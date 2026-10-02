-- 0081 — The app's parts, switched from the console
--
-- Operators could already pause all new orders, change the dispatch radii,
-- the OTP limits and the payment gateway. What they could not do was turn a
-- part of the app off — emergencies at night while supply is thin, bookings
-- before workshops are signed up, transfers during a legal review — without
-- a new build. Each of these is now a switch under «ميزات التطبيق».
--
-- The app reads them (they are public) to hide what is off. That is the
-- courtesy; the rule is here: an order, a transfer, a report or a provider
-- application for a switched-off part is refused by the database, whoever
-- sends it and however.
--
-- Two switches are the app's alone and cannot be enforced here: the guest
-- and email ways in. Both are Supabase Auth settings as well — to close
-- either for certain, turn the provider off in the Supabase dashboard too.
--
-- And the release floor, which existed (min_app_version) and was never read
-- by the app: it now is, with the store links it sends people to.

insert into public.platform_settings
  (key, value, value_type, min_value, max_value, is_public, category, label_ar, unit_ar,
   description_ar, sort_order)
values
  ('feature_emergency', 'true', 'boolean', null, null, true, 'features',
   'الطلب الطارئ', null,
   'عند الإيقاف يختفي «طلب طارئ» من التطبيق ويُرفض أي طلب طارئ جديد. الطلبات الجارية تكمل.', 10),
  ('feature_booking', 'true', 'boolean', null, null, true, 'features',
   'حجز المواعيد', null,
   'حجز موعد في ورشة أو فنّي متنقل، والفحص قبل الشراء.', 20),
  ('feature_video_triage', 'true', 'boolean', null, null, true, 'features',
   'تصوير المشكلة قبل الطلب', null,
   'خطوة التصوير بعد إرسال الطلب الطارئ. عند الإيقاف يذهب العميل إلى المتابعة مباشرة.', 30),
  ('feature_ownership_transfer', 'true', 'boolean', null, null, true, 'features',
   'نقل ملكية السيارة', null,
   'عند الإيقاف لا يمكن بدء نقل جديد. النقل القائم يكمل أو ينتهي.', 40),
  ('feature_habba_report', 'true', 'boolean', null, null, true, 'features',
   'تقرير هبّة', null,
   'إصدار تقرير هبّة من دفتر السيارة.', 50),
  ('feature_provider_applications', 'true', 'boolean', null, null, true, 'features',
   'قبول طلبات الانضمام كفنّي', null,
   '«اشتغل معنا كفنّي». يحتاج أيضاً تفعيل وضع الفنّي في نسخة التطبيق (ADR-0017).', 60),
  ('feature_guest_login', 'true', 'boolean', null, null, true, 'features',
   'الدخول كضيف', null,
   'يخفي زر الدخول كضيف. لإغلاقه نهائياً عطّل Anonymous sign-ins في لوحة Supabase أيضاً.', 70),
  ('feature_email_login', 'true', 'boolean', null, null, true, 'features',
   'الدخول بالبريد الإلكتروني', null,
   'يخفي الدخول بالبريد. لإغلاقه نهائياً عطّل مزوّد Email في لوحة Supabase أيضاً.', 80),

  ('app_store_url', '""', 'text', null, null, true, 'app',
   'رابط التطبيق في App Store', null, 'تُرسل إليه شاشة «حدّث التطبيق» على الآيفون.', 90),
  ('play_store_url', '""', 'text', null, null, true, 'app',
   'رابط التطبيق في Google Play', null, 'تُرسل إليه شاشة «حدّث التطبيق» على أندرويد.', 100)
on conflict (key) do nothing;

update public.platform_settings
   set description_ar = 'مثل 1.4.0 — النسخ الأقدم تعرض «حدّث التطبيق» ولا تفتح.'
 where key = 'min_app_version';


-- ---------------------------------------------------------------------------
-- Enforcement
-- ---------------------------------------------------------------------------
create or replace function public.feature_on(p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.setting_bool(p_key, true);
$$;

-- Orders: an emergency or a booking, as the switch for its kind says. A free
-- warranty re-service (claim_warranty, 0025) is the promise on a job already
-- paid for, and is never refused by a switch.
create or replace function public.refuse_switched_off_orders()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.parent_order_id is not null then
    return new;
  end if;
  if new.fulfilment_mode = 'mobile_ondemand' and not public.feature_on('feature_emergency') then
    raise exception 'Emergency requests are switched off'
      using errcode = 'check_violation', hint = 'feature_disabled:emergency';
  end if;
  if new.fulfilment_mode <> 'mobile_ondemand' and not public.feature_on('feature_booking') then
    raise exception 'Bookings are switched off'
      using errcode = 'check_violation', hint = 'feature_disabled:booking';
  end if;
  return new;
end;
$$;

create trigger orders_a_feature_switch
  before insert on public.orders
  for each row execute function public.refuse_switched_off_orders();
alter table public.orders enable always trigger orders_a_feature_switch;

create or replace function public.refuse_switched_off_transfer()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.feature_on('feature_ownership_transfer') then
    raise exception 'Ownership transfers are switched off'
      using errcode = 'check_violation', hint = 'feature_disabled:ownership_transfer';
  end if;
  return new;
end;
$$;

create trigger ownership_transfers_a_feature_switch
  before insert on public.ownership_transfers
  for each row execute function public.refuse_switched_off_transfer();
alter table public.ownership_transfers enable always trigger ownership_transfers_a_feature_switch;

create or replace function public.refuse_switched_off_report()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.feature_on('feature_habba_report') then
    raise exception 'Habba reports are switched off'
      using errcode = 'check_violation', hint = 'feature_disabled:habba_report';
  end if;
  return new;
end;
$$;

create trigger habba_reports_a_feature_switch
  before insert on public.habba_reports
  for each row execute function public.refuse_switched_off_report();
alter table public.habba_reports enable always trigger habba_reports_a_feature_switch;

-- A person applying. An operator adding a provider from the console is not
-- an application, and is not refused.
create or replace function public.refuse_switched_off_applications()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null and not public.is_ops()
     and not public.feature_on('feature_provider_applications') then
    raise exception 'Provider applications are closed'
      using errcode = 'check_violation', hint = 'feature_disabled:provider_applications';
  end if;
  return new;
end;
$$;

create trigger providers_a_feature_switch
  before insert on public.providers
  for each row execute function public.refuse_switched_off_applications();
alter table public.providers enable always trigger providers_a_feature_switch;
