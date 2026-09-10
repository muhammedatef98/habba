-- 0054 — Creating a transfer becomes a server operation
--
-- `ownership_transfers` landed in 0011 with an OTP hash column and an expiry,
-- and 0013 gave it an INSERT policy. Nothing ever gave it a *function*, so the
-- only way to start a handover was a client INSERT under
-- `ownership_transfers_insert`. That means the client chose:
--
--   * `otp_code_hash` — so the client chose the code, or chose to hash the
--     empty string, or reused one hash across every transfer it created;
--   * `expires_at` — so the client chose whether the transfer expired at all.
--
-- Both are business rules, and §2.2 puts business rules in the database. A
-- second factor whose value is picked by the party it is meant to check is not
-- a second factor. This migration moves creation, cancellation and expiry
-- server-side and closes the direct write path behind them.
--
-- Three things follow from that, and each is a defect on its own:
--
-- 1. `otp_code_hash` comes off the client-readable surface. The discovery
--    policy (0037, widened in 0045) deliberately shows a pending transfer to
--    the identity it is addressed to — that is how a recipient learns a car is
--    waiting for them. Until now that row carried the hash, and a six-digit
--    code behind sha256 is an offline search of one million candidates: any
--    recipient could derive the code they were supposed to be told. The OTP was
--    therefore not a factor at all for the one party it is checked against.
--    Same technique as 0037's fix for `providers`: revoke the table grant, then
--    re-grant SELECT on an explicit column list.
--
-- 2. An in-flight warranty claim blocks the handover. A claim is a free
--    re-service order already routed to a provider (0025); ADR-0021 makes the
--    right to claim follow the car, so letting ownership move mid-claim would
--    either strand a dispatched technician or hand a stranger's appointment to
--    the buyer. The seller has a remedy either way: finish it, or cancel it.
--
-- 3. Expiry is evaluated, not assumed. `expires_at` was written by the client
--    and read by nothing: a row sat `pending` forever, and because
--    `ownership_transfers_one_pending_idx` is partial on `status = 'pending'`,
--    that stale row also blocked the seller from ever issuing another transfer
--    for that car. Expiry now runs on every initiation and is callable on its
--    own for a scheduled sweep.
--
-- The code itself stays spoken rather than sent. It needs no SMS sender ID, and
-- a code read aloud at the kerb while the keys change hands is bound to the
-- handover in a way a message to a phone number is not.

-- ---------------------------------------------------------------------------
-- The window, as data rather than as a literal in three places
-- ---------------------------------------------------------------------------
create or replace function public.ownership_transfer_window()
returns interval language sql immutable as $$ select interval '7 days' $$;

comment on function public.ownership_transfer_window() is
  'Seven days to accept a handover. A function so the tests assert against the '
  'same source the code reads — see otp_send_limit() in 0042 for the pattern.';


-- ---------------------------------------------------------------------------
-- Nothing writes this table except the functions below
-- ---------------------------------------------------------------------------
-- The INSERT policy from 0013 is dropped rather than narrowed. There is no
-- version of "the client may insert here" that is safe while the row carries
-- the hash of its own second factor.
drop policy if exists ownership_transfers_insert on public.ownership_transfers;

create or replace function public.guard_ownership_transfers()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.is_privileged_write() then
    return coalesce(new, old);
  end if;

  raise exception 'ownership_transfers is written only by its RPCs (0054)'
    using errcode = 'insufficient_privilege',
          hint = 'Use initiate_ownership_transfer, accept_ownership_transfer or cancel_ownership_transfer.';
end;
$$;

create trigger ownership_transfers_guard
  before insert or update or delete on public.ownership_transfers
  for each row execute function public.guard_ownership_transfers();

-- ENABLE ALWAYS, for the reason 0042 gives: a leaked service key must not be
-- able to write a transfer row directly, because writing one is equivalent to
-- taking someone's car.
alter table public.ownership_transfers enable always trigger ownership_transfers_guard;


-- ---------------------------------------------------------------------------
-- The hash stops being readable
-- ---------------------------------------------------------------------------
revoke select on public.ownership_transfers from authenticated, anon;

grant select (
  id, vehicle_id, from_owner_id, to_phone, to_email, to_owner_id,
  status, expires_at, accepted_at, created_at, updated_at, created_by
) on public.ownership_transfers to authenticated;

-- `otp_code_hash` is deliberately absent above, and there is no masked
-- alternative: nothing a client renders needs to know anything about the code
-- except whether the one the user typed was accepted, which is what
-- `accept_ownership_transfer` answers.
comment on column public.ownership_transfers.otp_code_hash is
  'Hashed OTP. Not readable by any client (0054) — a 6-digit code behind sha256 '
  'is an offline search, so exposing the hash is exposing the code.';


-- ---------------------------------------------------------------------------
-- Expiry
-- ---------------------------------------------------------------------------
-- Scoped to one vehicle when initiating (the caller owns it), unscoped for a
-- sweep. Returns the number of rows it retired so a scheduled run has
-- something to log.
create or replace function public.expire_ownership_transfers(
  p_vehicle_id uuid default null
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
    and (p_vehicle_id is null or vehicle_id = p_vehicle_id);

  get diagnostics v_expired = row_count;
  perform public.end_privileged_write();

  return v_expired;
end;
$$;

comment on function public.expire_ownership_transfers(uuid) is
  'Retires pending transfers past their expiry. Called on every initiation; '
  'callable unscoped for a sweep once the project has cron.';

-- Not client-facing unscoped: a client calling it with no argument would sweep
-- every seller's transfers. Initiation calls it internally as definer.
revoke all on function public.expire_ownership_transfers(uuid) from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- initiate_ownership_transfer
-- ---------------------------------------------------------------------------
-- Returns the plaintext code EXACTLY once. It is never stored, never logged,
-- and cannot be read back: a seller who loses it cancels and re-issues.
create or replace function public.initiate_ownership_transfer(
  p_vehicle_id uuid,
  p_to_phone   text default null,
  p_to_email   text default null
)
returns table (transfer_id uuid, code text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor   uuid := auth.uid();
  v_phone   text := nullif(btrim(coalesce(p_to_phone, '')), '');
  v_email   text := lower(nullif(btrim(coalesce(p_to_email, '')), ''));
  v_code    text;
  v_expires timestamptz;
  v_id      uuid;
begin
  if v_actor is null then
    raise exception 'Not authenticated' using errcode = 'insufficient_privilege';
  end if;

  if not exists (
    select 1 from public.vehicles v where v.id = p_vehicle_id and v.owner_id = v_actor
  ) then
    -- Same message whether the vehicle is someone else's or does not exist.
    -- Distinguishing them turns this function into a probe for which vehicle
    -- ids are real.
    raise exception 'Vehicle % is not yours to transfer', p_vehicle_id
      using errcode = 'insufficient_privilege';
  end if;

  -- `ownership_transfers_addressed` (0045) would catch this, but a constraint
  -- violation is not a sentence anyone can act on.
  if (v_phone is null) = (v_email is null) then
    raise exception 'Address the transfer to exactly one of a phone number or an email'
      using errcode = 'check_violation';
  end if;

  -- Transferring a car to yourself is always a mistake — a typo of your own
  -- number, or a misunderstanding of what this screen does — and it would burn
  -- the vehicle's one pending slot on a no-op.
  if exists (
    select 1 from public.profiles p
    where p.id = v_actor
      and ((v_phone is not null and p.phone = v_phone)
        or (v_email is not null and lower(p.email) = v_email))
  ) then
    raise exception 'That is your own contact — a transfer goes to the new owner'
      using errcode = 'check_violation';
  end if;

  -- ADR-0021. The claim is an appointment on this car with a provider already
  -- assigned; ownership cannot move out from under it.
  if exists (
    select 1 from public.orders c
    where c.vehicle_id = p_vehicle_id
      and c.parent_order_id is not null
      and c.status not in ('completed', 'cancelled')
  ) then
    raise exception 'A warranty claim is open on this vehicle'
      using errcode = 'check_violation',
            hint = 'Finish or cancel the re-service before transferring the car.';
  end if;

  -- Before the pending check, not after: a transfer nobody accepted must not
  -- lock the car out of ever being transferred again.
  perform public.expire_ownership_transfers(p_vehicle_id);

  if exists (
    select 1 from public.ownership_transfers ot
    where ot.vehicle_id = p_vehicle_id and ot.status = 'pending'
  ) then
    raise exception 'A transfer is already pending for this vehicle'
      using errcode = 'unique_violation',
            hint = 'Cancel it before starting another.';
  end if;

  -- Six digits from 32 bits of a v4 UUID. Not pgcrypto's gen_random_bytes for
  -- the reason 0014 gives — this is frozen infrastructure and must not depend
  -- on an optional extension. The modulo bias over 2^32 is one part in ~4300
  -- of a single code's probability and is not what an attacker attacks; the
  -- one pending transfer per vehicle is.
  --
  -- `abs` is not decoration: `bit(32)::bigint` goes through int4, so the top
  -- half of the range comes back NEGATIVE, and `-123456 % 1000000` would have
  -- produced a seven-character "code" starting with a minus sign for roughly
  -- half of all transfers.
  v_code := lpad((
    abs(('x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))::bit(32)::bigint)
    % 1000000
  )::text, 6, '0');

  v_expires := now() + public.ownership_transfer_window();

  perform public.begin_privileged_write();

  insert into public.ownership_transfers (
    vehicle_id, from_owner_id, to_phone, to_email,
    otp_code_hash, expires_at, created_by
  ) values (
    p_vehicle_id, v_actor, v_phone, v_email,
    -- Same construction `accept_ownership_transfer` checks against (0045):
    -- the built-in sha256(bytea), not pgcrypto's digest().
    encode(sha256(convert_to(v_code, 'UTF8')), 'hex'),
    v_expires, v_actor
  )
  returning id into v_id;

  perform public.end_privileged_write();

  return query select v_id, v_code, v_expires;
end;
$$;

comment on function public.initiate_ownership_transfer(uuid, text, text) is
  'Starts a handover. Mints the code server-side and returns it once — §2.2. '
  'The seller reads it to the buyer; nothing sends it.';

grant execute on function public.initiate_ownership_transfer(uuid, text, text) to authenticated;


-- ---------------------------------------------------------------------------
-- cancel_ownership_transfer
-- ---------------------------------------------------------------------------
create or replace function public.cancel_ownership_transfer(p_transfer_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_owner uuid;
begin
  if v_actor is null then
    raise exception 'Not authenticated' using errcode = 'insufficient_privilege';
  end if;

  select ot.from_owner_id into v_owner
  from public.ownership_transfers ot
  where ot.id = p_transfer_id and ot.status = 'pending'
  for update;

  if v_owner is null then
    raise exception 'Transfer not found, or no longer pending'
      using errcode = 'no_data_found';
  end if;

  -- The recipient deliberately cannot cancel. They can decline by doing
  -- nothing, and a stranger who was addressed by a mistyped number must not be
  -- able to reach into the seller's account and close things there.
  if v_owner <> v_actor then
    raise exception 'Only the sender may cancel a transfer'
      using errcode = 'insufficient_privilege';
  end if;

  perform public.begin_privileged_write();

  update public.ownership_transfers
  set status = 'cancelled'
  where id = p_transfer_id;

  perform public.end_privileged_write();
end;
$$;

comment on function public.cancel_ownership_transfer(uuid) is
  'Withdraws a pending handover. Sender only — the recipient declines by not accepting.';

grant execute on function public.cancel_ownership_transfer(uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- pending_ownership_transfer_for_me
-- ---------------------------------------------------------------------------
-- The recipient's whole first screen, in one call.
--
-- It exists because of what the recipient cannot read. The discovery policy
-- shows them the transfer row, but `vehicles` and `vehicle_timeline` are the
-- seller's until the moment they accept — so a buyer deciding whether Habba is
-- worth an account could otherwise be shown a transfer of "a vehicle" with no
-- car and no history attached to it. §1.3 calls this the acquisition moment;
-- an empty screen is not one.
--
-- What it returns is the shape `generate_habba_report` already settled: the
-- car, and the weight of its record. No owner identity, no plate photograph,
-- no token, and — as everywhere — no otp_code_hash.
create or replace function public.pending_ownership_transfer_for_me()
returns table (
  transfer_id      uuid,
  expires_at       timestamptz,
  make_ar          text,
  make_en          text,
  model_ar         text,
  model_en         text,
  model_year       int,
  plate            text,
  records_total    int,
  habba_verified   int,
  first_record_at  timestamptz,
  open_warranties  int
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
    -- theirs on acceptance. It is the strongest single line on the screen and
    -- it would be dishonest to reveal it only afterwards.
    (select count(*)::int from public.orders o
      where o.vehicle_id = v.id
        and o.status = 'completed'
        and o.parent_order_id is null
        and o.warranty_expires_at is not null
        and o.warranty_expires_at > now())
  from public.ownership_transfers ot
  join public.vehicles v on v.id = ot.vehicle_id
  join public.vehicle_makes mk on mk.id = v.make_id
  join public.vehicle_models md on md.id = v.model_id
  join public.profiles p on p.id = auth.uid()
  where ot.status = 'pending'
    and ot.expires_at > now()
    -- Exactly the rule 0045 wrote into the read policy, restated here because
    -- this function is SECURITY DEFINER and therefore reaches the row without
    -- that policy. The two must not drift: a verified identity the caller
    -- actually holds, and nothing weaker.
    and (
      (ot.to_phone is not null and p.phone_verified and p.phone = ot.to_phone)
      or
      (ot.to_email is not null and p.email_verified and lower(p.email) = lower(ot.to_email))
    )
  order by ot.created_at desc;
$$;

comment on function public.pending_ownership_transfer_for_me() is
  'What is waiting for me: the car, the weight of its logbook, and live cover. '
  'Never the seller, never the code.';

grant execute on function public.pending_ownership_transfer_for_me() to authenticated;


-- ---------------------------------------------------------------------------
-- accept_ownership_transfer — the in-flight claim re-check
-- ---------------------------------------------------------------------------
-- Initiation refuses while a claim is open, but a claim can be opened in the
-- days between initiation and acceptance. Re-checked here so the window is the
-- transaction rather than the week.
--
-- Everything else is 0045's function unchanged: verified addressed identity
-- first, then the code, both failing with the same message.
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

  select * into v_transfer
  from public.ownership_transfers
  where id = p_transfer_id
    and status = 'pending'
    and expires_at > now()
  for update;

  if v_transfer is null then
    raise exception 'Transfer not found, already used, or expired'
      using errcode = 'no_data_found';
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
    -- Deliberately the same message as a wrong code. Distinguishing "this
    -- transfer is not for you" from "wrong code" tells a stranger holding a
    -- forwarded link that the transfer exists and who it is for.
    raise exception 'Incorrect code' using errcode = 'invalid_password';
  end if;

  -- Same hash construction as the timeline chain (0009): the built-in
  -- sha256(bytea), not pgcrypto's digest() — frozen infrastructure that must
  -- not depend on an optional extension, and the one that already tripped
  -- resolution problems under `search_path = ''` once (0001).
  if v_transfer.otp_code_hash is distinct from
     encode(sha256(convert_to(p_otp_code, 'UTF8')), 'hex') then
    raise exception 'Incorrect code' using errcode = 'invalid_password';
  end if;

  -- ADR-0021, restated at the last possible moment. Deliberately checked AFTER
  -- the code, so a wrong code and an open claim are not distinguishable to
  -- someone who has neither.
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

grant execute on function public.accept_ownership_transfer(uuid, text) to authenticated;

-- 0035 marked this table incomplete because nothing could accept a transfer.
-- 0037 built acceptance; this builds the other three quarters.
comment on table public.ownership_transfers is
  'Vehicle handover to a new owner. The logbook travels with the car — CLAUDE.md §1. '
  'Written only through its RPCs (0054).';
