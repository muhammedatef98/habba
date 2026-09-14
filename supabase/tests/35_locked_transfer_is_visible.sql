-- 35 — A locked handover is visible to both parties, and every refusal is written down (0057)
--
-- 0056 locked the row after five wrong codes and told nobody. Suite 34 proves
-- the lock holds; this one proves somebody can act on it.
--
-- The assertion that has to survive every change below is the one in section 3:
-- `accept_ownership_transfer` still answers a locked transfer exactly the way
-- it answers a wrong code. The lock is surfaced through the READ paths, each of
-- which already decides who may see the row — not through the accept response,
-- which is the thing an attacker can call about a car they know nothing about.

\echo '── locked transfer is visible'

begin;

select public.test_seed_auth_user('bb333333-0000-4000-e000-000000000001', '+966505300001');
select public.test_seed_auth_user('bb333333-0000-4000-e000-000000000002', '+966505300002');
select public.test_seed_auth_user('bb333333-0000-4000-e000-000000000003', '+966505300003');
select public.test_seed_auth_user('bb333333-0000-4000-e000-000000000004', '+966505300004');
select public.test_seed_auth_user('bb333333-0000-4000-e000-000000000005', '+966505300005');

insert into public.profiles (id, full_name, phone) values
  ('bb333333-0000-4000-e000-000000000001', 'البائع', '+966505300001'),
  ('bb333333-0000-4000-e000-000000000002', 'المشتري', '+966505300002'),
  ('bb333333-0000-4000-e000-000000000003', 'غريب', '+966505300003'),
  ('bb333333-0000-4000-e000-000000000004', 'مشتري ثانٍ', '+966505300004'),
  ('bb333333-0000-4000-e000-000000000005', 'مشتري ثالث', '+966505300005');

insert into public.vehicle_makes (id, name_ar, name_en) values
  ('bb000000-0000-4000-e000-000000000001', 'ماركة القفل', 'TestMakeLocked');
insert into public.vehicle_models (id, make_id, name_ar, name_en, year_from) values
  ('bb000000-0000-4000-e000-000000000002', 'bb000000-0000-4000-e000-000000000001',
   'موديل القفل', 'TestModelLocked', 2015);

insert into public.vehicles (id, owner_id, make_id, model_id, year, plate_en) values
  ('bb000000-0000-4000-e000-0000000000a1', 'bb333333-0000-4000-e000-000000000001',
   'bb000000-0000-4000-e000-000000000001', 'bb000000-0000-4000-e000-000000000002',
   2021, 'ABJ 2001'),
  ('bb000000-0000-4000-e000-0000000000a2', 'bb333333-0000-4000-e000-000000000001',
   'bb000000-0000-4000-e000-000000000001', 'bb000000-0000-4000-e000-000000000002',
   2021, 'ABJ 2002'),
  ('bb000000-0000-4000-e000-0000000000a3', 'bb333333-0000-4000-e000-000000000001',
   'bb000000-0000-4000-e000-000000000001', 'bb000000-0000-4000-e000-000000000002',
   2021, 'ABJ 2003'),
  ('bb000000-0000-4000-e000-0000000000a4', 'bb333333-0000-4000-e000-000000000001',
   'bb000000-0000-4000-e000-000000000001', 'bb000000-0000-4000-e000-000000000002',
   2021, 'ABJ 2004');

-- Five wrong codes, as the addressed recipient. Wrapped so each section can
-- lock a row without five copies of the same block.
create or replace function pg_temp.exhaust(p_actor uuid, p_transfer_id uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_actor::text, true);
  perform public.accept_ownership_transfer(p_transfer_id, '000000')
  from generate_series(1, public.transfer_attempt_limit());
end $$;


-- ===========================================================================
-- 1. A transfer that has not been guessed at is not exhausted
-- ===========================================================================
set role authenticated;
select test.become('bb333333-0000-4000-e000-000000000001');
select transfer_id as tid, code as otp
from public.initiate_ownership_transfer(
  'bb000000-0000-4000-e000-0000000000a1', '+966505300002', null) \gset

select test.assert_eq(
  (select attempts_exhausted from public.outgoing_ownership_transfer(
     'bb000000-0000-4000-e000-0000000000a1')),
  false, 'a fresh transfer reads as not exhausted to the seller');

select test.assert_eq(
  (select status::text from public.outgoing_ownership_transfer(
     'bb000000-0000-4000-e000-0000000000a1')),
  'pending', 'and the seller sees it pending, addressed and timed');

select test.assert_eq(
  (select to_phone from public.outgoing_ownership_transfer(
     'bb000000-0000-4000-e000-0000000000a1')),
  '+966505300002', 'with the address it was sent to');
reset role;

-- The seller's read is authorised on ownership of the CAR, so a stranger
-- holding the vehicle id gets nothing — not a row with nulls in it.
set role authenticated;
select test.become('bb333333-0000-4000-e000-000000000003');
select test.assert_eq(
  (select count(*)::int from public.outgoing_ownership_transfer(
     'bb000000-0000-4000-e000-0000000000a1')),
  0, 'and nobody else can read the seller''s transfer through it');
reset role;


-- ===========================================================================
-- 2. Five wrong codes, and the seller is told
-- ===========================================================================
set role authenticated;
select pg_temp.exhaust(
  'bb333333-0000-4000-e000-000000000002'::uuid, (:'tid')::uuid);
reset role;

set role authenticated;
select test.become('bb333333-0000-4000-e000-000000000001');
select test.assert_eq(
  (select attempts_exhausted from public.outgoing_ownership_transfer(
     'bb000000-0000-4000-e000-0000000000a1')),
  true, 'the seller is told the attempts are spent — the dead end 0056 left');

-- The derived fact, and only the derived fact. «انتهت المحاولات» is actionable;
-- «بقيت محاولتان» is a hint, and the column behind it stays off every surface.
select test.assert_raises(
  format($$select failed_attempts from public.ownership_transfers where id = '%s'$$, :'tid'),
  'without the count behind it, which is still nobody''s to read',
  '42501');
reset role;


-- ===========================================================================
-- 3. The recipient is told too — and `accept` says exactly what it said before
-- ===========================================================================
set role authenticated;
select test.become('bb333333-0000-4000-e000-000000000002');

select test.assert_eq(
  (select attempts_exhausted from public.pending_ownership_transfer_for_me()),
  true, 'the recipient is told to stop typing and ask for a new code');

-- Safe because of WHO can reach this row: the gate on
-- `pending_ownership_transfer_for_me` is a verified identity the transfer is
-- addressed to (0045), so anyone who sees this could already see the row.
select test.assert_eq(
  (select transfer_id from public.pending_ownership_transfer_for_me()),
  (:'tid')::uuid, 'through the same gate that showed them the car in the first place');

-- The load-bearing one. Surfacing the lock through the reads must not have
-- leaked it into the accept response, which is the surface an attacker reaches
-- for a car they know nothing about.
select test.assert_eq(
  public.accept_ownership_transfer((:'tid')::uuid, :'otp'),
  null::uuid,
  'and accept still refuses a locked transfer exactly as it refuses a wrong code');
reset role;

-- A stranger, with the transfer id in hand, learns nothing from either read.
set role authenticated;
select test.become('bb333333-0000-4000-e000-000000000003');
select test.assert_eq(
  (select count(*)::int from public.pending_ownership_transfer_for_me()),
  0, 'a stranger gets no preview, so no lock state either');
select test.assert_eq(
  public.accept_ownership_transfer((:'tid')::uuid, :'otp'),
  null::uuid, 'and the same NULL everyone else gets');
reset role;


-- ===========================================================================
-- 4. Every undifferentiated refusal is written down
-- ===========================================================================
-- One NULL for seven reasons is right for the caller and useless for support.
-- If accept ever returns NULL because of a bug — a profile row missing, a
-- verification flag that stopped syncing — the product calls it a wrong code
-- and the bug is invisible. This is where the difference lives.

select test.assert_eq(
  (select count(*)::int from public.transfer_accept_attempts
   where transfer_id = (:'tid')::uuid
     and actor_id = 'bb333333-0000-4000-e000-000000000002'
     and reason = 'wrong_code'),
  5, 'five wrong codes are logged as wrong codes');

select test.assert_eq(
  (select count(*)::int from public.transfer_accept_attempts
   where transfer_id = (:'tid')::uuid
     and actor_id = 'bb333333-0000-4000-e000-000000000002'
     and reason = 'locked'),
  1, 'and the sixth as locked, not as a sixth wrong code');

-- The stranger in section 3 is logged as `locked`, not as `not_addressed`:
-- acceptance checks the row's state before it checks who is asking, so a shut
-- transfer is shut for everyone and the identity of the caller never enters
-- into it. Both facts are true of that call; the log records the one that
-- decided it.
select test.assert_eq(
  (select reason from public.transfer_accept_attempts
   where transfer_id = (:'tid')::uuid
     and actor_id = 'bb333333-0000-4000-e000-000000000003'),
  'locked', 'a stranger knocking on a locked transfer is logged as locked');

-- The reason that matters most, because it is the one a bug would hide behind:
-- a caller the transfer is not addressed to is indistinguishable, from the
-- outside, from a legitimate buyer whose verified flag stopped syncing. Support
-- can tell them apart here and nowhere else.
set role authenticated;
select test.become('bb333333-0000-4000-e000-000000000001');
select transfer_id as open_id
from public.initiate_ownership_transfer(
  'bb000000-0000-4000-e000-0000000000a4', '+966505300005', null) \gset
reset role;

set role authenticated;
select test.become('bb333333-0000-4000-e000-000000000003');
select test.assert_eq(
  public.accept_ownership_transfer((:'open_id')::uuid, '000000'),
  null::uuid, 'a caller the transfer is not addressed to gets the usual NULL');
reset role;

select test.assert_eq(
  (select reason from public.transfer_accept_attempts
   where transfer_id = (:'open_id')::uuid
     and actor_id = 'bb333333-0000-4000-e000-000000000003'),
  'not_addressed', 'and is logged as such, rather than as a wrong code');

select test.assert_eq(
  (select failed_attempts from public.ownership_transfers where id = (:'open_id')::uuid),
  0, 'without costing the row one of its five — no value of the code would have '
     'worked, so there was nothing there to brute-force');

set role authenticated;
select test.become('bb333333-0000-4000-e000-000000000003');
select public.accept_ownership_transfer(
  'bb000000-0000-4000-e000-00000000dead'::uuid, '000000');
reset role;

select test.assert_eq(
  (select reason from public.transfer_accept_attempts
   where transfer_id = 'bb000000-0000-4000-e000-00000000dead'),
  'not_found', 'and an id that names nothing is logged as not found');

-- No silent NULLs: every attempt that reached a decision says which one.
select test.assert_eq(
  (select count(*)::int from public.transfer_accept_attempts
   where outcome = 'attempted' and reason is null),
  0, 'no attempt ends without a reason — a NULL nobody wrote down is the bug '
     'this log exists to catch');

-- And none of it is readable by either party. The ledger is closed entirely:
-- RLS on, no policy, no grant (0056), and `reason` adds no exception to that.
set role authenticated;
select test.become('bb333333-0000-4000-e000-000000000002');
select test.assert_raises(
  $$select reason from public.transfer_accept_attempts$$,
  'the recipient cannot read why they were refused',
  '42501');
reset role;

set role authenticated;
select test.become('bb333333-0000-4000-e000-000000000001');
select test.assert_raises(
  $$select reason from public.transfer_accept_attempts$$,
  'and neither can the seller',
  '42501');
reset role;

-- Support CAN read it, and has to: that is the whole point of writing the
-- reason down. What support cannot do is rewrite it — the guard from 0056 is
-- ENABLE ALWAYS, so the account that reads the ledger cannot also edit the
-- record of what it did.
set role service_role;
select test.assert_eq(
  (select count(*)::int from public.transfer_accept_attempts
   where reason = 'not_addressed'),
  1, 'support reads the reasons, which is what they are for');

select test.assert_raises(
  $$update public.transfer_accept_attempts set reason = 'wrong_code'
    where reason = 'not_addressed'$$,
  'but cannot rewrite one into a more comfortable answer',
  '42501');

select test.assert_raises(
  $$delete from public.transfer_accept_attempts$$,
  'nor erase the ledger that says what happened',
  '42501');
reset role;


-- ===========================================================================
-- 5. Cancelling a locked transfer works
-- ===========================================================================
-- It should, because a locked row is still `pending` and that is what
-- `cancel_ownership_transfer` matches on. "Should" is an assumption until
-- something asserts it, and the seller's only manual remedy rests on it.
set role authenticated;
select test.become('bb333333-0000-4000-e000-000000000001');
select transfer_id as tid2
from public.initiate_ownership_transfer(
  'bb000000-0000-4000-e000-0000000000a2', '+966505300004', null) \gset
reset role;

set role authenticated;
select pg_temp.exhaust(
  'bb333333-0000-4000-e000-000000000004'::uuid, (:'tid2')::uuid);
reset role;

select test.assert(
  (select locked_at is not null from public.ownership_transfers
    where id = (:'tid2')::uuid),
  'the second transfer is locked');

set role authenticated;
select test.become('bb333333-0000-4000-e000-000000000001');
select public.cancel_ownership_transfer((:'tid2')::uuid);
reset role;

select test.assert_eq(
  (select status::text from public.ownership_transfers where id = (:'tid2')::uuid),
  'cancelled', 'a locked transfer cancels like any other pending one');

set role authenticated;
select test.become('bb333333-0000-4000-e000-000000000001');
select test.assert_eq(
  (select count(*)::int from public.outgoing_ownership_transfer(
     'bb000000-0000-4000-e000-0000000000a2')),
  0, 'and the car is free of it');
reset role;


-- ===========================================================================
-- 6. Cancel and re-issue, as one act
-- ===========================================================================
-- The seller's screen offers one button, so the database offers one call. Two
-- calls would leave a window where the car has no transfer and a re-issue that
-- then failed would take away what the seller had.
set role authenticated;
select test.become('bb333333-0000-4000-e000-000000000001');
select transfer_id as tid3, code as otp3
from public.reissue_ownership_transfer((:'tid')::uuid) \gset
reset role;

select test.assert_eq(
  (select status::text from public.ownership_transfers where id = (:'tid')::uuid),
  'cancelled', 're-issuing withdraws the locked transfer');

select test.assert_eq(
  (select status::text from public.ownership_transfers where id = (:'tid3')::uuid),
  'pending', 'and opens a new one in the same call');

select test.assert(
  (:'otp3') <> (:'otp'), 'with a new code');

select test.assert_eq(
  (select to_phone from public.ownership_transfers where id = (:'tid3')::uuid),
  '+966505300002',
  'addressed to the same buyer, carried from the row rather than re-typed');

select test.assert_eq(
  (select failed_attempts from public.ownership_transfers where id = (:'tid3')::uuid),
  0, 'and its own count, starting at zero');

set role authenticated;
select test.become('bb333333-0000-4000-e000-000000000001');
select test.assert_eq(
  (select attempts_exhausted from public.outgoing_ownership_transfer(
     'bb000000-0000-4000-e000-0000000000a1')),
  false, 'the seller''s screen leaves the exhausted state');
reset role;

set role authenticated;
select test.become('bb333333-0000-4000-e000-000000000002');
select test.assert_eq(
  (select attempts_exhausted from public.pending_ownership_transfer_for_me()),
  false, 'and so does the buyer''s');

select test.assert_eq(
  public.accept_ownership_transfer((:'tid3')::uuid, :'otp3'),
  'bb000000-0000-4000-e000-0000000000a1'::uuid,
  'and the new code works, which is the whole point of the button');
reset role;

select test.assert_eq(
  (select reason from public.transfer_accept_attempts
   where transfer_id = (:'tid3')::uuid),
  'accepted', 'a success is logged too, so the ledger is the whole story');


-- ===========================================================================
-- 7. Who may re-issue, and what happens when the re-issue is refused
-- ===========================================================================
set role authenticated;
select test.become('bb333333-0000-4000-e000-000000000001');
select transfer_id as tid4
from public.initiate_ownership_transfer(
  'bb000000-0000-4000-e000-0000000000a3', '+966505300005', null) \gset
reset role;

-- A recipient who could re-issue could mint themselves an unlimited supply of
-- attempts by resetting the row they are locked out of.
set role authenticated;
select test.become('bb333333-0000-4000-e000-000000000005');
select test.assert_raises(
  format($$select * from public.reissue_ownership_transfer('%s')$$, :'tid4'),
  'the recipient cannot re-issue their way out of a lock',
  '42501');
reset role;

set role authenticated;
select test.become('bb333333-0000-4000-e000-000000000003');
select test.assert_raises(
  format($$select * from public.reissue_ownership_transfer('%s')$$, :'tid4'),
  'and neither can a stranger',
  '42501');
reset role;

select test.assert_eq(
  (select status::text from public.ownership_transfers where id = (:'tid4')::uuid),
  'pending', 'the transfer they tried it on is untouched');

-- Atomicity, which is the reason this is one function and not two calls. The
-- address is bent to the seller's own number through the privileged door, so
-- the `initiate` half refuses — and the `cancel` half has to come back with it.
select public.begin_privileged_write();
update public.ownership_transfers set to_phone = '+966505300001'
  where id = (:'tid4')::uuid;
select public.end_privileged_write();

set role authenticated;
select test.become('bb333333-0000-4000-e000-000000000001');
select test.assert_raises(
  format($$select * from public.reissue_ownership_transfer('%s')$$, :'tid4'),
  'a re-issue whose new transfer is refused fails as a whole',
  '23514');
reset role;

select test.assert_eq(
  (select status::text from public.ownership_transfers where id = (:'tid4')::uuid),
  'pending',
  'and the seller keeps the transfer they had, rather than losing it to a '
  'cancel whose re-issue never landed');

select test.assert_eq(
  (select count(*)::int from public.ownership_transfers
   where vehicle_id = 'bb000000-0000-4000-e000-0000000000a3'),
  1, 'with nothing half-created behind it');

-- A transfer that is no longer pending has nothing to re-issue.
set role authenticated;
select test.become('bb333333-0000-4000-e000-000000000001');
select test.assert_raises(
  format($$select * from public.reissue_ownership_transfer('%s')$$, :'tid'),
  'and a transfer already withdrawn cannot be re-issued',
  'P0002');
reset role;


-- ===========================================================================
-- 8. The seller still gets an explanation on day eight
-- ===========================================================================
-- Since 0056 a lapsed row is retired to `expired` — by the sweep, or by the
-- first attempt on it. A read filtered on `status = 'pending'` therefore stops
-- returning it, which would show a seller coming back a fresh warning screen
-- with no account of where their transfer went. One window's worth of
-- recently-expired rows is returned for exactly that reason.
select public.begin_privileged_write();
update public.ownership_transfers
set expires_at = now() - interval '1 hour', status = 'expired'
where id = (:'tid4')::uuid;
select public.end_privileged_write();

set role authenticated;
select test.become('bb333333-0000-4000-e000-000000000001');
select test.assert_eq(
  (select status::text from public.outgoing_ownership_transfer(
     'bb000000-0000-4000-e000-0000000000a3')),
  'expired', 'a transfer that ran out is still shown to the seller, as expired');
reset role;

select public.begin_privileged_write();
update public.ownership_transfers
set expires_at = now() - interval '60 days'
where id = (:'tid4')::uuid;
select public.end_privileged_write();

set role authenticated;
select test.become('bb333333-0000-4000-e000-000000000001');
select test.assert_eq(
  (select count(*)::int from public.outgoing_ownership_transfer(
     'bb000000-0000-4000-e000-0000000000a3')),
  0, 'but one that ran out two months ago is not news, and the car is free');
reset role;

rollback;

\echo '   locked transfer is visible OK'
