-- 05 — تقرير هبّة
--
-- This suite covers Phase 2's acceptance criterion: an owner records three
-- past services, generates a report, and the chain verifies. It also covers
-- the two things that would quietly destroy the product's credibility —
-- issuing a report over a broken chain, and leaking the owner's identity into
-- a public URL.

\echo '── habba reports'

begin;

insert into auth.users (id, phone) values
  ('11111111-1111-1111-1111-111111111111', '+966501111111'),
  ('22222222-2222-2222-2222-222222222222', '+966502222222');

insert into public.profiles (id, full_name, phone, role) values
  ('11111111-1111-1111-1111-111111111111', 'عبدالله الشمري', '+966501111111', 'customer'),
  ('22222222-2222-2222-2222-222222222222', 'مشتري محتمل',   '+966502222222', 'customer');

insert into public.vehicle_makes (id, name_ar, name_en) values
  ('a1111111-1111-1111-1111-111111111111', 'ماركة اختبار', 'TestMake');
insert into public.vehicle_models (id, make_id, name_ar, name_en, year_from) values
  ('b1111111-1111-1111-1111-111111111111', 'a1111111-1111-1111-1111-111111111111',
   'موديل اختبار', 'TestModel', 2015);
insert into public.vehicles (id, owner_id, make_id, model_id, year, plate_en, vin, colour) values
  ('d1111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111',
   'a1111111-1111-1111-1111-111111111111', 'b1111111-1111-1111-1111-111111111111',
   2019, 'ABJ 1234', '1HGBH41JXMN109186', 'أبيض');

select test.become('11111111-1111-1111-1111-111111111111');

select public.append_vehicle_timeline_event(
  'd1111111-1111-1111-1111-111111111111', 'vehicle_registered', 'تسجيل', 'Registered');


-- Phase 2 acceptance: three past services, entered by the owner ---------------
select public.record_past_service(
  'd1111111-1111-1111-1111-111111111111',
  'تغيير زيت وفلتر', now() - interval '400 days', 62000, 'Oil and filter change',
  '{"oil_grade":"5W-30","filter_part_number":"90915-YZZE1"}'::jsonb);

select public.record_past_service(
  'd1111111-1111-1111-1111-111111111111',
  'تبديل فحمات الفرامل الأمامية', now() - interval '220 days', 71000, 'Front brake pads',
  '{"part_number":"04465-33471","is_oem":true}'::jsonb);

select public.record_past_service(
  'd1111111-1111-1111-1111-111111111111',
  'تبديل إطارات', now() - interval '90 days', 78000, 'Tyre replacement',
  '{"tyre_size":"215/55R17"}'::jsonb,
  '[{"url":"https://example.test/invoice.jpg","type":"image"}]'::jsonb);

select public.record_mileage('d1111111-1111-1111-1111-111111111111', 84500);

select test.assert_eq(
  (select count(*)::int from public.vehicle_timeline
   where vehicle_id = 'd1111111-1111-1111-1111-111111111111'),
  5, 'registration + three services + one mileage reading');


-- Manual entries are never verified ------------------------------------------
select test.assert_eq(
  (select count(*)::int from public.vehicle_timeline
   where vehicle_id = 'd1111111-1111-1111-1111-111111111111'
     and event_type = 'service_completed' and provenance = 'habba_verified'),
  0, 'no owner-entered service is ever habba_verified');

select test.assert_eq(
  (select provenance from public.vehicle_timeline where summary_en = 'Tyre replacement'),
  'self_documented'::public.timeline_provenance,
  'an entry with an attached invoice is self_documented');


-- Mileage guards ---------------------------------------------------------------
select test.assert_raises(
  $$select public.record_mileage('d1111111-1111-1111-1111-111111111111', 1000)$$,
  'a current reading below the odometer is rejected, not silently dropped',
  '23514');

-- Backdating an older reading is legitimate when filling in history.
select public.record_mileage(
  'd1111111-1111-1111-1111-111111111111', 55000, now() - interval '600 days');

select test.assert_eq(
  (select current_mileage from public.vehicles where id = 'd1111111-1111-1111-1111-111111111111'),
  84500, 'a backdated older reading does not lower the odometer');

select test.assert_raises(
  $$select public.record_past_service(
      'd1111111-1111-1111-1111-111111111111', 'صيانة مستقبلية', now() + interval '10 days')$$,
  'a past service cannot be dated in the future',
  '23514');


-- Generating the report --------------------------------------------------------
select public.generate_habba_report('d1111111-1111-1111-1111-111111111111') as token \gset

select test.assert(length(:'token') > 30, 'the share token is long enough to be unguessable');

select test.assert(
  (select chain_valid from public.habba_reports where public_token = :'token'),
  'the issued report records a valid chain');


-- Privacy: the payload is about the CAR, never the owner (build prompt §7.3) ---
select test.assert(
  (select payload::text from public.habba_reports where public_token = :'token')
    not like '%عبدالله الشمري%',
  'the owner''s name does not appear in the report payload');

select test.assert(
  (select payload::text from public.habba_reports where public_token = :'token')
    not like '%+966501111111%',
  'the owner''s phone does not appear in the report payload');

select test.assert(
  (select payload::text from public.habba_reports where public_token = :'token')
    not like '%11111111-1111-1111-1111-111111111111%',
  'no owner or actor id appears in the report payload');


-- Redaction is an allowlist, so an unknown key is excluded by default ----------
select public.record_past_service(
  'd1111111-1111-1111-1111-111111111111',
  'صيانة مع ملاحظات', now() - interval '30 days', 80000, 'Service with notes',
  '{"oil_grade":"0W-20","customer_address":"حي النزهة، شارع 5","contact":"0501111111"}'::jsonb);

select public.generate_habba_report('d1111111-1111-1111-1111-111111111111') as token2 \gset

select test.assert(
  (select payload::text from public.habba_reports where public_token = :'token2')
    not like '%حي النزهة%',
  'a free-text address typed into details is redacted out of the report');
select test.assert(
  (select payload::text from public.habba_reports where public_token = :'token2')
    like '%0W-20%',
  'allowlisted mechanical facts survive redaction');


-- Coverage separates verified from owner-entered (ADR-0005) --------------------
-- Only vehicle_registered is a Habba-generated fact here. Everything else on
-- this car was typed by its owner, and the report says so.
select test.assert_eq(
  ((select payload -> 'coverage' ->> 'habba_verified'
    from public.habba_reports where public_token = :'token2'))::int,
  1, 'only the system-generated registration counts as habba_verified');

select test.assert(
  ((select payload -> 'coverage' ->> 'self_reported'
    from public.habba_reports where public_token = :'token2'))::int >= 3,
  'coverage counts the owner-entered entries separately');

-- An odometer reading an owner types is an owner's claim, not a Habba
-- measurement. Treating it as verified would be exactly the overclaim
-- ADR-0005 exists to prevent — mileage is the number most worth falsifying.
select test.assert_eq(
  (select provenance from public.vehicle_timeline
   where vehicle_id = 'd1111111-1111-1111-1111-111111111111'
     and event_type = 'mileage_recorded' and mileage = 84500),
  'self_reported'::public.timeline_provenance,
  'an owner-typed odometer reading is self_reported, not verified');


-- The report refuses to issue over a broken chain (ADR-0004) -------------------
alter table public.vehicle_timeline disable trigger vehicle_timeline_no_update_delete;
update public.vehicle_timeline set mileage = 5
where vehicle_id = 'd1111111-1111-1111-1111-111111111111'
  and summary_en = 'Front brake pads';

select test.assert_raises(
  $$select public.generate_habba_report('d1111111-1111-1111-1111-111111111111')$$,
  'a tampered logbook cannot produce a report at all',
  'XX001');

-- Restore, so the remaining assertions run against a sound chain.
update public.vehicle_timeline set mileage = 71000
where vehicle_id = 'd1111111-1111-1111-1111-111111111111'
  and summary_en = 'Front brake pads';
alter table public.vehicle_timeline enable always trigger vehicle_timeline_no_update_delete;


-- Only the owner may issue ------------------------------------------------------
select test.become('22222222-2222-2222-2222-222222222222');
select test.assert_raises(
  $$select public.generate_habba_report('d1111111-1111-1111-1111-111111111111')$$,
  'a non-owner cannot generate a report for someone else''s car',
  '42501');

rollback;

\echo '   habba reports OK'
