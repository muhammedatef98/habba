-- 32 — Ownership transfer, end to end (0054)
--
-- The acquisition loop in §1.3 has been closed twice — ADR-0019 removed the
-- public report page, 0037 gated discovery on a flag nothing set — and both
-- times the break was invisible because nothing exercised the whole path.
-- This suite walks it: mint, discover, cancel, expire, accept.
--
-- The assertions that matter most are the negative ones. Creation used to be a
-- client INSERT, which meant the client chose the hash of the code it would
-- later be checked against, and the discovery policy then handed that hash to
-- the recipient — a six-digit code behind sha256 is an offline search of a
-- million candidates. Two assertions below stand between that and a car.

\echo '── ownership transfer'

begin;

-- Seeded through the shim's GoTrue stand-in, not by INSERT. A bare
-- `insert into auth.users` leaves `phone_confirmed_at` null, so `phone_verified`
-- is false (0044) and discovery — which requires it — refuses everyone. That is
-- precisely the bug 0044/0045 were written to fix; a fixture that reproduces it
-- would test the broken world.
select public.test_seed_auth_user('ee111111-0000-4000-b000-000000000001', '+966505100001');
select public.test_seed_auth_user('ee111111-0000-4000-b000-000000000002', '+966505100002');
select public.test_seed_auth_user('ee111111-0000-4000-b000-000000000003', '+966505100003');

insert into public.profiles (id, full_name, phone) values
  ('ee111111-0000-4000-b000-000000000001', 'البائع', '+966505100001'),
  ('ee111111-0000-4000-b000-000000000002', 'المشتري', '+966505100002'),
  ('ee111111-0000-4000-b000-000000000003', 'غريب', '+966505100003');

insert into public.vehicle_makes (id, name_ar, name_en) values
  ('ee000000-0000-4000-b000-000000000001', 'ماركة النقل', 'TestMakeTransfer');
insert into public.vehicle_models (id, make_id, name_ar, name_en, year_from) values
  ('ee000000-0000-4000-b000-000000000002', 'ee000000-0000-4000-b000-000000000001',
   'موديل النقل', 'TestModelTransfer', 2015);
insert into public.vehicles (id, owner_id, make_id, model_id, year, plate_en) values
  ('ee000000-0000-4000-b000-0000000000a1', 'ee111111-0000-4000-b000-000000000001',
   'ee000000-0000-4000-b000-000000000001', 'ee000000-0000-4000-b000-000000000002',
   2021, 'ABJ 7777');

-- Some history, so the recipient preview has something to be a preview OF.
select test.become('ee111111-0000-4000-b000-000000000001');
select public.append_vehicle_timeline_event(
  'ee000000-0000-4000-b000-0000000000a1', 'mileage_recorded',
  'قراءة عدّاد', 'Mileage reading', now() - interval '200 days', 60000);
select public.append_vehicle_timeline_event(
  'ee000000-0000-4000-b000-0000000000a1', 'mileage_recorded',
  'قراءة عدّاد', 'Mileage reading', now() - interval '30 days', 68000);


-- ---------------------------------------------------------------------------
-- 1. The table is not writable by anyone but its RPCs
-- ---------------------------------------------------------------------------
-- As the table owner, so this is the GUARD failing and not RLS. A migration
-- role that can write a transfer row directly can take a car, and ENABLE
-- ALWAYS is what stops a leaked service key doing exactly that.
select test.assert_raises(
  $$insert into public.ownership_transfers
      (vehicle_id, from_owner_id, to_phone, otp_code_hash, expires_at)
    values ('ee000000-0000-4000-b000-0000000000a1',
            'ee111111-0000-4000-b000-000000000001', '+966505100002',
            encode(sha256(convert_to('000000', 'UTF8')), 'hex'),
            now() + interval '1 day')$$,
  'not even the table owner may insert a transfer directly',
  '42501');

set role authenticated;
select test.become('ee111111-0000-4000-b000-000000000001');
select test.assert_raises(
  $$insert into public.ownership_transfers
      (vehicle_id, from_owner_id, to_phone, otp_code_hash, expires_at)
    values ('ee000000-0000-4000-b000-0000000000a1',
            'ee111111-0000-4000-b000-000000000001', '+966505100002',
            encode(sha256(convert_to('000000', 'UTF8')), 'hex'),
            now() + interval '1 day')$$,
  'and a client certainly may not — the INSERT policy is gone',
  '42501');
reset role;


-- ---------------------------------------------------------------------------
-- 2. Minting
-- ---------------------------------------------------------------------------
set role authenticated;
select test.become('ee111111-0000-4000-b000-000000000001');

select transfer_id as tid, code as otp, expires_at as exp
from public.initiate_ownership_transfer(
  'ee000000-0000-4000-b000-0000000000a1', '+966505100002', null) \gset

select test.assert(
  :'otp' ~ '^[0-9]{6}$',
  'the server mints a six-digit code — and it is six digits every time, which '
  'a signed 32-bit remainder would not have been');

select test.assert_eq(
  (select status::text from public.ownership_transfers where id = (:'tid')::uuid),
  'pending', 'the transfer opens pending');

reset role;

-- Seven days, from the function rather than from a literal repeated here.
select test.assert(
  (select abs(extract(epoch from (
     expires_at - (now() + public.ownership_transfer_window()))))
   from public.ownership_transfers where id = (:'tid')::uuid) < 5,
  'the expiry is the window the database defines, not one the client sent');

select test.assert_eq(
  (select otp_code_hash from public.ownership_transfers where id = (:'tid')::uuid),
  encode(sha256(convert_to(:'otp', 'UTF8')), 'hex'),
  'and the stored hash is of the code that was returned, hashed server-side');


-- ---------------------------------------------------------------------------
-- 3. The hash is not readable — the assertion the whole OTP rests on
-- ---------------------------------------------------------------------------
-- The recipient CAN see this row: that is discovery, and it is deliberate. If
-- the row carried its own hash, the recipient could recover the code offline
-- in under a second and the "second factor" would check nothing.
set role authenticated;
select test.become('ee111111-0000-4000-b000-000000000002');

select test.assert_eq(
  (select count(*)::int from public.ownership_transfers where id = (:'tid')::uuid),
  1, 'the addressed recipient discovers the transfer');

select test.assert_raises(
  format($$select otp_code_hash from public.ownership_transfers where id = '%s'$$, :'tid'),
  'but cannot read the hash of the code they are supposed to be told',
  '42501');

reset role;

-- And neither can the sender, who has no reason to and would be a second copy
-- of it if the phone were compromised.
set role authenticated;
select test.become('ee111111-0000-4000-b000-000000000001');
select test.assert_raises(
  format($$select otp_code_hash from public.ownership_transfers where id = '%s'$$, :'tid'),
  'nor the sender, who was already handed the plaintext once',
  '42501');
reset role;


-- ---------------------------------------------------------------------------
-- 4. What the recipient sees before deciding
-- ---------------------------------------------------------------------------
set role authenticated;
select test.become('ee111111-0000-4000-b000-000000000002');

select test.assert_eq(
  (select records_total from public.pending_ownership_transfer_for_me()),
  2, 'the preview carries the weight of the logbook, not just a vehicle id');

-- Compared against a literal rather than against `vehicles`: read from here,
-- that sub-select returns NULL, because the recipient cannot see the row. That
-- is exactly why this function exists, and an assertion written the obvious way
-- would have compared NULL to NULL and passed while proving nothing.
select test.assert_eq(
  (select plate from public.pending_ownership_transfer_for_me()),
  'ABJ7777',
  'and names the car, which the recipient cannot read from vehicles yet');

select test.assert(
  (select count(*)::int from public.vehicles
    where id = 'ee000000-0000-4000-b000-0000000000a1') = 0,
  'the car itself stays the seller''s until acceptance');

reset role;

-- A stranger sees nothing. Not "an empty car" — nothing at all.
set role authenticated;
select test.become('ee111111-0000-4000-b000-000000000003');
select test.assert_eq(
  (select count(*)::int from public.pending_ownership_transfer_for_me()),
  0, 'an account the transfer is not addressed to gets no preview');
select test.assert_eq(
  (select count(*)::int from public.ownership_transfers where id = (:'tid')::uuid),
  0, 'and cannot see the row either');
reset role;


-- ---------------------------------------------------------------------------
-- 5. Cancelling
-- ---------------------------------------------------------------------------
set role authenticated;
select test.become('ee111111-0000-4000-b000-000000000002');
select test.assert_raises(
  format($$select public.cancel_ownership_transfer('%s')$$, :'tid'),
  'the recipient cannot cancel a transfer out of the sender''s account',
  '42501');
reset role;

set role authenticated;
select test.become('ee111111-0000-4000-b000-000000000001');
select public.cancel_ownership_transfer((:'tid')::uuid);
reset role;

select test.assert_eq(
  (select status::text from public.ownership_transfers where id = (:'tid')::uuid),
  'cancelled', 'the sender withdraws it');

-- The point of cancelling: the car is free to be transferred again. Before
-- 0054 the partial unique index made a stale pending row permanent.
set role authenticated;
select test.become('ee111111-0000-4000-b000-000000000001');
select transfer_id as tid2, code as otp2
from public.initiate_ownership_transfer(
  'ee000000-0000-4000-b000-0000000000a1', '+966505100002', null) \gset
reset role;

select test.assert(
  (:'otp2') <> (:'otp'), 'a re-issued transfer mints a NEW code');


-- ---------------------------------------------------------------------------
-- 6. Refusals at creation
-- ---------------------------------------------------------------------------
set role authenticated;
select test.become('ee111111-0000-4000-b000-000000000001');

select test.assert_raises(
  $$select public.initiate_ownership_transfer(
      'ee000000-0000-4000-b000-0000000000a1', '+966505100003', null)$$,
  'a second pending transfer for the same car is refused',
  '23505');

select test.assert_raises(
  $$select public.initiate_ownership_transfer(
      'ee000000-0000-4000-b000-0000000000a1', '+966505100001', null)$$,
  'and so is transferring a car to yourself',
  '23514');

select test.assert_raises(
  $$select public.initiate_ownership_transfer(
      'ee000000-0000-4000-b000-0000000000a1', null, null)$$,
  'a transfer addressed to nobody is refused with a sentence, not a constraint',
  '23514');

select test.assert_raises(
  $$select public.initiate_ownership_transfer(
      'ee000000-0000-4000-b000-0000000000a1', '+966505100002', 'buyer@example.com')$$,
  'and so is one addressed to both at once',
  '23514');

reset role;

set role authenticated;
select test.become('ee111111-0000-4000-b000-000000000003');
select test.assert_raises(
  $$select public.initiate_ownership_transfer(
      'ee000000-0000-4000-b000-0000000000a1', '+966505100002', null)$$,
  'a stranger cannot start a transfer of a car that is not theirs',
  '42501');
reset role;


-- ---------------------------------------------------------------------------
-- 7. Expiry is evaluated, not merely written
-- ---------------------------------------------------------------------------
-- Aged through the privileged-write door, because the guard from section 1
-- applies to this suite too.
select public.begin_privileged_write();
update public.ownership_transfers set expires_at = now() - interval '1 hour'
  where id = (:'tid2')::uuid;
select public.end_privileged_write();

set role authenticated;
select test.become('ee111111-0000-4000-b000-000000000002');
select test.assert_raises(
  format($$select public.accept_ownership_transfer('%s', '%s')$$, :'tid2', :'otp2'),
  'an expired transfer cannot be accepted, code or no code',
  'P0002');
select test.assert_eq(
  (select count(*)::int from public.pending_ownership_transfer_for_me()),
  0, 'and drops out of the recipient''s preview');
reset role;

-- The sweep is not client-facing: called with no argument it would retire
-- every seller's transfers.
set role authenticated;
select test.assert_raises(
  $$select public.expire_ownership_transfers(null)$$,
  'the expiry sweep is not callable by a client',
  '42501');
reset role;

-- Issuing a new one retires the stale row on the way past, which is what frees
-- the car from the partial unique index.
set role authenticated;
select test.become('ee111111-0000-4000-b000-000000000001');
select transfer_id as tid3, code as otp3
from public.initiate_ownership_transfer(
  'ee000000-0000-4000-b000-0000000000a1', '+966505100002', null) \gset
reset role;

select test.assert_eq(
  (select status::text from public.ownership_transfers where id = (:'tid2')::uuid),
  'expired', 'the stale transfer is retired rather than left blocking the car');


-- ---------------------------------------------------------------------------
-- 8. Acceptance, and what moves with the car
-- ---------------------------------------------------------------------------
set role authenticated;
select test.become('ee111111-0000-4000-b000-000000000002');

select test.assert_raises(
  format($$select public.accept_ownership_transfer('%s', '000000')$$, :'tid3'),
  'a wrong code is refused',
  '28P01');

select public.accept_ownership_transfer((:'tid3')::uuid, :'otp3');
reset role;

select test.assert_eq(
  (select owner_id from public.vehicles where id = 'ee000000-0000-4000-b000-0000000000a1'),
  'ee111111-0000-4000-b000-000000000002'::uuid,
  'the car changes hands');

select test.assert_eq(
  (select count(*)::int from public.vehicle_timeline
   where vehicle_id = 'ee000000-0000-4000-b000-0000000000a1'
     and event_type = 'ownership_transferred'),
  1, 'and the logbook records that it did');

-- The moat, stated as an assertion: the history did not reset.
select test.assert_eq(
  (select count(*)::int from public.vehicle_timeline
   where vehicle_id = 'ee000000-0000-4000-b000-0000000000a1'),
  3, 'the logbook travelled with the car rather than starting again');

select test.assert(
  (select is_valid from public.verify_vehicle_timeline(
     'ee000000-0000-4000-b000-0000000000a1')),
  'and the hash chain still verifies across the handover');

-- The seller's side of it. Not a courtesy — the handover screen tells them the
-- car leaves their list, and this is that sentence being true.
set role authenticated;
select test.become('ee111111-0000-4000-b000-000000000001');
select test.assert_eq(
  (select count(*)::int from public.vehicles
   where id = 'ee000000-0000-4000-b000-0000000000a1'),
  0, 'the car is gone from the seller''s list');
select test.assert_eq(
  (select count(*)::int from public.vehicle_timeline
   where vehicle_id = 'ee000000-0000-4000-b000-0000000000a1'),
  0, 'and so is the logbook they can no longer read');
reset role;

-- Used once. A replayed code against a closed transfer must not reopen it.
set role authenticated;
select test.become('ee111111-0000-4000-b000-000000000002');
select test.assert_raises(
  format($$select public.accept_ownership_transfer('%s', '%s')$$, :'tid3', :'otp3'),
  'an accepted transfer cannot be accepted twice',
  'P0002');
reset role;

rollback;

\echo '   ownership transfer OK'
