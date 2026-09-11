-- 34 — Expiry that runs, and an OTP that survives being guessed at (0056)
--
-- Suite 32 walks the happy handover. This one walks the two ways 0054 could
-- still lose a car:
--
--   1. A transfer nobody accepted stayed `pending` forever. The partial unique
--      index `ownership_transfers_one_pending_idx` is on `status = 'pending'`,
--      so the stale row went on occupying the vehicle's one slot, and the only
--      thing keeping it from being ACCEPTED on day nine was a `where` clause in
--      a read. A filter is not a guard.
--
--   2. Six digits is a million candidates. Taking `otp_code_hash` off the
--      client surface (0054) closed the offline search; it did nothing about a
--      caller who simply asks the accept endpoint a million times.
--
-- The load-bearing assertion in the second half is the sixth one: after five
-- wrong codes, the CORRECT code stops working. A lock that the right answer
-- opens is a delay, not a lock.

\echo '── transfer expiry and attempt limits'

begin;

select public.test_seed_auth_user('aa222222-0000-4000-d000-000000000001', '+966505200001');
select public.test_seed_auth_user('aa222222-0000-4000-d000-000000000002', '+966505200002');
select public.test_seed_auth_user('aa222222-0000-4000-d000-000000000003', '+966505200003');
select public.test_seed_auth_user('aa222222-0000-4000-d000-000000000004', '+966505200004');
select public.test_seed_auth_user('aa222222-0000-4000-d000-000000000005', '+966505200005');

insert into public.profiles (id, full_name, phone) values
  ('aa222222-0000-4000-d000-000000000001', 'البائع', '+966505200001'),
  ('aa222222-0000-4000-d000-000000000002', 'المشتري الأول', '+966505200002'),
  ('aa222222-0000-4000-d000-000000000003', 'المشتري الثاني', '+966505200003'),
  ('aa222222-0000-4000-d000-000000000004', 'المشتري الثالث', '+966505200004'),
  ('aa222222-0000-4000-d000-000000000005', 'المخمّن', '+966505200005');

insert into public.vehicle_makes (id, name_ar, name_en) values
  ('aa000000-0000-4000-d000-000000000001', 'ماركة الحدود', 'TestMakeLimits');
insert into public.vehicle_models (id, make_id, name_ar, name_en, year_from) values
  ('aa000000-0000-4000-d000-000000000002', 'aa000000-0000-4000-d000-000000000001',
   'موديل الحدود', 'TestModelLimits', 2015);

insert into public.vehicles (id, owner_id, make_id, model_id, year, plate_en) values
  ('aa000000-0000-4000-d000-0000000000a1', 'aa222222-0000-4000-d000-000000000001',
   'aa000000-0000-4000-d000-000000000001', 'aa000000-0000-4000-d000-000000000002',
   2021, 'ABJ 1001'),
  ('aa000000-0000-4000-d000-0000000000a2', 'aa222222-0000-4000-d000-000000000001',
   'aa000000-0000-4000-d000-000000000001', 'aa000000-0000-4000-d000-000000000002',
   2021, 'ABJ 1002'),
  ('aa000000-0000-4000-d000-0000000000a3', 'aa222222-0000-4000-d000-000000000001',
   'aa000000-0000-4000-d000-000000000001', 'aa000000-0000-4000-d000-000000000002',
   2021, 'ABJ 1003'),
  ('aa000000-0000-4000-d000-0000000000a4', 'aa222222-0000-4000-d000-000000000001',
   'aa000000-0000-4000-d000-000000000001', 'aa000000-0000-4000-d000-000000000002',
   2021, 'ABJ 1004');

-- Ageing a transfer goes through the privileged-write door: the guard from
-- 0054 is ENABLE ALWAYS and applies to this suite exactly as it applies to a
-- leaked service key.
create or replace function pg_temp.lapse(p_transfer_id uuid)
returns void language plpgsql as $$
begin
  perform public.begin_privileged_write();
  update public.ownership_transfers
  set expires_at = now() - interval '1 hour'
  where id = p_transfer_id;
  perform public.end_privileged_write();
end $$;


-- ===========================================================================
-- 1. A lapse does not lock the car out of ever being transferred again
-- ===========================================================================
-- The row this section ages is touched by NOTHING before the re-initiation, so
-- what frees the car here is `initiate_ownership_transfer`'s own inline expiry
-- and not some earlier read having tidied up on its way past.

set role authenticated;
select test.become('aa222222-0000-4000-d000-000000000001');
select transfer_id as lapse_a
from public.initiate_ownership_transfer(
  'aa000000-0000-4000-d000-0000000000a1', '+966505200002', null) \gset
reset role;

select pg_temp.lapse((:'lapse_a')::uuid);

set role authenticated;
select test.become('aa222222-0000-4000-d000-000000000001');
select transfer_id as lapse_b, code as lapse_b_code
from public.initiate_ownership_transfer(
  'aa000000-0000-4000-d000-0000000000a1', '+966505200002', null) \gset
reset role;

select test.assert_eq(
  (select status::text from public.ownership_transfers where id = (:'lapse_a')::uuid),
  'expired',
  'initiating retires the lapsed row rather than colliding with it');

select test.assert_eq(
  (select status::text from public.ownership_transfers where id = (:'lapse_b')::uuid),
  'pending',
  'and the new transfer opens — a lapse is not a life sentence for the car');

select test.assert_eq(
  (select count(*)::int from public.ownership_transfers
   where vehicle_id = 'aa000000-0000-4000-d000-0000000000a1' and status = 'pending'),
  1, 'with exactly one pending row, which is all the partial index allows');


-- ===========================================================================
-- 2. A lapsed transfer is refused exactly the way a wrong code is
-- ===========================================================================
-- Not "with a similar message" — with the same value. Since 0056 every refusal
-- a caller must not be able to tell apart leaves by one return path, so there
-- is no message to keep in sync and no SQLSTATE to leak.

set role authenticated;
select test.become('aa222222-0000-4000-d000-000000000001');
select transfer_id as gone_id, code as gone_code
from public.initiate_ownership_transfer(
  'aa000000-0000-4000-d000-0000000000a2', '+966505200003', null) \gset
reset role;

select pg_temp.lapse((:'gone_id')::uuid);

set role authenticated;
select test.become('aa222222-0000-4000-d000-000000000003');

-- The correct code, on a transfer that ran out. This is the case the read-time
-- filter was covering, and the one a client could have reached by calling the
-- RPC directly instead of through the screen that hid the row.
select test.assert_eq(
  public.accept_ownership_transfer((:'gone_id')::uuid, :'gone_code'),
  null::uuid,
  'a lapsed transfer is not acceptable, even holding the right code');

-- A transfer id that names nothing at all.
select test.assert_eq(
  public.accept_ownership_transfer(
    'aa000000-0000-4000-d000-00000000dead'::uuid, '000000'),
  null::uuid,
  'and a transfer id that names nothing gets the same answer — no probing for '
  'which cars have a handover open');

reset role;

-- And the lapsed row was RETIRED by the attempt, not merely hidden from it.
select test.assert_eq(
  (select status::text from public.ownership_transfers where id = (:'gone_id')::uuid),
  'expired',
  'the attempt to use a lapsed transfer is what closes it in the table');


-- ===========================================================================
-- 3. Five wrong codes lock the row, and the sixth right one does not open it
-- ===========================================================================
set role authenticated;
select test.become('aa222222-0000-4000-d000-000000000001');
select transfer_id as lock_id, code as lock_code
from public.initiate_ownership_transfer(
  'aa000000-0000-4000-d000-0000000000a3', '+966505200004', null) \gset
reset role;

-- The limit read from the function the code reads, so tuning it in one place
-- cannot leave this test asserting the old number.
select test.assert_eq(public.transfer_attempt_limit(), 5,
  'the row limit is five wrong codes');

set role authenticated;
select test.become('aa222222-0000-4000-d000-000000000004');

select test.assert_eq(
  (select count(*)::int from (
     select public.accept_ownership_transfer((:'lock_id')::uuid, '000000')
     from generate_series(1, 5)
   ) attempts(result)
   where result is not null),
  0, 'five wrong codes are refused, one after another');

reset role;

select test.assert_eq(
  (select failed_attempts from public.ownership_transfers where id = (:'lock_id')::uuid),
  5, 'and each of them was counted');

select test.assert(
  (select locked_at is not null from public.ownership_transfers
    where id = (:'lock_id')::uuid),
  'the fifth locks the row');

-- The assertion this whole section exists for.
set role authenticated;
select test.become('aa222222-0000-4000-d000-000000000004');
select test.assert_eq(
  public.accept_ownership_transfer((:'lock_id')::uuid, :'lock_code'),
  null::uuid,
  'and the CORRECT code no longer works — locked is terminal, not a cooldown');
reset role;

select test.assert_eq(
  (select owner_id from public.vehicles
   where id = 'aa000000-0000-4000-d000-0000000000a3'),
  'aa222222-0000-4000-d000-000000000001'::uuid,
  'the car stays with the seller');

select test.assert_eq(
  (select failed_attempts from public.ownership_transfers where id = (:'lock_id')::uuid),
  5, 'attempts against a locked row are not even counted — there is nothing '
     'left to count towards');

-- Locked is not a `status`, deliberately: `status` is on the recipient''s read
-- surface (0037/0045), and a lock they can read is a countdown they can watch.
select test.assert_eq(
  (select status::text from public.ownership_transfers where id = (:'lock_id')::uuid),
  'pending', 'the row is still pending, so it still occupies the vehicle''s slot');

set role authenticated;
select test.become('aa222222-0000-4000-d000-000000000001');
select test.assert_raises(
  $$select public.initiate_ownership_transfer(
      'aa000000-0000-4000-d000-0000000000a3', '+966505200004', null)$$,
  'so the seller cannot simply issue a second one around it',
  '23505');
reset role;

-- The remedy, which needs no new screen and no new verb: cancel, re-issue.
set role authenticated;
select test.become('aa222222-0000-4000-d000-000000000001');
select public.cancel_ownership_transfer((:'lock_id')::uuid);
select transfer_id as fresh_id, code as fresh_code
from public.initiate_ownership_transfer(
  'aa000000-0000-4000-d000-0000000000a3', '+966505200004', null) \gset
reset role;

set role authenticated;
select test.become('aa222222-0000-4000-d000-000000000004');
select test.assert_eq(
  public.accept_ownership_transfer((:'fresh_id')::uuid, :'fresh_code'),
  'aa000000-0000-4000-d000-0000000000a3'::uuid,
  'a re-issued transfer starts its own count, and the buyer gets their car');
reset role;


-- ===========================================================================
-- 4. Neither counter is readable by the recipient
-- ===========================================================================
-- 0037's technique, the one 0054 used for `otp_code_hash`: the columns are off
-- the grant, so asking for them fails the whole request rather than returning
-- a null column. The recipient here is the one who was locked out, so this is
-- the party with both the motive to read it and the row in front of them.

set role authenticated;
select test.become('aa222222-0000-4000-d000-000000000004');

select test.assert_raises(
  format($$select failed_attempts from public.ownership_transfers where id = '%s'$$,
         :'lock_id'),
  'the recipient cannot read the attempt counter',
  '42501');

select test.assert_raises(
  format($$select locked_at from public.ownership_transfers where id = '%s'$$,
         :'lock_id'),
  'nor the lock state',
  '42501');

select test.assert_raises(
  $$select count(*) from public.transfer_accept_attempts$$,
  'nor the per-caller ledger, which would answer "who has been offered a car"',
  '42501');

reset role;

-- Nor the seller, who has no more business holding a guesser's score than the
-- guesser does. The columns are off the client surface entirely.
set role authenticated;
select test.become('aa222222-0000-4000-d000-000000000001');
select test.assert_raises(
  format($$select failed_attempts from public.ownership_transfers where id = '%s'$$,
         :'lock_id'),
  'and neither can the sender',
  '42501');
reset role;

-- The mechanism is closed too, not just the data.
set role authenticated;
select test.become('aa222222-0000-4000-d000-000000000004');
select test.assert_raises(
  format($$select public.register_failed_transfer_attempt('%s')$$, :'lock_id'),
  'the counter cannot be written by a client either',
  '42501');
select test.assert_raises(
  $$select public.claim_transfer_accept(auth.uid(), null)$$,
  'nor the rate-limit ledger claimed directly',
  '42501');
select test.assert_raises(
  $$select public.purge_transfer_accept_attempts()$$,
  'nor purged, which would be how a caller resets their own limit',
  '42501');
reset role;


-- ===========================================================================
-- 5. The per-caller limit, independent of any row
-- ===========================================================================
-- Every attempt below names a transfer id that does not exist, so no row
-- counter moves. If the two limits were the same mechanism, ten of these would
-- cost nothing and the eleventh would be free — which is precisely how a
-- patient caller defeats a per-row cap: four guesses on each of a thousand
-- cars.

select test.assert_eq(public.transfer_accept_limit(), 10,
  'the per-caller limit is ten attempts an hour');

set role authenticated;
select test.become('aa222222-0000-4000-d000-000000000005');

select test.assert_eq(
  (select count(*)::int from (
     select public.accept_ownership_transfer(gen_random_uuid(), '000000')
     from generate_series(1, 10)
   ) attempts(result)
   where result is not null),
  0, 'ten attempts against ids that name nothing are refused');

reset role;

-- A real transfer, addressed to that same caller, with the code they were
-- given. Under any per-row rule this succeeds; it is refused because the
-- CALLER has spent their hour.
set role authenticated;
select test.become('aa222222-0000-4000-d000-000000000001');
select transfer_id as thr_id, code as thr_code
from public.initiate_ownership_transfer(
  'aa000000-0000-4000-d000-0000000000a4', '+966505200005', null) \gset
reset role;

set role authenticated;
select test.become('aa222222-0000-4000-d000-000000000005');
select test.assert_eq(
  public.accept_ownership_transfer((:'thr_id')::uuid, :'thr_code'),
  null::uuid,
  'the eleventh attempt is refused even holding the right code for a real transfer');
reset role;

select test.assert_eq(
  (select owner_id from public.vehicles
   where id = 'aa000000-0000-4000-d000-0000000000a4'),
  'aa222222-0000-4000-d000-000000000001'::uuid,
  'and the car did not move');

select test.assert_eq(
  (select failed_attempts from public.ownership_transfers where id = (:'thr_id')::uuid),
  0, 'the throttled call never reached the row, so it charged the row nothing');

select test.assert_eq(
  (select count(*)::int from public.transfer_accept_attempts
   where actor_id = 'aa222222-0000-4000-d000-000000000005'
     and outcome = 'rate_limited'),
  1, 'the refusal is recorded — a caller being throttled is a signal, and it is '
     'invisible if only the attempts that got through are written');

-- The throttle is per caller and not global. A different buyer, mid-sweep, is
-- unaffected: `lapse_b` from section 1 is still theirs to accept.
set role authenticated;
select test.become('aa222222-0000-4000-d000-000000000002');
select test.assert_eq(
  public.accept_ownership_transfer((:'lapse_b')::uuid, :'lapse_b_code'),
  'aa000000-0000-4000-d000-0000000000a1'::uuid,
  'one caller''s throttle is not everyone''s');
reset role;


-- ===========================================================================
-- 6. The sweep: on a clock where there is one, and honest where there is not
-- ===========================================================================
-- 0056 attempts pg_cron and announces the outcome rather than assuming it.
-- This asserts the two agree — a project WITH the extension must have the job,
-- and a project without must be the configuration the migration described:
-- inline expiry only, which sections 1 and 2 have already proved is sufficient
-- to stop a lapsed row being used or blocking a re-issue.
select test.assert(
  (to_regclass('cron.job') is null)
    = (not public.ownership_transfer_sweep_scheduled()),
  'the sweep is scheduled exactly when pg_cron is present to schedule it');

-- What the job runs, run by hand: an aged row anywhere in the table, retired
-- without anybody touching that vehicle.
set role authenticated;
select test.become('aa222222-0000-4000-d000-000000000001');
select transfer_id as sweep_id
from public.initiate_ownership_transfer(
  'aa000000-0000-4000-d000-0000000000a2', '+966505200003', null) \gset
reset role;

select pg_temp.lapse((:'sweep_id')::uuid);
select test.assert(
  public.expire_ownership_transfers() >= 1,
  'the unscoped sweep retires aged rows across every seller');

select test.assert_eq(
  (select status::text from public.ownership_transfers where id = (:'sweep_id')::uuid),
  'expired', 'which is what the cron job is for');

-- Still not client-facing, whatever it is now called with: unscoped it would
-- retire every seller's transfers.
set role authenticated;
select test.assert_raises(
  $$select public.expire_ownership_transfers()$$,
  'the sweep is not callable by a client',
  '42501');
select test.assert_raises(
  $$select public.ownership_transfer_sweep_scheduled()$$,
  'and neither is the question of whether it is scheduled',
  '42501');
reset role;

rollback;

\echo '   transfer expiry and attempt limits OK'
