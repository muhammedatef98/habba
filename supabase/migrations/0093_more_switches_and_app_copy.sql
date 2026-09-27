-- 0093 — More of the app switched from the console, and its words edited there
--
-- 0081 put eight parts of the app under «ميزات التطبيق». The operators asked
-- for the rest: whatever the app does, they want to be able to turn it off,
-- and whatever it says, they want to be able to change without a release.
--
--   1. Seven more switches. Where there is a server path, the database
--      refuses what is off (the same rule as 0081: hiding is the courtesy,
--      refusing is the rule). The two map switches are the app's alone, like
--      the guest and email ways in: there is nothing on the server to refuse.
--
--   2. app_copy — an operator's replacement for any sentence in the app, in
--      Arabic, English or both. The app ships its own words and lays these
--      over them at launch; deleting a row puts the shipped words back. The
--      words are public (the sign-in screen reads them before anyone signs
--      in), so nothing that is not already on screen belongs here.

insert into public.platform_settings
  (key, value, value_type, min_value, max_value, is_public, category, label_ar, unit_ar,
   description_ar, sort_order)
values
  ('feature_booking_mobile', 'true', 'boolean', null, null, true, 'features',
   'الحجز: الفنّي يأتي لموقع العميل', null,
   'عند الإيقاف يختفي خيار «يأتيك في موقعك» من الحجز، ويُرفض أي حجز جديد بهذه الطريقة.', 22),
  ('feature_booking_workshop', 'true', 'boolean', null, null, true, 'features',
   'الحجز: في الورشة', null,
   'عند الإيقاف يختفي خيار «في الورشة» من الحجز، ويُرفض أي حجز جديد في ورشة.', 24),
  ('feature_record_service', 'true', 'boolean', null, null, true, 'features',
   'إضافة صيانة سابقة', null,
   'زر «أضف صيانة» في دفتر السيارة. عند الإيقاف لا يستطيع المالك إضافة صيانة بنفسه، وتبقى السجلات السابقة كما هي.', 55),
  ('feature_care_reminders', 'true', 'boolean', null, null, true, 'features',
   'مواعيد الصيانة والتذكيرات', null,
   'قسم «مواعيد الصيانة القادمة» وأوراق السيارة، وإشعارات التذكير اليومية. عند الإيقاف يختفي القسم وتتوقف التذكيرات.', 57),
  ('feature_ratings', 'true', 'boolean', null, null, true, 'features',
   'تقييم الفنّي بعد الخدمة', null,
   'عند الإيقاف لا يظهر طلب التقييم بعد انتهاء الطلب، ولا يُقبل تقييم جديد.', 58),
  ('feature_map_search', 'true', 'boolean', null, null, true, 'features',
   'البحث بالعنوان في الخريطة', null,
   'مربّع البحث فوق خريطة اختيار الموقع. عند الإيقاف يحرّك العميل الخريطة بيده فقط.', 62),
  ('feature_saved_places', 'true', 'boolean', null, null, true, 'features',
   'الأماكن المحفوظة والأخيرة', null,
   'أزرار «البيت» و«العمل» وآخر المواقع تحت الخريطة. تُحفظ على جهاز العميل فقط.', 64)
on conflict (key) do nothing;

-- Written when the provider mode still needed a build flag; the flag is gone
-- (ADR-0017) and the sentence sent operators looking for it.
update public.platform_settings
   set description_ar = '«اشتغل معنا كفنّي». عند الإيقاف يختفي الزر من التطبيق ويُرفض أي طلب انضمام جديد.'
 where key = 'feature_provider_applications';


-- ---------------------------------------------------------------------------
-- Enforcement
-- ---------------------------------------------------------------------------

-- 0081's order rule, plus the two booking ways. A warranty re-service is still
-- never refused: it is the promise on work already paid for.
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
  if new.fulfilment_mode = 'mobile_scheduled' and not public.feature_on('feature_booking_mobile') then
    raise exception 'Bookings at the customer''s location are switched off'
      using errcode = 'check_violation', hint = 'feature_disabled:booking_mobile';
  end if;
  if new.fulfilment_mode = 'workshop' and not public.feature_on('feature_booking_workshop') then
    raise exception 'Workshop bookings are switched off'
      using errcode = 'check_violation', hint = 'feature_disabled:booking_workshop';
  end if;
  return new;
end;
$$;

-- An owner's own entry is a service_completed row with no order behind it,
-- which is exactly what record_past_service writes (0015). Work Habba carried
-- out, and anything an operator writes, is never refused.
create or replace function public.refuse_switched_off_self_service()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.event_type = 'service_completed'
     and new.order_id is null
     and new.provenance in ('self_reported', 'self_documented')
     and not public.is_ops()
     and not public.feature_on('feature_record_service') then
    raise exception 'Adding past services is switched off'
      using errcode = 'check_violation', hint = 'feature_disabled:record_service';
  end if;
  return new;
end;
$$;

create trigger vehicle_timeline_a_feature_switch
  before insert on public.vehicle_timeline
  for each row execute function public.refuse_switched_off_self_service();
alter table public.vehicle_timeline enable always trigger vehicle_timeline_a_feature_switch;

-- A rating is the customer's; an operator hiding one is an update, not this.
create or replace function public.refuse_switched_off_rating()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_ops() and not public.feature_on('feature_ratings') then
    raise exception 'Ratings are switched off'
      using errcode = 'check_violation', hint = 'feature_disabled:ratings';
  end if;
  return new;
end;
$$;

create trigger ratings_a_feature_switch
  before insert on public.ratings
  for each row execute function public.refuse_switched_off_rating();
alter table public.ratings enable always trigger ratings_a_feature_switch;

-- The daily reminder sweep (0062) sends nothing while reminders are off. The
-- body is 0062's; only the first check is new.
create or replace function public.run_vehicle_care_sweep(p_limit int default 5000)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vehicle_id uuid;
  v_sent       int := 0;
begin
  if not public.feature_on('feature_care_reminders') then
    return 0;
  end if;

  for v_vehicle_id in
    select v.id from public.vehicles v
    where v.is_active
    order by v.updated_at
    limit p_limit
  loop
    if public.sweep_vehicle_care(v_vehicle_id) is not null then
      v_sent := v_sent + 1;
    end if;
  end loop;

  return v_sent;
end;
$$;

revoke all on function public.run_vehicle_care_sweep(int) from public, anon, authenticated;
revoke all on function public.refuse_switched_off_self_service() from public, anon, authenticated;
revoke all on function public.refuse_switched_off_rating() from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- app_copy — the app's words, as the operators have changed them
-- ---------------------------------------------------------------------------
-- Keyed by the app's own translation key (`home.emergencyCta`). A row replaces
-- the shipped sentence in the language(s) it gives; a null language keeps the
-- shipped one. Placeholders such as {{amount}} are checked against the shipped
-- sentence by the console before saving — the database cannot see the app's
-- words, so it only holds the shape.
create table public.app_copy (
  key        text primary key
               check (key ~ '^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z0-9_]+)+$' and length(key) <= 200),
  ar         text check (ar is null or length(trim(ar)) between 1 and 2000),
  en         text check (en is null or length(trim(en)) between 1 and 2000),
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  constraint app_copy_says_something check (ar is not null or en is not null)
);

comment on table public.app_copy is
  'Operator replacements for the app''s shipped sentences, by translation key. Public by design. 0093.';

create or replace function public.stamp_app_copy()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.created_by := auth.uid();
  else
    new.created_at := old.created_at;
    new.created_by := old.created_by;
  end if;
  return new;
end;
$$;

create trigger app_copy_stamp
  before insert or update on public.app_copy
  for each row execute function public.stamp_app_copy();

alter table public.app_copy enable row level security;

-- Everyone reads: these are the words on the screen, before and after sign-in.
create policy app_copy_read on public.app_copy
  for select to anon, authenticated using (true);

create policy app_copy_insert_ops on public.app_copy
  for insert to authenticated with check (public.is_ops());
create policy app_copy_update_ops on public.app_copy
  for update to authenticated using (public.is_ops()) with check (public.is_ops());
create policy app_copy_delete_ops on public.app_copy
  for delete to authenticated using (public.is_ops());

revoke all on public.app_copy from anon, authenticated;
grant select on public.app_copy to anon, authenticated;
grant insert (key, ar, en), update (ar, en), delete on public.app_copy to authenticated;

create trigger app_copy_z_audit_ops
  after insert or update or delete on public.app_copy
  for each row execute function public.audit_ops_change();
