-- 0086 — Deleting your own account, from the app
--
-- Apple requires an app that lets people create an account to let them
-- delete it from inside the app (App Store Review Guideline 5.1.1(v)), and
-- the PDPL gives the right to destruction. Until now only a super admin could
-- erase an account (ops_anonymise_user, 0070): the app could only say
-- "contact us".
--
-- The erasure itself is unchanged and now lives in one place,
-- erase_account(), which both paths call:
--
--   * ops_anonymise_user()  — a super admin, with a reason (0070's checks)
--   * delete_my_account()   — the person themselves, from «حسابي»
--
-- Both refuse while something is still owed either way — an order in
-- progress or in dispute, a payout not yet paid — because erasing then would
-- strand the other party. Staff accounts are removed from the console, not
-- here. What is kept is what 0070 keeps: invoices (ZATCA), and the car's
-- logbook, which is the car's history and the next owner's, detached from
-- the person.

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

  update public.providers
     set is_online = false,
         verification_status = 'suspended',
         business_name_ar = case when provider_type = 'individual' then 'مقدّم خدمة محذوف' else business_name_ar end,
         business_name_en = case when provider_type = 'individual' then null else business_name_en end
   where owner_profile_id = p_user_id;

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

create or replace function public.ops_anonymise_user(p_user_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := public.assert_reason(p_reason);
begin
  if not public.is_super_admin() then
    raise exception 'Only a super admin may erase an account' using errcode = 'insufficient_privilege';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'You cannot erase your own account' using errcode = 'check_violation';
  end if;
  perform public.erase_account(p_user_id, v_reason, auth.uid());
end;
$$;

-- The confirmation word is the app's second «are you sure», enforced here too:
-- a stray call, a replayed request or a mistyped endpoint erases nothing.
create or replace function public.delete_my_account(p_confirmation text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'Sign in first' using errcode = 'insufficient_privilege';
  end if;
  if p_confirmation is distinct from 'DELETE' then
    raise exception 'Deleting an account needs its confirmation' using errcode = 'check_violation';
  end if;
  perform public.erase_account(v_user, 'طلب صاحب الحساب من التطبيق', v_user);
end;
$$;

revoke execute on function public.delete_my_account(text) from public, anon;
grant execute on function public.delete_my_account(text) to authenticated;
