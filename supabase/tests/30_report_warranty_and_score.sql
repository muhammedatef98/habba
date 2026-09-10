-- 30 — the report payload's warranty state and inspection scale (0046)
--
-- docs/design/report-pdf.md named two gaps that made page 3 of the printed
-- report unprintable: a warranty duration is not a warranty status, and a bare
-- "84" has no denominator. 0046 closes both in the payload, because the report
-- renders what the server sends and computes nothing of its own.
--
-- This suite also covers the defect that made those gaps academic for any
-- affected car: `redact_timeline_details` raised on a non-object `details`,
-- and since the timeline is append-only, one such row cost that owner every
-- future report permanently.

\echo '── report warranty and score'

begin;

insert into auth.users (id, phone) values
  ('11111111-3000-4000-d000-000000000001', '+966503000001'),
  ('22222222-3000-4000-d000-000000000002', '+966503000002');

insert into public.profiles (id, full_name, phone) values
  ('11111111-3000-4000-d000-000000000001', 'سعود المطيري', '+966503000001'),
  ('22222222-3000-4000-d000-000000000002', 'فنّي الضمان', '+966503000002');

select test.grant_role('22222222-3000-4000-d000-000000000002', 'technician');

insert into public.cities (id, name_ar, name_en, region_ar, region_en, centroid) values
  ('c3000000-0000-4000-d000-000000000001', 'الخبر', 'KhobarWarranty', 'الشرقية', 'Eastern',
   extensions.st_point(50.2083, 26.2794)::extensions.geography);

insert into public.vehicle_makes (id, name_ar, name_en) values
  ('a3000000-0000-4000-d000-000000000001', 'ماركة الضمان', 'TestMakeWarranty');
insert into public.vehicle_models (id, make_id, name_ar, name_en, year_from) values
  ('b3000000-0000-4000-d000-000000000001', 'a3000000-0000-4000-d000-000000000001',
   'موديل الضمان', 'TestModelWarranty', 2015);

insert into public.vehicles (id, owner_id, make_id, model_id, year, plate_en, current_mileage) values
  ('d3000000-0000-4000-d000-000000000001', '11111111-3000-4000-d000-000000000001',
   'a3000000-0000-4000-d000-000000000001', 'b3000000-0000-4000-d000-000000000001',
   2021, 'ABJ 3001', 60000),
  -- A second car with the same owner, so "this vehicle's inspections" is
  -- actually being tested rather than "this owner's".
  ('d3000000-0000-4000-d000-000000000002', '11111111-3000-4000-d000-000000000001',
   'a3000000-0000-4000-d000-000000000001', 'b3000000-0000-4000-d000-000000000001',
   2018, 'ABJ 3002', 90000);

insert into public.providers
  (id, owner_profile_id, provider_type, business_name_ar, verification_status, is_online, city_id)
values
  ('e3000000-0000-4000-d000-000000000001', '22222222-3000-4000-d000-000000000002',
   'individual', 'ورشة الضمان', 'approved', true, 'c3000000-0000-4000-d000-000000000001');

select id as svc_battery from public.services where name_en = 'Battery jump or replacement' \gset
select id as svc_oil from public.services where name_en = 'Oil and filter change' \gset

-- Orders are inserted already completed, with the warranty window set
-- explicitly. Walking the state machine would take real time to expire a
-- warranty, and what is under test here is how the payload READS a window,
-- not how 0025 sets one — 0025 has its own suite.
insert into public.orders
  (id, customer_id, vehicle_id, service_id, fulfilment_mode, service_location,
   provider_id, quoted_amount, status, completed_at, warranty_days,
   warranty_expires_at, created_by)
values
  -- Live cover.
  ('f3000000-0000-4000-d000-000000000001',
   '11111111-3000-4000-d000-000000000001', 'd3000000-0000-4000-d000-000000000001',
   :'svc_battery', 'mobile_ondemand',
   extensions.st_point(50.21, 26.28)::extensions.geography,
   'e3000000-0000-4000-d000-000000000001', 350, 'completed',
   now() - interval '10 days', 90, now() + interval '80 days',
   '11111111-3000-4000-d000-000000000001'),
  -- Cover that has run out. A buyer must be able to tell this car from one
  -- that never had any.
  ('f3000000-0000-4000-d000-000000000002',
   '11111111-3000-4000-d000-000000000001', 'd3000000-0000-4000-d000-000000000001',
   :'svc_oil', 'mobile_ondemand',
   extensions.st_point(50.21, 26.28)::extensions.geography,
   'e3000000-0000-4000-d000-000000000001', 200, 'completed',
   now() - interval '400 days', 30, now() - interval '370 days',
   '11111111-3000-4000-d000-000000000001');

select test.become('11111111-3000-4000-d000-000000000001');
select public.generate_habba_report('d3000000-0000-4000-d000-000000000001') as t1 \gset
select payload as p1 from public.habba_reports where public_token = :'t1' \gset


-- The version says which fields a reader may trust ---------------------------
-- Reports are frozen at generation (0014), so a version 1 payload exists
-- forever and will never grow these fields. A renderer that guessed from
-- their absence would print "no warranty" for a car that simply predates the
-- column.
select test.assert_eq(
  ((:'p1'::jsonb) ->> 'report_version')::int,
  2, 'a payload carrying warranties and inspections declares version 2');


-- Warranty as a STATE ---------------------------------------------------------
select test.assert_eq(
  (select count(*)::int from jsonb_array_elements((:'p1'::jsonb) -> 'warranties')),
  2, 'both the live and the expired warranty are listed');

select test.assert_eq(
  (select w ->> 'status' from jsonb_array_elements((:'p1'::jsonb) -> 'warranties') w
   where w ->> 'service_en' = 'Battery jump or replacement'),
  'active', 'a window that has not closed reads as active');

select test.assert(
  (select (w ->> 'days_remaining')::int between 75 and 81
   from jsonb_array_elements((:'p1'::jsonb) -> 'warranties') w
   where w ->> 'service_en' = 'Battery jump or replacement'),
  'the live warranty counts down to its expiry');

select test.assert_eq(
  (select w ->> 'status' from jsonb_array_elements((:'p1'::jsonb) -> 'warranties') w
   where w ->> 'service_en' = 'Oil and filter change'),
  'expired', 'a closed window reads as expired');

select test.assert(
  (select w -> 'days_remaining' = 'null'::jsonb
   from jsonb_array_elements((:'p1'::jsonb) -> 'warranties') w
   where w ->> 'service_en' = 'Oil and filter change'),
  'an expired warranty counts down to nothing, not to a negative number');

select test.assert(
  (select bool_and(not (w ->> 'has_open_claim')::boolean)
   from jsonb_array_elements((:'p1'::jsonb) -> 'warranties') w),
  'no claim is open on either job yet');


-- A re-service is a claim against a warranty, not a warranty of its own -------
insert into public.orders
  (id, customer_id, vehicle_id, service_id, fulfilment_mode, service_location,
   provider_id, quoted_amount, status, parent_order_id, warranty_days,
   warranty_expires_at, completed_at, created_by)
values
  ('f3000000-0000-4000-d000-000000000003',
   '11111111-3000-4000-d000-000000000001', 'd3000000-0000-4000-d000-000000000001',
   :'svc_battery', 'mobile_ondemand',
   extensions.st_point(50.21, 26.28)::extensions.geography,
   'e3000000-0000-4000-d000-000000000001', 0, 'completed',
   'f3000000-0000-4000-d000-000000000001', 90, now() + interval '80 days',
   now() - interval '1 day', '11111111-3000-4000-d000-000000000001');

select public.generate_habba_report('d3000000-0000-4000-d000-000000000001') as t2 \gset
select payload as p2 from public.habba_reports where public_token = :'t2' \gset

select test.assert_eq(
  (select count(*)::int from jsonb_array_elements((:'p2'::jsonb) -> 'warranties')),
  2, 'the re-service does not appear as a third warranty — that would double-count the job');

select test.assert(
  (select (w ->> 'has_open_claim')::boolean
   from jsonb_array_elements((:'p2'::jsonb) -> 'warranties') w
   where w ->> 'service_en' = 'Battery jump or replacement'),
  'the job the claim was made against is flagged as having one');

-- A claim that was raised and then called off. It still exists as a row, and
-- reading it as an open claim would put a warning on a job that is fine.
insert into public.orders
  (id, customer_id, vehicle_id, service_id, fulfilment_mode, service_location,
   provider_id, quoted_amount, status, parent_order_id, created_by)
values
  ('f3000000-0000-4000-d000-000000000005',
   '11111111-3000-4000-d000-000000000001', 'd3000000-0000-4000-d000-000000000001',
   :'svc_oil', 'mobile_ondemand',
   extensions.st_point(50.21, 26.28)::extensions.geography,
   'e3000000-0000-4000-d000-000000000001', 0, 'cancelled',
   'f3000000-0000-4000-d000-000000000002', '11111111-3000-4000-d000-000000000001');

select public.generate_habba_report('d3000000-0000-4000-d000-000000000001') as t3 \gset
select payload as p3 from public.habba_reports where public_token = :'t3' \gset

select test.assert(
  (select not (w ->> 'has_open_claim')::boolean
   from jsonb_array_elements((:'p3'::jsonb) -> 'warranties') w
   where w ->> 'service_en' = 'Oil and filter change'),
  'a cancelled claim is not an open one');


-- The inspection score, with the scale and the word ---------------------------
insert into public.inspection_reports
  (id, order_id, template_id, vehicle_id, subject_plate, subject_mileage,
   results, overall_score, recommendation, public_token, pdf_url, completed_at)
values
  ('01300000-0000-4000-d000-000000000001',
   'f3000000-0000-4000-d000-000000000002',
   (select id from public.inspection_templates where key = 'pre_purchase_v1'),
   'd3000000-0000-4000-d000-000000000001', 'ABJ 3001', 88000,
   -- 72 sits in 0026's middle band, so a derived word that simply returned the
   -- best one would fail here.
   '{}'::jsonb, 72, null, 'secret-inspection-token', 'https://example.test/secret.pdf',
   now() - interval '20 days');

-- Same owner, different car. Its score must not leak into this car's report.
insert into public.orders
  (id, customer_id, vehicle_id, service_id, fulfilment_mode, service_location,
   provider_id, quoted_amount, status, completed_at, created_by)
values
  ('f3000000-0000-4000-d000-000000000004',
   '11111111-3000-4000-d000-000000000001', 'd3000000-0000-4000-d000-000000000002',
   :'svc_oil', 'mobile_ondemand',
   extensions.st_point(50.21, 26.28)::extensions.geography,
   'e3000000-0000-4000-d000-000000000001', 200, 'completed',
   now() - interval '5 days', '11111111-3000-4000-d000-000000000001');

insert into public.inspection_reports
  (id, order_id, template_id, vehicle_id, subject_plate, results,
   overall_score, recommendation, completed_at)
values
  ('01300000-0000-4000-d000-000000000002',
   'f3000000-0000-4000-d000-000000000004',
   (select id from public.inspection_templates where key = 'pre_purchase_v1'),
   'd3000000-0000-4000-d000-000000000002', 'ABJ 3002', '{}'::jsonb,
   41, 'avoid', now() - interval '4 days');

select public.generate_habba_report('d3000000-0000-4000-d000-000000000001') as t4 \gset
select payload as p4 from public.habba_reports where public_token = :'t4' \gset

select test.assert_eq(
  (select count(*)::int from jsonb_array_elements((:'p4'::jsonb) -> 'inspections')),
  1, 'only this car''s inspection is on this car''s report');

select test.assert_eq(
  (select (i ->> 'score_scale')::int
   from jsonb_array_elements((:'p4'::jsonb) -> 'inspections') i),
  100, 'the score is printed with the scale it was scored on, not a bare number');

select test.assert_eq(
  (select i ->> 'recommendation'
   from jsonb_array_elements((:'p4'::jsonb) -> 'inspections') i),
  'negotiate',
  'a report with no stored recommendation derives one from 0026''s thresholds, not the renderer''s');

select test.assert_eq(
  (select (i ->> 'mileage_at_inspection')::int
   from jsonb_array_elements((:'p4'::jsonb) -> 'inspections') i),
  88000, 'the odometer at inspection travels with the score');

-- The stored word is product policy applied by a human inspector, and it wins.
update public.inspection_reports set recommendation = 'avoid'
where id = '01300000-0000-4000-d000-000000000001';

select public.generate_habba_report('d3000000-0000-4000-d000-000000000001') as t5 \gset
select payload as p5 from public.habba_reports where public_token = :'t5' \gset

select test.assert_eq(
  (select i ->> 'recommendation'
   from jsonb_array_elements((:'p5'::jsonb) -> 'inspections') i),
  'avoid', 'an inspector''s stored recommendation is not overwritten by the derived one');


-- The report is a document handed to strangers --------------------------------
select test.assert(
  (:'p5'::jsonb)::text not like '%secret-inspection-token%',
  'an inspection''s own share token never travels inside a report');

select test.assert(
  (:'p5'::jsonb)::text not like '%example.test/secret.pdf%',
  'an inspection''s PDF URL never travels inside a report');

select test.assert(
  (:'p5'::jsonb)::text not like '%سعود المطيري%'
  and (:'p5'::jsonb)::text not like '%+966503000001%'
  and (:'p5'::jsonb)::text not like '%11111111-3000-4000-d000-000000000001%',
  'the two new sections do not reintroduce the owner''s identity');


-- The append-only defect: one bad `details` row cost the owner every report ---
-- `vehicle_timeline.details` is jsonb with no shape constraint, so it can hold
-- an array. `jsonb_object_keys` RAISES on one rather than returning no rows,
-- which took out generate_habba_report for the whole vehicle — and the
-- timeline cannot be repaired by design.
select test.assert_eq(
  public.redact_timeline_details('[{"part_number":"X"}]'::jsonb),
  '{}'::jsonb, 'an array of details redacts to nothing instead of raising');

select test.assert_eq(
  public.redact_timeline_details('"just a string"'::jsonb),
  '{}'::jsonb, 'a scalar redacts to nothing instead of raising');

select test.assert_eq(
  public.redact_timeline_details(null),
  '{}'::jsonb, 'null still redacts to an empty object');

select test.assert_eq(
  public.redact_timeline_details('{"oil_grade":"5W-30","contact":"0501111111"}'::jsonb),
  '{"oil_grade": "5W-30"}'::jsonb, 'the allowlist still keeps exactly what it kept before');

select public.record_past_service(
  'd3000000-0000-4000-d000-000000000001',
  'صيانة بتفاصيل غير متوقّعة', now() - interval '3 days', 61000,
  'Service with array details', '[{"part_number":"04465-33471"}]'::jsonb);

select public.generate_habba_report('d3000000-0000-4000-d000-000000000001') as t6 \gset

select test.assert(
  (select payload is not null from public.habba_reports where public_token = :'t6'),
  'a timeline row with array details no longer costs the owner the report');

select test.assert_eq(
  (select e -> 'details'
   from public.habba_reports r,
        jsonb_array_elements(r.payload -> 'events') e
   where r.public_token = :'t6'
     and e ->> 'summary_en' = 'Service with array details'),
  '{}'::jsonb, 'the unreadable details are dropped, and the rest of the report survives');

rollback;

\echo '   report warranty and score OK'
