-- AquaFlow: user accounts (email + password), roles, distribution branches and an activity log.
-- Run after 20261111000000_aquaflow_schema.sql. Safe to run more than once.
--
-- Roles:
--   admin    - sees and manages everything, creates staff, sees earnings and activity
--   staff    - works for one branch and only sees / changes that branch's records
--   customer - signs up, orders, pays and sees only their own records

-- ---------- distribution branches / routes ----------
create table if not exists branches (
  id text primary key default aquaflow_next_id('BR'),
  code text not null,                 -- short label, e.g. DIS-1
  name text not null,                 -- e.g. Nyali route
  area text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists branches_code_idx on branches (upper(code));

-- ---------- user accounts ----------
create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text not null check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  name text not null,
  phone text check (phone is null or phone ~ '^254[17][0-9]{8}$'),
  role text not null check (role in ('admin', 'staff', 'customer')),
  branch_id text references branches (id) on delete set null,
  password_hash text not null,
  must_change_password boolean not null default false,
  active boolean not null default true,
  created_by uuid references users (id) on delete set null,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (role <> 'staff' or branch_id is not null)
);
create unique index if not exists users_email_idx on users (email);
create index if not exists users_role_idx on users (role, branch_id);

-- Sessions now belong to a user account (old phone/PIN sessions are cleared).
drop table if exists sessions;
create table sessions (
  token_hash text primary key,       -- SHA-256 of the sign-in token; the token itself is never stored
  user_id uuid not null references users (id) on delete cascade,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days'
);
create index if not exists sessions_user_idx on sessions (user_id);
create index if not exists sessions_expires_idx on sessions (expires_at);

-- Failed sign-in counters (per email and per IP address).
create table if not exists auth_throttle (
  key text primary key,
  failures integer not null default 0,
  window_start timestamptz not null default now(),
  locked_until timestamptz
);

-- ---------- link records to a branch and to the customer's account ----------
alter table tanks add column if not exists branch_id text references branches (id) on delete set null;
alter table trucks add column if not exists branch_id text references branches (id) on delete set null;
alter table orders add column if not exists branch_id text references branches (id) on delete set null;
alter table orders add column if not exists customer_id uuid references users (id) on delete set null;
alter table deliveries add column if not exists branch_id text references branches (id) on delete set null;
alter table deliveries add column if not exists customer_id uuid references users (id) on delete set null;
alter table feedback add column if not exists branch_id text references branches (id) on delete set null;
alter table feedback add column if not exists customer_id uuid references users (id) on delete set null;
alter table payments add column if not exists branch_id text references branches (id) on delete set null;
alter table payments add column if not exists requested_by_user uuid references users (id) on delete set null;
alter table reconciliations add column if not exists branch_id text references branches (id) on delete set null;

create index if not exists tanks_branch_idx on tanks (branch_id);
create index if not exists trucks_branch_idx on trucks (branch_id);
create index if not exists orders_branch_idx on orders (branch_id, created_at desc);
create index if not exists orders_customer_id_idx on orders (customer_id, created_at desc);
create index if not exists deliveries_branch_idx on deliveries (branch_id, created_at desc);
create index if not exists deliveries_customer_id_idx on deliveries (customer_id, created_at desc);
create index if not exists feedback_branch_idx on feedback (branch_id, created_at desc);
create index if not exists feedback_customer_id_idx on feedback (customer_id, created_at desc);
create index if not exists payments_branch_idx on payments (branch_id, created_at desc);
create index if not exists payments_success_idx on payments (status, settled_at) where status = 'success';
create index if not exists reconciliations_branch_idx on reconciliations (branch_id, date desc);

-- ---------- activity log (who did what, when) ----------
create table if not exists activity_log (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  user_id uuid references users (id) on delete set null,
  user_email text,
  user_role text,
  branch_id text references branches (id) on delete set null,
  action text not null,               -- e.g. order.created, payment.received, staff.created
  entity text,                        -- e.g. order, delivery, user
  entity_id text,
  summary text not null default '',   -- one human-readable line
  amount numeric(12, 2),              -- money involved, if any
  ip text
);
create index if not exists activity_created_idx on activity_log (created_at desc);
create index if not exists activity_branch_idx on activity_log (branch_id, created_at desc);

-- ---------- triggers & lock-down ----------
do $$
declare t text;
begin
  foreach t in array array['branches', 'users'] loop
    execute format('drop trigger if exists %I_touch on %I', t, t);
    execute format('create trigger %I_touch before update on %I for each row execute function aquaflow_touch_updated_at()', t, t);
  end loop;
  foreach t in array array['branches', 'users', 'sessions', 'auth_throttle', 'activity_log'] loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

-- The public Supabase API (anon / authenticated keys) gets no access at all; only the AquaFlow server
-- (connecting with the database connection string) reads and writes these tables.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on all tables in schema public from anon';
    execute 'revoke all on all sequences in schema public from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on all tables in schema public from authenticated';
    execute 'revoke all on all sequences in schema public from authenticated';
  end if;
end $$;
