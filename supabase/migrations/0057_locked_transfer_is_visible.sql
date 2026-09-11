-- 0057 — A locked handover stops being invisible, and every refusal is written down
--
-- 0056 gave the transfer row a lock after five wrong codes and hid it from
-- everyone, on the reasoning that a countdown the guessing party can watch
-- helps them. That reasoning holds for the COUNTER. It does not hold for the
-- lock itself, and hiding the lock produced a dead end that 0056's own ADR
-- entry recorded as a follow-up:
--
--   * the seller's screen still says «بانتظار قبول المشتري» over a code that
--     stopped working, with no way to learn otherwise;
--   * the recipient gets the same undifferentiated refusal they got for a
--     typo, and reads it as a typo;
--   * and because a locked row stays `pending`, the partial unique index keeps
--     counting it, so the car cannot be re-transferred until someone cancels
--     by hand or the seven days run out.
--
-- Nobody is told, so nobody acts, so the car sits. This migration closes it on
-- both sides and writes down why every refusal happened.
--
-- ---------------------------------------------------------------------------
-- What is safe to reveal, and to whom
-- ---------------------------------------------------------------------------
-- The indistinguishable-refusal rule (0056) exists so that `accept` cannot be
-- used to probe which vehicles have a handover open. That is a property of the
-- ACCEPT RESPONSE, and it is left exactly as it was: seven reasons, one NULL.
--
-- The lock is surfaced through the READ paths instead, each of which already
-- decides who may see the row at all:
--
--   * the seller, through `outgoing_ownership_transfer()` — owner of the
--     vehicle, and the only person who can do anything about it;
--   * the recipient, through `pending_ownership_transfer_for_me()` — a
--     verified identity the transfer is addressed to (0045), who can already
--     read the row and therefore learns nothing new from being told it is shut.
--
-- A caller who cannot read the row learns nothing either way. The counter
-- itself — `failed_attempts` — stays off every surface: "it is shut, ask for a
-- new code" is actionable, "you have two guesses left" is a hint.
--
-- ---------------------------------------------------------------------------
-- Why the refusals are logged
-- ---------------------------------------------------------------------------
-- One NULL for seven reasons is right for the caller and wrong for the people
-- who have to support it. If `accept` ever returns NULL because of a bug — a
-- profile row missing, a verification flag that did not sync, an identity
-- comparison that stopped matching — every screen in the product calls it a
-- wrong code and the bug is invisible forever.
--
-- So the reason is written server-side, on the ledger row 0056 already creates
-- for every attempt, and it is off the client grant like the rest of that
-- table. Support can tell `wrong_code` from `not_addressed` without either
-- party ever being able to.

-- ---------------------------------------------------------------------------
-- 1. The ledger learns why
-- ---------------------------------------------------------------------------
-- On `transfer_accept_attempts` rather than in a table of its own: one accept
-- call is one row there already, it is already closed to clients, and it
-- already has the retention (`purge_transfer_accept_attempts`, scheduled by
-- 0056) that an account id plus a timestamp needs under ADR-0010.
alter table public.transfer_accept_attempts add column reason text;

alter table public.transfer_accept_attempts
  add constraint transfer_accept_attempts_reason check (
    reason is null or reason in (
      'accepted',          -- the car changed hands
      'rate_limited',      -- this caller has spent their hour
      'not_found',         -- no transfer has that id
      'expired',           -- the seven days ran out
      'cancelled',         -- the seller withdrew it
      'already_accepted',  -- a replay
      'locked',            -- five wrong codes already
      'not_addressed',     -- a verified identity that is not the one addressed
      'wrong_code'         -- the only one the caller's message actually names
    ));

comment on column public.transfer_accept_attempts.reason is
  'Why the attempt ended. Every one of the refusals is a NULL to the caller (0056); '
  'this is the only place the difference is written down. Off the client grant, so '
  'neither the seller nor the recipient can read it.';

-- Null only for a row whose call did not reach a decision — a transaction that
-- rolled back after the claim, which in practice means the one refusal that
-- still raises: an open warranty claim (ADR-0021).


-- ---------------------------------------------------------------------------
-- 2. Claiming an attempt now hands back the row it wrote
-- ---------------------------------------------------------------------------
-- Dropped and recreated rather than replaced: the return type changes, and
-- `create or replace function` cannot change one. The argument list is
-- unchanged, so `revoke` and the test asserting it is not client-callable both
-- still name the same function.
drop function if exists public.claim_transfer_accept(uuid, uuid);

create or replace function public.claim_transfer_accept(
  p_actor       uuid,
  p_transfer_id uuid
)
returns table (allowed boolean, attempt_id bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recent  int;
  v_allowed boolean;
  v_id      bigint;
begin
  -- Serialise per caller, not globally: two different people accepting two
  -- different cars must not queue behind each other. Transaction-scoped.
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
  -- throttled extends their own throttle indefinitely.
  insert into public.transfer_accept_attempts (actor_id, transfer_id, outcome, reason)
  values (p_actor, p_transfer_id,
          case when v_allowed then 'attempted' else 'rate_limited' end,
          case when v_allowed then null else 'rate_limited' end)
  returning id into v_id;
  perform public.end_privileged_write();

  return query select v_allowed, v_id;
end;
$$;

revoke all on function public.claim_transfer_accept(uuid, uuid)
  from public, anon, authenticated;


create or replace function public.record_transfer_accept_outcome(
  p_attempt_id bigint,
  p_reason     text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.begin_privileged_write();

  update public.transfer_accept_attempts
  set reason = p_reason
  where id = p_attempt_id;

  perform public.end_privileged_write();
end;
$$;

comment on function public.record_transfer_accept_outcome(bigint, text) is
  'Writes down which of the seven identical refusals this one was. Called only by '
  'accept_ownership_transfer — and it commits, for the reason 0056 gives: an '
  'exception is a rollback, so anything worth keeping cannot be raised past.';

revoke all on function public.record_transfer_accept_outcome(bigint, text)
  from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 3. accept_ownership_transfer — same answer, better record
-- ---------------------------------------------------------------------------
-- The caller-visible behaviour is IDENTICAL to 0056: every refusal returns
-- NULL, an open warranty claim raises, an unauthenticated caller raises. What
-- changes is that the row is now read once without the filters and then
-- classified, so the ledger can say which refusal it was.
--
-- Reading unfiltered also removes a trap: with `status = 'pending' and
-- expires_at > now() and locked_at is null` in the WHERE, every one of those
-- reasons arrived as the same `not found`, and a future reader would have had
-- to re-derive which was which before they could log anything.
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
  v_allowed   boolean;
  v_attempt   bigint;
begin
  if v_actor is null then
    raise exception 'Not authenticated' using errcode = 'insufficient_privilege';
  end if;

  -- Before anything is read, so a caller who is over their limit learns
  -- nothing at all — not even how long the answer took.
  select allowed, attempt_id into v_allowed, v_attempt
  from public.claim_transfer_accept(v_actor, p_transfer_id);

  if not v_allowed then
    return null;  -- the reason was written by the claim itself
  end if;

  -- Expiry is evaluated rather than filtered (0056): a lapsed row is retired by
  -- the attempt to use it. `expire_ownership_transfers` opens and closes its own
  -- privileged window, so it runs before this function opens one — begin/end
  -- privileged_write do not nest (0033).
  perform public.expire_ownership_transfers(null, p_transfer_id);

  select * into v_transfer
  from public.ownership_transfers
  where id = p_transfer_id
  for update;

  if not found then
    perform public.record_transfer_accept_outcome(v_attempt, 'not_found');
    return null;
  end if;

  if v_transfer.status <> 'pending' then
    perform public.record_transfer_accept_outcome(v_attempt, case v_transfer.status
      when 'expired'   then 'expired'
      when 'cancelled' then 'cancelled'
      when 'accepted'  then 'already_accepted'
      else 'not_found'
    end);
    return null;
  end if;

  -- Belt and braces against the expiry call above having done nothing — two
  -- mechanisms for the rule that stops a car being taken, as 0056 has it.
  if v_transfer.expires_at <= now() then
    perform public.record_transfer_accept_outcome(v_attempt, 'expired');
    return null;
  end if;

  if v_transfer.locked_at is not null then
    perform public.record_transfer_accept_outcome(v_attempt, 'locked');
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
    -- irrelevant — no value of it would work — so there is nothing to
    -- brute-force, and counting it would hand a stranger who has come by a
    -- transfer id a way to lock a handover that is not theirs.
    --
    -- It IS logged, and this is the reason the log exists: a verification flag
    -- that stops syncing turns every legitimate buyer into this branch, and
    -- without a record of it the product would show them «الرمز غير صحيح»
    -- forever and nobody would ever know.
    perform public.record_transfer_accept_outcome(v_attempt, 'not_addressed');
    return null;
  end if;

  -- Same hash construction as the timeline chain (0009): the built-in
  -- sha256(bytea), not pgcrypto's digest().
  if v_transfer.otp_code_hash is distinct from
     encode(sha256(convert_to(p_otp_code, 'UTF8')), 'hex') then
    perform public.register_failed_transfer_attempt(p_transfer_id);
    perform public.record_transfer_accept_outcome(v_attempt, 'wrong_code');
    return null;
  end if;

  -- ADR-0021, and the one refusal that still raises. Reachable only by someone
  -- who has just presented the correct code, so it reveals nothing to a
  -- guesser, and it is actionable by the person who reads it. Raising rolls the
  -- ledger row back with everything else, which is why it is the one reason
  -- that never appears in the log.
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

  perform public.record_transfer_accept_outcome(v_attempt, 'accepted');

  perform public.append_vehicle_timeline_event(
    v_transfer.vehicle_id, 'ownership_transferred',
    'انتقلت ملكية السيارة إلى مالك جديد', 'Ownership transferred to a new owner');

  return v_transfer.vehicle_id;
end;
$$;

comment on function public.accept_ownership_transfer(uuid, text) is
  'Accepts a handover and returns the vehicle id. Returns NULL for every refusal a '
  'caller must not be able to tell apart (0056); which one it was is written to '
  'transfer_accept_attempts.reason, where no client can read it (0057).';

grant execute on function public.accept_ownership_transfer(uuid, text) to authenticated;


-- ---------------------------------------------------------------------------
-- 4. The seller's read
-- ---------------------------------------------------------------------------
-- Replaces a direct `select ... from ownership_transfers` in the repository.
-- It has to be a function: `locked_at` is off the client grant and stays off
-- it, so what the seller gets is the DERIVED fact — attempts exhausted, yes or
-- no — and never the count behind it.
--
-- It also answers the question the plain select could no longer answer. Since
-- 0056 a lapsed row is retired to `expired` by the sweep or by the first
-- attempt on it, and a query filtered on `status = 'pending'` therefore stops
-- returning it — which would have shown a seller coming back on day eight a
-- fresh warning screen with no account of where their transfer went, the exact
-- thing the expired state was written to prevent. One window's worth of
-- recently-expired rows is returned for that reason, and no more: a transfer
-- that ran out two months ago is not news.
create or replace function public.outgoing_ownership_transfer(p_vehicle_id uuid)
returns table (
  id                 uuid,
  vehicle_id         uuid,
  to_phone           text,
  to_email           text,
  status             public.ownership_transfer_status,
  expires_at         timestamptz,
  created_at         timestamptz,
  attempts_exhausted boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    ot.id, ot.vehicle_id, ot.to_phone, ot.to_email,
    ot.status, ot.expires_at, ot.created_at,
    ot.locked_at is not null
  from public.ownership_transfers ot
  join public.vehicles v on v.id = ot.vehicle_id
  where ot.vehicle_id = p_vehicle_id
    -- The whole authorisation, and it is ownership of the car rather than
    -- authorship of the transfer: the two are the same until acceptance, and
    -- after acceptance the seller has no business reading this at all.
    and v.owner_id = auth.uid()
    and (
      ot.status = 'pending'
      or (ot.status = 'expired'
          and ot.expires_at > now() - public.ownership_transfer_window())
    )
  order by ot.created_at desc
  limit 1;
$$;

comment on function public.outgoing_ownership_transfer(uuid) is
  'The seller''s view of the handover they started: who it is addressed to, how long '
  'is left, and whether the buyer has exhausted their attempts. Never the code, never '
  'the hash, never the count of wrong guesses.';

grant execute on function public.outgoing_ownership_transfer(uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- 5. The recipient's read
-- ---------------------------------------------------------------------------
-- Dropped and recreated: the return type gains a column and `create or replace`
-- cannot change one.
--
-- Everything else is 0054's function unchanged, including the gate — a
-- VERIFIED identity the transfer is actually addressed to. That gate is what
-- makes showing the lock here safe: anyone who reaches this row could already
-- see it, so «انتهت المحاولات» tells them nothing about which cars have a
-- handover open. It tells them the one thing they can act on, which is to stop
-- typing and ask the seller for a new code.
drop function if exists public.pending_ownership_transfer_for_me();

create or replace function public.pending_ownership_transfer_for_me()
returns table (
  transfer_id        uuid,
  expires_at         timestamptz,
  make_ar            text,
  make_en            text,
  model_ar           text,
  model_en           text,
  model_year         int,
  plate              text,
  records_total      int,
  habba_verified     int,
  first_record_at    timestamptz,
  open_warranties    int,
  attempts_exhausted boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    ot.id,
    ot.expires_at,
    mk.name_ar, mk.name_en,
    md.name_ar, md.name_en,
    v.year,
    v.plate_normalised,
    (select count(*)::int from public.vehicle_timeline t where t.vehicle_id = v.id),
    (select count(*)::int from public.vehicle_timeline t
      where t.vehicle_id = v.id and t.provenance = 'habba_verified'),
    (select min(t.occurred_at) from public.vehicle_timeline t where t.vehicle_id = v.id),
    -- Shown to the buyer BEFORE they accept, because ADR-0021 makes these
    -- theirs on acceptance.
    (select count(*)::int from public.orders o
      where o.vehicle_id = v.id
        and o.status = 'completed'
        and o.parent_order_id is null
        and o.warranty_expires_at is not null
        and o.warranty_expires_at > now()),
    ot.locked_at is not null
  from public.ownership_transfers ot
  join public.vehicles v on v.id = ot.vehicle_id
  join public.vehicle_makes mk on mk.id = v.make_id
  join public.vehicle_models md on md.id = v.model_id
  join public.profiles p on p.id = auth.uid()
  where ot.status = 'pending'
    and ot.expires_at > now()
    -- Exactly the rule 0045 wrote into the read policy, restated here because
    -- this function is SECURITY DEFINER and therefore reaches the row without
    -- that policy. The two must not drift.
    and (
      (ot.to_phone is not null and p.phone_verified and p.phone = ot.to_phone)
      or
      (ot.to_email is not null and p.email_verified and lower(p.email) = lower(ot.to_email))
    )
  order by ot.created_at desc;
$$;

comment on function public.pending_ownership_transfer_for_me() is
  'What is waiting for me: the car, the weight of its logbook, live cover, and whether '
  'the attempts on it are spent. Never the seller, never the code, never the count.';

grant execute on function public.pending_ownership_transfer_for_me() to authenticated;


-- ---------------------------------------------------------------------------
-- 6. Cancel and re-issue, as one act
-- ---------------------------------------------------------------------------
-- The seller's remedy for a locked transfer is to withdraw it and start
-- another to the same person. Making them do that as two taps is making them
-- perform an implementation detail: between the two there is a window where
-- the car has no transfer and the screen has no state, and a cancel whose
-- re-issue then fails — an open warranty claim, a dropped connection — leaves
-- them worse off than before they tapped.
--
-- One transaction, so it either produces a new code or changes nothing. The
-- address is carried over from the row rather than re-typed: re-typing it is
-- how a buyer who is already waiting gets addressed to a typo.
create or replace function public.reissue_ownership_transfer(p_transfer_id uuid)
returns table (transfer_id uuid, code text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_row   public.ownership_transfers;
begin
  if v_actor is null then
    raise exception 'Not authenticated' using errcode = 'insufficient_privilege';
  end if;

  select * into v_row
  from public.ownership_transfers
  where id = p_transfer_id and status = 'pending'
  for update;

  if not found then
    raise exception 'Transfer not found, or no longer pending'
      using errcode = 'no_data_found';
  end if;

  -- Same rule as cancel: the sender, and only the sender. A recipient who
  -- could re-issue could mint themselves an unlimited supply of attempts by
  -- resetting the row they are locked out of.
  if v_row.from_owner_id <> v_actor then
    raise exception 'Only the sender may re-issue a transfer'
      using errcode = 'insufficient_privilege';
  end if;

  -- Both of these are the existing functions, unchanged and unduplicated.
  -- `initiate` re-runs every rule that applied the first time — the warranty
  -- claim check above all — so a re-issue cannot slip past a refusal that a
  -- fresh transfer would have hit.
  perform public.cancel_ownership_transfer(p_transfer_id);

  return query
    select * from public.initiate_ownership_transfer(
      v_row.vehicle_id, v_row.to_phone, v_row.to_email);
end;
$$;

comment on function public.reissue_ownership_transfer(uuid) is
  'Withdraws a handover and issues a fresh code to the same address, atomically. The '
  'seller''s one-tap remedy when the buyer has exhausted their attempts (0057).';

grant execute on function public.reissue_ownership_transfer(uuid) to authenticated;
