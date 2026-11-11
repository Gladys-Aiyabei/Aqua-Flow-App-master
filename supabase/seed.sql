-- Optional demo data for AquaFlow. Run after the schema migration.
-- Safe to re-run: existing rows with the same IDs are left alone.

update settings set
  company_name = 'AquaFlow', hub_name = 'Nyali Hub', till_number = '1234', support_phone = '254700123456',
  bulk_price_per_litre = 0.45, low_level_percent = 20, variance_threshold_percent = 10
where id;

insert into tanks (id, name, type, location, capacity_l, level_l, inflow_lph, outflow_lph, ph, turbidity, chlorine) values
  ('tank-1', 'Reservoir Alpha', 'Storage tank', 'Nyali', 22000, 14800, 790, 520, 7.2, 2.1, 0.8),
  ('tank-2', 'Borehole West', 'Borehole', 'Mtwapa', 18000, 12650, 640, 470, 7.4, 1.8, 0.7)
on conflict (id) do nothing;

-- Six hourly readings per tank, ending at the current level.
insert into tank_readings (tank_id, level_l, recorded_at)
select t.id,
       case when h = 0 then t.level_l else t.level_l + h * 260 + (case when h % 2 = 0 then 120 else -80 end) end,
       now() - make_interval(mins => h * 60 + 6)
from tanks t
cross join generate_series(0, 5) as h
where t.id in ('tank-1', 'tank-2')
  and not exists (select 1 from tank_readings r where r.tank_id = t.id);

insert into products (id, name, size, description, price, refill_price, stock, active) values
  ('prod-1', '20L Mineral Water', '20L', 'Purified drinking water', 120, 90, 42, true),
  ('prod-2', '12L Family Pack', '12L', 'Daily home water pack', 80, null, 28, true)
on conflict (id) do nothing;

insert into customers (phone, name) values ('254712345678', 'Grace Wanjiku') on conflict (phone) do nothing;

insert into orders (id, customer_name, customer_phone, address, total, status, payment_status, created_at) values
  ('ORD-1001', 'Grace Wanjiku', '254712345678', 'Nyali, House 4', 240, 'new', 'unpaid', now() - interval '1 hour')
on conflict (id) do nothing;
insert into order_items (order_id, product_id, name, qty, unit_price, refill)
select 'ORD-1001', 'prod-1', '20L Mineral Water', 2, 120, false
where not exists (select 1 from order_items where order_id = 'ORD-1001');

insert into trucks (id, unit, plate, capacity_l, driver_name, driver_phone, status) values
  ('truck-1', 'Unit 07', 'KDD 482B', 10000, 'Peter Otieno', '254722111222', 'idle'),
  ('truck-2', 'Unit 11', 'KDF 119C', 18000, 'Hassan Ali', '254733444555', 'idle')
on conflict (id) do nothing;

insert into deliveries (id, customer_name, customer_phone, destination, volume_l, amount, notes, status, created_at) values
  ('BLK-1001', 'Bahari Apartments', '254722000111', 'Bamburi, Bahari Apartments Gate 2', 10000, 4500,
   'Tank on the roof, 3 floors', 'requested', now() - interval '2 hours')
on conflict (id) do nothing;

insert into feedback (id, customer_name, customer_phone, rating, category, message, location, created_at) values
  ('FB-1001', 'Grace Wanjiku', '254712345678', 5, 'Delivery', 'Water was delivered on time and was clean.', 'Nyali', now() - interval '1 day')
on conflict (id) do nothing;

insert into reconciliations (id, tank_id, tank_name, date, opening_l, received_l, loaded_l, other_out_l, expected_l, actual_l,
                             variance_l, variance_pct, flagged, reason, explanation, prepared_by, created_at) values
  ('REC-1001', 'tank-1', 'Reservoir Alpha', ((now() at time zone 'Africa/Nairobi') - interval '1 day')::date, 16000, 0, 3000, 0, 13000, 11500,
   -1500, -11.5, true, 'Meter fault', 'Pump readings differ from reserve forecast.', 'Operations Manager', now() - interval '1 day')
on conflict (id) do nothing;

-- Make sure new IDs start after the seeded ...-1001 records.
select setval('aquaflow_id_seq', greatest(1001, (select last_value from aquaflow_id_seq)));
