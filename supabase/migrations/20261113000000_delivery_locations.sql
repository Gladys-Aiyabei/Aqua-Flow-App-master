-- AquaFlow: pinned delivery locations (from "Use my current location") for Google Maps directions.
-- Safe to run more than once.
alter table orders add column if not exists latitude numeric(9, 6) check (latitude between -90 and 90);
alter table orders add column if not exists longitude numeric(9, 6) check (longitude between -180 and 180);
alter table deliveries add column if not exists latitude numeric(9, 6) check (latitude between -90 and 90);
alter table deliveries add column if not exists longitude numeric(9, 6) check (longitude between -180 and 180);
