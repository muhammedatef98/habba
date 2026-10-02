-- 0089 — KYC sealed in Vault, on the server (ADR-0017 §2)
--
-- A provider applies with a national ID (هوية) or iqama (إقامة) and an IBAN.
-- Until now the app "sealed" both itself, with a dev digest (enc:dev:…), and
-- inserted the row directly. That was a placeholder by design, so provider
-- applications stayed switched off: no real ID or IBAN could be accepted.
--
-- Now the values travel once, over TLS, to submit_provider_application(),
-- which validates them and stores each one as a Supabase Vault secret. Vault
-- encrypts it with a key that is not in the database. The providers row keeps
-- only a reference (vault:<secret id>), which the 0018 constraints and every
-- existing has_national_id / has_iban check still read correctly, plus the
-- last four characters for support ("the IBAN ending 4471").
--
--   * Clients can no longer insert providers rows at all. The only way in is
--     the function, so no value can skip validation or reach a column
--     unsealed.
--   * The KYC columns cannot be changed afterwards except by ops or by a
--     privileged write (erasure).
--   * One identity backs one provider account: a keyed digest of the ID,
--     kept in a table no client can read, is unique.
--   * An operator can read the values back through ops_reveal_provider_kyc(),
--     with a reason. That is needed to verify the person and to pay the
--     payout. Each read is audited, and the audit row names the reason, never
--     the values.
--   * Erasing an account deletes the secrets and the digest.

-- ---------------------------------------------------------------------------
-- Validation, the same rules as @habba/core (saudi/national-id.ts, iban.ts)
-- ---------------------------------------------------------------------------

create or replace function public.normalise_kyc_digits(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select upper(regexp_replace(
    translate(coalesce(p_value, ''), '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'),
    '[\s-]', '', 'g'));
$$;

-- 10 digits, leading 1 (citizen) or 2 (resident), Luhn-style check digit.
create or replace function public.is_valid_saudi_national_id(p_id text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_sum int := 0;
  v_digit int;
begin
  if p_id is null or p_id !~ '^[12][0-9]{9}$' then
    return false;
  end if;
  for i in 1..9 loop
    v_digit := substr(p_id, i, 1)::int;
    if i % 2 = 1 then
      v_digit := v_digit * 2;
      v_sum := v_sum + v_digit / 10 + v_digit % 10;
    else
      v_sum := v_sum + v_digit;
    end if;
  end loop;
  return (10 - v_sum % 10) % 10 = substr(p_id, 10, 1)::int;
end;
$$;

-- SA + 22 characters, ISO 13616 mod-97.
create or replace function public.is_valid_saudi_iban(p_iban text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_rearranged text;
  v_remainder int := 0;
  v_code int;
begin
  if p_iban is null or p_iban !~ '^SA[0-9]{2}[0-9A-Z]{20}$' then
    return false;
  end if;
  v_rearranged := substr(p_iban, 5) || substr(p_iban, 1, 4);
  for i in 1..length(v_rearranged) loop
    v_code := ascii(substr(v_rearranged, i, 1));
    if v_code between 48 and 57 then
      v_remainder := (v_remainder * 10 + (v_code - 48)) % 97;
    else
      v_remainder := (v_remainder * 100 + (v_code - 55)) % 97;
    end if;
  end loop;
  return v_remainder = 1;
end;
$$;

-- ---------------------------------------------------------------------------
-- Storage
-- ---------------------------------------------------------------------------

alter table public.providers
  add column if not exists identity_kind text
    constraint providers_identity_kind check (identity_kind in ('national', 'iqama')),
  add column if not exists national_id_tail text
    constraint providers_national_id_tail check (national_id_tail ~ '^[0-9]{4}$'),
  add column if not exists iban_tail text
    constraint providers_iban_tail check (iban_tail ~ '^[0-9A-Z]{4}$');

-- The keyed digest lives apart from providers, so no to_jsonb(providers) in
-- a console function, and no column grant, can ever carry it out.
create table if not exists public.provider_identity_digests (
  provider_id uuid primary key references public.providers(id) on delete cascade,
  digest      text not null unique,
  created_at  timestamptz not null default now()
);

alter table public.provider_identity_digests enable row level security;
revoke all on public.provider_identity_digests from public, anon, authenticated;
-- No policies: nobody reads this table except the definer functions below.

-- The digest key, created in Vault the first time it is needed. A digest
-- without a secret key could be reversed by hashing every possible ID, and
-- there are only a few billion.
create or replace function public.kyc_identity_digest(p_id text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_key text;
begin
  select s.decrypted_secret into v_key from vault.decrypted_secrets s where s.name = 'kyc_digest_key';
  if v_key is null then
    begin
      perform vault.create_secret(
        replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
        'kyc_digest_key', 'Keys the identity digest that keeps one ID to one provider (0089)');
    exception when unique_violation then
      null; -- a concurrent first application created it
    end;
    select s.decrypted_secret into v_key from vault.decrypted_secrets s where s.name = 'kyc_digest_key';
  end if;
  return encode(sha256(convert_to(v_key || ':' || p_id, 'UTF8')), 'hex');
end;
$$;

revoke execute on function public.kyc_identity_digest(text) from public, anon, authenticated;

-- Reads a sealed value back. Internal: ops_reveal_provider_kyc() is the door.
create or replace function public.kyc_unseal(p_reference text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_reference is null or p_reference !~ '^vault:[0-9a-f-]{36}$' then
    return null;
  end if;
  return (select s.decrypted_secret from vault.decrypted_secrets s
           where s.id = substr(p_reference, 7)::uuid);
end;
$$;

revoke execute on function public.kyc_unseal(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The only way in
-- ---------------------------------------------------------------------------

drop policy if exists providers_insert_own on public.providers;

create or replace function public.submit_provider_application(
  p_provider_type    public.provider_type,
  p_business_name_ar text,
  p_city_id          uuid,
  p_national_id      text,
  p_iban             text,
  p_cr_number        text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user   uuid := auth.uid();
  v_id     text := public.normalise_kyc_digits(p_national_id);
  v_iban   text := public.normalise_kyc_digits(p_iban);
  v_name   text := btrim(coalesce(p_business_name_ar, ''));
  v_cr     text := nullif(public.normalise_kyc_digits(p_cr_number), '');
  v_digest text;
  v_existing public.providers;
  v_provider uuid;
  v_id_secret uuid;
  v_iban_secret uuid;
  v_row public.providers;
begin
  if v_user is null then
    raise exception 'Sign in first' using errcode = 'insufficient_privilege';
  end if;
  if public.is_suspended(v_user) then
    raise exception 'This account is suspended' using errcode = 'insufficient_privilege',
      hint = 'account_suspended';
  end if;
  if not public.feature_on('feature_provider_applications') then
    raise exception 'Provider applications are closed'
      using errcode = 'check_violation', hint = 'feature_disabled:provider_applications';
  end if;

  -- One record per account (0041). A rejected applicant may apply again, and
  -- that replaces the rejected application rather than adding a second one.
  select * into v_existing from public.providers p where p.owner_profile_id = v_user;
  if found and v_existing.verification_status <> 'rejected' then
    raise exception 'This account has already applied' using errcode = 'unique_violation',
      hint = 'already_applied';
  end if;
  v_provider := coalesce(v_existing.id, gen_random_uuid());

  -- Each message names the field, never the value: these reach logs.
  if char_length(v_name) not between 2 and 80 then
    raise exception 'Business name must be 2 to 80 characters' using errcode = 'check_violation',
      hint = 'invalid_business_name';
  end if;
  if not public.is_valid_saudi_national_id(v_id) then
    raise exception 'Not a valid national ID or iqama number' using errcode = 'check_violation',
      hint = 'invalid_national_id';
  end if;
  if not public.is_valid_saudi_iban(v_iban) then
    raise exception 'Not a valid Saudi IBAN' using errcode = 'check_violation',
      hint = 'invalid_iban';
  end if;
  if p_provider_type = 'workshop' and (v_cr is null or v_cr !~ '^[0-9]{10}$') then
    raise exception 'A workshop needs its 10-digit commercial registration' using errcode = 'check_violation',
      hint = 'invalid_cr_number';
  end if;

  v_digest := public.kyc_identity_digest(v_id);
  if exists (select 1 from public.provider_identity_digests d
              where d.digest = v_digest and d.provider_id <> v_provider) then
    raise exception 'This identity already backs a provider account' using errcode = 'unique_violation',
      hint = 'identity_in_use';
  end if;

  -- Sealed first, in this transaction: if anything below fails, the secrets
  -- roll back with it. A re-application destroys the rejected values first.
  if v_existing.id is not null then
    perform public.erase_provider_kyc_values(v_existing);
  end if;
  v_id_secret := vault.create_secret(v_id, 'kyc:' || v_provider || ':national_id',
                                     'Provider national ID / iqama (0089)');
  v_iban_secret := vault.create_secret(v_iban, 'kyc:' || v_provider || ':iban',
                                       'Provider payout IBAN (0089)');

  if v_existing.id is null then
    insert into public.providers (
      id, owner_profile_id, provider_type, business_name_ar, city_id, cr_number,
      national_id_encrypted, iban_encrypted, identity_kind, national_id_tail, iban_tail
    ) values (
      v_provider, v_user, p_provider_type, v_name, p_city_id,
      case when p_provider_type = 'workshop' then v_cr end,
      'vault:' || v_id_secret, 'vault:' || v_iban_secret,
      case left(v_id, 1) when '1' then 'national' else 'iqama' end,
      right(v_id, 4), right(v_iban, 4)
    )
    returning * into v_row;
  else
    perform public.begin_privileged_write();
    update public.providers
       set provider_type = p_provider_type, business_name_ar = v_name, city_id = p_city_id,
           cr_number = case when p_provider_type = 'workshop' then v_cr end,
           national_id_encrypted = 'vault:' || v_id_secret, iban_encrypted = 'vault:' || v_iban_secret,
           identity_kind = case left(v_id, 1) when '1' then 'national' else 'iqama' end,
           national_id_tail = right(v_id, 4), iban_tail = right(v_iban, 4),
           verification_status = 'pending'
     where id = v_provider
    returning * into v_row;
    insert into public.provider_verification_events (provider_id, from_status, to_status, actor_id, note)
    values (v_provider, 'rejected', 'pending', v_user, 'أعاد المتقدّم إرسال طلبه');
    perform public.end_privileged_write();
  end if;

  insert into public.provider_identity_digests (provider_id, digest) values (v_provider, v_digest);

  return jsonb_build_object(
    'business_name_ar', v_row.business_name_ar,
    'verification_status', v_row.verification_status,
    'created_at', v_row.created_at
  );
end;
$$;

revoke execute on function public.submit_provider_application(public.provider_type, text, uuid, text, text, text)
  from public, anon;
grant execute on function public.submit_provider_application(public.provider_type, text, uuid, text, text, text)
  to authenticated;

-- The sealed columns do not change after the application, except by ops or
-- by a privileged write (erasure).
create or replace function public.guard_provider_kyc_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.is_ops() or public.is_privileged_write() then
    return new;
  end if;
  if new.national_id_encrypted is distinct from old.national_id_encrypted
     or new.iban_encrypted is distinct from old.iban_encrypted
     or new.identity_kind is distinct from old.identity_kind
     or new.national_id_tail is distinct from old.national_id_tail
     or new.iban_tail is distinct from old.iban_tail then
    raise exception 'Identity and IBAN are changed through Habba support'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

drop trigger if exists providers_b_guard_kyc on public.providers;
create trigger providers_b_guard_kyc
  before update on public.providers
  for each row execute function public.guard_provider_kyc_columns();
alter table public.providers enable always trigger providers_b_guard_kyc;

-- ---------------------------------------------------------------------------
-- Reading it back: operators only, with a reason, audited
-- ---------------------------------------------------------------------------

create or replace function public.ops_reveal_provider_kyc(p_provider_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := public.assert_reason(p_reason);
  v_provider public.providers;
begin
  perform public.assert_ops();

  select * into v_provider from public.providers p where p.id = p_provider_id;
  if not found then
    raise exception 'Provider % not found', p_provider_id using errcode = 'no_data_found';
  end if;

  -- Audited before it is returned: a read that fails halfway is still a read.
  perform public.audit_ops_read('providers', p_provider_id::text,
    jsonb_build_object('kyc_revealed', true, 'reason', v_reason));

  return jsonb_build_object(
    'identity_kind', v_provider.identity_kind,
    'national_id', public.kyc_unseal(v_provider.national_id_encrypted),
    'iban', public.kyc_unseal(v_provider.iban_encrypted),
    -- A value sealed by the old dev placeholder cannot be read back.
    'legacy', v_provider.national_id_encrypted like 'enc:%' or v_provider.iban_encrypted like 'enc:%'
  );
end;
$$;

revoke execute on function public.ops_reveal_provider_kyc(uuid, text) from public, anon;
grant execute on function public.ops_reveal_provider_kyc(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Erasure also destroys the sealed values (0086)
-- ---------------------------------------------------------------------------

-- Destroys one record's sealed values: the Vault secrets, the digest, and
-- the references. Used when an account is erased and when a rejected
-- applicant replaces their application.
create or replace function public.erase_provider_kyc_values(p_provider public.providers)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_was_open boolean := public.is_privileged_write();
begin
  delete from vault.secrets s
   where s.id::text in (substr(p_provider.national_id_encrypted, 7), substr(p_provider.iban_encrypted, 7))
     and (p_provider.national_id_encrypted like 'vault:%' or p_provider.iban_encrypted like 'vault:%');
  delete from public.provider_identity_digests d where d.provider_id = p_provider.id;

  perform public.begin_privileged_write();
  update public.providers
     set national_id_encrypted = null, iban_encrypted = null,
         identity_kind = null, national_id_tail = null, iban_tail = null
   where id = p_provider.id;
  -- erase_account() calls this with its own privileged write open; closing
  -- it here would leave the rest of the erasure unprivileged.
  perform public.end_privileged_write_unless(v_was_open);
end;
$$;

revoke execute on function public.erase_provider_kyc_values(public.providers) from public, anon, authenticated;

create or replace function public.erase_provider_kyc(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_provider public.providers;
begin
  for v_provider in select * from public.providers p where p.owner_profile_id = p_user_id loop
    perform public.erase_provider_kyc_values(v_provider);
  end loop;
end;
$$;

revoke execute on function public.erase_provider_kyc(uuid) from public, anon, authenticated;

create or replace function public.erase_account(p_user_id uuid, p_reason text, p_actor uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.has_role(p_user_id, 'ops') or public.has_role(p_user_id, 'super_admin') then
    raise exception 'Remove the staff role first' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.orders o
              left join public.providers pr on pr.id = o.provider_id
              where (o.customer_id = p_user_id or pr.owner_profile_id = p_user_id)
                and o.status not in ('draft', 'completed', 'cancelled')) then
    raise exception 'This person has an order in progress or in dispute' using errcode = 'check_violation',
      hint = 'Finish or cancel it first.';
  end if;
  if exists (select 1 from public.payouts py join public.providers pr on pr.id = py.provider_id
              where pr.owner_profile_id = p_user_id and py.status in ('pending', 'approved')) then
    raise exception 'This provider has a payout still to be paid' using errcode = 'check_violation';
  end if;

  insert into public.data_requests (user_id, kind, reason, handled_by)
  values (p_user_id, 'erasure', p_reason, p_actor);

  if not public.is_suspended(p_user_id) then
    insert into public.account_suspensions (user_id, reason, suspended_by)
    values (p_user_id, 'حُذفت بيانات الحساب بطلب صاحبه', p_actor);
  end if;

  perform public.begin_privileged_write();

  update public.profiles
     set full_name = 'مستخدم محذوف', phone = null, email = null, avatar_url = null,
         phone_verified = false, email_verified = false, is_guest = true
   where id = p_user_id;

  delete from public.push_devices where user_id = p_user_id;

  update public.orders
     set service_address_ar = null, problem_description = null, triage_media = '[]'::jsonb
   where customer_id = p_user_id;

  update public.vehicles set nickname = null, photo_url = null, is_active = false
   where owner_id = p_user_id;

  update public.ownership_transfers set status = 'cancelled'
   where (from_owner_id = p_user_id or to_owner_id = p_user_id) and status = 'pending';

  -- Reopened: a trigger fired by one of the updates above closes the flag
  -- behind it, which left 0086 unable to erase anyone with a provider record
  -- ("Verification status is set by Habba"). Found by suite 57.
  perform public.begin_privileged_write();

  update public.providers
     set is_online = false,
         verification_status = 'suspended',
         business_name_ar = case when provider_type = 'individual' then 'مقدّم خدمة محذوف' else business_name_ar end,
         business_name_en = case when provider_type = 'individual' then null else business_name_en end
   where owner_profile_id = p_user_id;

  perform public.erase_provider_kyc(p_user_id);

  delete from public.provider_locations l
   using public.providers pr where pr.id = l.provider_id and pr.owner_profile_id = p_user_id;

  update public.ratings set comment = null where rater_id = p_user_id;

  perform public.end_privileged_write();

  -- Sign-in identifiers, so the phone number is free to sign up again as a
  -- new person, and the old one cannot sign back in.
  begin
    update auth.users set phone = null, email = null where id = p_user_id;
  exception when others then
    null;
  end;
  perform public.sync_auth_ban(p_user_id, true);
end;
$$;

revoke execute on function public.erase_account(uuid, text, uuid) from public, anon, authenticated;
