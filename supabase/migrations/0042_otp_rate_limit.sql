-- 0042 — OTP send rate limiting, enforced in the database
--
-- Five OTP requests per phone number per hour. Enforced here rather than in
-- the Edge Function's memory or in the app, for three reasons:
--
--   1. Edge Functions are stateless and horizontally scaled. A counter in
--      process memory resets on every cold start, which an attacker reaches by
--      waiting, or sidesteps by arriving in parallel.
--   2. The app's resend cooldown (otp-provider.ts) is a courtesy to the user,
--      not a control. Anyone can call the endpoint directly.
--   3. Every SMS costs money, and an unthrottled OTP endpoint is both a bill
--      and a way to harass a phone number that is not yours.
--
-- GoTrue keeps its own SMS limits; this is the per-phone limit the product
-- promises, expressed where it cannot be skipped.
--
-- What is deliberately NOT stored: the OTP itself. Codes are generated and
-- verified by Supabase Auth, so nothing in Habba's schema ever holds one —
-- there is no table to leak and no code to log (ADR-0018).

create table public.otp_send_attempts (
  id           bigint generated always as identity primary key,
  -- E.164. Deliberately not a foreign key to profiles: the point is to
  -- throttle sends to numbers that have no account yet, which is most of them.
  phone        text not null,
  requested_at timestamptz not null default clock_timestamp(),
  -- Kept so ops can tell "we are being probed" from "our provider is down"
  -- without turning on debug logging.
  outcome      text not null default 'sent',

  constraint otp_send_attempts_phone_e164 check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  constraint otp_send_attempts_outcome
    check (outcome in ('sent', 'rate_limited', 'transport_failed'))
);

-- The only query this table serves: "how many in the last hour, for this
-- number?" — descending time so the window scan stops early.
create index otp_send_attempts_phone_window_idx
  on public.otp_send_attempts (phone, requested_at desc);

comment on table public.otp_send_attempts is
  'Rate-limit ledger for OTP sends. Never holds a code — see ADR-0018.';


-- ---------------------------------------------------------------------------
-- The limit, as data rather than as a literal in three places
-- ---------------------------------------------------------------------------
create or replace function public.otp_send_window()
returns interval language sql immutable as $$ select interval '1 hour' $$;

create or replace function public.otp_send_limit()
returns int language sql immutable as $$ select 5 $$;

comment on function public.otp_send_limit() is
  'Five sends per phone per hour. A function so ops can tune it in one place, '
  'and so the tests assert against the same source the code reads.';


-- ---------------------------------------------------------------------------
-- Append-only, and only through the claim function
-- ---------------------------------------------------------------------------
-- Defined before the functions that write, because they must declare
-- themselves privileged to get past it. ENABLE ALWAYS, so a leaked service key
-- cannot rewrite the ledger to unlock a number it has exhausted.
create or replace function public.guard_otp_attempts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.is_privileged_write() then
    return coalesce(new, old);
  end if;

  raise exception 'otp_send_attempts is written only by claim_otp_send()'
    using errcode = 'insufficient_privilege';
end;
$$;

create trigger otp_send_attempts_guard
  before insert or update or delete on public.otp_send_attempts
  for each row execute function public.guard_otp_attempts();
alter table public.otp_send_attempts enable always trigger otp_send_attempts_guard;


-- ---------------------------------------------------------------------------
-- Claiming a send
-- ---------------------------------------------------------------------------
-- Returns true when the send may proceed, and records the attempt in the same
-- statement. Check-then-insert would be a race: two concurrent requests would
-- both read four and both proceed.
create or replace function public.claim_otp_send(p_phone text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recent  int;
  v_allowed boolean;
begin
  if p_phone !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'phone must be E.164' using errcode = 'check_violation';
  end if;

  -- Serialise per phone number, not globally: two different numbers must not
  -- queue behind each other. Transaction-scoped, so it releases on commit.
  perform pg_advisory_xact_lock(hashtextextended(p_phone, 42));

  select count(*) into v_recent
  from public.otp_send_attempts a
  where a.phone = p_phone
    and a.outcome = 'sent'
    and a.requested_at > now() - public.otp_send_window();

  v_allowed := v_recent < public.otp_send_limit();

  perform public.begin_privileged_write();
  -- The refusal is recorded too: a number being hammered is a signal, and it
  -- is invisible if only successes are written.
  insert into public.otp_send_attempts (phone, outcome)
  values (p_phone, case when v_allowed then 'sent' else 'rate_limited' end);
  perform public.end_privileged_write();

  return v_allowed;
end;
$$;

-- A message the provider refused should not consume one of the user's five
-- attempts — they never got an SMS. The row stays visible to ops, but stops
-- counting.
create or replace function public.release_otp_send(p_phone text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.begin_privileged_write();

  update public.otp_send_attempts
  set outcome = 'transport_failed'
  where id = (
    select a.id from public.otp_send_attempts a
    where a.phone = p_phone and a.outcome = 'sent'
    order by a.requested_at desc
    limit 1
  );

  perform public.end_privileged_write();
end;
$$;

/** How many sends remain in the current window. For support, not for clients. */
create or replace function public.otp_sends_remaining(p_phone text)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(
    public.otp_send_limit() - (
      select count(*)::int from public.otp_send_attempts a
      where a.phone = p_phone
        and a.outcome = 'sent'
        and a.requested_at > now() - public.otp_send_window()
    ),
    0);
$$;


-- ---------------------------------------------------------------------------
-- Retention
-- ---------------------------------------------------------------------------
-- The ledger is a mechanism, not a record worth keeping: a phone number plus a
-- timestamp is personal data, and PDPL asks for a reason to hold it. Thirty
-- days covers an abuse investigation and nothing more. Scheduled once the
-- project has cron (Phase 6); until then it is run by hand.
create or replace function public.purge_otp_send_attempts()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted int;
begin
  perform public.begin_privileged_write();

  delete from public.otp_send_attempts
  where requested_at < now() - interval '30 days';

  get diagnostics v_deleted = row_count;
  perform public.end_privileged_write();

  return v_deleted;
end;
$$;


-- ---------------------------------------------------------------------------
-- Nothing here is client-facing
-- ---------------------------------------------------------------------------
-- The ledger maps phone numbers to timestamps. Readable by a client, it would
-- answer "does this number use Habba, and when did they last sign in?" — so it
-- is closed entirely: RLS on with no policy, and no grant. Only the Auth hook,
-- holding the service key, reaches these functions.
alter table public.otp_send_attempts enable row level security;
revoke all on public.otp_send_attempts from anon, authenticated;

revoke all on function public.claim_otp_send(text) from public, anon, authenticated;
revoke all on function public.release_otp_send(text) from public, anon, authenticated;
revoke all on function public.otp_sends_remaining(text) from public, anon, authenticated;
revoke all on function public.purge_otp_send_attempts() from public, anon, authenticated;
