-- 29 — Verified identity, and the transfer gate it unlocks (0044, 0045)
--
-- Before 0044 nothing in the product ever set `phone_verified`, so 0037's
-- ownership-transfer discovery policy — which requires it — refused everyone.
-- These assertions pin both halves: the flag now tracks what GoTrue confirmed,
-- and it still cannot be claimed.
--
-- The escalation assertion here is deliberately built on a flag that is FALSE
-- to begin with. An earlier draft set `email_verified = true` on an account
-- where it was already true; the guard allows a no-op update, so it passed
-- while proving nothing.

\echo '── verified identity'

begin;

-- ---------------------------------------------------------------------------
-- 1. Verification follows GoTrue, in both directions
-- ---------------------------------------------------------------------------
select public.test_seed_auth_user('cc111111-0000-4000-e000-000000000001', '+966577000001');
insert into public.profiles (id, full_name, phone)
values ('cc111111-0000-4000-e000-000000000001', 'مالك', '+966577000001');

select test.assert(
  (select phone_verified from public.profiles where id = 'cc111111-0000-4000-e000-000000000001'),
  'a phone sign-up is verified the moment its profile exists');

-- Changing the number is how the escalation 0037 blocks would start.
set role authenticated;
select test.become('cc111111-0000-4000-e000-000000000001');
update public.profiles set phone = '+966577999999'
  where id = 'cc111111-0000-4000-e000-000000000001';
reset role;

select test.assert(
  not (select phone_verified from public.profiles
       where id = 'cc111111-0000-4000-e000-000000000001'),
  'typing someone else''s number drops verification with it');

set role authenticated;
update public.profiles set phone = '+966577000001'
  where id = 'cc111111-0000-4000-e000-000000000001';
reset role;

select test.assert(
  (select phone_verified from public.profiles
   where id = 'cc111111-0000-4000-e000-000000000001'),
  'and restoring the number GoTrue confirmed brings it back');


-- ---------------------------------------------------------------------------
-- 2. An email-only account (0039) is a first-class, verifiable identity
-- ---------------------------------------------------------------------------
select public.test_seed_auth_email('cc111111-0000-4000-e000-000000000002', 'buyer@example.com');
insert into public.profiles (id, full_name, email)
values ('cc111111-0000-4000-e000-000000000002', 'مشتري', 'buyer@example.com');

select test.assert(
  (select email_verified from public.profiles where id = 'cc111111-0000-4000-e000-000000000002'),
  'an email-only account is email-verified');

select test.assert(
  not (select phone_verified from public.profiles
       where id = 'cc111111-0000-4000-e000-000000000002'),
  'and is NOT phone-verified — the two are separate facts');


-- ---------------------------------------------------------------------------
-- 3. Neither flag can be claimed
-- ---------------------------------------------------------------------------
-- An account GoTrue has NOT confirmed, so the flag starts false and setting it
-- true is a real change rather than a no-op the guard would rightly permit.
insert into auth.users (id, email) values
  ('cc111111-0000-4000-e000-000000000003', 'unconfirmed@example.com');
insert into public.profiles (id, full_name, email)
values ('cc111111-0000-4000-e000-000000000003', 'غير مؤكد', 'unconfirmed@example.com');

select test.assert(
  not (select email_verified from public.profiles
       where id = 'cc111111-0000-4000-e000-000000000003'),
  'an address GoTrue never confirmed is not verified');

set role authenticated;
select test.become('cc111111-0000-4000-e000-000000000003');

select test.assert_raises(
  $$update public.profiles set email_verified = true
    where id = 'cc111111-0000-4000-e000-000000000003'$$,
  'and the account cannot simply declare itself verified',
  '42501');

reset role;


-- ---------------------------------------------------------------------------
-- 4. Transfer discovery — the thing that was broken
-- ---------------------------------------------------------------------------
-- Seeded catalogue rather than hand-made ones: a fixture that invents a make
-- drifts from the columns the real table grows.
select id as mk from public.vehicle_makes order by name_en limit 1 \gset
select id as md from public.vehicle_models where make_id = :'mk' order by name_en limit 1 \gset

set role authenticated;
select test.become('cc111111-0000-4000-e000-000000000001');
insert into public.vehicles (id, owner_id, make_id, model_id, year, plate_en)
values ('cc111111-0000-4000-e000-0000000000a1',
        'cc111111-0000-4000-e000-000000000001',
        :'mk', :'md', 2019, 'ABJ 1111');
reset role;

-- Addressed to the email-only buyer.
--
-- Created through the RPC rather than by INSERT. Since 0054 there is no other
-- way: the table is guarded ENABLE ALWAYS and the client INSERT policy is
-- gone. The code comes back from the mint and is never chosen here — which is
-- the property 0054 exists to establish, so a fixture that picked its own
-- would be testing a database that no longer exists.
set role authenticated;
select test.become('cc111111-0000-4000-e000-000000000001');
select transfer_id as tid, code as otp
from public.initiate_ownership_transfer(
  'cc111111-0000-4000-e000-0000000000a1', null, 'buyer@example.com') \gset
reset role;

set role authenticated;
select test.become('cc111111-0000-4000-e000-000000000002');
select test.assert_eq(
  (select count(*)::int from public.ownership_transfers
   where id = (:'tid')::uuid),
  1, 'the verified email recipient can discover the transfer waiting for them');
reset role;

-- The unconfirmed account claims the same address. It matches on value and
-- fails on verification — which is the entire point of the flag.
set role authenticated;
select test.become('cc111111-0000-4000-e000-000000000003');
select test.assert_eq(
  (select count(*)::int from public.ownership_transfers
   where id = (:'tid')::uuid),
  0, 'an unverified account claiming that address sees nothing');
reset role;

-- ...and cannot accept it either, even holding the correct code, because a
-- forwarded link must not be enough.
set role authenticated;
select test.become('cc111111-0000-4000-e000-000000000003');
select test.assert_eq(
  public.accept_ownership_transfer((:'tid')::uuid, :'otp'),
  null::uuid,
  'nor accept it with the right code — acceptance checks the identity too, and '
  'refuses it the way it refuses a wrong code (0056)');
reset role;

-- The addressed recipient accepts, and the car moves.
set role authenticated;
select test.become('cc111111-0000-4000-e000-000000000002');
select public.accept_ownership_transfer((:'tid')::uuid, :'otp');
reset role;

select test.assert_eq(
  (select owner_id from public.vehicles where id = 'cc111111-0000-4000-e000-0000000000a1'),
  'cc111111-0000-4000-e000-000000000002'::uuid,
  'the addressed recipient accepts, and the vehicle changes hands');

select test.assert_eq(
  (select status::text from public.ownership_transfers
   where id = (:'tid')::uuid),
  'accepted', 'and the transfer is closed');

rollback;

\echo '   verified identity OK'
