// Creates the AquaFlow tables in your database (Supabase or any PostgreSQL).
// Usage: npm run db:setup            -> schema only
//        npm run db:setup -- --seed  -> schema + demo data
// Reads DATABASE_URL (and optional DATABASE_SSL / DATABASE_CA_CERT) from .env.local.
/* global __dirname */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const root = path.join(__dirname, '..');
const envFile = path.join(root, '.env.local');
if (fs.existsSync(envFile)) {
  fs.readFileSync(envFile, 'utf8').split(/\r?\n/).forEach((line) => {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  });
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set. Add it to .env.local first.');
  const url = new URL(process.env.DATABASE_URL);
  ['sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'uselibpqcompat'].forEach((k) => url.searchParams.delete(k));
  const ssl = process.env.DATABASE_SSL === 'disable' ? false
    : process.env.DATABASE_CA_CERT ? { ca: fs.readFileSync(path.resolve(root, process.env.DATABASE_CA_CERT), 'utf8') }
      : { rejectUnauthorized: false };

  const files = fs.readdirSync(path.join(root, 'supabase/migrations')).filter((f) => f.endsWith('.sql')).sort()
    .map((f) => path.join(root, 'supabase/migrations', f));
  if (process.argv.includes('--seed')) files.push(path.join(root, 'supabase/seed.sql'));

  const client = new Client({ connectionString: url.toString(), ssl });
  await client.connect();
  try {
    for (const file of files) {
      process.stdout.write(`Running ${path.relative(root, file)} ... `);
      await client.query(fs.readFileSync(file, 'utf8'));
      console.log('done');
    }
  } finally {
    await client.end();
  }
  console.log('Database is ready.');
}

main().catch((e) => {
  console.error(`\nDatabase setup failed: ${e.message}`);
  process.exit(1);
});
