// AquaFlow API: one request handler shared by the local server (server.js) and the
// Netlify function (netlify/functions/api.mjs). Takes a web Request, returns a web Response.
//
// Access rules (enforced here, never only in the app):
//   admin    - everything, every branch; manages branches, staff, products and settings
//   staff    - only records of their own branch
//   customer - only their own orders, deliveries, payments and feedback
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Buffer } from 'node:buffer';
import pg from 'pg';

const { Pool, types } = pg;

const SESSION_DAYS = 30;
const LIST_LIMIT = 300; // newest records sent to the app per list
const PAYMENT_APPROVE_SECONDS = 6; // simulated M-Pesa approval delay (when PayHero isn't configured)
const APP_TIMEZONE = process.env.APP_TIMEZONE || 'Africa/Nairobi';
const MAX_LOGIN_FAILURES = 5; // per email, per 15 minutes
const MAX_IP_FAILURES = 20; // per IP address, per 15 minutes
const MAX_SIGNUPS_PER_IP = 10; // per hour
const MIN_PASSWORD = 8;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new HttpError(status, message); };

// ---------- database ----------

types.setTypeParser(1082, (v) => v); // date -> 'YYYY-MM-DD'
types.setTypeParser(1700, (v) => (v === null ? null : Number(v))); // numeric -> number
types.setTypeParser(20, (v) => (v === null ? null : Number(v))); // bigint -> number

function dbConfig() {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new HttpError(500, 'The server is missing DATABASE_URL (the Supabase connection string).');
  // SSL is configured below, so drop libpq-style ssl flags that would override it.
  const url = new URL(raw);
  ['sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'uselibpqcompat'].forEach((k) => url.searchParams.delete(k));
  let ssl;
  if (process.env.DATABASE_SSL === 'disable') ssl = false; // local Postgres only
  else if (process.env.DATABASE_CA_CERT) ssl = { ca: fs.readFileSync(path.resolve(process.cwd(), process.env.DATABASE_CA_CERT), 'utf8') };
  else ssl = { rejectUnauthorized: false }; // encrypted, like sslmode=require
  const serverless = Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NETLIFY);
  return {
    connectionString: url.toString(),
    ssl,
    max: Number(process.env.DATABASE_POOL_SIZE) || (serverless ? 2 : 10),
    idleTimeoutMillis: serverless ? 10000 : 30000,
    connectionTimeoutMillis: 10000,
  };
}

// Created on first request and reused while the server (or a warm function instance) stays alive.
let pool;
function getPool() {
  if (!pool) {
    pool = new Pool(dbConfig());
    pool.on('error', (e) => console.error('Database connection error:', e.message));
  }
  return pool;
}

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
const rows = async (db, sql, params) => (await db.query(sql, params)).rows;
const one = async (db, sql, params) => (await db.query(sql, params)).rows[0];

/** snake_case row -> camelCase object, as the app expects. */
const camel = (row) => (row ? Object.fromEntries(Object.entries(row).map(([k, v]) => [k.replace(/_([a-z])/g, (_, c) => c.toUpperCase()), v])) : row);

/** Builds "col = $n" pairs for an UPDATE from a { column: value } map, skipping undefined values. */
function setClause(values, startAt = 1) {
  const entries = Object.entries(values).filter(([, v]) => v !== undefined);
  return { sql: entries.map(([k], i) => `${k} = $${i + startAt}`).join(', '), params: entries.map(([, v]) => v) };
}
const insertSql = (table, values) => {
  const cols = Object.keys(values);
  return { sql: `insert into ${table} (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning *`, params: Object.values(values) };
};

// ---------- PayHero (real M-Pesa STK push) ----------
// Docs: https://docs.payhero.co.ke/pay-hero-developer-apis/post-initiate-mpesa-stk-push-request

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
    // Public URL ending in /api/payhero/callback. On Netlify it defaults to the site's own address.
    callbackUrl: process.env.PAYHERO_CALLBACK_URL || (process.env.URL ? `${process.env.URL.replace(/\/$/, '')}/api/payhero/callback` : null),
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
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new HttpError(502, 'Could not reach PayHero. Check the server internet connection and try again.');
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) {
    const reason = json.error_message || json.message || json.error || json.detail || `status ${res.status}`;
    if (res.status === 401 || res.status === 403) throw new HttpError(502, 'PayHero rejected the API credentials. Check the server settings.');
    throw new HttpError(502, `PayHero could not send the prompt: ${typeof reason === 'string' ? reason : JSON.stringify(reason)}`);
  }
  return json;
}

// ---------- small helpers ----------

const toNumber = (v) => (v === '' || v === null || v === undefined ? NaN : Number(v));
const text = (v, max = 500) => String(v ?? '').trim().slice(0, max);
const dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: APP_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
/** Calendar day (YYYY-MM-DD) in APP_TIMEZONE, whatever timezone the server runs in. */
const localDateKey = (when) => dayFormat.format(new Date(when));
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

/** Accepts 0712345678, 712345678, +254712345678, 254712345678 (spaces allowed). Returns 2547XXXXXXXX or null. */
function normalizePhone(input) {
  const digits = String(input || '').replace(/\D/g, '');
  if (/^0[17]\d{8}$/.test(digits)) return `254${digits.slice(1)}`;
  if (/^[17]\d{8}$/.test(digits)) return `254${digits}`;
  if (/^254[17]\d{8}$/.test(digits)) return digits;
  return null;
}
const optionalPhone = (v, label) => (text(v) ? normalizePhone(v) || fail(400, `${label} is not a valid number.`) : null);

const normalizeEmail = (v) => {
  const e = text(v, 254).toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) ? e : null;
};

const ACTIVE_MISSION = ['scheduled', 'filling', 'en_route', 'discharging'];

/** Optional pinned location from the app: both numbers or neither. */
function pinFrom(body) {
  if (body.latitude === undefined && body.longitude === undefined) return { latitude: null, longitude: null };
  const lat = Number(body.latitude);
  const lng = Number(body.longitude);
  if (!(Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180)) fail(400, 'That location could not be read. Try "Use my current location" again.');
  return { latitude: Math.round(lat * 1e6) / 1e6, longitude: Math.round(lng * 1e6) / 1e6 };
}

// ---------- passwords & sign-in limits ----------

const scrypt = (password, salt, N) => new Promise((resolve, reject) => {
  crypto.scrypt(password, salt, 64, { N, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (e, key) => (e ? reject(e) : resolve(key)));
});

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, 16384);
  return `scrypt$16384$${salt.toString('base64')}$${key.toString('base64')}`;
}

async function verifyPassword(password, stored) {
  const [alg, n, salt, hash] = String(stored || '').split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const key = await scrypt(password, Buffer.from(salt, 'base64'), Number(n));
  const expected = Buffer.from(hash, 'base64');
  return expected.length === key.length && crypto.timingSafeEqual(expected, key);
}

// Used so a login for an unknown email takes as long as one for a real account.
const DUMMY_HASH = 'scrypt$16384$AAAAAAAAAAAAAAAAAAAAAA==$' + Buffer.alloc(64).toString('base64');

function checkPasswordStrength(p) {
  if (typeof p !== 'string' || p.length < MIN_PASSWORD) fail(400, `Use a password of at least ${MIN_PASSWORD} characters.`);
  if (p.length > 128) fail(400, 'That password is too long.');
  if (!/[A-Za-z]/.test(p) || !/\d/.test(p)) fail(400, 'Use at least one letter and one number in the password.');
}

async function assertNotLocked(keys) {
  const locked = await one(pool, 'select max(locked_until) as until from auth_throttle where key = any($1) and locked_until > now()', [keys]);
  if (locked?.until) {
    const minutes = Math.max(1, Math.ceil((new Date(locked.until) - Date.now()) / 60000));
    fail(429, `Too many attempts. Try again in ${minutes} minute${minutes > 1 ? 's' : ''}.`);
  }
}

/** Counts an attempt for each key; a key is locked once it reaches its limit within the window. */
async function recordAttempt(entries, windowMinutes = 15) {
  for (const [key, max] of entries) {
    await pool.query(`
      insert into auth_throttle (key, failures, window_start) values ($1, 1, now())
      on conflict (key) do update set
        failures = case when auth_throttle.window_start < now() - make_interval(mins => $2) then 1 else auth_throttle.failures + 1 end,
        window_start = case when auth_throttle.window_start < now() - make_interval(mins => $2) then now() else auth_throttle.window_start end`,
    [key, windowMinutes]);
    await pool.query(`update auth_throttle set locked_until = now() + make_interval(mins => $3), failures = 0, window_start = now()
      where key = $1 and failures >= $2`, [key, max, windowMinutes]);
  }
}
const clearAttempts = (key) => pool.query('delete from auth_throttle where key = $1', [key]);

// ---------- sessions ----------

async function createSession(user) {
  const token = crypto.randomBytes(32).toString('hex');
  await pool.query(`insert into sessions (token_hash, user_id, expires_at) values ($1, $2, now() + make_interval(days => $3))`,
    [hashToken(token), user.id, SESSION_DAYS]);
  await pool.query('update users set last_login_at = now() where id = $1', [user.id]);
  return { token, ...publicUser(user) };
}

const publicUser = (u) => ({
  id: u.id, email: u.email, name: u.name, phone: u.phone, role: u.role,
  branchId: u.branch_id, mustChangePassword: u.must_change_password,
});

async function sessionFor(ctx) {
  const match = /^Bearer ([a-f0-9]{64})$/.exec(ctx.header('authorization') || '');
  if (!match) return undefined;
  const hash = hashToken(match[1]);
  // Joining users means a deactivated account, or a changed role/branch, takes effect on the next request.
  const s = await one(pool, `
    select s.last_seen_at, u.* from sessions s join users u on u.id = s.user_id
    where s.token_hash = $1 and s.expires_at > now() and u.active`, [hash]);
  if (!s) return undefined;
  if (Date.now() - new Date(s.last_seen_at).getTime() > 3600000) {
    await pool.query(`update sessions set last_seen_at = now(), expires_at = now() + make_interval(days => $2) where token_hash = $1`, [hash, SESSION_DAYS]);
  }
  return {
    tokenHash: hash, userId: s.id, role: s.role, name: s.name, email: s.email, phone: s.phone,
    branchId: s.branch_id, mustChangePassword: s.must_change_password,
  };
}

const requireRole = (sess, ...roles) => (roles.includes(sess.role) ? sess : fail(403, 'You do not have access to that.'));
const requireAdmin = (sess) => requireRole(sess, 'admin');
const requireTeam = (sess) => requireRole(sess, 'admin', 'staff');

/** Can this user see or change a record? Staff: same branch. Customers: their own. Admin: anything. */
function canTouch(sess, row) {
  if (!row) return false;
  if (sess.role === 'admin') return true;
  if (sess.role === 'staff') return row.branch_id === sess.branchId;
  return row.customer_id === sess.userId;
}
const mustTouch = (sess, row, label) => (canTouch(sess, row) ? row : fail(404, `${label} not found.`));

/** Branch filter for lists: staff always their own; admin optional ?branchId=. */
const viewBranch = (sess, ctx) => (sess.role === 'staff' ? sess.branchId : ctx.url.searchParams.get('branchId') || null);

/** Branch for a new record made by the team. */
async function targetBranch(sess, ctx, body, db = pool) {
  if (sess.role === 'staff') return sess.branchId;
  const id = text(body?.branchId) || ctx.url.searchParams.get('branchId');
  if (!id) fail(400, 'Choose a branch first (use the branch picker at the top).');
  if (!(await one(db, 'select 1 from branches where id = $1', [id]))) fail(400, 'That branch does not exist.');
  return id;
}

// ---------- activity log ----------

async function logActivity(db, ctx, sess, { action, entity = null, entityId = null, summary = '', amount = null, branchId = null }) {
  await db.query(`
    insert into activity_log (user_id, user_email, user_role, branch_id, action, entity, entity_id, summary, amount, ip)
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
  [sess?.userId ?? null, sess?.email ?? null, sess?.role ?? null, branchId ?? (sess?.role === 'staff' ? sess.branchId : null),
    action, entity, entityId, text(summary, 300), amount, ctx.ip]);
}

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
    items: items.filter((i) => i.order_id === o.id).map((i) => ({
      productId: i.product_id, name: i.name, qty: i.qty, unitPrice: i.unit_price, refill: i.refill,
    })),
  }));
}
const getOrder = async (db, id) => (await withItems(db, await rows(db, 'select * from orders where id = $1', [id])))[0];

async function getTanks(db, branchId) {
  const tanks = await rows(db, 'select * from tanks where ($1::text is null or branch_id = $1) order by created_at, id', [branchId]);
  if (!tanks.length) return [];
  const readings = await rows(db, `
    select tank_id, level_l, recorded_at from (
      select *, row_number() over (partition by tank_id order by recorded_at desc) as n from tank_readings where tank_id = any($1)
    ) r where n <= 24 order by recorded_at`, [tanks.map((t) => t.id)]);
  return tanks.map((t) => ({
    ...camel(t),
    history: readings.filter((r) => r.tank_id === t.id).map((r) => ({ t: r.recorded_at, levelL: r.level_l })),
  }));
}

/** Money received, for the admin dashboard. */
async function earnings(branchId) {
  const scope = [branchId, APP_TIMEZONE];
  const where = `status = 'success' and ($1::text is null or branch_id = $1)`;
  const [totals, byBranch, bySource, daily, unpaid] = await Promise.all([
    one(pool, `
      select
        coalesce(sum(amount) filter (where settled_at >= date_trunc('day', now() at time zone $2) at time zone $2), 0) as today,
        coalesce(sum(amount) filter (where settled_at >= now() - interval '7 days'), 0) as week,
        coalesce(sum(amount) filter (where settled_at >= date_trunc('month', now() at time zone $2) at time zone $2), 0) as month,
        coalesce(sum(amount), 0) as all_time,
        count(*) as payments
      from payments where ${where}`, scope),
    rows(pool, `
      select p.branch_id, coalesce(b.code, 'Unassigned') as code, coalesce(b.name, 'No branch') as name,
        sum(p.amount) filter (where p.settled_at >= date_trunc('month', now() at time zone $2) at time zone $2) as month,
        sum(p.amount) as all_time, count(*) as payments
      from payments p left join branches b on b.id = p.branch_id
      where p.status = 'success' and ($1::text is null or p.branch_id = $1)
      group by p.branch_id, b.code, b.name order by all_time desc`, scope),
    rows(pool, `select source, sum(amount) as total, count(*) as payments from payments where ${where} group by source order by total desc`, [branchId]),
    rows(pool, `
      select (settled_at at time zone $2)::date as day, sum(amount) as total
      from payments where ${where} and settled_at >= now() - interval '14 days'
      group by 1 order by 1`, scope),
    one(pool, `
      select
        (select coalesce(sum(total), 0) from orders where payment_status <> 'paid' and status <> 'cancelled' and ($1::text is null or branch_id = $1)) +
        (select coalesce(sum(amount), 0) from deliveries where payment_status <> 'paid' and status <> 'cancelled' and ($1::text is null or branch_id = $1)) as unpaid`,
    [branchId]),
  ]);
  return {
    today: totals.today, week: totals.week, month: totals.month, allTime: totals.all_time, payments: totals.payments,
    unpaid: unpaid.unpaid,
    byBranch: byBranch.map((b) => ({ branchId: b.branch_id, code: b.code, name: b.name, month: b.month ?? 0, allTime: b.all_time, payments: b.payments })),
    bySource: bySource.map(camel),
    daily: daily.map(camel),
  };
}

async function stateFor(sess, ctx) {
  const settingsP = getSettings();
  const branchesP = rows(pool, 'select * from branches order by code');

  if (sess.role === 'customer') {
    const [s, branches, products, orders, deliveries, feedback, payments] = await Promise.all([
      settingsP, branchesP,
      rows(pool, 'select * from products where active order by created_at, id'),
      rows(pool, 'select * from orders where customer_id = $1 order by created_at desc limit $2', [sess.userId, LIST_LIMIT]).then((o) => withItems(pool, o)),
      rows(pool, 'select * from deliveries where customer_id = $1 order by created_at desc limit $2', [sess.userId, LIST_LIMIT]),
      rows(pool, 'select * from feedback where customer_id = $1 order by created_at desc limit $2', [sess.userId, LIST_LIMIT]),
      // Every payment for this customer's own orders and tanker deliveries, newest first.
      rows(pool, `
        select id, source, status, amount, phone, description, order_id, delivery_id, mpesa_receipt, result_desc, created_at, settled_at
        from payments
        where requested_by_user = $1
           or order_id in (select id from orders where customer_id = $1)
           or delivery_id in (select id from deliveries where customer_id = $1)
        order by created_at desc limit $2`, [sess.userId, LIST_LIMIT]),
    ]);
    const home = branches.find((b) => b.id === sess.branchId);
    return {
      me: publicUser({ ...sess, id: sess.userId, branch_id: sess.branchId, must_change_password: sess.mustChangePassword }),
      settings: {
        companyName: s.companyName, hubName: home?.name ?? s.hubName, tillNumber: s.tillNumber, supportPhone: s.supportPhone,
        bulkPricePerLitre: s.bulkPricePerLitre, mpesaMode: s.mpesaMode,
      },
      branches: branches.filter((b) => b.active).map((b) => ({ id: b.id, code: b.code, name: b.name, area: b.area })),
      products: products.map(camel), orders, deliveries: deliveries.map(camel), feedback: feedback.map(camel),
      payments: payments.map(camel),
    };
  }

  const b = viewBranch(sess, ctx);
  const [settings, branches, tanks, products, orders, trucks, deliveries, feedback, payments, reconciliations, activity] = await Promise.all([
    settingsP, branchesP,
    getTanks(pool, b),
    rows(pool, 'select * from products order by created_at, id'),
    rows(pool, 'select * from orders where ($1::text is null or branch_id = $1) order by created_at desc limit $2', [b, LIST_LIMIT]).then((o) => withItems(pool, o)),
    rows(pool, 'select * from trucks where ($1::text is null or branch_id = $1) order by created_at, id', [b]),
    rows(pool, 'select * from deliveries where ($1::text is null or branch_id = $1) order by created_at desc limit $2', [b, LIST_LIMIT]),
    rows(pool, 'select * from feedback where ($1::text is null or branch_id = $1) order by created_at desc limit $2', [b, LIST_LIMIT]),
    rows(pool, `select id, source, status, amount, phone, payer_name, description, order_id, delivery_id, mpesa_receipt, result_desc,
      provider, branch_id, created_at, settled_at from payments where ($1::text is null or branch_id = $1) order by created_at desc limit $2`, [b, LIST_LIMIT]),
    rows(pool, 'select * from reconciliations where ($1::text is null or branch_id = $1) order by date desc, created_at desc limit $2', [b, LIST_LIMIT]),
    rows(pool, `select a.*, br.code as branch_code from activity_log a left join branches br on br.id = a.branch_id
      where ($1::text is null or a.branch_id = $1) order by a.created_at desc limit $2`, [b, sess.role === 'admin' ? 150 : 50]),
  ]);
  const myBranch = branches.find((x) => x.id === (b || sess.branchId));
  const state = {
    me: publicUser({ ...sess, id: sess.userId, branch_id: sess.branchId, must_change_password: sess.mustChangePassword }),
    viewBranchId: b,
    settings: { ...settings, hubName: myBranch ? `${myBranch.code} · ${myBranch.name}` : 'All branches' },
    branches: branches.map(camel),
    tanks, orders, products: products.map(camel), trucks: trucks.map(camel), deliveries: deliveries.map(camel),
    feedback: feedback.map(camel), payments: payments.map(camel), reconciliations: reconciliations.map(camel),
    activity: activity.map(camel),
  };
  if (sess.role === 'admin') {
    const [money, users, counts] = await Promise.all([
      earnings(b),
      rows(pool, `select id, email, name, phone, role, branch_id, active, must_change_password, last_login_at, created_at from users
        where role <> 'customer' or created_at > now() - interval '365 days' order by role, name limit 500`),
      one(pool, `select
          (select count(*) from users where role = 'customer') as customers,
          (select count(*) from users where role = 'staff' and active) as staff`),
    ]);
    state.earnings = money;
    state.users = users.map(camel);
    state.counts = counts;
  }
  return state;
}

// ---------- payments ----------

async function markPaid(db, p) {
  const method = p.source === 'cash' ? 'cash' : 'mpesa';
  if (p.order_id) await db.query(`update orders set payment_status = 'paid', mpesa_ref = $2, payment_method = $3 where id = $1`, [p.order_id, p.mpesa_receipt, method]);
  if (p.delivery_id) await db.query(`update deliveries set payment_status = 'paid', mpesa_ref = $2, payment_method = $3 where id = $1`, [p.delivery_id, p.mpesa_receipt, method]);
}

const paymentLog = (db, p) => db.query(`
  insert into activity_log (user_role, branch_id, action, entity, entity_id, summary, amount)
  values ('system', $1, $2, 'payment', $3, $4, $5)`,
[p.branch_id, p.status === 'success' ? 'payment.received' : 'payment.failed', p.id,
  `${p.status === 'success' ? 'Received' : 'Failed'} M-Pesa ${p.mpesa_receipt ?? ''} for ${p.description}`.replace(/\s+/g, ' '), p.amount]);

/** Applies a final result once; the WHERE status = 'pending' makes this safe to call repeatedly. */
function settlePayment(id, ok, receipt, desc) {
  return tx(async (c) => {
    const p = await one(c, `
      update payments set status = $2, mpesa_receipt = $3, result_desc = $4, settled_at = now()
      where id = $1 and status = 'pending' returning *`,
    [id, ok ? 'success' : 'failed', ok ? receipt || null : null,
      desc || (ok ? 'Payment confirmed.' : 'The customer cancelled or the request timed out.')]);
    if (p) {
      if (ok) await markPaid(c, p);
      await paymentLog(c, p);
    }
    return p;
  });
}

/** Asks PayHero for the latest status. Callbacks are not trusted on their own, so this is the source of truth. */
async function checkPayhero(id, force = false) {
  if (!payhero.enabled) return;
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

/** Test mode: approves simulated prompts once they are a few seconds old. */
async function settleSimulated(onlyId = null) {
  if (payhero.enabled) return;
  await tx(async (c) => {
    const settled = await rows(c, `
      update payments set status = 'success', settled_at = now(),
        mpesa_receipt = 'S' || upper(substr(md5(random()::text || id), 1, 9)),
        result_desc = 'The service request is processed successfully.'
      where source = 'stk' and status = 'pending' and provider is null
        and created_at < now() - make_interval(secs => $1) and ($2::text is null or id = $2)
      returning *`, [PAYMENT_APPROVE_SECONDS, onlyId]);
    for (const p of settled) {
      await markPaid(c, p);
      await paymentLog(c, p);
    }
  });
}

async function paymentTarget(sess, ctx, body) {
  if (body.orderId) {
    const o = mustTouch(sess, await one(pool, 'select * from orders where id = $1', [body.orderId]), 'Order');
    if (o.status === 'cancelled') fail(400, 'This order was cancelled.');
    if (o.payment_status === 'paid') fail(400, 'This order is already paid.');
    return { order_id: o.id, delivery_id: null, amount: o.total, description: `Order ${o.id}`, payer_name: o.customer_name, branch_id: o.branch_id };
  }
  if (body.deliveryId) {
    const d = mustTouch(sess, await one(pool, 'select * from deliveries where id = $1', [body.deliveryId]), 'Delivery');
    if (d.status === 'cancelled') fail(400, 'This delivery was cancelled.');
    if (d.payment_status === 'paid') fail(400, 'This delivery is already paid.');
    return { order_id: null, delivery_id: d.id, amount: d.amount, description: `Tanker ${d.id}`, payer_name: d.customer_name, branch_id: d.branch_id };
  }
  requireTeam(sess);
  const amount = toNumber(body.amount);
  if (!(amount > 0 && amount <= 1000000)) fail(400, 'Enter an amount between 1 and 1,000,000.');
  return {
    order_id: null, delivery_id: null, amount, description: text(body.description, 120) || 'Water payment',
    payer_name: text(body.payerName, 120), branch_id: await targetBranch(sess, ctx, body),
  };
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

const addReading = (c, tankId, levelL) => c.query('insert into tank_readings (tank_id, level_l) values ($1, $2)', [tankId, levelL]);

// ---------- routes ----------

async function route(ctx) {
  const { url, method } = ctx;
  const { pathname } = url;
  const parts = pathname.split('/').filter(Boolean); // ['api', 'orders', 'ORD-1']
  const id = parts[2] ? decodeURIComponent(parts[2]) : undefined;

  if (pathname === '/api/health') {
    await pool.query('select 1');
    return { ok: true, service: 'aquaflow-api', database: 'ok' };
  }

  // Branch list for the sign-up form (names only).
  if (pathname === '/api/branches/public' && method === 'GET') {
    return (await rows(pool, 'select id, code, name, area from branches where active order by code')).map(camel);
  }

  // --- sign up / log in ---
  if (pathname === '/api/auth/signup' && method === 'POST') {
    const body = await ctx.body();
    const ipKey = `signup:${ctx.ip}`;
    await assertNotLocked([ipKey]);
    const name = text(body.name, 80).replace(/\s+/g, ' ');
    const email = normalizeEmail(body.email);
    const phone = normalizePhone(body.phone);
    if (name.length < 2) fail(400, 'Enter your name.');
    if (!email) fail(400, 'Enter a valid email address.');
    if (!phone) fail(400, 'Enter a valid Safaricom number for M-Pesa, e.g. 0712 345 678.');
    checkPasswordStrength(body.password);
    // The delivery area is chosen later, from the customer's dashboard.
    await recordAttempt([[ipKey, MAX_SIGNUPS_PER_IP]], 60);
    const hash = await hashPassword(body.password);
    const user = await one(pool, `
      insert into users (email, name, phone, role, branch_id, password_hash) values ($1, $2, $3, 'customer', $4, $5)
      on conflict (email) do nothing returning *`, [email, name, phone, null, hash]);
    if (!user) fail(409, 'An account with this email already exists. Log in instead.');
    await logActivity(pool, ctx, { userId: user.id, email, role: 'customer' }, {
      action: 'auth.signup', entity: 'user', entityId: user.id, summary: `${name} signed up`,
    });
    return { ok: true, email };
  }

  if (pathname === '/api/auth/login' && method === 'POST') {
    const body = await ctx.body();
    const email = normalizeEmail(body.email);
    if (!email) fail(400, 'Enter a valid email address.');
    if (typeof body.password !== 'string' || !body.password) fail(400, 'Enter your password.');
    const emailKey = `login:${email}`;
    const ipKey = `ip:${ctx.ip}`;
    await assertNotLocked([emailKey, ipKey]);
    const user = await one(pool, 'select * from users where email = $1', [email]);
    const ok = await verifyPassword(body.password.slice(0, 128), user?.password_hash || DUMMY_HASH);
    if (!user || !ok || !user.active) {
      await recordAttempt([[emailKey, MAX_LOGIN_FAILURES], [ipKey, MAX_IP_FAILURES]]);
      await logActivity(pool, ctx, null, { action: 'auth.login_failed', entity: 'user', entityId: user?.id ?? null, summary: `Failed sign-in for ${email}` });
      // Same message whether or not the email exists, so accounts can't be discovered.
      fail(401, user && ok && !user.active ? 'This account has been deactivated. Contact the admin.' : 'Wrong email or password.');
    }
    await clearAttempts(emailKey);
    await pool.query('delete from sessions where expires_at < now()');
    await logActivity(pool, ctx, { userId: user.id, email: user.email, role: user.role, branchId: user.branch_id }, {
      action: 'auth.login', entity: 'user', entityId: user.id, summary: `${user.name} signed in`, branchId: user.branch_id,
    });
    return createSession(user);
  }

  if (pathname === '/api/auth/logout' && method === 'POST') {
    const match = /^Bearer (.+)$/.exec(ctx.header('authorization') || '');
    if (match) await pool.query('delete from sessions where token_hash = $1', [hashToken(match[1])]);
    return { ok: true };
  }

  // PayHero calls this when the customer approves or cancels. The body is only used to find the payment;
  // the result is confirmed with PayHero's status API so a forged callback can't mark anything paid.
  if (pathname === '/api/payhero/callback' && method === 'POST') {
    const body = await ctx.body();
    const r = body.response || {};
    const p = await one(pool, `select id from payments where provider = 'payhero' and (id = $1 or ($2::text is not null and checkout_request_id = $2))`,
      [text(r.ExternalReference), r.CheckoutRequestID ? text(r.CheckoutRequestID) : null]);
    if (p) await checkPayhero(p.id, true);
    return { ok: true };
  }

  // ----- everything below needs a signed-in user -----
  const sess = (await sessionFor(ctx)) || fail(401, 'Please sign in again.');

  if (pathname === '/api/auth/password' && method === 'POST') {
    const body = await ctx.body();
    const user = await one(pool, 'select * from users where id = $1', [sess.userId]);
    if (!(await verifyPassword(String(body.currentPassword || '').slice(0, 128), user.password_hash))) fail(400, 'Your current password is wrong.');
    checkPasswordStrength(body.newPassword);
    if (body.newPassword === body.currentPassword) fail(400, 'Choose a new password that is different from the current one.');
    await pool.query('update users set password_hash = $2, must_change_password = false where id = $1', [sess.userId, await hashPassword(body.newPassword)]);
    // Sign out every other device.
    await pool.query('delete from sessions where user_id = $1 and token_hash <> $2', [sess.userId, sess.tokenHash]);
    await logActivity(pool, ctx, sess, { action: 'auth.password_changed', entity: 'user', entityId: sess.userId, summary: `${sess.name} changed their password` });
    return { ok: true };
  }

  if (pathname === '/api/me' && method === 'GET') {
    return publicUser({ ...sess, id: sess.userId, branch_id: sess.branchId, must_change_password: sess.mustChangePassword });
  }

  // Customers pick (or change) their delivery area from their dashboard. Staff branches are set by the admin.
  if (pathname === '/api/me' && method === 'PATCH') {
    requireRole(sess, 'customer');
    const body = await ctx.body();
    const branch = await one(pool, 'select id, code, name from branches where id = $1 and active', [text(body.branchId)]);
    if (!branch) fail(400, 'Choose one of the delivery areas.');
    const user = await one(pool, 'update users set branch_id = $2 where id = $1 returning *', [sess.userId, branch.id]);
    if (branch.id !== sess.branchId) {
      await logActivity(pool, ctx, { ...sess, branchId: branch.id }, {
        action: 'customer.area_set', entity: 'user', entityId: sess.userId, branchId: branch.id,
        summary: `${sess.name} ${sess.branchId ? 'moved to' : 'chose'} ${branch.code} · ${branch.name}`,
      });
    }
    return publicUser(user);
  }

  // New staff must replace the temporary password before doing anything else.
  if (sess.mustChangePassword) fail(403, 'Please set a new password first.');

  if (pathname === '/api/state' && method === 'GET') {
    if (payhero.enabled) {
      const pending = await rows(pool, `select id from payments where provider = 'payhero' and status = 'pending'
        and created_at > now() - interval '30 minutes' order by created_at desc limit 3`);
      await Promise.allSettled(pending.map((p) => checkPayhero(p.id)));
    } else {
      await settleSimulated();
    }
    return stateFor(sess, ctx);
  }

  // --- branches (admin) ---
  if (pathname === '/api/branches' && method === 'POST') {
    requireAdmin(sess);
    const body = await ctx.body();
    const code = text(body.code, 20).toUpperCase() || fail(400, 'Enter a short code, e.g. DIS-3.');
    const name = text(body.name, 80) || fail(400, 'Enter the branch or route name.');
    if (await one(pool, 'select 1 from branches where upper(code) = $1', [code])) fail(409, `There is already a branch with code ${code}.`);
    const b = await one(pool, 'insert into branches (code, name, area) values ($1, $2, $3) returning *', [code, name, text(body.area, 120)]);
    await logActivity(pool, ctx, sess, { action: 'branch.created', entity: 'branch', entityId: b.id, summary: `Created branch ${code} · ${name}`, branchId: b.id });
    return camel(b);
  }
  if (parts[1] === 'branches' && id && method === 'PATCH') {
    requireAdmin(sess);
    const body = await ctx.body();
    const v = {};
    if (body.code !== undefined) v.code = text(body.code, 20).toUpperCase() || fail(400, 'Enter a short code.');
    if (body.name !== undefined) v.name = text(body.name, 80) || fail(400, 'Enter the branch name.');
    if (body.area !== undefined) v.area = text(body.area, 120);
    if (body.active !== undefined) v.active = Boolean(body.active);
    const { sql, params } = setClause(v, 2);
    if (!sql) fail(400, 'Nothing to change.');
    const b = (await one(pool, `update branches set ${sql} where id = $1 returning *`, [id, ...params])) || fail(404, 'Branch not found.');
    await logActivity(pool, ctx, sess, { action: 'branch.updated', entity: 'branch', entityId: id, summary: `Updated branch ${b.code}`, branchId: id });
    return camel(b);
  }

  // --- user accounts (admin) ---
  if (pathname === '/api/users' && method === 'POST') {
    requireAdmin(sess);
    const body = await ctx.body();
    const role = ['staff', 'admin'].includes(body.role) ? body.role : 'staff';
    const email = normalizeEmail(body.email) || fail(400, 'Enter a valid email address.');
    const name = text(body.name, 80) || fail(400, 'Enter the staff member\'s name.');
    const phone = optionalPhone(body.phone, 'Phone');
    let branchId = null;
    if (role === 'staff') {
      branchId = text(body.branchId) || fail(400, 'Choose the branch this staff member works on.');
      if (!(await one(pool, 'select 1 from branches where id = $1', [branchId]))) fail(400, 'That branch does not exist.');
    }
    checkPasswordStrength(body.password);
    const user = await one(pool, `
      insert into users (email, name, phone, role, branch_id, password_hash, must_change_password, created_by)
      values ($1, $2, $3, $4, $5, $6, true, $7) on conflict (email) do nothing returning *`,
    [email, name, phone, role, branchId, await hashPassword(body.password), sess.userId]);
    if (!user) fail(409, 'An account with this email already exists.');
    await logActivity(pool, ctx, sess, {
      action: `${role}.created`, entity: 'user', entityId: user.id, summary: `Added ${role} ${name} (${email})`, branchId,
    });
    return camel({ ...user, password_hash: undefined });
  }
  if (parts[1] === 'users' && id && method === 'PATCH') {
    requireAdmin(sess);
    const body = await ctx.body();
    return tx(async (c) => {
      const user = (await one(c, 'select * from users where id = $1 for update', [id])) || fail(404, 'User not found.');
      const v = {};
      if (body.name !== undefined) v.name = text(body.name, 80) || fail(400, 'Enter a name.');
      if (body.phone !== undefined) v.phone = optionalPhone(body.phone, 'Phone');
      if (body.role !== undefined) {
        if (!['admin', 'staff', 'customer'].includes(body.role)) fail(400, 'Unknown role.');
        v.role = body.role;
      }
      if (body.branchId !== undefined) {
        v.branch_id = text(body.branchId) || null;
        if (v.branch_id && !(await one(c, 'select 1 from branches where id = $1', [v.branch_id]))) fail(400, 'That branch does not exist.');
      }
      if ((v.role ?? user.role) === 'staff' && !(v.branch_id !== undefined ? v.branch_id : user.branch_id)) fail(400, 'Staff must be assigned to a branch.');
      if (body.active !== undefined) v.active = Boolean(body.active);
      let resetPassword = false;
      if (body.password !== undefined && body.password !== '') {
        checkPasswordStrength(body.password);
        v.password_hash = await hashPassword(body.password);
        v.must_change_password = true;
        resetPassword = true;
      }
      // Never lock out the last admin (or yourself).
      const losingAdmin = user.role === 'admin' && ((v.role && v.role !== 'admin') || v.active === false);
      if (losingAdmin) {
        if (user.id === sess.userId) fail(400, 'You cannot remove your own admin access.');
        const admins = await one(c, `select count(*) as n from users where role = 'admin' and active`);
        if (admins.n <= 1) fail(400, 'There must be at least one active admin.');
      }
      const { sql, params } = setClause(v, 2);
      if (!sql) fail(400, 'Nothing to change.');
      const updated = await one(c, `update users set ${sql} where id = $1 returning *`, [id, ...params]);
      if (v.active === false || resetPassword || v.role || v.branch_id !== undefined) {
        await c.query('delete from sessions where user_id = $1', [id]); // takes effect immediately
      }
      const what = [
        v.active === false && 'deactivated', v.active === true && 'reactivated', resetPassword && 'password reset',
        v.role && `role → ${v.role}`, v.branch_id !== undefined && 'branch changed', (v.name || v.phone !== undefined) && 'details updated',
      ].filter(Boolean).join(', ');
      await logActivity(c, ctx, sess, { action: 'user.updated', entity: 'user', entityId: id, summary: `${updated.name}: ${what}`, branchId: updated.branch_id });
      return camel({ ...updated, password_hash: undefined });
    });
  }

  // --- company settings (admin) ---
  if (pathname === '/api/settings' && method === 'PATCH') {
    requireAdmin(sess);
    const body = await ctx.body();
    const values = {};
    [['companyName', 'company_name'], ['hubName', 'hub_name'], ['tillNumber', 'till_number']].forEach(([k, col]) => {
      if (body[k] === undefined) return;
      values[col] = text(body[k], 80) || fail(400, 'Company name, hub and till number cannot be empty.');
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
    await logActivity(pool, ctx, sess, { action: 'settings.updated', entity: 'settings', summary: 'Updated company settings' });
    return getSettings();
  }

  // --- orders ---
  if (pathname === '/api/orders' && method === 'POST') {
    const body = await ctx.body();
    const requested = Array.isArray(body.items) ? body.items.slice(0, 50) : [];
    if (!requested.length) fail(400, 'Your cart is empty.');

    let customerName; let customerPhone; let customerId = null; let branchId;
    let address = text(body.address, 200);
    if (sess.role === 'customer') {
      customerName = sess.name;
      customerPhone = sess.phone;
      customerId = sess.userId;
      branchId = sess.branchId || fail(400, 'Choose your delivery area first (top of the Shop screen).');
      if (!address) fail(400, 'Enter a delivery address.');
    } else {
      customerName = text(body.customerName, 80) || 'Walk-in customer';
      customerPhone = optionalPhone(body.customerPhone, 'Customer phone');
      address = address || 'Counter pickup';
      branchId = await targetBranch(sess, ctx, body);
    }

    const order = await tx(async (c) => {
      const used = {};
      const items = [];
      for (const item of requested) {
        // Lock the product row so two orders can't both take the last bottles.
        const product = await one(c, 'select * from products where id = $1 and active for update', [item.productId]);
        if (!product) fail(400, 'One of the products is no longer available.');
        const qty = Math.floor(toNumber(item.qty));
        if (!(qty > 0 && qty <= 500)) fail(400, 'Quantities must be between 1 and 500.');
        used[product.id] = (used[product.id] || 0) + qty;
        if (used[product.id] > product.stock) fail(400, `Only ${product.stock} × ${product.name} left in stock.`);
        const refill = Boolean(item.refill && product.refill_price);
        items.push({ product, qty, refill, unitPrice: refill ? product.refill_price : product.price });
      }
      const total = items.reduce((s, i) => s + i.qty * i.unitPrice, 0);
      const pin = pinFrom(body);
      const paymentMethod = body.paymentMethod === 'cash' ? 'cash' : 'mpesa';
      const o = await one(c, `
        insert into orders (customer_name, customer_phone, customer_id, branch_id, address, notes, total, payment_method, latitude, longitude)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning *`,
      [customerName, customerPhone, customerId, branchId, address, text(body.notes, 300), total, paymentMethod, pin.latitude, pin.longitude]);
      for (const i of items) {
        await c.query('insert into order_items (order_id, product_id, name, qty, unit_price, refill) values ($1, $2, $3, $4, $5, $6)',
          [o.id, i.product.id, i.product.name, i.qty, i.unitPrice, i.refill]);
      }
      for (const [productId, qty] of Object.entries(used)) {
        await c.query('update products set stock = stock - $2 where id = $1', [productId, qty]);
      }
      await logActivity(c, ctx, sess, {
        action: 'order.created', entity: 'order', entityId: o.id, branchId, amount: total,
        summary: `${sess.role === 'customer' ? `${customerName} ordered` : `${sess.name} took an order for ${customerName}`}: ${items.map((i) => `${i.qty}× ${i.product.name}`).join(', ')}`,
      });
      if (sess.role !== 'customer' && body.paidCash) {
        const p = await one(c, `
          insert into payments (source, status, amount, phone, payer_name, description, order_id, branch_id, settled_at, requested_by, requested_by_user)
          values ('cash', 'success', $1, $2, $3, $4, $5, $6, now(), 'staff', $7) returning *`,
        [total, customerPhone, customerName, `Order ${o.id}`, o.id, branchId, sess.userId]);
        await markPaid(c, p);
        await logActivity(c, ctx, sess, { action: 'payment.received', entity: 'payment', entityId: p.id, branchId, amount: total, summary: `Cash received for ${o.id}` });
      }
      return o;
    });
    return getOrder(pool, order.id);
  }

  if (parts[1] === 'orders' && id && (method === 'PATCH' || method === 'DELETE')) {
    const body = method === 'PATCH' ? await ctx.body() : {};
    await tx(async (c) => {
      const order = mustTouch(sess, await one(c, 'select * from orders where id = $1 for update', [id]), 'Order');

      if (method === 'DELETE') {
        requireAdmin(sess);
        if (order.status !== 'cancelled') await restoreStock(c, id);
        await c.query('delete from orders where id = $1', [id]);
        await logActivity(c, ctx, sess, { action: 'order.deleted', entity: 'order', entityId: id, branchId: order.branch_id, summary: `Deleted order ${id}` });
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
      if (body.rider !== undefined) values.rider = text(body.rider, 100);
      const { sql, params } = setClause(values, 2);
      if (sql) await c.query(`update orders set ${sql} where id = $1`, [id, ...params]);
      if (values.status && values.status !== order.status) {
        await logActivity(c, ctx, sess, {
          action: `order.${values.status}`, entity: 'order', entityId: id, branchId: order.branch_id,
          amount: values.payment_status === 'paid' ? order.total : null,
          summary: `Order ${id} → ${values.status}${values.rider ? ` (rider ${values.rider})` : ''}`,
        });
      }
      if (body.paidCash && order.payment_status !== 'paid') {
        requireTeam(sess);
        const p = await one(c, `
          insert into payments (source, status, amount, phone, payer_name, description, order_id, branch_id, settled_at, requested_by, requested_by_user)
          values ('cash', 'success', $1, $2, $3, $4, $5, $6, now(), 'staff', $7) returning *`,
        [order.total, order.customer_phone, order.customer_name, `Order ${order.id}`, order.id, order.branch_id, sess.userId]);
        await markPaid(c, p);
        await logActivity(c, ctx, sess, { action: 'payment.received', entity: 'payment', entityId: p.id, branchId: order.branch_id, amount: order.total, summary: `Cash received for ${id}` });
      }
    });
    return method === 'DELETE' ? { ok: true } : getOrder(pool, id);
  }

  // --- products (catalogue is shared by all branches; admin manages it, staff can restock) ---
  const productValues = (body) => {
    const v = {};
    if (body.name !== undefined) v.name = text(body.name, 80) || fail(400, 'Enter a product name.');
    if (body.size !== undefined) v.size = text(body.size, 20) || '20L';
    if (body.description !== undefined) v.description = text(body.description, 200);
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
    requireAdmin(sess);
    const v = productValues(await ctx.body());
    if (!v.name) fail(400, 'Enter a product name.');
    if (v.price === undefined) fail(400, 'Enter a price greater than 0.');
    const { sql, params } = insertSql('products', v);
    const p = await one(pool, sql, params);
    await logActivity(pool, ctx, sess, { action: 'product.created', entity: 'product', entityId: p.id, summary: `Added product ${p.name}` });
    return camel(p);
  }
  if (parts[1] === 'products' && id) {
    requireTeam(sess);
    if (method === 'PATCH') {
      const { restock, ...rest } = await ctx.body();
      const v = productValues(rest);
      if (sess.role === 'staff' && Object.keys(v).length) fail(403, 'Only the admin can change products and prices. You can restock.');
      let qty = 0;
      if (restock !== undefined) {
        qty = Math.floor(toNumber(restock));
        if (!(qty > 0 && qty <= 100000)) fail(400, 'Restock quantity must be between 1 and 100,000.');
      }
      const editedStock = v.stock;
      delete v.stock;
      const { sql, params } = setClause(v, 3);
      const stockExpr = editedStock !== undefined ? 'stock = $2' : 'stock = stock + $2';
      const p = (await one(pool, `update products set ${[sql, stockExpr].filter(Boolean).join(', ')} where id = $1 returning *`,
        [id, editedStock !== undefined ? editedStock + qty : qty, ...params])) || fail(404, 'Product not found.');
      await logActivity(pool, ctx, sess, {
        action: qty && !sql ? 'product.restocked' : 'product.updated', entity: 'product', entityId: id,
        summary: qty && !sql ? `Restocked ${qty} × ${p.name}` : `Updated product ${p.name}`,
      });
      return camel(p);
    }
    if (method === 'DELETE') {
      requireAdmin(sess);
      const r = await pool.query('delete from products where id = $1 returning name', [id]);
      if (!r.rowCount) fail(404, 'Product not found.');
      await logActivity(pool, ctx, sess, { action: 'product.deleted', entity: 'product', entityId: id, summary: `Removed product ${r.rows[0].name}` });
      return { ok: true };
    }
  }

  // --- tanks ---
  if (pathname === '/api/tanks' && method === 'POST') {
    requireTeam(sess);
    const body = await ctx.body();
    const name = text(body.name, 80) || fail(400, 'Enter a tank name.');
    const capacityL = toNumber(body.capacityL);
    const levelL = toNumber(body.levelL) || 0;
    if (!(capacityL > 0 && capacityL <= 10000000)) fail(400, 'Enter the tank capacity.');
    if (levelL < 0 || levelL > capacityL) fail(400, 'Level must be between 0 and the tank capacity.');
    const branchId = await targetBranch(sess, ctx, body);
    const tankId = await tx(async (c) => {
      const t = await one(c, 'insert into tanks (name, type, location, capacity_l, level_l, branch_id) values ($1, $2, $3, $4, $5, $6) returning id',
        [name, text(body.type, 40) || 'Storage tank', text(body.location, 80), capacityL, levelL, branchId]);
      await addReading(c, t.id, levelL);
      await logActivity(c, ctx, sess, { action: 'tank.created', entity: 'tank', entityId: t.id, branchId, summary: `Added tank ${name}` });
      return t.id;
    });
    return (await getTanks(pool, branchId)).find((t) => t.id === tankId);
  }
  if (parts[1] === 'tanks' && id) {
    requireTeam(sess);
    if (method === 'PATCH') {
      const body = await ctx.body();
      const branchId = await tx(async (c) => {
        const tank = mustTouch(sess, await one(c, 'select * from tanks where id = $1 for update', [id]), 'Tank');
        const v = {};
        if (body.name !== undefined) v.name = text(body.name, 80) || fail(400, 'Enter a tank name.');
        if (body.type !== undefined) v.type = text(body.type, 40) || 'Storage tank';
        if (body.location !== undefined) v.location = text(body.location, 80);
        [['capacityL', 'capacity_l'], ['levelL', 'level_l'], ['inflowLph', 'inflow_lph'], ['outflowLph', 'outflow_lph'],
          ['ph', 'ph'], ['turbidity', 'turbidity'], ['chlorine', 'chlorine']].forEach(([k, col]) => {
          if (body[k] === undefined || text(body[k]) === '') return; // blank = unchanged
          v[col] = toNumber(body[k]);
          if (!Number.isFinite(v[col]) || v[col] < 0) fail(400, 'Values must be numbers of 0 or more.');
        });
        if (body.branchId !== undefined && sess.role === 'admin') v.branch_id = text(body.branchId) || null;
        const capacity = v.capacity_l ?? tank.capacity_l;
        if (!(capacity > 0)) fail(400, 'Enter the tank capacity.');
        if ((v.level_l ?? tank.level_l) > capacity) fail(400, 'Level cannot be more than the tank capacity.');
        const { sql, params } = setClause(v, 2);
        if (sql) await c.query(`update tanks set ${sql} where id = $1`, [id, ...params]);
        if (v.level_l !== undefined) await addReading(c, id, v.level_l);
        await logActivity(c, ctx, sess, {
          action: v.level_l !== undefined ? 'tank.reading' : 'tank.updated', entity: 'tank', entityId: id, branchId: tank.branch_id,
          summary: v.level_l !== undefined ? `${tank.name}: level recorded at ${v.level_l} L` : `Updated tank ${tank.name}`,
        });
        return v.branch_id !== undefined ? v.branch_id : tank.branch_id;
      });
      return (await getTanks(pool, branchId)).find((t) => t.id === id);
    }
    if (method === 'DELETE') {
      requireAdmin(sess);
      const r = await pool.query('delete from tanks where id = $1 returning name, branch_id', [id]);
      if (!r.rowCount) fail(404, 'Tank not found.');
      await logActivity(pool, ctx, sess, { action: 'tank.deleted', entity: 'tank', entityId: id, branchId: r.rows[0].branch_id, summary: `Removed tank ${r.rows[0].name}` });
      return { ok: true };
    }
  }

  // --- trucks ---
  const truckValues = (body) => {
    const v = {};
    if (body.unit !== undefined) v.unit = text(body.unit, 40) || fail(400, 'Enter a unit name.');
    if (body.plate !== undefined) v.plate = text(body.plate, 20).toUpperCase();
    if (body.capacityL !== undefined) { v.capacity_l = toNumber(body.capacityL); if (!(v.capacity_l > 0)) fail(400, 'Enter the tank capacity.'); }
    if (body.driverName !== undefined) v.driver_name = text(body.driverName, 80);
    if (body.driverPhone !== undefined) v.driver_phone = optionalPhone(body.driverPhone, 'Driver phone');
    return v;
  };
  if (pathname === '/api/trucks' && method === 'POST') {
    requireTeam(sess);
    const body = await ctx.body();
    const v = truckValues(body);
    if (!v.unit) fail(400, 'Enter a unit name.');
    if (v.capacity_l === undefined) fail(400, 'Enter the tank capacity.');
    v.branch_id = await targetBranch(sess, ctx, body);
    const { sql, params } = insertSql('trucks', v);
    const t = await one(pool, sql, params);
    await logActivity(pool, ctx, sess, { action: 'truck.created', entity: 'truck', entityId: t.id, branchId: t.branch_id, summary: `Added tanker ${t.unit} (${t.plate})` });
    return camel(t);
  }
  if (parts[1] === 'trucks' && id) {
    requireTeam(sess);
    if (method === 'PATCH') {
      const body = await ctx.body();
      const v = truckValues(body);
      if (body.status !== undefined) {
        if (!['idle', 'maintenance'].includes(body.status)) fail(400, 'Use the mission screen to change trip status.');
        v.status = body.status;
      }
      if (body.branchId !== undefined && sess.role === 'admin') v.branch_id = text(body.branchId) || null;
      return tx(async (c) => {
        const truck = mustTouch(sess, await one(c, 'select * from trucks where id = $1 for update', [id]), 'Tanker');
        if (v.status && ACTIVE_MISSION.includes(truck.status)) fail(400, 'This tanker is on a mission.');
        const { sql, params } = setClause(v, 2);
        const updated = sql ? await one(c, `update trucks set ${sql} where id = $1 returning *`, [id, ...params]) : truck;
        await logActivity(c, ctx, sess, {
          action: v.status ? `truck.${v.status}` : 'truck.updated', entity: 'truck', entityId: id, branchId: truck.branch_id,
          summary: v.status === 'maintenance' ? `${truck.unit} sent to maintenance` : v.status === 'idle' ? `${truck.unit} back in service` : `Updated tanker ${truck.unit}`,
        });
        return camel(updated);
      });
    }
    if (method === 'DELETE') {
      requireAdmin(sess);
      const busy = await one(pool, 'select 1 from deliveries where truck_id = $1 and status = any($2)', [id, ACTIVE_MISSION]);
      if (busy) fail(400, 'This tanker is on a mission.');
      const r = await pool.query('delete from trucks where id = $1 returning unit, branch_id', [id]);
      if (!r.rowCount) fail(404, 'Tanker not found.');
      await logActivity(pool, ctx, sess, { action: 'truck.deleted', entity: 'truck', entityId: id, branchId: r.rows[0].branch_id, summary: `Removed tanker ${r.rows[0].unit}` });
      return { ok: true };
    }
  }

  // --- bulk deliveries ---
  if (pathname === '/api/deliveries' && method === 'POST') {
    const body = await ctx.body();
    const volumeL = Math.floor(toNumber(body.volumeL));
    const destination = text(body.destination, 200);
    if (!(volumeL >= 500 && volumeL <= 100000)) fail(400, 'Tanker orders must be between 500 and 100,000 litres.');
    if (!destination) fail(400, 'Enter a delivery location.');
    return tx(async (c) => {
      const { bulk_price_per_litre: price } = await one(c, 'select bulk_price_per_litre from settings where id');
      const d = {
        destination, volume_l: volumeL, notes: text(body.notes, 300), amount: Math.round(volumeL * price), status: 'requested',
        truck_id: null, source_tank_id: null, ...pinFrom(body),
      };
      if (sess.role === 'customer') {
        Object.assign(d, { customer_name: sess.name, customer_phone: sess.phone, customer_id: sess.userId });
        d.branch_id = sess.branchId || fail(400, 'Choose your delivery area first (top of the Shop screen).');
      } else {
        d.customer_name = text(body.customerName, 80) || fail(400, 'Enter the customer or site name.');
        d.customer_phone = optionalPhone(body.customerPhone, 'Customer phone');
        d.branch_id = await targetBranch(sess, ctx, body, c);
        if (body.truckId) {
          const truck = await one(c, 'select * from trucks where id = $1 for update', [body.truckId]);
          if (!truck || truck.branch_id !== d.branch_id) fail(400, 'Choose a tanker from this branch.');
          if (truck.status !== 'idle') fail(400, `${truck.unit} is not available.`);
          if (body.sourceTankId && !(await one(c, 'select 1 from tanks where id = $1 and branch_id = $2', [body.sourceTankId, d.branch_id]))) {
            fail(400, 'Choose a tank from this branch.');
          }
          Object.assign(d, { truck_id: truck.id, source_tank_id: body.sourceTankId || null, status: 'scheduled' });
        }
      }
      const { sql, params } = insertSql('deliveries', d);
      const row = await one(c, sql, params);
      await syncTruck(c, row);
      await logActivity(c, ctx, sess, {
        action: 'delivery.created', entity: 'delivery', entityId: row.id, branchId: row.branch_id, amount: row.amount,
        summary: `${sess.role === 'customer' ? `${sess.name} requested` : `${sess.name} scheduled`} ${volumeL.toLocaleString('en-KE')} L to ${destination}`,
      });
      return camel(row);
    });
  }
  if (parts[1] === 'deliveries' && id && method === 'PATCH') {
    const body = await ctx.body();
    return tx(async (c) => {
      const d = mustTouch(sess, await one(c, 'select * from deliveries where id = $1 for update', [id]), 'Delivery');
      if (sess.role === 'customer') {
        if (body.status !== 'cancelled' || d.status !== 'requested') fail(403, 'You can only cancel a request before a tanker is assigned.');
        const row = await one(c, `update deliveries set status = 'cancelled' where id = $1 returning *`, [id]);
        await logActivity(c, ctx, sess, { action: 'delivery.cancelled', entity: 'delivery', entityId: id, branchId: d.branch_id, summary: `${sess.name} cancelled ${id}` });
        return camel(row);
      }
      const v = {};
      if (body.truckId !== undefined) {
        const truck = await one(c, 'select * from trucks where id = $1 for update', [body.truckId]);
        if (!truck || truck.branch_id !== d.branch_id) fail(400, 'Choose a tanker from this branch.');
        if (truck.status !== 'idle' && truck.id !== d.truck_id) fail(400, `${truck.unit} is not available.`);
        if (d.truck_id && d.truck_id !== truck.id) await c.query(`update trucks set status = 'idle' where id = $1 and status <> 'maintenance'`, [d.truck_id]);
        v.truck_id = truck.id;
        if (d.status === 'requested') v.status = 'scheduled';
      }
      if (body.sourceTankId !== undefined) {
        v.source_tank_id = body.sourceTankId || null;
        if (v.source_tank_id && !(await one(c, 'select 1 from tanks where id = $1 and branch_id = $2', [v.source_tank_id, d.branch_id]))) {
          fail(400, 'Choose a tank from this branch.');
        }
      }
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
      if (v.status || v.truck_id) {
        await logActivity(c, ctx, sess, {
          action: `delivery.${v.status || 'assigned'}`, entity: 'delivery', entityId: id, branchId: d.branch_id,
          summary: `${id} (${d.customer_name}) → ${(v.status || 'tanker assigned').replace('_', ' ')}`,
        });
      }
      return camel(row);
    });
  }

  // --- feedback ---
  if (pathname === '/api/feedback' && method === 'POST') {
    requireRole(sess, 'customer');
    const body = await ctx.body();
    const rating = Math.round(toNumber(body.rating));
    const message = text(body.message, 1000);
    if (!(rating >= 1 && rating <= 5)) fail(400, 'Choose a rating from 1 to 5 stars.');
    if (!message) fail(400, 'Write a short message.');
    if (body.orderId && !(await one(pool, 'select 1 from orders where id = $1 and customer_id = $2', [body.orderId, sess.userId]))) fail(400, 'Order not found.');
    const fb = await one(pool, `
      insert into feedback (customer_name, customer_phone, customer_id, branch_id, rating, category, message, location, order_id)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning *`,
    [sess.name, sess.phone, sess.userId, sess.branchId, rating, text(body.category, 40) || 'Other', message, text(body.location, 80), body.orderId || null]);
    await logActivity(pool, ctx, sess, { action: 'feedback.created', entity: 'feedback', entityId: fb.id, branchId: sess.branchId, summary: `${sess.name} left ${rating}★ feedback` });
    return camel(fb);
  }
  if (parts[1] === 'feedback' && id && method === 'PATCH') {
    requireTeam(sess);
    const body = await ctx.body();
    const reply = text(body.reply, 1000) || fail(400, 'Write a reply.');
    return tx(async (c) => {
      const fb = mustTouch(sess, await one(c, 'select * from feedback where id = $1 for update', [id]), 'Feedback');
      const row = await one(c, `update feedback set reply = $2, status = 'resolved', replied_by = $3, replied_at = now() where id = $1 returning *`, [id, reply, sess.name]);
      await logActivity(c, ctx, sess, { action: 'feedback.replied', entity: 'feedback', entityId: id, branchId: fb.branch_id, summary: `${sess.name} replied to ${fb.customer_name}` });
      return camel(row);
    });
  }

  // --- payments ---
  if (pathname === '/api/payments/stk' && method === 'POST') {
    const body = await ctx.body();
    const phone = normalizePhone(body.phone) || fail(400, 'Enter a valid M-Pesa number, e.g. 0712 345 678.');
    const target = await paymentTarget(sess, ctx, body);
    const amount = Math.round(target.amount);
    if (!(amount >= 1)) fail(400, 'Amount must be at least KES 1.');
    const payment = await one(pool, `
      insert into payments (source, status, amount, phone, payer_name, description, order_id, delivery_id, branch_id, provider, requested_by, requested_by_user)
      values ('stk', 'pending', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning *`,
    [amount, phone, target.payer_name, target.description, target.order_id, target.delivery_id, target.branch_id,
      payhero.enabled ? 'payhero' : null, sess.role === 'customer' ? sess.phone : 'staff', sess.userId]);
    await logActivity(pool, ctx, sess, { action: 'payment.requested', entity: 'payment', entityId: payment.id, branchId: target.branch_id, amount, summary: `M-Pesa prompt sent for ${target.description}` });

    if (!payhero.enabled) return { payment: camel(payment) }; // approved by settleSimulated() a few seconds later
    try {
      const res = await payheroRequest('POST', '/api/v2/payments', {
        amount,
        phone_number: `0${phone.slice(3)}`,
        channel_id: payhero.channelId,
        provider: 'm-pesa',
        external_reference: payment.id,
        customer_name: target.payer_name || sess.name,
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
    requireTeam(sess);
    const body = await ctx.body();
    const source = body.method === 'cash' ? 'cash' : 'till';
    const amount = toNumber(body.amount);
    if (!(amount > 0 && amount <= 1000000)) fail(400, 'Enter the amount received.');
    const receipt = text(body.mpesaReceipt, 20).toUpperCase();
    if (source === 'till' && !/^[A-Z0-9]{8,12}$/.test(receipt)) fail(400, 'Enter the M-Pesa code from the till SMS, e.g. QKH4891MN.');
    return tx(async (c) => {
      let branchId;
      if (body.orderId) branchId = mustTouch(sess, await one(c, 'select * from orders where id = $1', [body.orderId]), 'Order').branch_id;
      else if (body.deliveryId) branchId = mustTouch(sess, await one(c, 'select * from deliveries where id = $1', [body.deliveryId]), 'Delivery').branch_id;
      else branchId = await targetBranch(sess, ctx, body, c);
      const p = await one(c, `
        insert into payments (source, status, amount, mpesa_receipt, phone, payer_name, description, order_id, delivery_id, branch_id,
                              settled_at, requested_by, requested_by_user)
        values ($1, 'success', $2, $3, $4, $5, $6, $7, $8, $9, now(), 'staff', $10) returning *`,
      [source, amount, source === 'till' ? receipt : null, optionalPhone(body.phone, 'Phone'), text(body.payerName, 80),
        text(body.description, 120) || 'Till payment', body.orderId || null, body.deliveryId || null, branchId, sess.userId]);
      await markPaid(c, p);
      await logActivity(c, ctx, sess, {
        action: 'payment.received', entity: 'payment', entityId: p.id, branchId, amount,
        summary: `${sess.name} recorded ${source === 'cash' ? 'cash' : `till payment ${receipt}`} for ${p.description}`,
      });
      return camel(p);
    });
  }
  if (parts[1] === 'payments' && id && method === 'GET') {
    let p = await one(pool, 'select * from payments where id = $1', [id]);
    const allowed = p && (sess.role === 'admin' || (sess.role === 'staff' && p.branch_id === sess.branchId) || p.requested_by_user === sess.userId);
    if (!allowed) fail(404, 'Payment not found.');
    if (p.status === 'pending') {
      if (p.provider === 'payhero') await checkPayhero(id);
      else await settleSimulated(id);
      p = await one(pool, 'select * from payments where id = $1', [id]);
    }
    delete p.provider_ref;
    delete p.checkout_request_id;
    delete p.last_checked_at;
    return camel(p);
  }

  // --- reconciliation ---
  if (pathname === '/api/reconciliations/draft' && method === 'GET') {
    requireTeam(sess);
    const tank = mustTouch(sess, await one(pool, 'select * from tanks where id = $1', [url.searchParams.get('tankId')]), 'Tank');
    const date = url.searchParams.get('date') || localDateKey(Date.now());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail(400, 'Invalid date.');
    // Fetch a 3-day window, then keep the rows that fall on that calendar day in APP_TIMEZONE.
    const from = new Date(Date.parse(`${date}T00:00:00Z`) - 86400000);
    const to = new Date(Date.parse(`${date}T00:00:00Z`) + 2 * 86400000);
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
    requireTeam(sess);
    const body = await ctx.body();
    const date = text(body.date, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail(400, 'Invalid date.');
    const [openingL, receivedL, loadedL, otherOutL, actualL] = ['openingL', 'receivedL', 'loadedL', 'otherOutL', 'actualL'].map((k) => toNumber(body[k] ?? 0));
    if ([openingL, receivedL, loadedL, otherOutL, actualL].some((n) => !Number.isFinite(n) || n < 0)) fail(400, 'All volumes must be 0 or more.');
    return tx(async (c) => {
      const tank = mustTouch(sess, await one(c, 'select id, name, branch_id from tanks where id = $1', [body.tankId]), 'Tank');
      const { variance_threshold_percent: limit } = await one(c, 'select variance_threshold_percent from settings where id');
      const expectedL = openingL + receivedL - loadedL - otherOutL;
      const varianceL = actualL - expectedL;
      const variancePct = expectedL > 0 ? Math.round((varianceL / expectedL) * 1000) / 10 : 0;
      const flagged = Math.abs(variancePct) > limit;
      const explanation = text(body.explanation, 1000);
      if (flagged && !explanation) fail(400, 'Variance is over the limit: add an explanation.');
      const row = await one(c, `
        insert into reconciliations (tank_id, tank_name, branch_id, date, opening_l, received_l, loaded_l, other_out_l, expected_l, actual_l,
                                     variance_l, variance_pct, flagged, reason, explanation, auto_generated, prepared_by)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
        on conflict (tank_id, date) do update set
          revisions = reconciliations.revisions || jsonb_build_array(to_jsonb(reconciliations) - 'revisions'),
          tank_name = excluded.tank_name, branch_id = excluded.branch_id, opening_l = excluded.opening_l, received_l = excluded.received_l,
          loaded_l = excluded.loaded_l, other_out_l = excluded.other_out_l, expected_l = excluded.expected_l, actual_l = excluded.actual_l,
          variance_l = excluded.variance_l, variance_pct = excluded.variance_pct, flagged = excluded.flagged, reason = excluded.reason,
          explanation = excluded.explanation, auto_generated = excluded.auto_generated, prepared_by = excluded.prepared_by,
          reviewed_by = null, reviewed_at = null, created_at = now()
        returning *`,
      [tank.id, tank.name, tank.branch_id, date, openingL, receivedL, loadedL, otherOutL, expectedL, actualL, varianceL, variancePct, flagged,
        text(body.reason, 40) || 'Other', explanation, Boolean(body.autoGenerated), sess.name]);
      await logActivity(c, ctx, sess, {
        action: 'reconciliation.saved', entity: 'reconciliation', entityId: row.id, branchId: tank.branch_id,
        summary: `${tank.name} ${date}: variance ${variancePct}%${flagged ? ' (flagged)' : ''}`,
      });
      return camel(row);
    });
  }
  if (parts[1] === 'reconciliations' && id && method === 'PATCH') {
    requireAdmin(sess); // supervisor sign-off
    const body = await ctx.body();
    if (!body.reviewed) fail(400, 'Nothing to change.');
    const rec = (await one(pool, 'update reconciliations set reviewed_by = $2, reviewed_at = now() where id = $1 returning *', [id, sess.name])) || fail(404, 'Reconciliation not found.');
    await logActivity(pool, ctx, sess, { action: 'reconciliation.signed_off', entity: 'reconciliation', entityId: id, branchId: rec.branch_id, summary: `${sess.name} signed off ${rec.tank_name} ${rec.date}` });
    return camel(rec);
  }

  return fail(404, 'Not found');
}

/** Turns database constraint errors into short messages instead of 500s. */
function dbErrorMessage(e) {
  if (e.code === '23505') {
    if (/mpesa_receipt/.test(e.constraint || '')) return 'That M-Pesa code has already been recorded.';
    if (/email/.test(e.constraint || '')) return 'An account with this email already exists.';
    return 'That record already exists.';
  }
  if (e.code === '23503') return 'This is linked to another record that no longer exists.';
  if (e.code === '23514' || e.code === '22P02' || e.code === '22003') return 'One of the values is not allowed.';
  return null;
}

// ---------- HTTP ----------

/** Browsers may only call the API from these sites (native apps send no Origin header). */
function allowedOrigin(origin) {
  if (!origin) return null;
  const allowed = [process.env.URL, process.env.DEPLOY_PRIME_URL, process.env.DEPLOY_URL,
    ...String(process.env.ALLOWED_ORIGINS || '').split(',')].map((o) => (o || '').trim().replace(/\/$/, '')).filter(Boolean);
  if (allowed.includes(origin)) return origin;
  // Local development (not on Netlify): allow localhost on any port.
  if (!process.env.NETLIFY && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return origin;
  return null;
}

/** Handles one API request: web Request in, web Response out. */
async function handle(request) {
  const origin = allowedOrigin(request.headers.get('origin'));
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    ...(origin ? {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '600',
      Vary: 'Origin',
    } : { Vary: 'Origin' }),
  };
  const respond = (status, payload) => new Response(status === 204 ? null : JSON.stringify(payload), { status, headers });
  if (request.method === 'OPTIONS') return respond(204);
  // Cross-site browser requests from unknown sites are refused outright.
  if (request.headers.get('origin') && !origin) return respond(403, { error: 'This site is not allowed to use the AquaFlow API.' });

  let parsed;
  const ctx = {
    method: request.method,
    url: new URL(request.url),
    header: (name) => request.headers.get(name),
    // Netlify sets this header itself; the local server fills it from the socket.
    ip: request.headers.get('x-nf-client-connection-ip') || 'unknown',
    body: async () => {
      if (parsed !== undefined) return parsed;
      const raw = await request.text();
      if (raw.length > 1e6) fail(413, 'Body too large');
      try { parsed = raw ? JSON.parse(raw) : {}; } catch { fail(400, 'Invalid JSON'); }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) fail(400, 'Invalid request body');
      return parsed;
    },
  };
  try {
    getPool();
    return respond(200, await route(ctx));
  } catch (error) {
    if (error instanceof HttpError) return respond(error.status, { error: error.message });
    const friendly = dbErrorMessage(error);
    if (friendly) return respond(400, { error: friendly });
    console.error(error);
    return respond(500, { error: 'Something went wrong on the server. Please try again.' });
  }
}

/** Startup check for the local server: can we reach the database and are the tables there? */
async function checkDatabase() {
  try {
    await getPool().query('select 1 from settings limit 1');
    await getPool().query('select 1 from users limit 1');
    return null;
  } catch (e) {
    if (e instanceof HttpError) return e.message;
    if (e.code === '42P01') return 'Some AquaFlow tables are missing. Run every file in supabase/migrations (or `npm run db:setup`).';
    return `Could not connect to the database: ${e.message}`;
  }
}

const closeDatabase = () => (pool ? pool.end() : Promise.resolve());

export { handle, checkDatabase, closeDatabase, payhero, hashPassword, normalizeEmail, checkPasswordStrength };
