-- AquaFlow: test data for the live site (delivery areas, tanks, tankers, products).
-- Run in Supabase > SQL Editor after all files in supabase/migrations.
-- Safe to run more than once: it only adds what is missing and never deletes anything.

-- Company settings (only fills empty values).
update settings set
  till_number = coalesce(nullif(till_number, ''), '1234'),
  support_phone = coalesce(support_phone, '254700123456'),
  bulk_price_per_litre = case when bulk_price_per_litre > 0 then bulk_price_per_litre else 0.45 end
where id;

-- Delivery areas / branches (skipped if a branch with the same code already exists).
insert into branches (code, name, area)
select v.code, v.name, v.area
from (values
  ('DIS-1', 'Nyali route', 'Nyali, Links Road, Kongowea'),
  ('DIS-2', 'Mtwapa route', 'Mtwapa, Shanzu, Kikambala'),
  ('DIS-3', 'Bamburi route', 'Bamburi, Utange, Kiembeni'),
  ('DIS-4', 'Kisauni route', 'Kisauni, Mlaleo, Mshomoroni')
) as v(code, name, area)
where not exists (select 1 from branches b where upper(b.code) = v.code);

-- One storage tank per branch, with a first reading.
insert into tanks (name, type, location, capacity_l, level_l, inflow_lph, outflow_lph, ph, turbidity, chlorine, branch_id)
select v.name, 'Storage tank', v.location, v.capacity, v.level, 600, 450, 7.2, 1.9, 0.8, b.id
from (values
  ('DIS-1', 'Nyali Reservoir', 'Nyali depot', 22000, 15400),
  ('DIS-2', 'Mtwapa Borehole Tank', 'Mtwapa depot', 18000, 12600),
  ('DIS-3', 'Bamburi Tank', 'Bamburi depot', 15000, 9800),
  ('DIS-4', 'Kisauni Tank', 'Kisauni depot', 12000, 2100)
) as v(code, name, location, capacity, level)
join branches b on upper(b.code) = v.code
where not exists (select 1 from tanks t where t.name = v.name);

insert into tank_readings (tank_id, level_l)
select t.id, t.level_l from tanks t
where not exists (select 1 from tank_readings r where r.tank_id = t.id);

-- Tanker trucks.
insert into trucks (unit, plate, capacity_l, driver_name, driver_phone, status, branch_id)
select v.unit, v.plate, v.capacity, v.driver, v.phone, 'idle', b.id
from (values
  ('DIS-1', 'Unit 07', 'KDD 482B', 10000, 'Peter Otieno', '254722111222'),
  ('DIS-2', 'Unit 11', 'KDF 119C', 18000, 'Hassan Ali', '254733444555'),
  ('DIS-3', 'Unit 14', 'KDG 305D', 10000, 'Mary Achieng', '254711666777'),
  ('DIS-4', 'Unit 19', 'KDH 778E', 5000, 'John Kamau', '254799888777')
) as v(code, unit, plate, capacity, driver, phone)
join branches b on upper(b.code) = v.code
where not exists (select 1 from trucks t where t.plate = v.plate);

-- Products in the shop.
insert into products (name, size, description, price, refill_price, stock, active)
select v.name, v.size, v.description, v.price, v.refill, v.stock, true
from (values
  ('20L Mineral Water', '20L', 'Purified drinking water', 120, 90, 120),
  ('12L Family Pack', '12L', 'Daily home water pack', 80, null::numeric, 80),
  ('5L Bottle', '5L', 'Handy bottle for the office or car', 40, null::numeric, 200),
  ('500ml x 24 Pack', '24x500ml', 'Case of small bottles for events', 450, null::numeric, 60)
) as v(name, size, description, price, refill, stock)
where not exists (select 1 from products p where p.name = v.name);

-- What you should now have:
select
  (select count(*) from branches) as branches,
  (select count(*) from tanks) as tanks,
  (select count(*) from trucks) as tankers,
  (select count(*) from products where active) as products;
