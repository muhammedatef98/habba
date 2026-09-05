-- 21 — OTP send rate limiting (migration 0042)
--
-- The promise is "five per phone per hour, enforced server-side". A test that
-- only counted to five would pass for an implementation that resets on process
-- restart, throttles globally instead of per number, or can be cleared by
-- anyone holding a key. So this asserts the shape of the limit as well as its
-- size.

\echo '── otp rate limit'

begin;

-- 1. The limit is what the product promises ----------------------------------
select test.assert_eq(public.otp_send_limit(), 5, 'the limit is five sends');
select test.assert_eq(
  public.otp_send_window(), interval '1 hour', 'the window is one hour');


-- 2. Five succeed, the sixth does not ----------------------------------------
select test.assert(public.claim_otp_send('+966510000001'), 'send 1 is allowed');
select test.assert(public.claim_otp_send('+966510000001'), 'send 2 is allowed');
select test.assert(public.claim_otp_send('+966510000001'), 'send 3 is allowed');
select test.assert(public.claim_otp_send('+966510000001'), 'send 4 is allowed');
select test.assert(public.claim_otp_send('+966510000001'), 'send 5 is allowed');

select test.assert_eq(
  public.otp_sends_remaining('+966510000001'), 0, 'nothing is left in the window');

select test.assert(
  not public.claim_otp_send('+966510000001'), 'send 6 is refused');

-- The refusal is recorded, not silently dropped: a hammered number is a signal.
select test.assert_eq(
  (select count(*)::int from public.otp_send_attempts
   where phone = '+966510000001' and outcome = 'rate_limited'),
  1, 'the refusal is written to the ledger');


-- 3. The limit is PER PHONE, not global --------------------------------------
-- A global counter would pass test 2 and take the whole product down the first
-- time one number was probed.
select test.assert(
  public.claim_otp_send('+966510000002'),
  'a different number is unaffected by the first one being exhausted');

select test.assert_eq(
  public.otp_sends_remaining('+966510000002'), 4, 'and has its own budget');


-- 4. The window rolls --------------------------------------------------------
-- Age the ledger rather than waiting an hour. The rows are backdated through
-- the privileged path, since the table refuses ordinary updates.
select public.begin_privileged_write();
update public.otp_send_attempts
set requested_at = now() - interval '61 minutes'
where phone = '+966510000001';
select public.end_privileged_write();

select test.assert_eq(
  public.otp_sends_remaining('+966510000001'), 5, 'the budget returns after an hour');
select test.assert(
  public.claim_otp_send('+966510000001'), 'and sending works again');


-- 5. A failed transport does not consume an attempt --------------------------
-- The user never received an SMS; charging them an attempt for our provider's
-- outage would lock them out of their own account.
select public.claim_otp_send('+966510000003');
select public.claim_otp_send('+966510000003');
select test.assert_eq(public.otp_sends_remaining('+966510000003'), 3, 'two used');

select public.release_otp_send('+966510000003');
select test.assert_eq(
  public.otp_sends_remaining('+966510000003'), 4, 'a failed send is refunded');

select test.assert_eq(
  (select count(*)::int from public.otp_send_attempts
   where phone = '+966510000003' and outcome = 'transport_failed'),
  1, 'and remains visible to ops as a failure');


-- 6. Malformed input is refused, not counted ---------------------------------
select test.assert_raises(
  $$select public.claim_otp_send('0512345678')$$,
  'a non-E.164 number is refused outright',
  '23514');


-- 7. No client can read the ledger or call the functions ---------------------
-- The table maps phone numbers to timestamps: readable, it answers "does this
-- number use Habba, and when did they last sign in?".
set role authenticated;
select test.become('11111111-0000-4000-b000-000000000001');

select test.assert_raises(
  $$select count(*) from public.otp_send_attempts$$,
  'an authenticated client cannot read the ledger',
  '42501');

select test.assert_raises(
  $$select public.claim_otp_send('+966510000009')$$,
  'nor claim a send directly',
  '42501');

select test.assert_raises(
  $$select public.otp_sends_remaining('+966510000001')$$,
  'nor ask how many sends a number has left',
  '42501');

reset role;


-- 8. The ledger is append-only, even for a leaked service key ----------------
set role service_role;

select test.assert_raises(
  $$delete from public.otp_send_attempts where phone = '+966510000001'$$,
  'service_role cannot delete the ledger to unlock a number',
  '42501');

select test.assert_raises(
  $$update public.otp_send_attempts set outcome = 'transport_failed'
    where phone = '+966510000001'$$,
  'nor rewrite outcomes to refund itself',
  '42501');

reset role;


-- 9. And it holds no codes ---------------------------------------------------
-- Asserted structurally: a column added later to "help with debugging" fails
-- here rather than in a breach report.
select test.assert_eq(
  (select coalesce(string_agg(column_name, ', ' order by column_name), '(none)')
   from information_schema.columns
   where table_schema = 'public' and table_name = 'otp_send_attempts'),
  'id, outcome, phone, requested_at',
  'the ledger holds exactly four columns, and none of them is a code');

rollback;

\echo '   otp rate limit OK'
