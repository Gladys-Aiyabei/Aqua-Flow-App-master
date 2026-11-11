# AquaFlow

AquaFlow is a React Native + Expo app for managing water distribution operations for both customers and staff. It includes customer ordering, staff inventory monitoring, tanker tracking, M-Pesa payment flows, and operational dashboards.

## Features

- Customer login and ordering flow
- Water product catalog and refill/new bottle selection
- Order checkout with M-Pesa style payment flow
- Staff dashboard for stock, tanks, fleet, M-Pesa, reconciliation, and feedback
- Auto-refreshing live state from the configured server
- Browser-friendly Expo web support

## Tech stack

- React Native
- Expo SDK 57
- Expo Router-compatible app shell structure
- React Native Web
- Local mock API for browser testing

## Project structure

- `App.js` — app entry, auth gate, and role-specific shell
- `src/AppContext.js` — session, auth, polling, cached state
- `src/api.js` — API URL and HTTP client logic
- `src/components/` — reusable UI and sheets
- `src/screens/` — customer and staff screens
- `server.js` — local mock backend used when the real API is unavailable

## Prerequisites

- Node.js 20.19.4+
- npm
- A browser such as Chrome

## Run the app in Chrome

```bash
npm install
npm run web
```

This starts the Expo web server and opens the app in the browser at:

- http://localhost:8083

If a port is unavailable, Expo will automatically choose the next available one.

## Start the mock backend API

This project includes a local mock API so the app can be demoed without the external AquaFlow server.

```bash
npm run mock-api
```

The mock API listens on:

- http://localhost:4000

## Database (Supabase)

All data is stored in PostgreSQL, hosted on [Supabase](https://supabase.com). The app talks to `server.js`, and only the server connects to the database.

1. Create a Supabase project.
2. Copy `.env.local.example` to `.env.local` and set `DATABASE_URL` to the **Session pooler** connection string from Supabase (Connect button). Also set `STAFF_PIN`.
3. Create the tables: paste `supabase/migrations/20261111000000_aquaflow_schema.sql` into the Supabase SQL Editor and run it (optionally `supabase/seed.sql` for demo data), or run `npm run db:setup -- --seed`.
4. Start the server with `npm run server`. It prints `database connected` when it works.

Row Level Security is enabled on every table with no policies, so the public Supabase API keys can't read or change the data.

## M-Pesa payments with PayHero

Payment prompts go through [PayHero](https://docs.payhero.co.ke). Without PayHero keys the server runs in test mode and approves payments automatically after about 6 seconds.

To take real payments:

1. Copy `.env.local.example` to `.env.local` (it is git-ignored).
2. Fill in your PayHero auth token (or API username and password) and your payment channel ID.
3. Optionally set `PAYHERO_CALLBACK_URL` to a public HTTPS address ending in `/api/payhero/callback`.
4. Restart the server with `npm run mock-api`. It logs `M-Pesa: PayHero live` when the keys are picked up.

The keys stay on the server; the app never sees them. Results are always confirmed with PayHero's status API, so a fake callback can't mark an order as paid.

## Demo login

Customer example:

- Name: `Grace Wanjiku`
- Phone: `0712345678`

Staff example:

- Name: `Operations Manager`
- PIN: `1234`

## Available scripts

```bash
npm start
npm run web
npm run mock-api
npx expo start --android
npx expo start --ios
npx expo lint
```

## Notes

- The browser app is intentionally resilient when the backend is offline.
- If the backend server is down, the app will show a connection error rather than crashing.
- The project is structured for Expo web compatibility, which is why it can run in Chrome as a web app.
