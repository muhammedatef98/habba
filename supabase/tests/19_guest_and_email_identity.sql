-- 19 — Guest access and email identity
--
-- Companion to 0039. The rules worth protecting here are the ones that stop
-- "guest" and "email" from becoming ways around the identity guarantees the
-- earlier guards established.

\echo '── guest and email identity'

begin;

insert into auth.users (id, phone, email) values
  ('11111111-0000-4000-9999-000000000001', '+966509500001', null),
  ('22222222-0000-4000-9999-000000000002', null, null),
  ('33333333-0000-4000-9999-000000000003', null, 'buyer@example.com');

insert into public.profiles (id, full_name, phone, phone_verified, role) values
  ('11111111-0000-4000-9999-000000000001', 'صاحب رقم', '+966509500001', true, 'customer');

-- A guest: no phone, no email. This INSERT failing is what 0039 exists to
-- prevent — before it, profiles.phone was NOT NULL.
insert into public.profiles (id, is_guest, role) values
  ('22222222-0000-4000-9999-000000000002', true, 'customer');

insert into public.profiles (id, full_name, email, role) values
  ('33333333-0000-4000-9999-000000000003', 'مشتري', 'buyer@example.com', 'customer');

select test.assert_eq(
  (select full_name from public.profiles where id = '22222222-0000-4000-9999-000000000002'),
  'ضيف',
  'a guest profile needs no name and gets the default');


-- The logbook is NOT gated (§11) --------------------------------------------------
-- The whole reason a guest is a real anonymous auth user rather than an
-- unauthenticated client: RLS is keyed on auth.uid(), so a guest can own rows.
insert into public.vehicle_makes (id, name_ar, name_en) values
  ('a0000000-0000-4000-9999-000000000001', 'م', 'MakeGuest');
insert into public.vehicle_models (id, make_id, name_ar, name_en, year_from) values
  ('b0000000-0000-4000-9999-000000000001', 'a0000000-0000-4000-9999-000000000001',
   'م', 'ModelGuest', 2015);

set role authenticated;
select test.become('22222222-0000-4000-9999-000000000002');

insert into public.vehicles (id, owner_id, make_id, model_id, year, plate_en)
values ('d0000000-0000-4000-9999-000000000001', '22222222-0000-4000-9999-000000000002',
        'a0000000-0000-4000-9999-000000000001', 'b0000000-0000-4000-9999-000000000001',
        2020, 'ABJ 99');

select public.append_vehicle_timeline_event(
  'd0000000-0000-4000-9999-000000000001', 'vehicle_registered', 'تسجيل', 'Registered');

select test.assert_eq(
  (select count(*)::int from public.vehicles
   where id = 'd0000000-0000-4000-9999-000000000001'),
  1,
  'a GUEST can add a vehicle and read it back — the logbook is not gated (§11)');

select test.assert_eq(
  (select count(*)::int from public.vehicle_timeline
   where vehicle_id = 'd0000000-0000-4000-9999-000000000001'),
  1,
  'a guest owns real timeline rows, because a guest has a real auth.uid()');


-- Conversion keeps the same uid, so the logbook carries over ------------------------
update public.profiles
set phone = '+966509500099', full_name = 'ضيف صار عميل', is_guest = false
where id = '22222222-0000-4000-9999-000000000002';

select test.assert(
  not (select is_guest from public.profiles
       where id = '22222222-0000-4000-9999-000000000002'),
  'a guest can claim a phone number and stop being a guest');

select test.assert_eq(
  (select count(*)::int from public.vehicles
   where owner_id = '22222222-0000-4000-9999-000000000002'),
  1,
  'THE POINT: the vehicle survives conversion — same uid, logbook intact');

-- Claiming an identity does not grant its verification.
select test.assert(
  not (select phone_verified from public.profiles
       where id = '22222222-0000-4000-9999-000000000002'),
  'a claimed phone is unverified until an SMS proves it');


-- The rules that stop guest/email being a loophole ---------------------------------
select test.assert_raises(
  $$update public.profiles set is_guest = true
    where id = '22222222-0000-4000-9999-000000000002'$$,
  'an account CANNOT be turned back into a guest',
  '42501');

select test.become('33333333-0000-4000-9999-000000000003');

select test.assert_raises(
  $$update public.profiles set email_verified = true
    where id = '33333333-0000-4000-9999-000000000003'$$,
  'a user CANNOT mark their own email verified',
  '42501');

-- Same revocation rule as phone (0036): a verified flag cannot ride along to a
-- different address.
select public.begin_privileged_write();
update public.profiles set email_verified = true
where id = '33333333-0000-4000-9999-000000000003';
select public.end_privileged_write();

update public.profiles set email = 'someone.else@example.com'
where id = '33333333-0000-4000-9999-000000000003';

select test.assert(
  not (select email_verified from public.profiles
       where id = '33333333-0000-4000-9999-000000000003'),
  'changing the email revokes its verification');

-- Role escalation is still refused on every path (0036 remains the floor).
select test.assert_raises(
  $$update public.profiles set role = 'ops'
    where id = '33333333-0000-4000-9999-000000000003'$$,
  'an email user still cannot promote themselves to ops',
  '42501');

reset role;

-- A non-guest with no identity at all is refused: nothing may leave a profile
-- unreachable.
select test.assert_raises(
  $$insert into public.profiles (id, full_name, role)
    values ('44444444-0000-4000-9999-000000000004', 'مجهول', 'customer')$$,
  'a non-guest profile must carry a phone or an email',
  '23514');

-- Email uniqueness is case-insensitive, or one person becomes two accounts.
-- Collide against the address user 3 holds NOW ('someone.else@example.com'),
-- not the one they started with — the change above released that one, and an
-- earlier draft of this test wrongly asserted against the freed address.
insert into auth.users (id, email) values
  ('55555555-0000-4000-9999-000000000005', 'Someone.Else@Example.com');

select test.assert_raises(
  $$insert into public.profiles (id, full_name, email, role)
    values ('55555555-0000-4000-9999-000000000005', 'مكرر', 'SOMEONE.ELSE@example.com', 'customer')$$,
  'the same email in different case cannot become a second account',
  '23505');

-- And the freed address is genuinely reusable, which is the flip side of the
-- same rule rather than a separate one. The auth.users row deliberately does
-- not carry the address: the rule under test is the profiles index, and the
-- shim's own auth.users unique constraint would otherwise mask it.
insert into auth.users (id) values ('66666666-0000-4000-9999-000000000006');
insert into public.profiles (id, full_name, email, role)
values ('66666666-0000-4000-9999-000000000006', 'مالك جديد', 'buyer@example.com', 'customer');

select test.assert_eq(
  (select count(*)::int from public.profiles where lower(email) = 'buyer@example.com'),
  1,
  'an address released by a change can be claimed by someone else');

rollback;

\echo '   guest and email identity OK'
