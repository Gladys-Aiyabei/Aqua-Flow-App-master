// Creates (or resets) an AquaFlow admin account.
// Usage: npm run create-admin -- --email you@example.com --name "Your Name"
// You'll be asked for the password; it is never shown or saved anywhere except as a hash.
/* global __dirname */
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const root = path.join(__dirname, '..');
const envFile = path.join(root, '.env.local');
if (fs.existsSync(envFile)) {
  fs.readFileSync(envFile, 'utf8').split(/\r?\n/).forEach((line) => {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  });
}
const { Client } = require('pg');

const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : undefined; };

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl.stdoutMuted = true;
    rl._writeToOutput = (s) => { if (!rl.stdoutMuted || s.includes(question)) rl.output.write(s); };
    rl.question(question, (answer) => { rl.close(); process.stdout.write('\n'); resolve(answer); });
  });
}

async function main() {
  const api = await import('../server/api.mjs');
  const email = api.normalizeEmail(arg('email'));
  const name = (arg('name') || 'Administrator').trim();
  if (!email) throw new Error('Pass a valid --email.');
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set. Add it to .env.local first.');
  const password = process.env.ADMIN_PASSWORD || await askHidden('New admin password: ');
  try { api.checkPasswordStrength(password); } catch (e) { throw new Error(e.message); }
  if (!process.env.ADMIN_PASSWORD && password !== await askHidden('Repeat the password: ')) throw new Error('The passwords do not match.');

  const url = new URL(process.env.DATABASE_URL);
  ['sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'uselibpqcompat'].forEach((k) => url.searchParams.delete(k));
  const ssl = process.env.DATABASE_SSL === 'disable' ? false
    : process.env.DATABASE_CA_CERT ? { ca: fs.readFileSync(path.resolve(root, process.env.DATABASE_CA_CERT), 'utf8') } : { rejectUnauthorized: false };
  const client = new Client({ connectionString: url.toString(), ssl });
  await client.connect();
  try {
    const hash = await api.hashPassword(password);
    const r = await client.query(`
      insert into users (email, name, role, password_hash) values ($1, $2, 'admin', $3)
      on conflict (email) do update set role = 'admin', name = excluded.name, password_hash = excluded.password_hash,
        active = true, must_change_password = false, branch_id = null
      returning (xmax = 0) as created`, [email, name, hash]);
    await client.query('delete from sessions where user_id = (select id from users where email = $1)', [email]);
    await client.query(`insert into activity_log (user_role, action, entity, summary) values ('system', 'admin.created', 'user', $1)`,
      [`Admin account ${r.rows[0].created ? 'created' : 'reset'} for ${email} from the command line`]);
    console.log(`Admin ${r.rows[0].created ? 'created' : 'updated'}: ${email}. Log in to the app with this email and password.`);
  } finally {
    await client.end();
  }
}

main().catch((e) => { console.error(`Could not create admin: ${e.message}`); process.exit(1); });
