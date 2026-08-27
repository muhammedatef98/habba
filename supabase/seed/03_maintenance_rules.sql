-- Maintenance rule seed — build prompt §7.2.
--
-- "Seed with generic intervals (oil 5–10k km, air filter 20k, brake fluid 40k,
-- timing belt 90–150k depending on model) — flag them as confidence: 'generic'
-- vs 'oem'."
--
-- Every rule here is `generic`, because that is what they are: sensible
-- defaults, not manufacturer schedules. The alert copy says so out loud. When
-- real OEM intervals are loaded per model they override these by specificity,
-- and only then may an alert drop the "general estimate" qualifier.
--
-- Intervals lean conservative for Saudi conditions: sustained heat and dust
-- shorten oil and air-filter life relative to the temperate-climate figures
-- most published schedules assume.

insert into public.maintenance_rules
  (service_id, name_ar, name_en, due_every_km, due_every_months, confidence)
select s.id, 'تغيير الزيت والفلتر', 'Oil and filter change', 7000, 6, 'generic'
from public.services s where s.name_en = 'Oil and filter change'
on conflict do nothing;

insert into public.maintenance_rules
  (service_id, name_ar, name_en, due_every_km, due_every_months, confidence)
select s.id, 'فلتر الهواء', 'Air filter', 20000, 12, 'generic'
from public.services s where s.name_en = 'Air filter'
on conflict do nothing;

insert into public.maintenance_rules
  (service_id, name_ar, name_en, due_every_km, due_every_months, confidence)
select s.id, 'فحص الفرامل', 'Brake inspection', 20000, 12, 'generic'
from public.services s where s.name_en = 'Brake inspection'
on conflict do nothing;

insert into public.maintenance_rules
  (service_id, name_ar, name_en, due_every_km, due_every_months, confidence)
select s.id, 'تبديل البطارية', 'Battery replacement', null, 30, 'generic'
from public.services s where s.name_en = 'Battery replacement'
on conflict do nothing;

-- Batteries fail early in Gulf heat; 30 months is deliberately shorter than
-- the 48 a temperate schedule would suggest.

insert into public.maintenance_rules
  (service_id, name_ar, name_en, due_every_km, due_every_months, confidence)
select s.id, 'تبديل الإطارات', 'Tyre replacement', 50000, 60, 'generic'
from public.services s where s.name_en = 'Tyre replacement'
on conflict do nothing;

insert into public.maintenance_rules
  (service_id, name_ar, name_en, due_every_km, due_every_months, confidence)
select s.id, 'فحص التكييف', 'A/C service', null, 12, 'generic'
from public.services s where s.name_en = 'A/C service'
on conflict do nothing;

insert into public.maintenance_rules
  (service_id, name_ar, name_en, due_every_km, due_every_months, confidence)
select s.id, 'الفحص الدوري', 'Periodic inspection', null, 12, 'generic'
from public.services s where s.name_en = 'Periodic inspection'
on conflict do nothing;
