const http = require('http');

const PORT = 4000;

const buildHistory = (current, points = 6) => {
  const result = [];
  for (let i = 0; i < points; i += 1) {
    const value = Math.max(6000, current - i * 550 + (i % 2 === 0 ? 120 : -80));
    result.push({
      t: new Date(Date.now() - (points - i) * 60 * 60 * 1000).toISOString(),
      levelL: value,
    });
  }
  return result;
};

const state = {
  settings: {
    companyName: 'AquaFlow',
    hubName: 'Nyali Hub',
    tillNumber: '1234',
    lowLevelPercent: 20,
  },
  tanks: [
    {
      id: 'tank-1',
      name: 'Reservoir Alpha',
      type: 'Storage tank',
      location: 'Nyali',
      capacityL: 22000,
      levelL: 14800,
      inflowLph: 790,
      outflowLph: 520,
      ph: 7.2,
      turbidity: 2.1,
      chlorine: 0.8,
      updatedAt: new Date().toISOString(),
      history: buildHistory(14800, 6),
    },
    {
      id: 'tank-2',
      name: 'Borehole West',
      type: 'Borehole',
      location: 'Mtwapa',
      capacityL: 18000,
      levelL: 12650,
      inflowLph: 640,
      outflowLph: 470,
      ph: 7.4,
      turbidity: 1.8,
      chlorine: 0.7,
      updatedAt: new Date().toISOString(),
      history: buildHistory(12650, 6),
    },
  ],
  products: [
    {
      id: 'prod-1',
      name: '20L Mineral Water',
      size: '20L',
      description: 'Purified drinking water',
      price: 120,
      refillPrice: 90,
      stock: 42,
      active: true,
    },
    {
      id: 'prod-2',
      name: '12L Family Pack',
      size: '12L',
      description: 'Daily home water pack',
      price: 80,
      stock: 28,
      active: true,
    },
  ],
  orders: [
    {
      id: 'ORD-1001',
      customerName: 'Grace Wanjiku',
      customerPhone: '0712345678',
      address: 'Nyali, House 4',
      total: 240,
      status: 'new',
      paymentStatus: 'unpaid',
      paymentMethod: 'mpesa',
      createdAt: new Date().toISOString(),
      items: [
        { productId: 'prod-1', name: '20L Mineral Water', qty: 2, unitPrice: 120, refill: false },
      ],
    },
  ],
  deliveries: [
    { id: 'del-1', status: 'requested', route: 'Nyali Run', eta: '20 mins' },
  ],
  feedback: [
    { id: 'fb-1', status: 'open', customer: 'Grace Wanjiku', message: 'Water was delivered on time and was clean.' },
  ],
  reconciliations: [
    { id: 'rec-1', flagged: true, reviewedBy: null, note: 'Pump readings differ from reserve forecast.' },
  ],
};

const clone = (value) => JSON.parse(JSON.stringify(value));

const send = (res, statusCode, payload) => {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  });
  res.end(JSON.stringify(payload));
};

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1e6) {
        req.destroy();
        reject(new Error('Body too large'));
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });

const getOrderById = (id) => state.orders.find((order) => order.id === id);
const getProductById = (id) => state.products.find((product) => product.id === id);

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    send(res, 204, {});
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  try {
    if (url.pathname === '/api/health') {
      send(res, 200, { ok: true, service: 'aquaflow-mock-api' });
      return;
    }

    if (url.pathname === '/api/auth/customer') {
      const body = await readBody(req);
      const name = body.name || 'Demo Customer';
      const phone = body.phone || '0712345678';
      send(res, 200, {
        token: `customer-token-${Date.now()}`,
        role: 'customer',
        name,
        phone,
      });
      return;
    }

    if (url.pathname === '/api/auth/staff') {
      const body = await readBody(req);
      if (body.pin !== '1234') {
        send(res, 401, { error: 'Invalid staff PIN.' });
        return;
      }
      send(res, 200, {
        token: `staff-token-${Date.now()}`,
        role: 'staff',
        name: body.name || 'Operations Manager',
        phone: body.phone || '0700000000',
      });
      return;
    }

    if (url.pathname === '/api/auth/logout') {
      send(res, 200, { ok: true });
      return;
    }

    if (url.pathname === '/api/state') {
      send(res, 200, clone(state));
      return;
    }

    if (url.pathname === '/api/orders' && req.method === 'POST') {
      const body = await readBody(req);
      const items = (body.items || []).map((item) => {
        const product = getProductById(item.productId);
        if (!product) return null;
        const unitPrice = item.refill && product.refillPrice ? product.refillPrice : product.price;
        const qty = Number(item.qty || 0);
        if (product.stock !== undefined) product.stock = Math.max(0, product.stock - qty);
        return {
          productId: item.productId,
          name: product.name,
          qty,
          unitPrice,
          refill: Boolean(item.refill),
        };
      }).filter(Boolean);

      const total = items.reduce((sum, item) => sum + item.qty * item.unitPrice, 0);
      const order = {
        id: `ORD-${Date.now()}`,
        customerName: body.customerName || 'Demo Customer',
        customerPhone: body.customerPhone || '0712345678',
        address: body.address || 'Nyali, Home 1',
        total,
        status: 'new',
        paymentStatus: 'unpaid',
        paymentMethod: 'mpesa',
        createdAt: new Date().toISOString(),
        items,
      };
      state.orders.unshift(order);
      send(res, 200, order);
      return;
    }

    if (url.pathname.startsWith('/api/orders/')) {
      const id = url.pathname.split('/').pop();
      const order = getOrderById(id);

      if (!order) {
        send(res, 404, { error: 'Order not found' });
        return;
      }

      if (req.method === 'PATCH') {
        const body = await readBody(req);
        Object.assign(order, body);
        if (body.status === 'delivered') order.paymentStatus = 'paid';
        send(res, 200, order);
        return;
      }

      if (req.method === 'DELETE') {
        state.orders = state.orders.filter((item) => item.id !== id);
        send(res, 200, { ok: true });
        return;
      }
    }

    if (url.pathname === '/api/products' && req.method === 'POST') {
      const body = await readBody(req);
      const product = {
        id: `prod-${Date.now()}`,
        name: body.name || 'New Product',
        size: body.size || '20L',
        description: body.description || '',
        price: Number(body.price || 0),
        refillPrice: body.refillPrice ? Number(body.refillPrice) : undefined,
        stock: Number(body.stock || 0),
        active: body.active !== false,
      };
      state.products.push(product);
      send(res, 200, product);
      return;
    }

    if (url.pathname.startsWith('/api/products/')) {
      const id = url.pathname.split('/').pop();
      const product = getProductById(id);

      if (!product) {
        send(res, 404, { error: 'Product not found' });
        return;
      }

      if (req.method === 'PATCH') {
        const body = await readBody(req);
        if (typeof body.restock === 'number') {
          product.stock = (Number(product.stock) || 0) + body.restock;
        }
        Object.assign(product, body);
        send(res, 200, product);
        return;
      }

      if (req.method === 'DELETE') {
        state.products = state.products.filter((item) => item.id !== id);
        send(res, 200, { ok: true });
        return;
      }
    }

    if (url.pathname === '/api/tanks' && req.method === 'POST') {
      const body = await readBody(req);
      const tank = {
        id: `tank-${Date.now()}`,
        name: body.name || 'New Tank',
        type: body.type || 'Storage tank',
        location: body.location || '',
        capacityL: Number(body.capacityL || 0),
        levelL: Number(body.levelL || 0),
        inflowLph: 0,
        outflowLph: 0,
        updatedAt: new Date().toISOString(),
        history: buildHistory(Number(body.levelL || 0), 5),
      };
      state.tanks.push(tank);
      send(res, 200, tank);
      return;
    }

    if (url.pathname.startsWith('/api/tanks/')) {
      const id = url.pathname.split('/').pop();
      const tank = state.tanks.find((item) => item.id === id);
      if (!tank) {
        send(res, 404, { error: 'Tank not found' });
        return;
      }
      if (req.method === 'PATCH') {
        const body = await readBody(req);
        Object.assign(tank, body);
        tank.updatedAt = new Date().toISOString();
        tank.history = buildHistory(Number(tank.levelL || 0), 5);
        send(res, 200, tank);
        return;
      }
      if (req.method === 'DELETE') {
        state.tanks = state.tanks.filter((item) => item.id !== id);
        send(res, 200, { ok: true });
        return;
      }
    }

    send(res, 404, { error: 'Not found' });
  } catch (error) {
    send(res, 500, { error: error.message || 'Server error' });
  }
});

server.listen(PORT, () => {
  console.log(`AquaFlow mock API listening on http://localhost:${PORT}`);
});
