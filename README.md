# AquaFlow

AquaFlow is a React Native + Expo app for managing water distribution operations for both customers and staff. It includes customer ordering, staff inventory monitoring, tanker tracking, M-Pesa payment flows, and operational dashboards.

## Features

- **Accounts:** customers sign up (name, email, M-Pesa phone, password), then log in with email and password. They choose their delivery area on their dashboard and can change it any time.
- **Roles, enforced on the server:**
  - **Admin:** sees every branch; manages branches, staff, products, prices and settings; sees earnings and the activity log.
  - **Staff:** created by the admin and assigned to one branch (e.g. DIS-1). They only see and change that branch's orders, tanker missions, tanks, tankers, payments and reconciliations.
  - **Customer:** orders bottled water or a tanker, pays by M-Pesa, tracks deliveries and leaves feedback. Sees only their own records.
- **Admin dashboard:** earnings today / 7 days / month / all time, by branch and by payment type, a 14-day chart, open work, and a full activity log.
- **M-Pesa through PayHero** (test mode without keys).
- **Data in Supabase (PostgreSQL)**, with the API running as a Netlify Function on the same site.

## Security

- Passwords are hashed with scrypt. Sign-in tokens are random and stored only as SHA-256 hashes; sessions expire after 30 days of inactivity.
- Five wrong passwords lock that email for 15 minutes (plus a per-IP limit). Login errors don't reveal whether an email exists.
- New staff get a temporary password and must set their own before doing anything else. Changing a password signs out other devices.
- Deactivating an account, resetting its password or changing its role or branch signs it out immediately.
- Every action is checked on the server (role and branch), and every change is written to the activity log.
- Row Level Security is on for all tables and the public Supabase keys have no access; only the API's connection string can read data.
- The API only accepts browser requests from the site itself (plus `ALLOWED_ORIGINS`). Netlify adds security headers (no framing, no sniffing, HSTS).

## Project structure

- `App.js`: sign-up/login flow and the admin, staff and customer apps
- `src/AppContext.js`: session, polling, the admin's branch filter
- `src/screens/auth/`: sign-up, login and change-password pages (aqua scene background)
- `src/screens/admin/`: dashboard and team management
- `src/screens/staff/`, `src/screens/customer/`: operations and customer screens
- `server/api.mjs`: the API (one handler used locally and on Netlify)
- `server.js`: local development server
- `netlify/functions/api.mjs`, `netlify.toml`: Netlify Function and build settings
- `supabase/migrations/`, `supabase/seed.sql`: database schema and demo data
- `scripts/`: `db-setup.js` (create tables) and `create-admin.js` (first admin)

## Prerequisites

- Node.js 20.19.4+ (Expo SDK 57)
- A Supabase project

## Go live on Netlify + Supabase

1. **Create the tables:** in Supabase, open the SQL Editor and run each file in `supabase/migrations/` in order. Optionally run `supabase/seed.sql` for demo branches and data. Or run `npm run db:setup -- --seed` locally once `DATABASE_URL` is in `.env.local`.
2. **Create the first admin** (locally, with `DATABASE_URL` in `.env.local`):
   ```bash
   npm run create-admin -- --email you@yourcompany.co.ke --name "Your Name"
   ```
3. **Netlify environment variables** (Site configuration > Environment variables, scope: Functions):
   - `DATABASE_URL`: the Supabase **Transaction pooler** connection string (port 6543)
   - `APP_TIMEZONE`: `Africa/Nairobi`
   - PayHero keys (optional): `PAYHERO_AUTH_TOKEN`, `PAYHERO_CHANNEL_ID`
4. **Deploy:** connect the GitHub repository in Netlify. `netlify.toml` builds the web app and the API function automatically.
5. Log in as the admin, add branches (Team > Branches), then add staff (Team > Add staff member).

The Supabase integration's `SUPABASE_*` variables aren't used: the API needs the Postgres connection string in `DATABASE_URL`.

## Run locally

```bash
npm install
cp .env.local.example .env.local   # then fill in DATABASE_URL
npm run db:setup -- --seed
npm run create-admin -- --email admin@example.com --name "Admin"
npm run server                     # API on http://localhost:4000
npm run web                        # app in the browser
```

## M-Pesa payments with PayHero

Payment prompts go through [PayHero](https://docs.payhero.co.ke). Without PayHero keys the server runs in test mode and approves payments automatically after about 6 seconds.

To take real payments:

1. Copy `.env.local.example` to `.env.local` (it is git-ignored).
2. Fill in your PayHero auth token (or API username and password) and your payment channel ID.
3. Optionally set `PAYHERO_CALLBACK_URL` to a public HTTPS address ending in `/api/payhero/callback`.
4. Restart the server (`npm run server`), or redeploy on Netlify after adding the keys as environment variables.

The keys stay on the server; the app never sees them. Results are always confirmed with PayHero's status API, so a fake callback can't mark an order as paid.

## Available scripts

```bash
npm run server          # local API
npm run web             # Expo web dev server
npm run build:web       # production web build (what Netlify runs)
npm run db:setup        # create tables (add -- --seed for demo data)
npm run create-admin    # create or reset an admin account
npm run lint
```
