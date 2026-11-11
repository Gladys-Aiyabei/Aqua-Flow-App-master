// AquaFlow API server. Stores everything in PostgreSQL (Supabase) and talks to PayHero for M-Pesa.
// Setup: see README "Database (Supabase)". Config lives in .env.local (git-ignored).
/* global __dirname, Buffer */
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Pool, types } = require('pg');

/** Loads KEY=value lines from .env.local (git-ignored). Existing environment variables win. */
function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach((line) => {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trim().startsWith('#')) return;
    const value = m[2].replace(/^(['"])(.*)\1$/, '$2');
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  });
}
loadEnvFile(path.join(__dirname, '.env.local'));

const PORT = Number(process.env.PORT) || 4000;
const STAFF_PIN = process.env.STAFF_PIN || '1234';
const PAYMENT_APPROVE_MS = 6000; // simulated M-Pesa approval delay (when PayHero isn't configured)
const SESSION_DAYS = 30;
const LIST_LIMIT = 300; // newest records sent to the app per list

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new HttpError(status, message); };

// ---------- database ----------

types.setTypeParser(1082, (v) => v); // date -> 'YYYY-MM-DD' (no timezone shifting)
types.setTypeParser(1700, (v) => (v === null ? null : Number(v))); // numeric -> number
types.setTypeParser(20, (v) => (v === null ? null : Number(v))); // bigint -> number

function dbConfig() {
  const raw = process.env.DATABASE_URL;
  if (!raw) {
    console.error('DATABASE_URL is not set. Add your Supabase connection string to .env.local (see .env.local.example).');
    process.exit(1);
  }
  // SSL is configured below, so drop libpq-style ssl flags that would override it.
  const url = new URL(raw);
  ['sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'uselibpqcompat'].forEach((k) => url.searchParams.delete(k));
  let ssl;
  if (process.env.DATABASE_SSL === 'disable') ssl = false; // local Postgres only
  else if (process.env.DATABASE_CA_CERT) ssl = { ca: fs.readFileSync(path.resolve(__dirname, process.env.DATABASE_CA_CERT), 'utf8') }; // encrypted + verified
  else ssl = { rejectUnauthorized: false }; // encrypted, like sslmode=require
  return { connectionString: url.toString(), ssl, max: Number(process.env.DATABASE_POOL_SIZE) || 10, idleTimeoutMillis: 30000 };
}

const pool = new Pool(dbConfig());
pool.on('error', (e) => console.error('Database connection error:', e.message));

/** Runs fn inside a transaction on one connection. */
async function tx(fn) {
  const c = await pool.connect();
  try {
    await c.query('begin');
    const result = await fn(c);
    await c.query('commit');
    return result;
  } catch (e) {
    await c.query('rollback').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}
const rows = async (db, text, params) => (await db.query(text, params)).rows;
const one = async (db, text, params) => (await db.query(text, params)).rows[0];

/** snake_case row -> camelCase object, as the app expects. */
const camel = (row) => (row ? Object.fromEntries(Object.entries(row).map(([k, v]) => [k.replace(/_([a-z])/g, (_, c) => c.toUpperCase()), v])) : row);

/** Builds "col = $n" pairs for an UPDATE from a { column: value } map, skipping undefined values. */
function setClause(values, startAt = 1) {
  const entries = Object.entries(values).filter(([, v]) => v !== undefined);
  return { sql: entries.map(([k], i) => `${k} = $${i + startAt}`).join(', '), params: entries.map(([, v]) => v) };
}

// ---------- PayHero (real M-Pesa STK push) ----------
// Docs: https://docs.payhero.co.ke/pay-hero-developer-apis/post-initiate-mpesa-stk-push-request
// Enabled when PAYHERO_CHANNEL_ID and either PAYHERO_AUTH_TOKEN or PAYHERO_API_USERNAME + PAYHERO_API_PASSWORD are set.

const payhero = (() => {
  const token = (process.env.PAYHERO_AUTH_TOKEN || '').trim();
  const user = process.env.PAYHERO_API_USERNAME;
  const pass = process.env.PAYHERO_API_PASSWORD;
  let auth = null;
  if (token) auth = /^Basic /i.test(token) ? token : `Basic ${token}`;
  else if (user && pass) auth = `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
  const channelId = Number(process.env.PAYHERO_CHANNEL_ID) || null;
  return {
    auth,
    channelId,
    baseUrl: (process.env.PAYHERO_BASE_URL || 'https://backend.payhero.co.ke').replace(/\/$/, ''),
    callbackUrl: process.env.PAYHERO_CALLBACK_URL || null, // public URL ending in /api/payhero/callback
    enabled: Boolean(auth && channelId),
  };
})();

async function payheroRequest(method, pathAndQuery, body) {
  let res;
  try {
    res = await fetch(`${payhero.baseUrl}${pathAndQuery}`, {
      method,
      headers: { Authorization: payhero.auth, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new HttpError(502, 'Could not reach PayHero. Check the server internet connection and try again.');
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) {
    const reason = json.error_message || json.message || json.error || json.detail || `status ${res.status}`;
    if (res.status === 401 || res.status === 403) throw new HttpError(502, 'PayHero rejected the API credentials. Check .env.local on the server.');
    throw new HttpError(502, `PayHero could not send the prompt: ${typeof reason === 'string' ? reason : JSON.stringify(reason)}`);
  }
  return json;
}

// ---------- helpers ----------

const toNumber = (v) => (v === '' || v === null || v === undefined ? NaN : Number(v));
const text = (v) => String(v ?? '').trim();
const localDateKey = (when) => {
  const d = new Date(when);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');
const receiptCode = () => crypto.randomBytes(5).toString('hex').toUpperCase().replace(/^./, 'S');

/** Accepts 0712345678, 712345678, +254712345678, 254712345678 (spaces allowed). Returns 2547XXXXXXXX or null. */
function normalizePhone(input) {
  const digits = String(input || '').replace(/\D/g, '');
  if (/^0[17]\d{8}$/.test(digits)) return `254${digits.slice(1)}`;
  if (/^[17]\d{8}$/.test(digits)) return `254${digits}`;
  if (/^254[17]\d{8}$/.test(digits)) return digits;
  return null;
}
const optionalPhone = (v, label) => (text(v) ? normalizePhone(v) || fail(400, `${label} is not a valid number.`) : null);

const ACTIVE_MISSION = ['scheduled', 'filling', 'en_route', 'discharging'];

// ---------- reading data in the shape the app expects ----------

async function getSettings(db = pool) {
  const s = camel(await one(db, 'select * from settings where id'));
  delete s.id;
  delete s.updatedAt;
  return { ...s, mpesaMode: payhero.enabled ? 'live' : 'simulation' };
}

async function withItems(db, orderRows) {
  if (!orderRows.length) return [];
  const items = await rows(db, 'select order_id, product_id, name, qty, unit_price, refill from order_items where order_id = any($1) order by id', [orderRows.map((o) => o.id)]);
  return orderRows.map((o) => ({
    ...camel(o),
    items: items.filter((i) => i.order_id === o.id).map(({ order_id: _ignored, ...i }) => camel(i)),
  }));
}
const getOrder = async (db, id) => (await withItems(db, await rows(db, 'select * from orders where id = $1', [id])))[0];

async function getTanks(db = pool) {
  const tanks = await rows(db, 'select * from tanks order by created_at, id');
  const readings = await rows(db, `
    select tank_id, level_l, recorded_at from (
      select *, row_number() over (partition by tank_id order by recorded_at desc) as n from tank_readings
    ) r where n <= 24 order by recorded_at`);
  return tanks.map((t) => ({
    ...camel(t),
    history: readings.filter((r) => r.tank_id === t.id).map((r) => ({ t: r.recorded_at, levelL: r.level_l })),
  }));
}

async function stateFor(sess) {
  if (sess.role === 'staff') {
    const [settings, tanks, products, orders, trucks, deliveries, feedback, payments, reconciliations] = await Promise.all([
      getSettings(),
      getTanks(),
      rows(pool, 'select * from products order by created_at, id'),
      rows(pool, 'select * from orders order by created_at desc limit $1', [LIST_LIMIT]).then((o) => withItems(pool, o)),
      rows(pool, 'select * from trucks order by created_at, id'),
      rows(pool, 'select * from deliveries order by created_at desc limit $1', [LIST_LIMIT]),
      rows(pool, 'select * from feedback order by created_at desc limit $1', [LIST_LIMIT]),
      rows(pool, 'select * from payments order by created_at desc limit $1', [LIST_LIMIT]),
      rows(pool, 'select * from reconciliations order by date desc, created_at desc limit $1', [LIST_LIMIT]),
    ]);
    return {
      settings, tanks, orders,
      products: products.map(camel), trucks: trucks.map(camel), deliveries: deliveries.map(camel),
      feedback: feedback.map(camel), payments: payments.map(camel), reconciliations: reconciliations.map(camel),
    };
  }
  // Customers only ever receive their own records and public settings.
  const [s, products, orders, deliveries, feedback] = await Promise.all([
    getSettings(),
    rows(pool, 'select * from products where active order by created_at, id'),
    rows(pool, 'select * from orders where customer_phone = $1 order by created_at desc limit $2', [sess.phone, LIST_LIMIT]).then((o) => withItems(pool, o)),
    rows(pool, 'select * from deliveries where customer_phone = $1 order by created_at desc limit $2', [sess.phone, LIST_LIMIT]),
    rows(pool, 'select * from feedback where customer_phone = $1 order by created_at desc limit $2', [sess.phone, LIST_LIMIT]),
  ]);
  return {
    settings: {
      companyName: s.companyName, hubName: s.hubName, tillNumber: s.tillNumber, supportPhone: s.supportPhone,
      bulkPricePerLitre: s.bulkPricePerLitre, mpesaMode: s.mpesaMode,
    },
    products: products.map(camel), orders, deliveries: deliveries.map(camel), feedback: feedback.map(camel),
  };
}

// ---------- sessions ----------

async function createSession(role, name, phone) {
  const token = crypto.randomBytes(32).toString('hex');
  await pool.query(
    `insert into sessions (token_hash, role, name, phone, expires_at) values ($1, $2, $3, $4, now() + make_interval(days => $5))`,
    [hashToken(token), role, name, phone, SESSION_DAYS],
  );
  return { token, role, name, phone };
}

async function sessionFor(req) {
  const match = /^Bearer ([a-f0-9]{64})$/.exec(req.headers.authorization || '');
  if (!match) return undefined;
  const hash = hashToken(match[1]);
  const s = await one(pool, 'select role, name, phone, last_seen_at from sessions where token_hash = $1 and expires_at > now()', [hash]);
  if (!s) return undefined;
  if (Date.now() - new Date(s.last_seen_at).getTime() > 3600000) {
    // Active users stay signed in: refresh at most once an hour.
    pool.query(`update sessions set last_seen_at = now(), expires_at = now() + make_interval(days => $2) where token_hash = $1`, [hash, SESSION_DAYS])
      .catch(() => {});
  }
  return { role: s.role, name: s.name, phone: s.phone };
}

const requireStaff = (sess) => (sess.role === 'staff' ? sess : fail(403, 'Only staff can do that.'));
const ownedBy = (sess, record) => sess.role === 'staff' || record.customer_phone === sess.phone;

// ---------- payments ----------

/** Marks the linked order or delivery as paid. */
async function markPaid(db, p) {
  const method = p.source === 'cash' ? 'cash' : 'mpesa';
  if (p.order_id) await db.query(`update orders set payment_status = 'paid', mpesa_ref = $2, payment_method = $3 where id = $1`, [p.order_id, p.mpesa_receipt, method]);
  if (p.delivery_id) await db.query(`update deliveries set payment_status = 'paid', mpesa_ref = $2, payment_method = $3 where id = $1`, [p.delivery_id, p.mpesa_receipt, method]);
}

/** Applies a final result once; later duplicates are ignored (the WHERE status = 'pending' makes this atomic). */
function settlePayment(id, ok, receipt, desc) {
  return tx(async (c) => {
    const p = await one(c, `
      update payments set status = $2, mpesa_receipt = $3, result_desc = $4, settled_at = now()
      where id = $1 and status = 'pending' returning *`,
    [id, ok ? 'success' : 'failed', ok ? receipt || null : null,
      desc || (ok ? 'Payment confirmed.' : 'The customer cancelled or the request timed out.')]);
    if (p && ok) await markPaid(c, p);
    return p;
  });
}

/** Asks PayHero for the latest status. Callbacks are not trusted on their own, so this is the source of truth. */
async function checkPayhero(id, force = false) {
  if (!payhero.enabled) return;
  // Claim the check atomically so parallel requests don't all call PayHero.
  const p = await one(pool, `
    update payments set last_checked_at = now()
    where id = $1 and status = 'pending' and provider = 'payhero' and provider_ref is not null
      and ($2 or last_checked_at is null or last_checked_at < now() - interval '2.5 seconds')
    returning provider_ref`, [id, force]);
  if (!p) return;
  try {
    const s = await payheroRequest('GET', `/api/v2/transaction-status?reference=${encodeURIComponent(p.provider_ref)}`);
    const status = String(s.status || '').toUpperCase();
    if (status === 'SUCCESS') await settlePayment(id, true, s.provider_reference || s.third_party_reference, 'The service request is processed successfully.');
    else if (status === 'FAILED') await settlePayment(id, false, null, s.result_desc || s.ResultDesc);
  } catch (e) {
    console.warn(`PayHero status check failed for ${id}: ${e.message}`);
  }
}

async function paymentTarget(sess, body) {
  if (body.orderId) {
    const o = await one(pool, 'select * from orders where id = $1', [body.orderId]);
    if (!o || !ownedBy(sess, o)) fail(404, 'Order not found.');
    if (o.status === 'cancelled') fail(400, 'This order was cancelled.');
    if (o.payment_status === 'paid') fail(400, 'This order is already paid.');
    return { order_id: o.id, delivery_id: null, amount: o.total, description: `Order ${o.id}`, payer_name: o.customer_name };
  }
  if (body.deliveryId) {
    const d = await one(pool, 'select * from deliveries where id = $1', [body.deliveryId]);
    if (!d || !ownedBy(sess, d)) fail(404, 'Delivery not found.');
    if (d.status === 'cancelled') fail(400, 'This delivery was cancelled.');
    if (d.payment_status === 'paid') fail(400, 'This delivery is already paid.');
    return { order_id: null, delivery_id: d.id, amount: d.amount, description: `Tanker ${d.id}`, payer_name: d.customer_name };
  }
  requireStaff(sess);
  const amount = toNumber(body.amount);
  if (!(amount > 0)) fail(400, 'Enter an amount greater than 0.');
  return { order_id: null, delivery_id: null, amount, description: text(body.description) || 'Water payment', payer_name: text(body.payerName) };
}

// ---------- stock & fleet ----------

async function restoreStock(c, orderId) {
  await c.query(`
    update products p set stock = p.stock + s.qty
    from (select product_id, sum(qty) as qty from order_items where order_id = $1 and product_id is not null group by product_id) s
    where p.id = s.product_id`, [orderId]);
}

async function syncTruck(c, d) {
  if (!d.truck_id) return;
  const status = ACTIVE_MISSION.includes(d.status) ? d.status : 'idle';
  await c.query(`update trucks set status = $2 where id = $1 and status <> 'maintenance'`, [d.truck_id, status]);
}

async function addReading(c, tankId, levelL) {
  await c.query('insert into tank_readings (tank_id, level_l) values ($1, $2)', [tankId, levelL]);
}

// ---------- http plumbing ----------

const send = (res, statusCode, payload) => {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  });
  res.end(statusCode === 204 ? undefined : JSON.stringify(payload));
};

const readBody = (req) => new Promise((resolve, reject) => {
  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
    if (body.length > 1e6) { req.destroy(); reject(new HttpError(413, 'Body too large')); }
  });
  req.on('end', () => {
    if (!body) return resolve({});
    try { return resolve(JSON.parse(body)); } catch { return reject(new HttpError(400, 'Invalid JSON')); }
  });
  req.on('error', reject);
});

// ---------- routes ----------

async function route(req, url) {
  const { pathname } = url;
  const method = req.method;
  const parts = pathname.split('/').filter(Boolean); // ['api', 'orders', 'ORD-1']
  const id = parts[2] ? decodeURIComponent(parts[2]) : undefined;

  if (pathname === '/api/health') {
    await pool.query('select 1');
    return { ok: true, service: 'aquaflow-api', database: 'ok' };
  }

  // --- auth ---
  if (pathname === '/api/auth/customer' && method === 'POST') {
    const body = await readBody(req);
    const name = text(body.name).replace(/\s+/g, ' ');
    const phone = normalizePhone(body.phone);
    if (name.length < 2) fail(400, 'Enter your name.');
    if (!phone) fail(400, 'Enter a valid Safaricom number, e.g. 0712 345 678.');
    await pool.query('insert into customers (phone, name) values ($1, $2) on conflict (phone) do update set name = excluded.name', [phone, name]);
    return createSession('customer', name, phone);
  }
  if (pathname === '/api/auth/staff' && method === 'POST') {
    const body = await readBody(req);
    if (String(body.pin || '') !== STAFF_PIN) fail(401, 'Invalid staff PIN.');
    return createSession('staff', text(body.name) || 'Operations Manager', null);
  }
  if (pathname === '/api/auth/logout' && method === 'POST') {
    const match = /^Bearer (.+)$/.exec(req.headers.authorization || '');
    if (match) await pool.query('delete from sessions where token_hash = $1', [hashToken(match[1])]);
    return { ok: true };
  }

  // PayHero calls this when the customer approves or cancels. The body is only used to find the payment;
  // the result is confirmed with PayHero's status API so a forged callback can't mark anything paid.
  if (pathname === '/api/payhero/callback' && method === 'POST') {
    const body = await readBody(req);
    const r = body.response || {};
    const p = await one(pool, `select id from payments where provider = 'payhero' and (id = $1 or ($2::text is not null and checkout_request_id = $2))`,
      [text(r.ExternalReference), r.CheckoutRequestID || null]);
    if (p) await checkPayhero(p.id, true);
    return { ok: true };
  }

  const sess = (await sessionFor(req)) || fail(401, 'Please sign in again.');

  if (pathname === '/api/state' && method === 'GET') {
    if (payhero.enabled) {
      // Keep pending PayHero payments moving even when nobody has the payment sheet open.
      const pending = await rows(pool, `select id from payments where provider = 'payhero' and status = 'pending' order by created_at desc limit 5`);
      pending.forEach((p) => { checkPayhero(p.id); });
    }
    return stateFor(sess);
  }

  // --- settings ---
  if (pathname === '/api/settings' && method === 'PATCH') {
    requireStaff(sess);
    const body = await readBody(req);
    const values = {};
    [['companyName', 'company_name'], ['hubName', 'hub_name'], ['tillNumber', 'till_number']].forEach(([k, col]) => {
      if (body[k] === undefined) return;
      values[col] = text(body[k]) || fail(400, 'Company name, hub and till number cannot be empty.');
    });
    if (body.supportPhone !== undefined) values.support_phone = optionalPhone(body.supportPhone, 'Support phone');
    [['bulkPricePerLitre', 'bulk_price_per_litre', 0, 1000], ['lowLevelPercent', 'low_level_percent', 1, 99],
      ['varianceThresholdPercent', 'variance_threshold_percent', 0, 100]].forEach(([k, col, min, max]) => {
      if (body[k] === undefined) return;
      const v = toNumber(body[k]);
      if (!(v >= min && v <= max)) fail(400, `${k} must be between ${min} and ${max}.`);
      values[col] = v;
    });
    const { sql, params } = setClause(values);
    if (sql) await pool.query(`update settings set ${sql} where id`, params);
    return getSettings();
  }

  // --- orders ---
  if (pathname === '/api/orders' && method === 'POST') {
    const body = await readBody(req);
    const requested = Array.isArray(body.items) ? body.items : [];
    if (!requested.length) fail(400, 'Your cart is empty.');

    let customerName; let customerPhone; let address = text(body.address);
    if (sess.role === 'customer') {
      customerName = sess.name;
      customerPhone = sess.phone;
      if (!address) fail(400, 'Enter a delivery address.');
    } else {
      customerName = text(body.customerName) || 'Walk-in customer';
      customerPhone = optionalPhone(body.customerPhone, 'Customer phone');
      address = address || 'Counter pickup';
    }

    const orderId = await tx(async (c) => {
      const used = {};
      const items = [];
      for (const item of requested) {
        // Lock the product row so two orders can't both take the last bottles.
        const product = await one(c, 'select * from products where id = $1 and active for update', [item.productId]);
        if (!product) fail(400, 'One of the products is no longer available.');
        const qty = Math.floor(toNumber(item.qty));
        if (!(qty > 0)) fail(400, 'Quantities must be at least 1.');
        used[product.id] = (used[product.id] || 0) + qty;
        if (used[product.id] > product.stock) fail(400, `Only ${product.stock} × ${product.name} left in stock.`);
        const refill = Boolean(item.refill && product.refill_price);
        items.push({ product, qty, refill, unitPrice: refill ? product.refill_price : product.price });
      }
      const total = items.reduce((s, i) => s + i.qty * i.unitPrice, 0);
      const order = await one(c, `
        insert into orders (customer_name, customer_phone, address, notes, total) values ($1, $2, $3, $4, $5) returning *`,
      [customerName, customerPhone, address, text(body.notes), total]);
      for (const i of items) {
        await c.query('insert into order_items (order_id, product_id, name, qty, unit_price, refill) values ($1, $2, $3, $4, $5, $6)',
          [order.id, i.product.id, i.product.name, i.qty, i.unitPrice, i.refill]);
      }
      for (const [productId, qty] of Object.entries(used)) {
        await c.query('update products set stock = stock - $2 where id = $1', [productId, qty]);
      }
      if (sess.role === 'staff' && body.paidCash) {
        const p = await one(c, `
          insert into payments (source, status, amount, phone, payer_name, description, order_id, settled_at, requested_by)
          values ('cash', 'success', $1, $2, $3, $4, $5, now(), 'staff') returning *`,
        [total, customerPhone, customerName, `Order ${order.id}`, order.id]);
        await markPaid(c, p);
      }
      return order.id;
    });
    return getOrder(pool, orderId);
  }

  if (parts[1] === 'orders' && id && (method === 'PATCH' || method === 'DELETE')) {
    const body = method === 'PATCH' ? await readBody(req) : {};
    await tx(async (c) => {
      const order = await one(c, 'select * from orders where id = $1 for update', [id]);
      if (!order || !ownedBy(sess, order)) fail(404, 'Order not found.');

      if (method === 'DELETE') {
        requireStaff(sess);
        if (order.status !== 'cancelled') await restoreStock(c, id);
        await c.query('delete from orders where id = $1', [id]);
        return;
      }

      if (sess.role === 'customer') {
        if (body.status !== 'cancelled' || Object.keys(body).length !== 1) fail(403, 'You can only cancel your order.');
        if (!['new', 'confirmed'].includes(order.status) || order.payment_status === 'paid') fail(400, 'This order can no longer be cancelled.');
      }
      const values = {};
      if (body.status !== undefined) {
        if (!['new', 'confirmed', 'dispatched', 'delivered', 'cancelled'].includes(body.status)) fail(400, 'Unknown order status.');
        if (order.status === 'cancelled' && body.status !== 'cancelled') fail(400, 'A cancelled order cannot be reopened.');
        if (body.status === 'cancelled' && order.status !== 'cancelled') await restoreStock(c, id);
        values.status = body.status;
        // cash on delivery: delivered orders are treated as paid
        if (body.status === 'delivered' && order.payment_status !== 'paid') Object.assign(values, { payment_status: 'paid', payment_method: 'cash' });
      }
      if (body.rider !== undefined) values.rider = text(body.rider);
      const { sql, params } = setClause(values, 2);
      if (sql) await c.query(`update orders set ${sql} where id = $1`, [id, ...params]);
      if (body.paidCash && order.payment_status !== 'paid') {
        const p = await one(c, `
          insert into payments (source, status, amount, phone, payer_name, description, order_id, settled_at, requested_by)
          values ('cash', 'success', $1, $2, $3, $4, $5, now(), 'staff') returning *`,
        [order.total, order.customer_phone, order.customer_name, `Order ${order.id}`, order.id]);
        await markPaid(c, p);
      }
    });
    return method === 'DELETE' ? { ok: true } : getOrder(pool, id);
  }

  // --- products ---
  const productValues = (body) => {
    const v = {};
    if (body.name !== undefined) v.name = text(body.name) || fail(400, 'Enter a product name.');
    if (body.size !== undefined) v.size = text(body.size) || '20L';
    if (body.description !== undefined) v.description = text(body.description);
    if (body.price !== undefined) { v.price = toNumber(body.price); if (!(v.price > 0)) fail(400, 'Enter a price greater than 0.'); }
    if (body.refillPrice !== undefined) {
      v.refill_price = text(body.refillPrice) === '' ? null : toNumber(body.refillPrice);
      if (v.refill_price !== null && !(v.refill_price > 0)) fail(400, 'Refill price must be greater than 0.');
    }
    if (body.stock !== undefined && text(body.stock) !== '') {
      v.stock = Math.floor(toNumber(body.stock));
      if (!(v.stock >= 0)) fail(400, 'Stock cannot be negative.');
    }
    if (body.active !== undefined) v.active = Boolean(body.active);
    return v;
  };
  if (pathname === '/api/products' && method === 'POST') {
    requireStaff(sess);
    const v = productValues(await readBody(req));
    if (!v.name) fail(400, 'Enter a product name.');
    if (v.price === undefined) fail(400, 'Enter a price greater than 0.');
    const cols = Object.keys(v);
    return camel(await one(pool, `insert into products (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning *`, Object.values(v)));
  }
  if (parts[1] === 'products' && id) {
    requireStaff(sess);
    if (method === 'PATCH') {
      const { restock, ...rest } = await readBody(req);
      const v = productValues(rest);
      let qty = 0;
      if (restock !== undefined) {
        qty = Math.floor(toNumber(restock));
        if (!(qty > 0)) fail(400, 'Restock quantity must be at least 1.');
      }
      // A restock adds to whatever stock ends up being (the edited value, or the current one).
      const editedStock = v.stock;
      delete v.stock;
      const { sql, params } = setClause(v, 3);
      const stockExpr = editedStock !== undefined ? 'stock = $2' : 'stock = stock + $2';
      const assignments = [sql, stockExpr].filter(Boolean).join(', ');
      const p = await one(pool, `update products set ${assignments} where id = $1 returning *`,
        [id, editedStock !== undefined ? editedStock + qty : qty, ...params]);
      return camel(p) || fail(404, 'Product not found.');
    }
    if (method === 'DELETE') {
      const r = await pool.query('delete from products where id = $1', [id]);
      return r.rowCount ? { ok: true } : fail(404, 'Product not found.');
    }
  }

  // --- tanks ---
  if (pathname === '/api/tanks' && method === 'POST') {
    requireStaff(sess);
    const body = await readBody(req);
    const name = text(body.name) || fail(400, 'Enter a tank name.');
    const capacityL = toNumber(body.capacityL);
    const levelL = toNumber(body.levelL) || 0;
    if (!(capacityL > 0)) fail(400, 'Enter the tank capacity.');
    if (levelL < 0 || levelL > capacityL) fail(400, 'Level must be between 0 and the tank capacity.');
    const tankId = await tx(async (c) => {
      const t = await one(c, 'insert into tanks (name, type, location, capacity_l, level_l) values ($1, $2, $3, $4, $5) returning id',
        [name, text(body.type) || 'Storage tank', text(body.location), capacityL, levelL]);
      await addReading(c, t.id, levelL);
      return t.id;
    });
    return (await getTanks()).find((t) => t.id === tankId);
  }
  if (parts[1] === 'tanks' && id) {
    requireStaff(sess);
    if (method === 'PATCH') {
      const body = await readBody(req);
      await tx(async (c) => {
        const tank = await one(c, 'select * from tanks where id = $1 for update', [id]);
        if (!tank) fail(404, 'Tank not found.');
        const v = {};
        if (body.name !== undefined) v.name = text(body.name) || fail(400, 'Enter a tank name.');
        if (body.type !== undefined) v.type = text(body.type) || 'Storage tank';
        if (body.location !== undefined) v.location = text(body.location);
        [['capacityL', 'capacity_l'], ['levelL', 'level_l'], ['inflowLph', 'inflow_lph'], ['outflowLph', 'outflow_lph'],
          ['ph', 'ph'], ['turbidity', 'turbidity'], ['chlorine', 'chlorine']].forEach(([k, col]) => {
          if (body[k] === undefined || text(body[k]) === '') return; // blank = unchanged
          v[col] = toNumber(body[k]);
          if (!Number.isFinite(v[col]) || v[col] < 0) fail(400, 'Values must be numbers of 0 or more.');
        });
        const capacity = v.capacity_l ?? tank.capacity_l;
        if (!(capacity > 0)) fail(400, 'Enter the tank capacity.');
        if ((v.level_l ?? tank.level_l) > capacity) fail(400, 'Level cannot be more than the tank capacity.');
        const { sql, params } = setClause(v, 2);
        if (sql) await c.query(`update tanks set ${sql} where id = $1`, [id, ...params]);
        if (v.level_l !== undefined) await addReading(c, id, v.level_l);
      });
      return (await getTanks()).find((t) => t.id === id);
    }
    if (method === 'DELETE') {
      const r = await pool.query('delete from tanks where id = $1', [id]);
      return r.rowCount ? { ok: true } : fail(404, 'Tank not found.');
    }
  }

  // --- trucks ---
  const truckValues = (body) => {
    const v = {};
    if (body.unit !== undefined) v.unit = text(body.unit) || fail(400, 'Enter a unit name.');
    if (body.plate !== undefined) v.plate = text(body.plate).toUpperCase();
    if (body.capacityL !== undefined) { v.capacity_l = toNumber(body.capacityL); if (!(v.capacity_l > 0)) fail(400, 'Enter the tank capacity.'); }
    if (body.driverName !== undefined) v.driver_name = text(body.driverName);
    if (body.driverPhone !== undefined) v.driver_phone = optionalPhone(body.driverPhone, 'Driver phone');
    return v;
  };
  if (pathname === '/api/trucks' && method === 'POST') {
    requireStaff(sess);
    const v = truckValues(await readBody(req));
    if (!v.unit) fail(400, 'Enter a unit name.');
    if (v.capacity_l === undefined) fail(400, 'Enter the tank capacity.');
    const cols = Object.keys(v);
    return camel(await one(pool, `insert into trucks (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning *`, Object.values(v)));
  }
  if (parts[1] === 'trucks' && id) {
    requireStaff(sess);
    if (method === 'PATCH') {
      const body = await readBody(req);
      const v = truckValues(body);
      if (body.status !== undefined) {
        if (!['idle', 'maintenance'].includes(body.status)) fail(400, 'Use the mission screen to change trip status.');
        v.status = body.status;
      }
      return tx(async (c) => {
        const truck = await one(c, 'select * from trucks where id = $1 for update', [id]);
        if (!truck) fail(404, 'Tanker not found.');
        if (v.status && ACTIVE_MISSION.includes(truck.status)) fail(400, 'This tanker is on a mission.');
        const { sql, params } = setClause(v, 2);
        return camel(sql ? await one(c, `update trucks set ${sql} where id = $1 returning *`, [id, ...params]) : truck);
      });
    }
    if (method === 'DELETE') {
      const busy = await one(pool, 'select 1 from deliveries where truck_id = $1 and status = any($2)', [id, ACTIVE_MISSION]);
      if (busy) fail(400, 'This tanker is on a mission.');
      const r = await pool.query('delete from trucks where id = $1', [id]);
      return r.rowCount ? { ok: true } : fail(404, 'Tanker not found.');
    }
  }

  // --- bulk deliveries ---
  if (pathname === '/api/deliveries' && method === 'POST') {
    const body = await readBody(req);
    const volumeL = Math.floor(toNumber(body.volumeL));
    const destination = text(body.destination);
    if (!(volumeL >= 500)) fail(400, 'Minimum tanker order is 500 L.');
    if (!destination) fail(400, 'Enter a delivery location.');
    return tx(async (c) => {
      const { bulk_price_per_litre: price } = await one(c, 'select bulk_price_per_litre from settings where id');
      const d = {
        destination, volume_l: volumeL, notes: text(body.notes), amount: Math.round(volumeL * price), status: 'requested',
        truck_id: null, source_tank_id: null,
      };
      if (sess.role === 'customer') {
        d.customer_name = sess.name;
        d.customer_phone = sess.phone;
      } else {
        d.customer_name = text(body.customerName) || fail(400, 'Enter the customer or site name.');
        d.customer_phone = optionalPhone(body.customerPhone, 'Customer phone');
        if (body.truckId) {
          const truck = await one(c, 'select * from trucks where id = $1 for update', [body.truckId]);
          if (!truck) fail(404, 'Tanker not found.');
          if (truck.status !== 'idle') fail(400, `${truck.unit} is not available.`);
          d.truck_id = truck.id;
          d.source_tank_id = body.sourceTankId || null;
          d.status = 'scheduled';
        }
      }
      const cols = Object.keys(d);
      const row = await one(c, `insert into deliveries (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning *`, Object.values(d));
      await syncTruck(c, row);
      return camel(row);
    });
  }
  if (parts[1] === 'deliveries' && id && method === 'PATCH') {
    const body = await readBody(req);
    return tx(async (c) => {
      const d = await one(c, 'select * from deliveries where id = $1 for update', [id]);
      if (!d || !ownedBy(sess, d)) fail(404, 'Delivery not found.');
      if (sess.role === 'customer') {
        if (body.status !== 'cancelled' || d.status !== 'requested') fail(403, 'You can only cancel a request before a tanker is assigned.');
        return camel(await one(c, `update deliveries set status = 'cancelled' where id = $1 returning *`, [id]));
      }
      const v = {};
      if (body.truckId !== undefined) {
        const truck = await one(c, 'select * from trucks where id = $1 for update', [body.truckId]);
        if (!truck) fail(404, 'Tanker not found.');
        if (truck.status !== 'idle' && truck.id !== d.truck_id) fail(400, `${truck.unit} is not available.`);
        if (d.truck_id && d.truck_id !== truck.id) await c.query(`update trucks set status = 'idle' where id = $1 and status <> 'maintenance'`, [d.truck_id]);
        v.truck_id = truck.id;
        if (d.status === 'requested') v.status = 'scheduled';
      }
      if (body.sourceTankId !== undefined) v.source_tank_id = body.sourceTankId || null;
      if (body.status !== undefined) {
        const flow = ['requested', 'scheduled', 'filling', 'en_route', 'discharging', 'delivered'];
        if (body.status !== 'cancelled' && !flow.includes(body.status)) fail(400, 'Unknown delivery status.');
        if (['delivered', 'cancelled'].includes(d.status)) fail(400, 'This mission is already closed.');
        if (!['cancelled', 'requested'].includes(body.status) && !(v.truck_id || d.truck_id)) fail(400, 'Assign a tanker first.');
        // Water leaves the source tank once filling finishes.
        if (body.status === 'en_route' && !d.loaded_at) {
          v.loaded_at = new Date();
          const tank = await one(c, 'update tanks set level_l = greatest(0, level_l - $2) where id = $1 returning id, level_l',
            [v.source_tank_id ?? d.source_tank_id, d.volume_l]);
          if (tank) await addReading(c, tank.id, tank.level_l);
        }
        v.status = body.status;
      }
      const { sql, params } = setClause(v, 2);
      const row = sql ? await one(c, `update deliveries set ${sql} where id = $1 returning *`, [id, ...params]) : d;
      await syncTruck(c, row);
      return camel(row);
    });
  }

  // --- feedback ---
  if (pathname === '/api/feedback' && method === 'POST') {
    if (sess.role !== 'customer') fail(403, 'Feedback is sent from the customer app.');
    const body = await readBody(req);
    const rating = Math.round(toNumber(body.rating));
    const message = text(body.message);
    if (!(rating >= 1 && rating <= 5)) fail(400, 'Choose a rating from 1 to 5 stars.');
    if (!message) fail(400, 'Write a short message.');
    if (body.orderId && !(await one(pool, 'select 1 from orders where id = $1 and customer_phone = $2', [body.orderId, sess.phone]))) fail(400, 'Order not found.');
    return camel(await one(pool, `
      insert into feedback (customer_name, customer_phone, rating, category, message, location, order_id)
      values ($1, $2, $3, $4, $5, $6, $7) returning *`,
    [sess.name, sess.phone, rating, text(body.category) || 'Other', message, text(body.location), body.orderId || null]));
  }
  if (parts[1] === 'feedback' && id && method === 'PATCH') {
    requireStaff(sess);
    const body = await readBody(req);
    const reply = text(body.reply) || fail(400, 'Write a reply.');
    const fb = await one(pool, `update feedback set reply = $2, status = 'resolved', replied_by = $3, replied_at = now() where id = $1 returning *`, [id, reply, sess.name]);
    return camel(fb) || fail(404, 'Feedback not found.');
  }

  // --- payments ---
  if (pathname === '/api/payments/stk' && method === 'POST') {
    const body = await readBody(req);
    const phone = normalizePhone(body.phone) || fail(400, 'Enter a valid M-Pesa number, e.g. 0712 345 678.');
    const target = await paymentTarget(sess, body);
    const amount = Math.round(target.amount);
    if (!(amount >= 1)) fail(400, 'Amount must be at least KES 1.');
    const payment = await one(pool, `
      insert into payments (source, status, amount, phone, payer_name, description, order_id, delivery_id, provider, requested_by)
      values ('stk', 'pending', $1, $2, $3, $4, $5, $6, $7, $8) returning *`,
    [amount, phone, target.payer_name, target.description, target.order_id, target.delivery_id,
      payhero.enabled ? 'payhero' : null, sess.role === 'customer' ? sess.phone : 'staff']);

    if (!payhero.enabled) {
      setTimeout(() => {
        settlePayment(payment.id, true, receiptCode(), 'The service request is processed successfully.').catch((e) => console.error(e));
      }, PAYMENT_APPROVE_MS);
      return { payment: camel(payment) };
    }
    try {
      const res = await payheroRequest('POST', '/api/v2/payments', {
        amount,
        phone_number: `0${phone.slice(3)}`,
        channel_id: payhero.channelId,
        provider: 'm-pesa',
        external_reference: payment.id,
        customer_name: target.payer_name || (sess.role === 'customer' ? sess.name : undefined),
        ...(payhero.callbackUrl ? { callback_url: payhero.callbackUrl } : {}),
      });
      if (!res.reference) fail(502, 'PayHero did not return a payment reference.');
      const updated = await one(pool, 'update payments set provider_ref = $2, checkout_request_id = $3 where id = $1 returning *',
        [payment.id, res.reference, res.CheckoutRequestID || null]);
      return { payment: camel(updated) };
    } catch (e) {
      await pool.query(`update payments set status = 'failed', result_desc = $2, settled_at = now() where id = $1`, [payment.id, e.message]);
      throw e;
    }
  }
  if (pathname === '/api/payments/manual' && method === 'POST') {
    requireStaff(sess);
    const body = await readBody(req);
    const source = body.method === 'cash' ? 'cash' : 'till';
    const amount = toNumber(body.amount);
    if (!(amount > 0)) fail(400, 'Enter the amount received.');
    const receipt = text(body.mpesaReceipt).toUpperCase();
    if (source === 'till' && !/^[A-Z0-9]{8,12}$/.test(receipt)) fail(400, 'Enter the M-Pesa code from the till SMS, e.g. QKH4891MN.');
    return tx(async (c) => {
      const p = await one(c, `
        insert into payments (source, status, amount, mpesa_receipt, phone, payer_name, description, order_id, delivery_id, settled_at, requested_by)
        values ($1, 'success', $2, $3, $4, $5, $6, $7, $8, now(), 'staff') returning *`,
      [source, amount, source === 'till' ? receipt : null, optionalPhone(body.phone, 'Phone'), text(body.payerName),
        text(body.description) || 'Till payment', body.orderId || null, body.deliveryId || null]);
      await markPaid(c, p);
      return camel(p);
    });
  }
  if (parts[1] === 'payments' && id && method === 'GET') {
    let p = await one(pool, 'select * from payments where id = $1', [id]);
    if (!p || (sess.role !== 'staff' && p.requested_by !== sess.phone)) fail(404, 'Payment not found.');
    if (p.status === 'pending' && p.provider === 'payhero') {
      await checkPayhero(id);
      p = await one(pool, 'select * from payments where id = $1', [id]);
    }
    return camel(p);
  }

  // --- reconciliation ---
  if (pathname === '/api/reconciliations/draft' && method === 'GET') {
    requireStaff(sess);
    const tank = await one(pool, 'select * from tanks where id = $1', [url.searchParams.get('tankId')]);
    if (!tank) fail(404, 'Tank not found.');
    const date = url.searchParams.get('date') || localDateKey(Date.now());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail(400, 'Invalid date.');
    // Fetch a 3-day window, then pick the server's local calendar day (set TZ=Africa/Nairobi on the server).
    const from = new Date(`${date}T00:00:00`); from.setDate(from.getDate() - 1);
    const to = new Date(`${date}T00:00:00`); to.setDate(to.getDate() + 2);
    const readings = (await rows(pool, 'select level_l, recorded_at from tank_readings where tank_id = $1 and recorded_at >= $2 and recorded_at < $3 order by recorded_at',
      [tank.id, from, to])).filter((r) => localDateKey(r.recorded_at) === date);
    const loads = (await rows(pool, `select volume_l, loaded_at from deliveries where source_tank_id = $1 and loaded_at >= $2 and loaded_at < $3 and status <> 'cancelled'`,
      [tank.id, from, to])).filter((d) => localDateKey(d.loaded_at) === date);
    return {
      tankId: tank.id, date,
      openingL: readings.length ? readings[0].level_l : tank.level_l,
      loadedL: loads.reduce((s, d) => s + d.volume_l, 0),
      actualL: readings.length ? readings[readings.length - 1].level_l : null,
    };
  }
  if (pathname === '/api/reconciliations' && method === 'POST') {
    requireStaff(sess);
    const body = await readBody(req);
    const date = text(body.date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail(400, 'Invalid date.');
    const [openingL, receivedL, loadedL, otherOutL, actualL] = ['openingL', 'receivedL', 'loadedL', 'otherOutL', 'actualL'].map((k) => toNumber(body[k] ?? 0));
    if ([openingL, receivedL, loadedL, otherOutL, actualL].some((n) => !Number.isFinite(n) || n < 0)) fail(400, 'All volumes must be 0 or more.');
    return tx(async (c) => {
      const tank = await one(c, 'select id, name from tanks where id = $1', [body.tankId]);
      if (!tank) fail(404, 'Tank not found.');
      const { variance_threshold_percent: limit } = await one(c, 'select variance_threshold_percent from settings where id');
      const expectedL = openingL + receivedL - loadedL - otherOutL;
      const varianceL = actualL - expectedL;
      const variancePct = expectedL > 0 ? Math.round((varianceL / expectedL) * 1000) / 10 : 0;
      const flagged = Math.abs(variancePct) > limit;
      const explanation = text(body.explanation);
      if (flagged && !explanation) fail(400, 'Variance is over the limit: add an explanation.');
      const values = [tank.id, tank.name, date, openingL, receivedL, loadedL, otherOutL, expectedL, actualL, varianceL, variancePct, flagged,
        text(body.reason) || 'Other', explanation, Boolean(body.autoGenerated), sess.name];
      // One record per tank per day; editing keeps the earlier version in "revisions".
      const row = await one(c, `
        insert into reconciliations (tank_id, tank_name, date, opening_l, received_l, loaded_l, other_out_l, expected_l, actual_l,
                                     variance_l, variance_pct, flagged, reason, explanation, auto_generated, prepared_by)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
        on conflict (tank_id, date) do update set
          revisions = reconciliations.revisions || jsonb_build_array(to_jsonb(reconciliations) - 'revisions'),
          tank_name = excluded.tank_name, opening_l = excluded.opening_l, received_l = excluded.received_l, loaded_l = excluded.loaded_l,
          other_out_l = excluded.other_out_l, expected_l = excluded.expected_l, actual_l = excluded.actual_l, variance_l = excluded.variance_l,
          variance_pct = excluded.variance_pct, flagged = excluded.flagged, reason = excluded.reason, explanation = excluded.explanation,
          auto_generated = excluded.auto_generated, prepared_by = excluded.prepared_by, reviewed_by = null, reviewed_at = null, created_at = now()
        returning *`, values);
      return camel(row);
    });
  }
  if (parts[1] === 'reconciliations' && id && method === 'PATCH') {
    requireStaff(sess);
    const body = await readBody(req);
    const rec = body.reviewed
      ? await one(pool, 'update reconciliations set reviewed_by = $2, reviewed_at = now() where id = $1 returning *', [id, sess.name])
      : await one(pool, 'select * from reconciliations where id = $1', [id]);
    return camel(rec) || fail(404, 'Reconciliation not found.');
  }

  return fail(404, 'Not found');
}

/** Turns database constraint errors into short messages instead of 500s. */
function dbErrorMessage(e) {
  if (e.code === '23505') {
    if (/mpesa_receipt/.test(e.constraint || '')) return 'That M-Pesa code has already been recorded.';
    return 'That record already exists.';
  }
  if (e.code === '23503') return 'This is linked to another record that no longer exists.';
  if (e.code === '23514' || e.code === '22P02' || e.code === '22003') return 'One of the values is not allowed.';
  return null;
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204);
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    return send(res, 200, await route(req, url));
  } catch (error) {
    if (error instanceof HttpError) return send(res, error.status, { error: error.message });
    const friendly = dbErrorMessage(error);
    if (friendly) return send(res, 400, { error: friendly });
    console.error(error);
    return send(res, 500, { error: 'Something went wrong on the server. Please try again.' });
  }
});

async function start() {
  try {
    await pool.query('select 1 from settings limit 1');
    await pool.query('delete from sessions where expires_at < now()');
  } catch (e) {
    if (e.code === '42P01') console.error('The AquaFlow tables are missing. Run supabase/migrations/*.sql in the Supabase SQL Editor (or `npm run db:setup`).');
    else console.error(`Could not connect to the database: ${e.message}`);
    process.exit(1);
  }
  server.listen(PORT, () => {
    console.log(`AquaFlow API listening on http://localhost:${PORT} · database connected`);
    if (STAFF_PIN === '1234') console.warn('Staff PIN is the demo PIN 1234. Set STAFF_PIN in .env.local before going live.');
    console.log(payhero.enabled
      ? `M-Pesa: PayHero live (channel ${payhero.channelId})${payhero.callbackUrl ? '' : ' · no PAYHERO_CALLBACK_URL, using status checks only'}`
      : 'M-Pesa: simulation (add PayHero keys to .env.local to go live)');
  });
}

const shutdown = () => { server.close(); pool.end().finally(() => process.exit(0)); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

start();
