-- Vehicle-care item catalogue — the care section's extension point (0059).
--
-- This is a SEED, not a migration, for the reason 0028's rules are: it is
-- reference data ops tunes, and it names a `services` row, which is itself
-- seeded. Migrations run before seeds, so a migration that tried to make the
-- link would match zero rows and silently succeed.
--
-- ONLY OIL AND THE OIL FILTER. Brakes, tyres, battery and belts are
-- deliberately out of this slice — and when they arrive they arrive HERE, as
-- two more inserts, with no migration, no deploy and no schema change. That is
-- what `maintenance_item_types` is for.
--
-- Both rows point at the SAME service, and that is not a mistake to be tidied
-- up later. «تغيير زيت وفلتر» is one job, one invoice line and one booking in
-- this market; it is two things on the car's schedule because they are two
-- things that wear. 0061's auto-fill closes both from one completed order, and
-- 0059's cold start seeds both from the one question the owner is asked.
--
-- Intervals match supabase/seed/03_maintenance_rules.sql and lean conservative
-- for Saudi conditions: sustained heat and dust shorten oil life relative to
-- the temperate-climate figures most published schedules assume. They are a
-- starting point for a vehicle's own row, never a claim about a manufacturer's
-- schedule — the copy in 0062 says «متوقع» and not «الموعد» for exactly this
-- reason (ADR-0022).

insert into public.maintenance_item_types
  (item_type, name_ar, name_en, service_id,
   default_interval_km, default_interval_months, sort_order)
select
  'engine_oil', 'زيت المحرك', 'Engine oil', s.id, 7000, 6, 10
from public.services s
where s.name_en = 'Oil and filter change'
on conflict (item_type) do update
  set service_id = excluded.service_id;

insert into public.maintenance_item_types
  (item_type, name_ar, name_en, service_id,
   default_interval_km, default_interval_months, sort_order)
select
  'oil_filter', 'فلتر الزيت', 'Oil filter', s.id, 7000, 6, 20
from public.services s
where s.name_en = 'Oil and filter change'
on conflict (item_type) do update
  set service_id = excluded.service_id;
