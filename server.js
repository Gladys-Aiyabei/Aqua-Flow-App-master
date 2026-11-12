// Local AquaFlow API server for development (`npm run server`).
// In production the same handler runs as a Netlify Function (netlify/functions/api.mjs).
// Settings come from .env.local (git-ignored); see .env.local.example.
/* global __dirname, Buffer */
const http = require('http');
const fs = require('fs');
const path = require('path');

/** Loads KEY=value lines from .env.local. Existing environment variables win. */
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

let api; // loaded after .env.local, see start-up below
const PORT = Number(process.env.PORT) || 4000;

const server = http.createServer(async (req, res) => {
  try {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 1e6) { res.writeHead(413).end(); return; }
      chunks.push(chunk);
    }
    const headers = new Headers();
    Object.entries(req.headers).forEach(([k, v]) => { if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(', ') : v); });
    // Same header Netlify provides; never trust a client-supplied one.
    headers.set('x-nf-client-connection-ip', req.socket.remoteAddress || 'local');
    const request = new Request(`http://localhost:${PORT}${req.url}`, {
      method: req.method,
      headers,
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks),
    });
    const response = await api.handle(request);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (e) {
    console.error(e);
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Server error' }));
  }
});

(async () => {
  api = await import('./server/api.mjs');
  const problem = await api.checkDatabase();
  if (problem) {
    console.error(problem);
    process.exit(1);
  }
  server.listen(PORT, () => {
    console.log(`AquaFlow API listening on http://localhost:${PORT} · database connected`);
    console.log(api.payhero.enabled
      ? `M-Pesa: PayHero live (channel ${api.payhero.channelId})${api.payhero.callbackUrl ? '' : ' · no PAYHERO_CALLBACK_URL, using status checks only'}`
      : 'M-Pesa: simulation (add PayHero keys to go live)');
  });
})();

const shutdown = () => { server.close(); (api ? api.closeDatabase() : Promise.resolve()).finally(() => process.exit(0)); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
