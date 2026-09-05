-- 13 — Column guards on vehicles and providers
--
-- Every assertion here is an attack that worked before 0034, found by probing
-- rather than by a failing test. The pattern is the same one 0033 closed on
-- `orders`: RLS grants UPDATE on a row and cannot say which columns.

\echo '── vehicle and provider guards'

begin;

insert into auth.users (id, phone) values
  ('11111111-0000-4000-1111-000000000001', '+966508000001'),
  ('22222222-0000-4000-1111-000000000002', '+966508000002'),
  ('33333333-0000-4000-1111-000000000003', '+966508000003');

insert into public.profiles (id, full_name, phone) values
  ('11111111-0000-4000-1111-000000000001', 'المالك', '+966508000001'),
  ('22222222-0000-4000-1111-000000000002', 'الفنّي', '+966508000002'),
  ('33333333-0000-4000-1111-000000000003', 'المشغّل', '+966508000003');

select test.grant_role('22222222-0000-4000-1111-000000000002', 'technician');
select test.grant_role('33333333-0000-4000-1111-000000000003', 'ops');

insert into public.cities (id, name_ar, name_en, region_ar, region_en, centroid) values
  ('c0000000-0000-4000-1111-000000000001', 'الرياض', 'RiyadhGuards', 'ر', 'R',
   extensions.st_point(46.6753, 24.7136)::extensions.geography);

insert into public.vehicle_makes (id, name_ar, name_en) values
  ('a0000000-0000-4000-1111-000000000001', 'ماركة', 'TestMakeGuards');
insert into public.vehicle_models (id, make_id, name_ar, name_en, year_from) values
  ('b0000000-0000-4000-1111-000000000001', 'a0000000-0000-4000-1111-000000000001',
   'موديل', 'TestModelGuards', 2015);
insert into public.vehicles (id, owner_id, make_id, model_id, year, vin, plate_en, current_mileage) values
  ('d0000000-0000-4000-1111-000000000001', '11111111-0000-4000-1111-000000000001',
   'a0000000-0000-4000-1111-000000000001', 'b0000000-0000-4000-1111-000000000001',
   2020, '1HGBH41JXMN800001', 'ABJ 6', 150000);

insert into public.vehicles (id, owner_id, make_id, model_id, year, plate_en) values
  ('d0000000-0000-4000-1111-000000000002', '11111111-0000-4000-1111-000000000001',
   'a0000000-0000-4000-1111-000000000001', 'b0000000-0000-4000-1111-000000000001',
   2019, 'ABJ 7');

insert into public.providers
  (id, owner_profile_id, provider_type, business_name_ar, verification_status, city_id)
values
  ('e0000000-0000-4000-1111-000000000002', '22222222-0000-4000-1111-000000000002',
   'individual', 'ورشة', 'pending', 'c0000000-0000-4000-1111-000000000001');


-- ===========================================================================
set role authenticated;
select test.become('11111111-0000-4000-1111-000000000001');
-- ===========================================================================

-- THE odometer rollback. record_mileage refuses a lower reading, but a direct
-- UPDATE never reached that function — and vehicles.current_mileage is what
-- تقرير هبّة prints as the car's odometer.
select test.assert_raises(
  $$update public.vehicles set current_mileage = 40000
    where id = 'd0000000-0000-4000-1111-000000000001'$$,
  'an owner CANNOT roll their own odometer back',
  '42501');

select test.assert_eq(
  (select current_mileage from public.vehicles where id = 'd0000000-0000-4000-1111-000000000001'),
  150000, 'the odometer is unchanged after the attempt');

-- Nor forward, which would fake a service interval or inflate a trade-in.
select test.assert_raises(
  $$update public.vehicles set current_mileage = 999999
    where id = 'd0000000-0000-4000-1111-000000000001'$$,
  'an owner cannot set the odometer forward either',
  '42501');

-- The legitimate route still works, and still refuses a decrease.
select public.record_mileage('d0000000-0000-4000-1111-000000000001', 151000);
select test.assert_eq(
  (select current_mileage from public.vehicles where id = 'd0000000-0000-4000-1111-000000000001'),
  151000, 'recording a reading through the logbook DOES move the odometer');


-- Transplanting a history onto a different car ---------------------------------
select test.assert_raises(
  $$update public.vehicles set vin = '1HGBH41JXMN800099'
    where id = 'd0000000-0000-4000-1111-000000000001'$$,
  'the VIN cannot be rewritten once recorded',
  '42501');

select test.assert_raises(
  $$update public.vehicles set vin = null
    where id = 'd0000000-0000-4000-1111-000000000001'$$,
  'the VIN cannot be cleared to free it for another car',
  '42501');

-- But an owner who did not know their VIN at sign-up can still fill it in.
update public.vehicles set vin = '1HGBH41JXMN800002'
where id = 'd0000000-0000-4000-1111-000000000002';

select test.assert_eq(
  (select vin from public.vehicles where id = 'd0000000-0000-4000-1111-000000000002'),
  '1HGBH41JXMN800002',
  'a missing VIN can be recorded once');

-- The laundering chain — deactivate, then re-register the same VIN fresh — is
-- blocked by the table-wide unique constraint, whatever is_active says.
select test.assert_raises(
  $$insert into public.vehicles (owner_id, make_id, model_id, year, vin, plate_en)
    values ('11111111-0000-4000-1111-000000000001','a0000000-0000-4000-1111-000000000001',
            'b0000000-0000-4000-1111-000000000001', 2020, '1HGBH41JXMN800001', 'ABJ 8')$$,
  'a VIN already in Habba cannot be registered a second time',
  '23505');

-- Ownership moves by transfer, which verifies the recipient by OTP.
select test.assert_raises(
  $$update public.vehicles set owner_id = '22222222-0000-4000-1111-000000000002'
    where id = 'd0000000-0000-4000-1111-000000000001'$$,
  'ownership cannot be reassigned by a direct write',
  '42501');

-- Ordinary corrections still work.
update public.vehicles set nickname = 'سيارة العائلة', colour = 'أبيض'
where id = 'd0000000-0000-4000-1111-000000000001';
select test.assert_eq(
  (select nickname from public.vehicles where id = 'd0000000-0000-4000-1111-000000000001'),
  'سيارة العائلة', 'an owner CAN still edit the details that are theirs');


-- Provider reputation -------------------------------------------------------------
select test.become('22222222-0000-4000-1111-000000000002');

-- match_providers ranks on rating and acceptance_rate, so writing your own is
-- writing your own dispatch priority.
select test.assert_raises(
  $$update public.providers
    set rating_avg = 5.00, rating_count = 480, jobs_completed = 900, acceptance_rate = 100
    where id = 'e0000000-0000-4000-1111-000000000002'$$,
  'a provider CANNOT fabricate their own rating and job history',
  '42501');

select test.assert_eq(
  (select rating_count from public.providers where id = 'e0000000-0000-4000-1111-000000000002'),
  0, 'the reputation is untouched after the attempt');

-- Self-granted verification makes KYC theatre — and an ops reviewer would see
-- a Nafath badge nobody issued.
select test.assert_raises(
  $$update public.providers set nafath_verified_at = now()
    where id = 'e0000000-0000-4000-1111-000000000002'$$,
  'a provider CANNOT mark themselves Nafath-verified',
  '42501');

select test.assert_raises(
  $$update public.providers set verification_status = 'approved'
    where id = 'e0000000-0000-4000-1111-000000000002'$$,
  'a provider CANNOT approve themselves',
  '42501');

-- Their own business details remain theirs to edit. The previous policy
-- required verification_status = 'pending' on the new row, which meant an
-- APPROVED provider could not edit anything without demoting themselves.
update public.providers set business_name_ar = 'ورشة النخبة', business_name_en = 'Elite'
where id = 'e0000000-0000-4000-1111-000000000002';

select test.assert_eq(
  (select business_name_ar from public.providers where id = 'e0000000-0000-4000-1111-000000000002'),
  'ورشة النخبة', 'a provider CAN edit their own business details');

-- Ops approves — the only actor who can.
select test.become('33333333-0000-4000-1111-000000000003');
update public.providers set verification_status = 'approved'
where id = 'e0000000-0000-4000-1111-000000000002';

select test.become('22222222-0000-4000-1111-000000000002');

update public.providers set business_name_ar = 'ورشة النخبة المعتمدة'
where id = 'e0000000-0000-4000-1111-000000000002';

select test.assert_eq(
  (select business_name_ar from public.providers where id = 'e0000000-0000-4000-1111-000000000002'),
  'ورشة النخبة المعتمدة',
  'an APPROVED provider can edit their details without demoting themselves');

reset role;
rollback;

\echo '   vehicle and provider guards OK'
