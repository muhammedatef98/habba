-- 64 — صحة السيارة and تكلفة الملكية
--
-- Companion to 0097.

\echo '── vehicle insights'

begin;

select public.test_seed_auth_user('64111111-0000-4000-c064-000000000001', '+966505640001');
select public.test_seed_auth_user('64111111-0000-4000-c064-000000000002', '+966505640002');

insert into public.profiles (id, full_name, phone) values
  ('64111111-0000-4000-c064-000000000001', 'المالك', '+966505640001'),
  ('64111111-0000-4000-c064-000000000002', 'غريب', '+966505640002');

insert into public.vehicle_makes (id, name_ar, name_en) values
  ('64000000-0000-4000-c064-000000000001', 'ماركة', 'TestMakeInsights');
insert into public.vehicle_models (id, make_id, name_ar, name_en, year_from) values
  ('64000000-0000-4000-c064-000000000002', '64000000-0000-4000-c064-000000000001',
   'موديل', 'TestModelInsights', 2015);
insert into public.vehicles (id, owner_id, make_id, model_id, year, plate_en) values
  ('64000000-0000-4000-c064-0000000000a1', '64111111-0000-4000-c064-000000000001',
   '64000000-0000-4000-c064-000000000001', '64000000-0000-4000-c064-000000000002',
   2021, 'ABJ 6401');

set role authenticated;

-- An empty car is not judged ----------------------------------------------------------------------
select test.become('64111111-0000-4000-c064-000000000001');

select test.assert(
  (select h ->> 'grade' = 'unknown' and h -> 'score' = 'null'::jsonb
     from public.vehicle_health('64000000-0000-4000-c064-0000000000a1') h),
  'a car with nothing recorded has no score — not a flattering 100');

select test.assert(
  (select c ->> 'total' = '0.00' and (c ->> 'entries')::int = 0
          and jsonb_array_length(c -> 'months') = 12 and c -> 'per_1000_km' = 'null'::jsonb
     from public.vehicle_cost_summary('64000000-0000-4000-c064-0000000000a1') c),
  'and costs nothing, over twelve empty months');

-- Overdue care and an expired document bring it down ---------------------------------------------
select public.start_vehicle_care(
  '64000000-0000-4000-c064-0000000000a1',
  p_odometer_km => 60000,
  p_last_oil_km => 50000,
  p_last_oil_at => now() - interval '14 months');

select test.assert(
  (select (h ->> 'score')::int < 100
          and exists (select 1 from jsonb_array_elements(h -> 'factors') f
                       where f ->> 'key' = 'care_overdue'
                         and (f ->> 'impact')::int = -15 * (f ->> 'count')::int)
     from public.vehicle_health('64000000-0000-4000-c064-0000000000a1') h),
  'overdue care costs 15 points an item, and says so');

select (h ->> 'score')::int as before_doc
  from public.vehicle_health('64000000-0000-4000-c064-0000000000a1') h \gset

insert into public.vehicle_documents (vehicle_id, doc_type, expires_at) values
  ('64000000-0000-4000-c064-0000000000a1', 'insurance', current_date - 3);

select test.assert(
  (select (h ->> 'score')::int = greatest(0, :before_doc - 15)
          and exists (select 1 from jsonb_array_elements(h -> 'factors') f
                       where f ->> 'key' = 'documents_expired' and (f ->> 'count')::int = 1)
     from public.vehicle_health('64000000-0000-4000-c064-0000000000a1') h),
  'an expired insurance costs 15 more');

-- Doing the work brings it back up -----------------------------------------------------------------
update public.vehicle_documents set expires_at = current_date + 300
 where vehicle_id = '64000000-0000-4000-c064-0000000000a1';

update public.vehicle_maintenance_items
   set last_done_km = 60000, last_done_at = now()
 where vehicle_id = '64000000-0000-4000-c064-0000000000a1';

select test.assert(
  (select (h ->> 'score')::int = 100 and h ->> 'grade' = 'excellent'
          and jsonb_array_length(h -> 'factors') = 0
     from public.vehicle_health('64000000-0000-4000-c064-0000000000a1') h),
  'with everything done and in date, the car is excellent, with nothing to explain');

-- Costs: the owner's own entries --------------------------------------------------------------------
select public.record_past_service(
  '64000000-0000-4000-c064-0000000000a1', 'تغيير زيت', now() - interval '20 days', null, null,
  '{"service_type": "oil_change", "cost_sar": "250.00"}'::jsonb);
select public.record_past_service(
  '64000000-0000-4000-c064-0000000000a1', 'سمكرة', now() - interval '26 months', null, null,
  '{"service_type": "bodywork", "cost_sar": "1200.50"}'::jsonb);
select public.record_past_service(
  '64000000-0000-4000-c064-0000000000a1', 'غسيل', now() - interval '3 days', null, null,
  '{"service_type": "other", "cost_sar": "not a number"}'::jsonb);

select test.assert(
  (select c ->> 'total' = '1450.50' and c ->> 'last_12_months' = '250.00'
          and (c ->> 'entries')::int = 2
     from public.vehicle_cost_summary('64000000-0000-4000-c064-0000000000a1') c),
  'what the owner typed counts, an amount that is not money does not, and old costs leave the 12 months');

select test.assert(
  (select c -> 'categories' = '[{"category": "maintenance", "amount": "250.00"}]'::jsonb
     from public.vehicle_cost_summary('64000000-0000-4000-c064-0000000000a1') c),
  'the 12 months, by category');

select test.assert(
  (select sum((m ->> 'amount')::numeric) = 250
     from public.vehicle_cost_summary('64000000-0000-4000-c064-0000000000a1') c,
          jsonb_array_elements(c -> 'months') m),
  'and the months add up to the 12-month total');

select test.assert(
  (select c -> 'per_1000_km' = 'null'::jsonb
     from public.vehicle_cost_summary('64000000-0000-4000-c064-0000000000a1') c),
  'with the odometer still, there is no cost per kilometre to show');

select public.record_mileage('64000000-0000-4000-c064-0000000000a1', 61500);
select test.assert(
  (select (c ->> 'km_12_months')::int = 1500 and c ->> 'per_1000_km' = '166.67'
     from public.vehicle_cost_summary('64000000-0000-4000-c064-0000000000a1') c),
  'once it has moved 1,500 km, 250 SAR is 166.67 per 1,000 km');

-- Undocumented history is a small, stated deduction
select test.assert(
  (select exists (select 1 from jsonb_array_elements(h -> 'factors') f
                   where f ->> 'key' = 'undocumented' and (f ->> 'impact')::int between -10 and -1)
     from public.vehicle_health('64000000-0000-4000-c064-0000000000a1') h),
  'services typed without evidence cost up to ten points, and say so');

-- Nobody else ---------------------------------------------------------------------------------------
select test.become('64111111-0000-4000-c064-000000000002');
select test.assert_raises(
  $$select public.vehicle_health('64000000-0000-4000-c064-0000000000a1')$$,
  'a stranger cannot read another car''s health', '42501');
select test.assert_raises(
  $$select public.vehicle_cost_summary('64000000-0000-4000-c064-0000000000a1')$$,
  'nor what it costs', '42501');
select test.assert_raises(
  $$select * from public.vehicle_cost_lines('64000000-0000-4000-c064-0000000000a1')$$,
  'and the ungated helper is not a client API', '42501');

reset role;
rollback;

\echo '   vehicle insights OK'
