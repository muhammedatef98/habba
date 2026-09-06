-- 0045 — A transfer can be addressed to an email, not only a phone
--
-- 0044 made `phone_verified` mean something. This makes the transfer reachable
-- by the other identity, because 0039 introduced accounts that have no phone
-- at all — and an email-only buyer who cannot be sent a car is a buyer the
-- moat's acquisition loop (§1.3) cannot convert.
--
-- The seller types whichever identity they know. `to_phone` stops being
-- mandatory; exactly one of the two must be present, because a transfer
-- addressed to nobody is not a transfer.

alter table public.ownership_transfers alter column to_phone drop not null;

alter table public.ownership_transfers add column to_email text;

-- Same shape check the profiles table uses (0039), for the same reason: an
-- address the database accepts but the app rejects fails at the worst moment.
alter table public.ownership_transfers add constraint ownership_transfers_to_email_shape check (
  to_email is null or to_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
);

alter table public.ownership_transfers add constraint ownership_transfers_addressed check (
  to_phone is not null or to_email is not null
);

comment on column public.ownership_transfers.to_email is
  'Recipient by email, for accounts with no phone (0039). Exactly one of to_phone/to_email is set — see ownership_transfers_addressed.';

-- ---------------------------------------------------------------------------
-- Discovery
-- ---------------------------------------------------------------------------
-- The rule 0037 established, extended to the second identity and no further:
-- a recipient discovers a pending transfer addressed to an identity they hold
-- AND that GoTrue has confirmed for them.
--
-- The verified requirement is the whole security property. Both `profiles.phone`
-- and `profiles.email` are self-service — a user may type anything into either
-- — so matching on the value alone would hand any attacker the row, including
-- its `otp_code_hash`. Since 0044 the flags are derived from what GoTrue
-- confirmed, so "verified" now means what 0037 assumed it meant.
drop policy if exists ownership_transfers_read on public.ownership_transfers;

create policy ownership_transfers_read on public.ownership_transfers
  for select to authenticated using (
    from_owner_id = auth.uid()
    or to_owner_id = auth.uid()
    or (
      status = 'pending'
      and exists (
        select 1 from public.profiles p
        where p.id = auth.uid()
          and (
            (public.ownership_transfers.to_phone is not null
              and p.phone_verified
              and p.phone = public.ownership_transfers.to_phone)
            or
            (public.ownership_transfers.to_email is not null
              and p.email_verified
              and lower(p.email) = lower(public.ownership_transfers.to_email))
          )
      )
    )
    or public.is_ops()
  );

-- ---------------------------------------------------------------------------
-- Acceptance
-- ---------------------------------------------------------------------------
-- `accept_ownership_transfer` (0037) checks the OTP and nothing else: knowing
-- the id and the code was the whole proof. That was defensible while discovery
-- was the only way to learn an id — but it is one leaked link away from being
-- the entire authorisation story, and the row now carries a second identity to
-- check against.
--
-- So acceptance requires what discovery requires: the caller holds the
-- identity the transfer was addressed to, verified. The OTP stays; this is a
-- second factor, not a replacement.
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
  v_transfer public.ownership_transfers;
  v_actor    uuid := auth.uid();
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
