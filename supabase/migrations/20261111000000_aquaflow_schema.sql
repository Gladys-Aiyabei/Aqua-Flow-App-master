-- AquaFlow database schema (PostgreSQL / Supabase)
-- Run once in the Supabase SQL Editor, or with `supabase db push`.
--
-- The AquaFlow server (server.js) connects with the database connection string and does all reads/writes.
-- Row Level Security is switched on with no policies, so the public Supabase API (anon / authenticated keys)
-- cannot read or change any of this data directly.

create extension if not exists pgcrypto;

-- ---------- readable IDs (ORD-1002, BLK-1003, ...) ----------
create sequence if not exists aquaflow_id_seq start with 1001;

create or replace function aquaflow_next_id(prefix text)
returns text language sql volatile as $$
  select prefix || '-' || nextval('aquaflow_id_seq')::text
$$;

create or replace function aquaflow_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------- company settings (single row) ----------
create table if not exists settings (
  id boolean primary key default true check (id),
  company_name text not null default 'AquaFlow',
  hub_name text not null default 'Main Hub',
  till_number text not null default '',
  support_phone text,
  bulk_price_per_litre numeric(10, 2) not null default 0.45 check (bulk_price_per_litre >= 0),
  low_level_percent numeric(5, 2) not null default 20 check (low_level_percent between 1 and 99),
  variance_threshold_percent numeric(5, 2) not null default 10 check (variance_threshold_percent between 0 and 100),
  updated_at timestamptz not null default now()
);
insert into settings (id) values (true) on conflict do nothing;

-- ---------- people & sign-in ----------
create table if not exists customers (
  phone text primary key check (phone ~ '^254[17][0-9]{8}$'),
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Only a SHA-256 hash of each sign-in token is stored.
create table if not exists sessions (
  token_hash text primary key,
  role text not null check (role in ('customer', 'staff')),
  name text not null,
  phone text references customers (phone) on delete cascade,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days',
  check (role = 'staff' or phone is not null)
);
create index if not exists sessions_expires_idx on sessions (expires_at);

-- ---------- water storage ----------
create table if not exists tanks (
  id text primary key default aquaflow_next_id('TANK'),
  name text not null,
  type text not null default 'Storage tank',
  location text not null default '',
  capacity_l numeric(12, 2) not null check (capacity_l > 0),
  level_l numeric(12, 2) not null default 0 check (level_l >= 0),
  inflow_lph numeric(12, 2) not null default 0,
  outflow_lph numeric(12, 2) not null default 0,
  ph numeric(4, 2),
  turbidity numeric(8, 2),
  chlorine numeric(8, 2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists tank_readings (
  id bigint generated always as identity primary key,
  tank_id text not null references tanks (id) on delete cascade,
  level_l numeric(12, 2) not null check (level_l >= 0),
  recorded_at timestamptz not null default now()
);
create index if not exists tank_readings_tank_time_idx on tank_readings (tank_id, recorded_at desc);

-- ---------- packaged water store ----------
create table if not exists products (
  id text primary key default aquaflow_next_id('PROD'),
  name text not null,
  size text not null default '20L',
  description text not null default '',
  price numeric(10, 2) not null check (price > 0),
  refill_price numeric(10, 2) check (refill_price is null or refill_price > 0),
  stock integer not null default 0 check (stock >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists orders (
  id text primary key default aquaflow_next_id('ORD'),
  customer_name text not null,
  customer_phone text,
  address text not null,
  notes text not null default '',
  total numeric(12, 2) not null check (total >= 0),
  status text not null default 'new' check (status in ('new', 'confirmed', 'dispatched', 'delivered', 'cancelled')),
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid', 'paid')),
  payment_method text not null default 'mpesa' check (payment_method in ('mpesa', 'cash')),
  mpesa_ref text,
  rider text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists orders_customer_idx on orders (customer_phone, created_at desc);
create index if not exists orders_status_idx on orders (status);

create table if not exists order_items (
  id bigint generated always as identity primary key,
  order_id text not null references orders (id) on delete cascade,
  product_id text references products (id) on delete set null,
  name text not null,
  qty integer not null check (qty > 0),
  unit_price numeric(10, 2) not null check (unit_price >= 0),
  refill boolean not null default false
);
create index if not exists order_items_order_idx on order_items (order_id);

-- ---------- bulk water by tanker ----------
create table if not exists trucks (
  id text primary key default aquaflow_next_id('TRK'),
  unit text not null,
  plate text not null default '',
  capacity_l numeric(12, 2) not null check (capacity_l > 0),
  driver_name text not null default '',
  driver_phone text,
  status text not null default 'idle' check (status in ('idle', 'maintenance', 'scheduled', 'filling', 'en_route', 'discharging')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists deliveries (
  id text primary key default aquaflow_next_id('BLK'),
  customer_name text not null,
  customer_phone text,
  destination text not null,
  volume_l integer not null check (volume_l > 0),
  amount numeric(12, 2) not null check (amount >= 0),
  notes text not null default '',
  status text not null default 'requested'
    check (status in ('requested', 'scheduled', 'filling', 'en_route', 'discharging', 'delivered', 'cancelled')),
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid', 'paid')),
  payment_method text not null default 'mpesa' check (payment_method in ('mpesa', 'cash')),
  mpesa_ref text,
  truck_id text references trucks (id) on delete set null,
  source_tank_id text references tanks (id) on delete set null,
  loaded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists deliveries_customer_idx on deliveries (customer_phone, created_at desc);
create index if not exists deliveries_status_idx on deliveries (status);
create index if not exists deliveries_source_loaded_idx on deliveries (source_tank_id, loaded_at);

-- ---------- customer feedback ----------
create table if not exists feedback (
  id text primary key default aquaflow_next_id('FB'),
  customer_name text not null,
  customer_phone text,
  rating smallint not null check (rating between 1 and 5),
  category text not null default 'Other',
  message text not null check (length(trim(message)) > 0),
  location text not null default '',
  order_id text references orders (id) on delete set null,
  status text not null default 'open' check (status in ('open', 'resolved')),
  reply text,
  replied_by text,
  replied_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists feedback_customer_idx on feedback (customer_phone, created_at desc);

-- ---------- M-Pesa / cash payments ----------
create table if not exists payments (
  id text primary key default aquaflow_next_id('PAY'),
  source text not null check (source in ('stk', 'till', 'cash')),
  status text not null default 'pending' check (status in ('pending', 'success', 'failed')),
  amount numeric(12, 2) not null check (amount > 0),
  phone text,
  payer_name text not null default '',
  description text not null default '',
  order_id text references orders (id) on delete set null,
  delivery_id text references deliveries (id) on delete set null,
  mpesa_receipt text,
  result_desc text,
  provider text,            -- 'payhero' for real prompts, null for simulation/manual
  provider_ref text,        -- PayHero reference
  checkout_request_id text, -- Safaricom CheckoutRequestID
  requested_by text,        -- customer phone, or 'staff'
  last_checked_at timestamptz,
  settled_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists payments_created_idx on payments (created_at desc);
create index if not exists payments_pending_idx on payments (status) where status = 'pending';
create unique index if not exists payments_provider_ref_idx on payments (provider_ref) where provider_ref is not null;
-- The same M-Pesa code can't be recorded twice.
create unique index if not exists payments_mpesa_receipt_idx on payments (mpesa_receipt) where mpesa_receipt is not null;

-- ---------- daily water reconciliation ----------
create table if not exists reconciliations (
  id text primary key default aquaflow_next_id('REC'),
  tank_id text not null references tanks (id) on delete cascade,
  tank_name text not null,
  date date not null,
  opening_l numeric(12, 2) not null,
  received_l numeric(12, 2) not null default 0,
  loaded_l numeric(12, 2) not null default 0,
  other_out_l numeric(12, 2) not null default 0,
  expected_l numeric(12, 2) not null,
  actual_l numeric(12, 2) not null,
  variance_l numeric(12, 2) not null,
  variance_pct numeric(7, 1) not null,
  flagged boolean not null default false,
  reason text not null default 'Other',
  explanation text not null default '',
  auto_generated boolean not null default false,
  prepared_by text not null,
  reviewed_by text,
  reviewed_at timestamptz,
  revisions jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (tank_id, date)
);

-- ---------- updated_at triggers ----------
do $$
declare t text;
begin
  foreach t in array array['settings', 'customers', 'tanks', 'products', 'orders', 'trucks', 'deliveries'] loop
    execute format('drop trigger if exists %I_touch on %I', t, t);
    execute format('create trigger %I_touch before update on %I for each row execute function aquaflow_touch_updated_at()', t, t);
  end loop;
end $$;

-- ---------- lock down the public Supabase API ----------
do $$
declare t text;
begin
  foreach t in array array['settings', 'customers', 'sessions', 'tanks', 'tank_readings', 'products', 'orders', 'order_items',
                           'trucks', 'deliveries', 'feedback', 'payments', 'reconciliations'] loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;
