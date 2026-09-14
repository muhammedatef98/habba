-- 0056 — Expiry that runs on a clock, and an OTP that cannot be guessed online
--
-- 0054 moved the handover server-side and took `otp_code_hash` off the
-- client-readable surface. That closed the OFFLINE search — a recipient
-- holding the hash could recover six digits in under a second — and left two
-- things open.
--
-- ---------------------------------------------------------------------------
-- Defect 1 — expiry had no clock
-- ---------------------------------------------------------------------------
-- `expire_ownership_transfers()` was written for a sweep that nothing ran.
-- Initiation calls it (0054), and that is the whole of it: a transfer nobody
-- accepted stays `status = 'pending'` in the table until the seller happens to
-- come back and issue another one. Three consequences, in increasing order of
-- how much they cost:
--
--   * `ownership_transfers_one_pending_idx` is partial on `status = 'pending'`,
--     so a lapsed row keeps occupying the vehicle's one pending slot;
--   * `pending_ownership_transfer_for_me` and the repositories mask it at
--     display time — the row is filtered on `expires_at > now()` when read —
--     which makes the database and the screens disagree about the same row;
--   * the masking is the only thing standing between a lapsed transfer and
--     acceptance, and masking is not a guard.
--
-- This migration gives expiry two mechanisms and stops pretending either one
-- is enough on its own:
--
--   1. **Inline.** Initiation already expires the vehicle's rows before the
--      uniqueness check (0054). Acceptance now does the same for the row it is
--      about to read, so a lapsed row is RETIRED by the attempt to use it
--      rather than merely hidden from it.
--   2. **Scheduled.** A pg_cron job, IF the extension can be had. It is
--      attempted at the bottom of this file and the result is announced,
--      because the failure mode of a scheduled sweep is that everyone assumes
--      it runs. `ownership_transfer_sweep_scheduled()` answers the question
--      afterwards, and supabase/tests/34 asserts the two agree.
--
-- ---------------------------------------------------------------------------
-- Defect 2 — the code was still guessable online
-- ---------------------------------------------------------------------------
-- Six digits is a million candidates. Unlimited attempts against
-- `accept_ownership_transfer` turns a million candidates into a few hours of
-- HTTP, and the prize is a car. Two counters, because they answer different
-- questions:
--
--   * **Per row.** Five wrong codes lock the transfer. Locked is terminal: not
--     even the correct code opens it again. The seller cancels and re-issues,
--     which mints a new code and starts a new row.
--   * **Per caller.** Independent of any row, so a caller cannot spread
--     attempts thinly across many transfers to stay under the per-row cap.
--     Same shape as 0042's OTP ledger and for the same reason: a limit that
--     lives in a stateless Edge Function's memory is a limit that resets.
--
-- Both counters are unreadable by the recipient — 0037's technique, the one
-- 0054 used for `otp_code_hash`: revoke the table grant, re-grant SELECT on an
-- explicit column list, and leave the new columns off it.
--
-- ---------------------------------------------------------------------------
-- Why a refusal stopped being an exception
-- ---------------------------------------------------------------------------
-- This is the one design decision in this file that changes an existing API,
-- and it is forced rather than chosen.
--
-- `raise exception` aborts the transaction. PostgREST runs one RPC in one
-- transaction. So a version of `accept_ownership_transfer` that increments a
-- failure counter AND THEN raises increments nothing: the counter is rolled
-- back by the very refusal it was counting. There is no autonomous transaction
-- in Postgres, and the alternatives — dblink, pg_background — are optional
-- extensions this project refuses to depend on for frozen infrastructure
-- (0014, and 0054's note on gen_random_bytes).
--
-- A counter that rolls back is not a counter, so the refusal has to commit:
--
--   * every indistinguishable refusal — no such transfer, not pending, lapsed,
--     locked, not addressed to you, wrong code, caller over their limit —
--     **returns NULL**;
--   * the caller's repository turns NULL into the same
--     `Error('Incorrect code')` it used to get from the server, so nothing
--     above the data layer can tell which of the seven it was either;
--   * an open warranty claim (ADR-0021) still RAISES, because it is reachable
--     only by someone who has already presented the correct code, and because
--     it is the one refusal a person can act on.
--
-- Not authenticated still raises: there is no counter to preserve, and nothing
-- about a car is revealed by it.

-- ---------------------------------------------------------------------------
-- The limits, as data rather than as literals in three places
-- ---------------------------------------------------------------------------
-- Same pattern as otp_send_limit() (0042) and ownership_transfer_window()
-- (0054): the tests assert against the same source the code reads, so tuning
-- one of these cannot silently invalidate a test that hard-coded it.

create or replace function public.transfer_attempt_limit()
returns int language sql immutable as $$ select 5 $$;

comment on function public.transfer_attempt_limit() is
  'Five wrong codes lock a transfer row. Terminal — the seller cancels and re-issues.';

create or replace function public.transfer_accept_window()
returns interval language sql immutable as $$ select interval '1 hour' $$;

create or replace function public.transfer_accept_limit()
returns int language sql immutable as $$ select 10 $$;

comment on function public.transfer_accept_limit() is
  'Ten acceptance attempts per caller per hour, across ALL transfers. Deliberately '
  'above transfer_attempt_limit(), so a caller working one transfer hits the row '
  'lock first and this catches only the caller sweeping many.';


-- ---------------------------------------------------------------------------
-- 1. Expiry, addressable by transfer as well as by vehicle
-- ---------------------------------------------------------------------------
-- Dropped and recreated rather than overloaded. A second one-argument overload
-- would have made the existing `expire_ownership_transfers(null)` ambiguous —
-- including the call in supabase/tests/32 that proves it is not client-facing.
drop function if exists public.expire_ownership_transfers(uuid);

create or replace function public.expire_ownership_transfers(
  p_vehicle_id  uuid default null,
  p_transfer_id uuid default null
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expired int;
begin
  perform public.begin_privileged_write();

  update public.ownership_transfers
  set status = 'expired'
  where status = 'pending'
    and expires_at <= now()
    and (p_vehicle_id is null or vehicle_id = p_vehicle_id)
    and (p_transfer_id is null or id = p_transfer_id);

  get diagnostics v_expired = row_count;
  perform public.end_privileged_write();

  return v_expired;
end;
$$;

comment on function public.expire_ownership_transfers(uuid, uuid) is
  'Retires pending transfers past their expiry. Scoped by vehicle on initiation, '
  'by transfer on acceptance, unscoped for the pg_cron sweep. Called from all three '
  'so that no single one of them is load-bearing.';

-- Unscoped it would sweep every seller's transfers, so it stays off the client
-- surface entirely. The three callers are all SECURITY DEFINER functions owned
-- by the migration role, plus the cron job, which runs as that role too.
revoke all on function public.expire_ownership_transfers(uuid, uuid)
  from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 2. The per-row counter
-- ---------------------------------------------------------------------------
-- `locked_at` rather than a `locked` value on `status`, for one reason: the
-- recipient CAN read `status` — that is discovery (0037, widened in 0045) and
-- it is how they learn a car is waiting for them. A lock expressed there would
-- be a lock they could read, and reading it tells the party doing the guessing
-- exactly how much guessing is left.
alter table public.ownership_transfers
  add column failed_attempts int not null default 0,
  add column locked_at       timestamptz;

alter table public.ownership_transfers
  add constraint ownership_transfers_failed_attempts_sane
  check (failed_attempts >= 0);

comment on column public.ownership_transfers.failed_attempts is
  'Wrong codes presented by the addressed recipient. Not readable by any client (0056).';

comment on column public.ownership_transfers.locked_at is
  'Set once failed_attempts reaches transfer_attempt_limit(). Terminal: the correct '
  'code no longer works. Not readable by any client (0056) — a countdown a guesser '
  'can watch is a countdown that helps them.';

-- The row stays `pending` while locked, which is deliberate and has two
-- effects, both wanted: the vehicle's one pending slot stays occupied, so the
-- seller cannot quietly leave a locked transfer lying around; and
-- `cancel_ownership_transfer` (which matches on `status = 'pending'`) is still
-- the remedy, so the seller needs no new screen and no new verb.

-- 0037's technique, restated so the new columns are provably off the surface
-- rather than off it by the accident of not being in an older grant list.
revoke select on public.ownership_transfers from authenticated, anon;

grant select (
  id, vehicle_id, from_owner_id, to_phone, to_email, to_owner_id,
  status, expires_at, accepted_at, created_at, updated_at, created_by
) on public.ownership_transfers to authenticated;

-- `otp_code_hash`, `failed_attempts` and `locked_at` are all deliberately
-- absent above. supabase/tests/17 keeps them absent.


-- Bumping the counter is its own function so that it, and not
-- `accept_ownership_transfer`, owns the arithmetic that decides a lock.
create or replace function public.register_failed_transfer_attempt(p_transfer_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.begin_privileged_write();

  update public.ownership_transfers
  set failed_attempts = failed_attempts + 1,
      locked_at = case
        when locked_at is not null then locked_at
        when failed_attempts + 1 >= public.transfer_attempt_limit() then now()
        else null
      end
  where id = p_transfer_id;

  perform public.end_privileged_write();
end;
$$;

comment on function public.register_failed_transfer_attempt(uuid) is
  'Counts one wrong code and locks the row at the limit. Called only by '
  'accept_ownership_transfer, which is why it commits: see the header on why a '
  'refusal returns NULL instead of raising.';

revoke all on function public.register_failed_transfer_attempt(uuid)
  from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 3. The per-caller ledger
-- ---------------------------------------------------------------------------
-- Independent of the per-row counter, and it has to be: the per-row counter is
-- defeated by a caller who tries four codes on each of a thousand transfers.
-- Modelled on `otp_send_attempts` (0042) down to the guard and the retention.
create table public.transfer_accept_attempts (
  id           bigint generated always as identity primary key,
  -- auth.uid(). Deliberately NOT a foreign key: a foreign key to auth.users
  -- would either block the PDPL erasure path (0039, proved in tests/22) or
  -- cascade the ledger away with the account being investigated. Retention is
  -- handled below instead.
  actor_id     uuid not null,
  -- The id the caller PRESENTED, which may name no transfer at all. Also not a
  -- foreign key, for that reason: a probe for non-existent ids is exactly the
  -- traffic worth recording.
  transfer_id  uuid,
  attempted_at timestamptz not null default clock_timestamp(),
  outcome      text not null default 'attempted',

  constraint transfer_accept_attempts_outcome
    check (outcome in ('attempted', 'rate_limited'))
);

-- The only query this table serves: "how many by this caller in the last
-- hour?" — descending time so the window scan stops early.
create index transfer_accept_attempts_actor_window_idx
  on public.transfer_accept_attempts (actor_id, attempted_at desc);

comment on table public.transfer_accept_attempts is
  'Rate-limit ledger for handover acceptance. Never holds a code, or a hash of one. '
  'A successful acceptance is recorded on ownership_transfers.accepted_at, not here.';

create or replace function public.guard_transfer_accept_attempts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.is_privileged_write() then
    return coalesce(new, old);
  end if;

  raise exception 'transfer_accept_attempts is written only by claim_transfer_accept()'
    using errcode = 'insufficient_privilege';
end;
$$;

create trigger transfer_accept_attempts_guard
  before insert or update or delete on public.transfer_accept_attempts
  for each row execute function public.guard_transfer_accept_attempts();

-- ENABLE ALWAYS, for 0042's reason: a leaked service key must not be able to
-- erase the ledger that says it has been guessing.
alter table public.transfer_accept_attempts
  enable always trigger transfer_accept_attempts_guard;

-- The ledger maps account ids to timestamps. Readable by a client it would
-- answer "who has been offered a car, and when?", so it is closed entirely:
-- RLS on with no policy, and no grant.
alter table public.transfer_accept_attempts enable row level security;
revoke all on public.transfer_accept_attempts from anon, authenticated;


-- Returns true when the attempt may proceed, and records it in the same call.
-- Check-then-insert would be a race: two concurrent requests would both read
-- nine and both proceed.
create or replace function public.claim_transfer_accept(
  p_actor       uuid,
  p_transfer_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recent  int;
  v_allowed boolean;
begin
  -- Serialise per caller, not globally: two different people accepting two
  -- different cars must not queue behind each other. Transaction-scoped, so it
  -- releases on commit.
  perform pg_advisory_xact_lock(hashtextextended(p_actor::text, 56));

  select count(*) into v_recent
  from public.transfer_accept_attempts a
  where a.actor_id = p_actor
    and a.outcome = 'attempted'
    and a.attempted_at > now() - public.transfer_accept_window();

  v_allowed := v_recent < public.transfer_accept_limit();

  perform public.begin_privileged_write();
  -- The refusal is recorded too, and deliberately does NOT count towards the
  -- limit (0042's rule): otherwise a caller who keeps hammering after being
  -- throttled extends their own throttle indefinitely, which punishes the one
  -- person who might be a confused buyer rather than an attacker.
  insert into public.transfer_accept_attempts (actor_id, transfer_id, outcome)
  values (p_actor, p_transfer_id,
          case when v_allowed then 'attempted' else 'rate_limited' end);
  perform public.end_privileged_write();

  return v_allowed;
end;
$$;

revoke all on function public.claim_transfer_accept(uuid, uuid)
  from public, anon, authenticated;


-- Retention. An account id plus a timestamp is personal data and PDPL asks for
-- a reason to hold it (ADR-0010); thirty days covers an abuse investigation and
-- nothing more. Scheduled at the bottom of this file alongside the sweep.
create or replace function public.purge_transfer_accept_attempts()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted int;
begin
  perform public.begin_privileged_write();

  delete from public.transfer_accept_attempts
  where attempted_at < now() - interval '30 days';

  get diagnostics v_deleted = row_count;
  perform public.end_privileged_write();

  return v_deleted;
end;
$$;

revoke all on function public.purge_transfer_accept_attempts()
  from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 4. accept_ownership_transfer
-- ---------------------------------------------------------------------------
-- Same order of checks as 0054, with three changes: the throttle first, expiry
-- evaluated rather than filtered, and every refusal returning NULL so that the
-- counters it wrote survive the call. See the file header for why.
create or replace function public.accept_ownership_transfer(
  p_transfer_id uuid,
  p_otp_code    text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_transfer  public.ownership_transfers;
  v_actor     uuid := auth.uid();
  v_addressed boolean;
begin
  if v_actor is null then
    raise exception 'Not authenticated' using errcode = 'insufficient_privilege';
  end if;

  -- Before anything is read, so that a caller who is over their limit learns
  -- nothing at all — not even how long the answer took.
  if not public.claim_transfer_accept(v_actor, p_transfer_id) then
    return null;
  end if;

  -- Defect 1, at the last possible moment: retire the row rather than filter
  -- it. `expire_ownership_transfers` opens and closes its own privileged
  -- window, so it must run before this function opens one of its own —
  -- begin/end_privileged_write do not nest (0033).
  perform public.expire_ownership_transfers(null, p_transfer_id);

  select * into v_transfer
  from public.ownership_transfers
  where id = p_transfer_id
    and status = 'pending'
    -- Kept alongside the expiry call above, not instead of it: two mechanisms
    -- for the same rule, because this is the one that stops a car being taken.
    and expires_at > now()
    and locked_at is null
  for update;

  -- No such transfer, someone else's, already used, lapsed, or locked. One
  -- answer for all of them.
  if not found then
    return null;
  end if;

  select
    (v_transfer.to_phone is not null and p.phone_verified and p.phone = v_transfer.to_phone)
    or
    (v_transfer.to_email is not null and p.email_verified
      and lower(p.email) = lower(v_transfer.to_email))
  into v_addressed
  from public.profiles p
  where p.id = v_actor;

  if not coalesce(v_addressed, false) then
    -- Deliberately NOT counted against the row. On this path the code is
    -- irrelevant — no value of it would work — so there is nothing here to
    -- brute-force, and counting it would hand a stranger who has come by a
    -- transfer id a way to lock a handover that is not theirs. The per-caller
    -- ledger above is what answers this traffic.
    return null;
  end if;

  -- Same hash construction as the timeline chain (0009): the built-in
  -- sha256(bytea), not pgcrypto's digest().
  if v_transfer.otp_code_hash is distinct from
     encode(sha256(convert_to(p_otp_code, 'UTF8')), 'hex') then
    perform public.register_failed_transfer_attempt(p_transfer_id);
    return null;
  end if;

  -- ADR-0021, restated at the last possible moment, and the one refusal that
  -- still raises. Reachable only by someone who has just presented the correct
  -- code, so it reveals nothing to a guesser; actionable by the person who
  -- reads it, which is the whole reason to distinguish it.
  if exists (
    select 1 from public.orders c
    where c.vehicle_id = v_transfer.vehicle_id
      and c.parent_order_id is not null
      and c.status not in ('completed', 'cancelled')
  ) then
    raise exception 'A warranty claim is open on this vehicle'
      using errcode = 'check_violation',
            hint = 'The current owner must finish or cancel the re-service first.';
  end if;

  perform public.begin_privileged_write();

  update public.ownership_transfers
  set status = 'accepted', accepted_at = now(), to_owner_id = v_actor
  where id = p_transfer_id;

  update public.vehicles
  set owner_id = v_actor
  where id = v_transfer.vehicle_id;

  perform public.end_privileged_write();

  perform public.append_vehicle_timeline_event(
    v_transfer.vehicle_id, 'ownership_transferred',
    'انتقلت ملكية السيارة إلى مالك جديد', 'Ownership transferred to a new owner');

  return v_transfer.vehicle_id;
end;
$$;

comment on function public.accept_ownership_transfer(uuid, text) is
  'Accepts a handover and returns the vehicle id. Returns NULL for every refusal '
  'a caller must not be able to tell apart — see 0056 on why those are not '
  'exceptions. Raises only for an unauthenticated caller and for an open warranty '
  'claim, which is reachable only with the correct code.';

grant execute on function public.accept_ownership_transfer(uuid, text) to authenticated;


-- ---------------------------------------------------------------------------
-- 5. Is the sweep actually scheduled?
-- ---------------------------------------------------------------------------
-- Written before the scheduling attempt so the attempt can be checked, and so
-- nobody has to read a migration log to find out. Tolerates the absence of
-- pg_cron entirely — `cron.job` is not a table this project can assume exists.
create or replace function public.ownership_transfer_sweep_scheduled()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  if to_regclass('cron.job') is null then
    return false;
  end if;

  execute $q$
    select count(*)::int from cron.job
    where jobname = 'habba-expire-ownership-transfers' and active
  $q$ into v_count;

  return v_count > 0;
end;
$$;

comment on function public.ownership_transfer_sweep_scheduled() is
  'Whether the expiry sweep is on a clock. False is a legitimate answer — it means '
  'inline expiry on initiation and acceptance is the only mechanism (ADR-0021).';

revoke all on function public.ownership_transfer_sweep_scheduled()
  from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 6. pg_cron, if it can be had
-- ---------------------------------------------------------------------------
-- Three ways this ends, and all three are announced rather than assumed:
--
--   * the extension is already installed (a hosted project with pg_cron
--     enabled) → the jobs are scheduled;
--   * it is installable from here → same;
--   * it is not → NOTICE, and inline expiry stays the only mechanism. That is
--     a supported configuration, not a broken one: initiation and acceptance
--     both expire, so no lapsed row can be used and no lapsed row can block a
--     re-issue. What is lost is only that a lapsed row stays `pending` in the
--     table until somebody touches that vehicle again.
--
-- `create extension pg_cron` needs the library in shared_preload_libraries and
-- a superuser, and it only works in the database named by cron.database_name.
-- None of that is knowable from inside a migration, so it is attempted and the
-- failure is caught. The handler is wide on purpose — every way this can fail
-- is a way the project simply does not have cron — and it reports SQLERRM
-- rather than swallowing it.
do $cron$
declare
  v_available boolean;
begin
  begin
    execute 'create extension if not exists pg_cron';
  exception when others then
    raise notice '0056: pg_cron could not be installed here (%: %)', sqlstate, sqlerrm;
  end;

  select exists (select 1 from pg_extension where extname = 'pg_cron')
  into v_available;

  if not v_available then
    raise notice
      '0056: no pg_cron. Ownership-transfer expiry runs INLINE ONLY — on '
      'initiate_ownership_transfer and accept_ownership_transfer. Lapsed rows '
      'stay pending in the table until one of those touches the vehicle. See '
      'ADR-0021, "Expiry needs a clock".';
    return;
  end if;

  begin
    -- Quarter-hourly. The window is seven days, so the sweep's job is
    -- housekeeping, not enforcement — enforcement is inline, and stays inline
    -- even here.
    execute $j$
      select cron.schedule('habba-expire-ownership-transfers', '*/15 * * * *',
                           'select public.expire_ownership_transfers()')
    $j$;

    -- The ledger this migration introduces holds personal data and needs the
    -- retention its comment promises (ADR-0010). Nightly, off the hour.
    execute $j$
      select cron.schedule('habba-purge-transfer-accept-attempts', '17 3 * * *',
                           'select public.purge_transfer_accept_attempts()')
    $j$;

    raise notice '0056: pg_cron present — expiry sweep and ledger purge scheduled.';
  exception when others then
    raise notice
      '0056: pg_cron is installed but scheduling failed (%: %). Expiry runs '
      'INLINE ONLY. Check public.ownership_transfer_sweep_scheduled().',
      sqlstate, sqlerrm;
  end;
end
$cron$;
