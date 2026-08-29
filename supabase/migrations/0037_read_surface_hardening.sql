-- 0037 — Read-surface hardening
--
-- ⚠️ SECURITY FIX, first pass on reads rather than writes. Every guard so far
-- (0033–0036) closed a column on UPDATE. RLS has the identical blind spot on
-- SELECT, and triggers cannot help there — there is no BEFORE SELECT.
--
-- Three findings:
--
-- 1. `providers_read` (0022) is a correct ROW-level policy — a customer must
--    see approved providers to book them — but RLS is row-granular, not
--    column-granular. The same row carries `national_id_encrypted` and
--    `iban_encrypted`. Probed: any authenticated customer could
--
--        select national_id_encrypted, iban_encrypted from providers
--        where verification_status = 'approved';
--
--    and read every approved provider's KYC blobs. Column ciphertext is not a
--    defence against this — it is still a mass PII/financial-data disclosure,
--    and it defeats the point of encrypting the columns at all if the whole
--    table is one query away from anyone with the anon key.
--
--    ⚠️ Postgres will silently no-op a column-level REVOKE against a role that
--    still holds a TABLE-level grant — the table-level privilege is a
--    superset and wins. Supabase grants `anon`/`authenticated` blanket
--    SELECT on every public table by default, so the fix must REVOKE the
--    table-level grant and re-GRANT SELECT on an explicit column list.
--    Confirmed live: a bare column REVOKE left the columns readable; this
--    form does not.
--
-- 2. `ownership_transfers_read` (0013) grants SELECT when
--    `to_phone = (select phone from profiles where id = auth.uid())`. That
--    match exists so a brand-new recipient — who has no transfer-specific
--    reference yet — can discover a transfer waiting for them by phone. But
--    `profiles.phone` is self-service (0036 guard only revokes
--    `phone_verified` on change; it does not restrict the value), so:
--
--        update profiles set phone = '<victim's phone>' where id = auth.uid();
--
--    immediately grants SELECT on the victim's pending transfer row —
--    including `otp_code_hash`. A leaked OTP hash is worse than it sounds:
--    the online-guessing assumption behind a 6-digit code only holds against
--    a rate-limited endpoint. A leaked hash can be tested offline, where
--    nothing rate-limits it.
--
--    The fix keeps the discovery UX but requires the phone to be VERIFIED,
--    not merely claimed — `phone_verified` is exactly the flag that
--    distinguishes the two, and the old policy never checked it. It also
--    ships `accept_ownership_transfer`, the acceptance path flagged as
--    missing in 0035: verification now happens by calling a function with the
--    OTP, not by first being able to read the row that contains its hash.
--
-- 3. `commission_rates_read` (0031) is `using (true)` — Habba's take-rate is
--    readable by any authenticated client, including a competitor or a
--    provider probing for the exact threshold to price against. Nothing
--    client-facing needs the raw table; `commission_rate_for()` already does
--    the one computation payouts need, as a SECURITY DEFINER function.

-- ---------------------------------------------------------------------------
-- 1. providers — KYC columns off the client-readable surface
-- ---------------------------------------------------------------------------
revoke select on public.providers from authenticated, anon;

grant select (
  id, owner_profile_id, provider_type, business_name_ar, business_name_en,
  cr_number, vat_number, verification_status, nafath_verified_at,
  rating_avg, rating_count, jobs_completed, acceptance_rate,
  is_online, city_id, created_at, updated_at
) on public.providers to authenticated, anon;

-- national_id_encrypted and iban_encrypted are deliberately absent above.
-- service_role (payout jobs, a future ops console) keeps full table access
-- via its own unrevoked grant. If the app ever needs to show a provider a
-- masked view of their own IBAN, that is a new generated column or a
-- SECURITY DEFINER function scoped to `owner_profile_id = auth.uid()` — never
-- the raw column.


-- ---------------------------------------------------------------------------
-- 2. ownership_transfers — verified phone, not claimed phone; real acceptance
-- ---------------------------------------------------------------------------
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
          and p.phone_verified
          and p.phone = public.ownership_transfers.to_phone
      )
    )
    or public.is_ops()
  );

-- The recipient's claim to `to_owner_id` is settled by this function, not by
-- a client UPDATE — there is still no UPDATE policy on this table (0035), and
-- there should not be one; the transfer is accepted, never freely edited.
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

comment on table public.ownership_transfers is
  'Vehicle handover. Acceptance goes through accept_ownership_transfer(); there is deliberately no UPDATE policy — see 0035, 0037.';


-- ---------------------------------------------------------------------------
-- 3. commission_rates — ops only
-- ---------------------------------------------------------------------------
drop policy if exists commission_rates_read on public.commission_rates;

create policy commission_rates_read on public.commission_rates
  for select to authenticated using (public.is_ops());
