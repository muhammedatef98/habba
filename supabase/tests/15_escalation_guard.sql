-- 15 — Privilege escalation, report tampering, slot capacity
--
-- The first test here is the one that mattered most in this whole project:
-- until 0036, a customer could promote themselves to ops and thereby bypass
-- every column guard written in 0033–0035, because is_ops() is the first check
-- in all of them.

\echo '── escalation and tamper guards'

begin;

insert into auth.users (id, phone) values
  ('11111111-0000-4000-3333-000000000001', '+966509200001'),
  ('22222222-0000-4000-3333-000000000002', '+966509200002');

insert into public.profiles (id, full_name, phone, role) values
  ('11111111-0000-4000-3333-000000000001', 'المالك', '+966509200001', 'customer'),
  ('22222222-0000-4000-3333-000000000002', 'الورشة', '+966509200002', 'workshop_admin');

insert into public.cities (id, name_ar, name_en, region_ar, region_en, centroid) values
  ('c0000000-0000-4000-3333-000000000001', 'ر', 'CityEsc', 'ر', 'R',
   extensions.st_point(46.6753, 24.7136)::extensions.geography);

insert into public.vehicle_makes (id, name_ar, name_en) values
  ('a0000000-0000-4000-3333-000000000001', 'م', 'MakeEsc');
insert into public.vehicle_models (id, make_id, name_ar, name_en, year_from) values
  ('b0000000-0000-4000-3333-000000000001', 'a0000000-0000-4000-3333-000000000001',
   'م', 'ModelEsc', 2015);
insert into public.vehicles (id, owner_id, make_id, model_id, year, plate_en, current_mileage) values
  ('d0000000-0000-4000-3333-000000000001', '11111111-0000-4000-3333-000000000001',
   'a0000000-0000-4000-3333-000000000001', 'b0000000-0000-4000-3333-000000000001',
   2020, 'ABJ 13', 90000);

insert into public.providers
  (id, owner_profile_id, provider_type, business_name_ar, cr_number, verification_status, city_id)
values
  ('e0000000-0000-4000-3333-000000000002', '22222222-0000-4000-3333-000000000002',
   'workshop', 'ورشة', '1010999999', 'approved', 'c0000000-0000-4000-3333-000000000001');

insert into public.appointment_slots (id, provider_id, starts_at, ends_at, capacity, booked_count)
values ('50000000-0000-4000-3333-000000000001', 'e0000000-0000-4000-3333-000000000002',
        now() + interval '2 days', now() + interval '2 days 1 hour', 3, 2);


-- ===========================================================================
set role authenticated;
select test.become('11111111-0000-4000-3333-000000000001');
-- ===========================================================================

-- THE escalation. Everything in 0033–0035 depended on this being impossible,
-- and until 0036 it was not.
select test.assert_raises(
  $$update public.profiles set role = 'ops'
    where id = '11111111-0000-4000-3333-000000000001'$$,
  'a customer CANNOT promote themselves to ops',
  '42501');

select test.assert_eq(
  (select role from public.profiles where id = '11111111-0000-4000-3333-000000000001'),
  'customer'::user_role, 'the role is unchanged after the attempt');

select test.assert(not public.is_ops(), 'is_ops() is still false');

-- Nor to any other role: technician would grant provider-side capabilities.
select test.assert_raises(
  $$update public.profiles set role = 'technician'
    where id = '11111111-0000-4000-3333-000000000001'$$,
  'a customer cannot assign themselves any other role either',
  '42501');

-- Nor claim their number is verified.
select test.assert_raises(
  $$update public.profiles set phone_verified = true
    where id = '11111111-0000-4000-3333-000000000001'$$,
  'a user CANNOT mark their own phone verified',
  '42501');

-- Ordinary profile edits still work.
update public.profiles set full_name = 'المالك الجديد', preferred_locale = 'en'
where id = '11111111-0000-4000-3333-000000000001';
select test.assert_eq(
  (select full_name from public.profiles where id = '11111111-0000-4000-3333-000000000001'),
  'المالك الجديد', 'a user CAN still edit their own name and locale');

-- Changing the number revokes its verification, so a verified flag cannot be
-- carried onto a different phone.
select public.begin_privileged_write();
update public.profiles set phone_verified = true
where id = '11111111-0000-4000-3333-000000000001';
select public.end_privileged_write();

update public.profiles set phone = '+966509200099'
where id = '11111111-0000-4000-3333-000000000001';

select test.assert(
  not (select phone_verified from public.profiles
       where id = '11111111-0000-4000-3333-000000000001'),
  'changing the phone number revokes its verification');


-- Report tampering ----------------------------------------------------------------
select public.append_vehicle_timeline_event(
  'd0000000-0000-4000-3333-000000000001', 'vehicle_registered', 'تسجيل', 'Registered');
select public.generate_habba_report('d0000000-0000-4000-3333-000000000001') as tok \gset

select test.assert_eq(
  ((select payload -> 'vehicle' ->> 'current_mileage'
    from public.habba_reports where public_token = :'tok'))::int,
  90000, 'the report records the real odometer');

-- The hash chain protects the TIMELINE. The report payload is a separate
-- frozen snapshot, and until 0036 the owner could simply rewrite it — the
-- public page would then serve whatever they wrote.
select test.assert_raises(
  format($$update public.habba_reports
           set payload = jsonb_set(payload, '{vehicle,current_mileage}', '40000')
           where public_token = %L$$, :'tok'),
  'an owner CANNOT rewrite an issued report',
  '42501');

select test.assert_eq(
  ((select payload -> 'vehicle' ->> 'current_mileage'
    from public.habba_reports where public_token = :'tok'))::int,
  90000, 'the report still shows the real odometer');

select test.assert_raises(
  format($$update public.habba_reports set expires_at = now() + interval '10 years'
           where public_token = %L$$, :'tok'),
  'an owner cannot extend an issued report''s life',
  '42501');

-- Revoking, which is the one thing that policy was for, still works.
update public.habba_reports set revoked_at = now() where public_token = :'tok';
select test.assert(
  public.get_habba_report(:'tok') is null,
  'revoking a report still works and takes the public link down');


-- Slot capacity ---------------------------------------------------------------------
select test.become('22222222-0000-4000-3333-000000000002');

-- Lowering the count oversells the slot: two customers hold a booking, and the
-- counter is what stops a third.
select test.assert_raises(
  $$update public.appointment_slots set booked_count = 0
    where id = '50000000-0000-4000-3333-000000000001'$$,
  'a provider CANNOT edit how many places are booked',
  '42501');

select test.assert_raises(
  $$update public.appointment_slots set capacity = 1
    where id = '50000000-0000-4000-3333-000000000001'$$,
  'capacity cannot be cut below the places already booked',
  '23514');

-- Blocking the slot is the supported way to stop taking bookings.
update public.appointment_slots set is_blocked = true
where id = '50000000-0000-4000-3333-000000000001';
select test.assert(
  (select is_blocked from public.appointment_slots
   where id = '50000000-0000-4000-3333-000000000001'),
  'a provider CAN block a slot, which is the supported route');

reset role;
rollback;

\echo '   escalation and tamper guards OK'
