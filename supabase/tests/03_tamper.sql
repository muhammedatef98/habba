-- 03 — Tamper detection
--
-- Proves the hash chain does the job it is sold on. Each case bypasses the
-- append-only trigger the way a determined attacker with database access
-- would, mutates one field, and asserts that verification catches it.
--
-- The attachment and mileage cases are the reason ADR-0004 corrected the
-- build prompt's hash formula. The spec hashes only
--   prev_hash || vehicle_id || event_type || occurred_at || details
-- which leaves `attachments` and `mileage` unprotected — precisely the two
-- fields a seller falsifying a car's history would target. Under the spec's
-- formula the two tests below would PASS verification. They must fail.

\echo '── tamper detection'

begin;

insert into auth.users (id, phone) values ('11111111-1111-1111-1111-111111111111', '+966501111111');
insert into public.profiles (id, full_name, phone) values
  ('11111111-1111-1111-1111-111111111111', 'مالك', '+966501111111');
insert into public.vehicle_makes (id, name_ar, name_en) values
  ('a1111111-1111-1111-1111-111111111111', 'ماركة اختبار', 'TestMake');
insert into public.vehicle_models (id, make_id, name_ar, name_en, year_from) values
  ('b1111111-1111-1111-1111-111111111111', 'a1111111-1111-1111-1111-111111111111', 'موديل اختبار', 'TestModel', 2015);
insert into public.vehicles (id, owner_id, make_id, model_id, year, plate_en) values
  ('d1111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111',
   'a1111111-1111-1111-1111-111111111111', 'b1111111-1111-1111-1111-111111111111', 2020, 'ABJ 1234');

select test.become('11111111-1111-1111-1111-111111111111');

select public.append_vehicle_timeline_event(
  'd1111111-1111-1111-1111-111111111111', 'vehicle_registered', 'تسجيل', 'Registered');
select public.append_vehicle_timeline_event(
  'd1111111-1111-1111-1111-111111111111', 'service_completed', 'تغيير زيت', 'Oil change',
  now() - interval '60 days', 40000, null, null,
  '{"oil_grade":"5W-30"}'::jsonb,
  '[{"url":"https://example.test/before.jpg","type":"image"}]'::jsonb) as target_id \gset
select public.append_vehicle_timeline_event(
  'd1111111-1111-1111-1111-111111111111', 'mileage_recorded', 'عداد', 'Mileage', now(), 55000);

select test.assert(
  (select is_valid from public.verify_vehicle_timeline('d1111111-1111-1111-1111-111111111111')),
  'baseline chain is valid'
);

-- Bypass the append-only guard, as an attacker with database access would.
alter table public.vehicle_timeline disable trigger vehicle_timeline_no_update_delete;


-- Case 1: falsify the odometer -----------------------------------------------
update public.vehicle_timeline set mileage = 20000 where id = :'target_id';
select test.assert(
  not (select is_valid from public.verify_vehicle_timeline('d1111111-1111-1111-1111-111111111111')),
  'lowering a recorded mileage breaks verification (spec formula would MISS this)'
);
update public.vehicle_timeline set mileage = 40000 where id = :'target_id';


-- Case 2: swap the evidence photos --------------------------------------------
update public.vehicle_timeline
set attachments = '[{"url":"https://example.test/someone-elses-car.jpg","type":"image"}]'::jsonb
where id = :'target_id';
select test.assert(
  not (select is_valid from public.verify_vehicle_timeline('d1111111-1111-1111-1111-111111111111')),
  'swapping attachment photos breaks verification (spec formula would MISS this)'
);
update public.vehicle_timeline
set attachments = '[{"url":"https://example.test/before.jpg","type":"image"}]'::jsonb
where id = :'target_id';

select test.assert(
  (select is_valid from public.verify_vehicle_timeline('d1111111-1111-1111-1111-111111111111')),
  'restoring the original values makes the chain valid again'
);


-- Case 3: promote a self-reported claim to habba_verified ---------------------
update public.vehicle_timeline set provenance = 'habba_verified' where id = :'target_id';
select test.assert(
  not (select is_valid from public.verify_vehicle_timeline('d1111111-1111-1111-1111-111111111111')),
  'silently upgrading provenance breaks verification'
);
update public.vehicle_timeline set provenance = 'self_reported' where id = :'target_id';


-- Case 4: rewrite the service description -------------------------------------
update public.vehicle_timeline set details = '{"oil_grade":"0W-20"}'::jsonb where id = :'target_id';
select test.assert(
  not (select is_valid from public.verify_vehicle_timeline('d1111111-1111-1111-1111-111111111111')),
  'editing details breaks verification'
);
update public.vehicle_timeline set details = '{"oil_grade":"5W-30"}'::jsonb where id = :'target_id';


-- Case 5: reassign authorship ---------------------------------------------------
insert into auth.users (id, phone) values ('22222222-2222-2222-2222-222222222222', '+966502222222');
insert into public.profiles (id, full_name, phone) values
  ('22222222-2222-2222-2222-222222222222', 'آخر', '+966502222222');
update public.vehicle_timeline set created_by = '22222222-2222-2222-2222-222222222222'
where id = :'target_id';
select test.assert(
  not (select is_valid from public.verify_vehicle_timeline('d1111111-1111-1111-1111-111111111111')),
  'reassigning who asserted an entry breaks verification'
);
update public.vehicle_timeline set created_by = '11111111-1111-1111-1111-111111111111'
where id = :'target_id';


-- Case 6: excise a row from the middle -------------------------------------------
delete from public.vehicle_timeline where id = :'target_id';
select test.assert(
  not (select is_valid from public.verify_vehicle_timeline('d1111111-1111-1111-1111-111111111111')),
  'removing a row from the middle breaks the chain'
);

-- The verifier reports where, not just that.
select test.assert(
  (select reason from public.verify_vehicle_timeline('d1111111-1111-1111-1111-111111111111'))
    like 'prev_hash mismatch%',
  'the verifier identifies the break point for support'
);

alter table public.vehicle_timeline enable always trigger vehicle_timeline_no_update_delete;

rollback;

\echo '   tamper detection OK'
