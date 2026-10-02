-- 0069 — What the console needs underneath it
--
-- The ops console is meant to reach everything an operator is answerable for.
-- Before it can, several things have to exist in the database, because the
-- console is a client and a client decides nothing (CLAUDE.md §2.2):
--
--   1. platform_settings — the operational numbers that were hardcoded in SQL
--      (dispatch rounds and radii, OTP limits, how long a search may run
--      before it is flagged…) plus the app-facing switches (pause new orders,
--      support contacts, an announcement). Ops edits a value; every function
--      that used the constant now reads it.
--   2. account_suspensions — an operator can stop an account from ordering or
--      working, recorded with a reason and lifted with a note, never deleted.
--   3. Disputes and refunds — `disputed` was a dead end: nothing could move an
--      order out of it. There is now a way back to `completed`, a record of
--      how each dispute was resolved, and a ledger of the money movements
--      (voids, refunds) the payment provider has to carry out.
--   4. Cancelling an order released nothing: an authorised hold stayed on the
--      customer's card. It is released now, whoever cancels.
--   5. Rating moderation, internal notes, broadcast and data-request records.
--   6. Payment columns are closed to direct writes by operators too. The
--      orders_update_ops policy lets ops correct an order; it must not let
--      anyone — an operator included — declare an order paid or refunded
--      without the ledger row that the payment provider acts on.
--   7. The audit trigger reaches every new table, and identifies rows whose
--      key is not called `id`.

-- ---------------------------------------------------------------------------
-- 1. Settings
-- ---------------------------------------------------------------------------
create table public.platform_settings (
  key          text primary key check (key ~ '^[a-z][a-z0-9_]*$'),
  value        jsonb not null,
  value_type   text not null check (value_type in ('integer', 'number', 'boolean', 'text')),
  min_value    numeric,
  max_value    numeric,
  -- Readable by the app without signing in (get_public_settings, 0070).
  -- Nothing operational is public: an attacker learning the OTP limit is
  -- learning how far to push it.
  is_public    boolean not null default false,
  category     text not null,
  label_ar     text not null,
  unit_ar      text,
  description_ar text,
  sort_order   int not null default 0,
  updated_at   timestamptz not null default now(),
  updated_by   uuid
);

alter table public.platform_settings enable row level security;

create policy platform_settings_read_ops on public.platform_settings
  for select to authenticated using (public.is_ops());

create policy platform_settings_update_ops on public.platform_settings
  for update to authenticated using (public.is_ops()) with check (public.is_ops());

revoke all on public.platform_settings from anon, authenticated;
grant select on public.platform_settings to authenticated;
-- Only the value. The key, its type and its bounds are defined here, in a
-- migration, where they are reviewed; an operator changes a number, not what
-- the number means.
grant update (value) on public.platform_settings to authenticated;

create or replace function public.validate_platform_setting()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_number numeric;
begin
  case new.value_type
    when 'integer', 'number' then
      if jsonb_typeof(new.value) <> 'number' then
        raise exception 'Setting % must be a number', new.key using errcode = 'check_violation';
      end if;
      v_number := (new.value #>> '{}')::numeric;
      if new.value_type = 'integer' and v_number <> trunc(v_number) then
        raise exception 'Setting % must be a whole number', new.key using errcode = 'check_violation';
      end if;
      if new.min_value is not null and v_number < new.min_value then
        raise exception 'Setting % must be at least %', new.key, new.min_value
          using errcode = 'check_violation';
      end if;
      if new.max_value is not null and v_number > new.max_value then
        raise exception 'Setting % must be at most %', new.key, new.max_value
          using errcode = 'check_violation';
      end if;
    when 'boolean' then
      if jsonb_typeof(new.value) <> 'boolean' then
        raise exception 'Setting % must be true or false', new.key using errcode = 'check_violation';
      end if;
    when 'text' then
      if jsonb_typeof(new.value) <> 'string' then
        raise exception 'Setting % must be text', new.key using errcode = 'check_violation';
      end if;
      if length(new.value #>> '{}') > 2000 then
        raise exception 'Setting % is too long', new.key using errcode = 'check_violation';
      end if;
  end case;

  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

create trigger platform_settings_validate
  before insert or update on public.platform_settings
  for each row execute function public.validate_platform_setting();

-- Readers. SECURITY DEFINER so a customer's request (the matching function,
-- the OTP limiter) can read an operational number it may not itself select.
-- The default in each call is the fail-safe: a missing row behaves exactly as
-- the constant did.
create or replace function public.setting_number(p_key text, p_default numeric)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select (s.value #>> '{}')::numeric from public.platform_settings s
      where s.key = p_key and jsonb_typeof(s.value) = 'number'),
    p_default);
$$;

create or replace function public.setting_bool(p_key text, p_default boolean)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select (s.value #>> '{}')::boolean from public.platform_settings s
      where s.key = p_key and jsonb_typeof(s.value) = 'boolean'),
    p_default);
$$;

create or replace function public.setting_text(p_key text, p_default text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select s.value #>> '{}' from public.platform_settings s
      where s.key = p_key and jsonb_typeof(s.value) = 'string'),
    p_default);
$$;

insert into public.platform_settings
  (key, value, value_type, min_value, max_value, is_public, category, label_ar, unit_ar, description_ar, sort_order)
values
  -- The app
  ('new_orders_paused', 'false', 'boolean', null, null, true, 'app',
   'إيقاف استقبال الطلبات الجديدة', null,
   'عند التفعيل لا يستطيع أحد إرسال طلب جديد. الطلبات الجارية تكمل طبيعياً.', 10),
  ('new_orders_paused_message_ar', '"نعتذر، استقبال الطلبات متوقف مؤقتاً. حاول بعد قليل."', 'text',
   null, null, true, 'app', 'رسالة الإيقاف للعملاء', null, null, 20),
  ('announcement_ar', '""', 'text', null, null, true, 'app',
   'إعلان يظهر أعلى الصفحة الرئيسية', null, 'اتركه فارغاً لإخفاء الإعلان.', 30),
  ('announcement_en', '""', 'text', null, null, true, 'app',
   'الإعلان بالإنجليزية', null, null, 40),
  ('support_phone', '""', 'text', null, null, true, 'app', 'هاتف الدعم', null, null, 50),
  ('support_whatsapp', '""', 'text', null, null, true, 'app', 'واتساب الدعم', null, null, 60),
  ('support_email', '""', 'text', null, null, true, 'app', 'بريد الدعم', null, null, 70),
  ('min_app_version', '""', 'text', null, null, true, 'app',
   'أقل إصدار مسموح من التطبيق', null, 'مثل 1.4.0 — الإصدارات الأقدم تُطالَب بالتحديث.', 80),

  -- Dispatch
  ('dispatch_max_round', '3', 'integer', 1, 10, false, 'dispatch',
   'عدد جولات البحث عن فنّي', 'جولة', 'كل جولة توسّع نطاق البحث.', 10),
  ('dispatch_silence_seconds', '45', 'integer', 10, 600, false, 'dispatch',
   'مهلة الجولة قبل التوسيع', 'ثانية', null, 20),
  ('match_radius_round1_m', '8000', 'integer', 500, 100000, false, 'dispatch',
   'نطاق الجولة الأولى', 'متر', null, 30),
  ('match_radius_round2_m', '15000', 'integer', 500, 100000, false, 'dispatch',
   'نطاق الجولة الثانية', 'متر', null, 40),
  ('match_radius_round3_m', '25000', 'integer', 500, 150000, false, 'dispatch',
   'نطاق الجولة الثالثة وما بعدها', 'متر', null, 50),
  ('location_freshness_seconds', '180', 'integer', 30, 3600, false, 'dispatch',
   'أقدم موقع مقبول للفنّي', 'ثانية', 'الفنّي الذي لم يُحدَّث موقعه خلال هذه المدة لا تصله العروض.', 60),
  ('urban_speed_kmh', '28', 'number', 5, 120, false, 'dispatch',
   'متوسط السرعة داخل المدن', 'كم/ساعة', 'يُستخدم لتقدير وقت الوصول.', 70),
  ('route_detour_factor', '1.35', 'number', 1, 3, false, 'dispatch',
   'معامل انحراف الطريق', null, 'نسبة طول الطريق الفعلي إلى الخط المستقيم.', 80),

  -- The board
  ('ops_stuck_search_minutes', '4', 'integer', 1, 120, false, 'ops',
   'تنبيه البحث البطيء بعد', 'دقيقة', null, 10),
  ('ops_unconfirmed_minutes', '30', 'integer', 5, 1440, false, 'ops',
   'تنبيه انتظار اعتماد العميل بعد', 'دقيقة', null, 20),

  -- Security
  ('otp_send_limit', '5', 'integer', 1, 50, false, 'security',
   'أقصى عدد لرسائل رمز الدخول', 'رسالة', 'لكل رقم خلال النافذة التالية.', 10),
  ('otp_send_window_minutes', '60', 'integer', 5, 1440, false, 'security',
   'نافذة حدّ رسائل الدخول', 'دقيقة', null, 20),
  ('handover_max_attempts', '5', 'integer', 1, 20, false, 'security',
   'محاولات رمز التسليم', 'محاولة', null, 30),

  -- Ownership transfer
  ('ownership_transfer_days', '7', 'integer', 1, 60, false, 'transfer',
   'صلاحية طلب نقل الملكية', 'يوم', null, 10),
  ('transfer_attempt_limit', '5', 'integer', 1, 20, false, 'transfer',
   'محاولات رمز نقل الملكية', 'محاولة', null, 20),
  ('transfer_accept_limit', '10', 'integer', 1, 100, false, 'transfer',
   'محاولات القبول لكل مستخدم', 'محاولة', 'خلال النافذة التالية.', 30),
  ('transfer_accept_window_minutes', '60', 'integer', 5, 1440, false, 'transfer',
   'نافذة محاولات القبول', 'دقيقة', null, 40),

  -- Vehicle care
  ('care_lead_days', '14', 'integer', 1, 90, false, 'care',
   'التذكير قبل موعد الصيانة', 'يوم', null, 10),
  ('care_lead_km', '500', 'integer', 50, 5000, false, 'care',
   'التذكير قبل مسافة الصيانة', 'كم', null, 20),
  ('care_reminder_repeat_days', '7', 'integer', 1, 60, false, 'care',
   'تكرار التذكير كل', 'يوم', null, 30),
  ('care_default_snooze_days', '14', 'integer', 1, 90, false, 'care',
   'مدة التأجيل الافتراضية', 'يوم', null, 40),
  ('maintenance_alert_window_days', '14', 'integer', 1, 90, false, 'care',
   'نافذة تنبيه الصيانة', 'يوم', null, 50),
  ('maintenance_alert_window_km', '500', 'integer', 50, 5000, false, 'care',
   'نافذة تنبيه الصيانة بالمسافة', 'كم', null, 60);

-- Every constant becomes a read of its setting, with the old value as the
-- default. Same names, same return types, so nothing that calls them changes;
-- STABLE rather than IMMUTABLE, because they now read a table.
create or replace function public.dispatch_max_round() returns integer
language sql stable as $$ select public.setting_number('dispatch_max_round', 3)::int $$;

create or replace function public.dispatch_silence_window() returns interval
language sql stable as $$
  select make_interval(secs => public.setting_number('dispatch_silence_seconds', 45)::double precision)
$$;

create or replace function public.match_radius_for_round(p_round integer) returns integer
language sql stable as $$
  select case
    when p_round <= 1 then public.setting_number('match_radius_round1_m', 8000)::int
    when p_round = 2 then public.setting_number('match_radius_round2_m', 15000)::int
    else public.setting_number('match_radius_round3_m', 25000)::int
  end
$$;

create or replace function public.location_freshness_limit() returns interval
language sql stable as $$
  select make_interval(secs => public.setting_number('location_freshness_seconds', 180)::double precision)
$$;

create or replace function public.urban_speed_kmh() returns numeric
language sql stable as $$ select public.setting_number('urban_speed_kmh', 28) $$;

create or replace function public.route_detour_factor() returns numeric
language sql stable as $$ select public.setting_number('route_detour_factor', 1.35) $$;

create or replace function public.ops_stuck_search_after() returns interval
language sql stable as $$
  select make_interval(mins => public.setting_number('ops_stuck_search_minutes', 4)::int)
$$;

create or replace function public.ops_unconfirmed_after() returns interval
language sql stable as $$
  select make_interval(mins => public.setting_number('ops_unconfirmed_minutes', 30)::int)
$$;

create or replace function public.otp_send_limit() returns integer
language sql stable as $$ select public.setting_number('otp_send_limit', 5)::int $$;

create or replace function public.otp_send_window() returns interval
language sql stable as $$
  select make_interval(mins => public.setting_number('otp_send_window_minutes', 60)::int)
$$;

create or replace function public.handover_max_attempts() returns integer
language sql stable as $$ select public.setting_number('handover_max_attempts', 5)::int $$;

create or replace function public.ownership_transfer_window() returns interval
language sql stable as $$
  select make_interval(days => public.setting_number('ownership_transfer_days', 7)::int)
$$;

create or replace function public.transfer_attempt_limit() returns integer
language sql stable as $$ select public.setting_number('transfer_attempt_limit', 5)::int $$;

create or replace function public.transfer_accept_limit() returns integer
language sql stable as $$ select public.setting_number('transfer_accept_limit', 10)::int $$;

create or replace function public.transfer_accept_window() returns interval
language sql stable as $$
  select make_interval(mins => public.setting_number('transfer_accept_window_minutes', 60)::int)
$$;

create or replace function public.care_lead_days() returns integer
language sql stable as $$ select public.setting_number('care_lead_days', 14)::int $$;

create or replace function public.care_lead_km() returns integer
language sql stable as $$ select public.setting_number('care_lead_km', 500)::int $$;

create or replace function public.care_reminder_repeat_days() returns integer
language sql stable as $$ select public.setting_number('care_reminder_repeat_days', 7)::int $$;

create or replace function public.care_default_snooze_days() returns integer
language sql stable as $$ select public.setting_number('care_default_snooze_days', 14)::int $$;

create or replace function public.maintenance_alert_window_days() returns integer
language sql stable as $$ select public.setting_number('maintenance_alert_window_days', 14)::int $$;

create or replace function public.maintenance_alert_window_km() returns integer
language sql stable as $$ select public.setting_number('maintenance_alert_window_km', 500)::int $$;


-- ---------------------------------------------------------------------------
-- 2. Account suspension
-- ---------------------------------------------------------------------------
create table public.account_suspensions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  reason        text not null check (length(trim(reason)) > 0),
  suspended_at  timestamptz not null default now(),
  suspended_by  uuid not null,
  lifted_at     timestamptz,
  lifted_by     uuid,
  lift_note     text,
  check ((lifted_at is null) = (lifted_by is null))
);

create unique index account_suspensions_one_active
  on public.account_suspensions (user_id) where lifted_at is null;

alter table public.account_suspensions enable row level security;

-- The person can see that they are suspended and why — the app tells them,
-- rather than failing every action with no explanation.
create policy account_suspensions_read on public.account_suspensions
  for select to authenticated using (user_id = auth.uid() or public.is_ops());

revoke all on public.account_suspensions from anon, authenticated;
grant select on public.account_suspensions to authenticated;

-- History is kept: a suspension is lifted, once, and never rewritten.
create or replace function public.guard_account_suspensions()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from public.profiles p where p.id = old.user_id) then
      raise exception 'A suspension is lifted, not deleted' using errcode = 'insufficient_privilege';
    end if;
    return old;
  end if;

  if old.lifted_at is not null
     or new.id is distinct from old.id
     or new.user_id is distinct from old.user_id
     or new.reason is distinct from old.reason
     or new.suspended_at is distinct from old.suspended_at
     or new.suspended_by is distinct from old.suspended_by then
    raise exception 'A suspension record cannot be rewritten' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger account_suspensions_guard
  before update or delete on public.account_suspensions
  for each row execute function public.guard_account_suspensions();

alter table public.account_suspensions enable always trigger account_suspensions_guard;

create or replace function public.is_suspended(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.account_suspensions s
     where s.user_id = p_user and s.lifted_at is null);
$$;

-- On a hosted project the ban also reaches sign-in: GoTrue refuses a banned
-- user's password, OTP and token refresh. The shim has no such column, and a
-- deployment where the migrator cannot write auth.users still suspends
-- everything below — so this is best effort, never the only line.
create or replace function public.sync_auth_ban(p_user uuid, p_banned boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'auth' and table_name = 'users'
                and column_name = 'banned_until') then
    execute 'update auth.users set banned_until = $1 where id = $2'
      using case when p_banned then now() + interval '100 years' end, p_user;
  end if;
exception when insufficient_privilege then
  null;
end;
$$;

revoke execute on function public.sync_auth_ban(uuid, boolean) from public, anon, authenticated;

-- The rule, where it cannot be bypassed: a suspended account does not start
-- an order and a suspended provider does not take one. Checked on the row,
-- so a hand-written request fails the same way the app's does.
create or replace function public.refuse_suspended_on_orders()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
begin
  if public.is_ops() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if public.is_suspended(new.customer_id) then
      raise exception 'This account is suspended'
        using errcode = 'insufficient_privilege', hint = 'account_suspended';
    end if;
    return new;
  end if;

  -- Leaving draft is the moment an order goes out to providers.
  if old.status = 'draft' and new.status not in ('draft', 'cancelled') then
    if public.is_suspended(new.customer_id) then
      raise exception 'This account is suspended'
        using errcode = 'insufficient_privilege', hint = 'account_suspended';
    end if;
    if public.setting_bool('new_orders_paused', false) and new.parent_order_id is null then
      raise exception '%', public.setting_text('new_orders_paused_message_ar',
                                              'Habba is not taking new orders right now')
        using errcode = 'check_violation', hint = 'orders_paused';
    end if;
  end if;

  if new.provider_id is not null and new.provider_id is distinct from old.provider_id then
    select pr.owner_profile_id into v_owner from public.providers pr where pr.id = new.provider_id;
    if public.is_suspended(v_owner) then
      raise exception 'This provider account is suspended'
        using errcode = 'insufficient_privilege', hint = 'account_suspended';
    end if;
  end if;

  return new;
end;
$$;

create trigger orders_0_refuse_suspended
  before insert or update on public.orders
  for each row execute function public.refuse_suspended_on_orders();

create or replace function public.refuse_suspended_going_online()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.is_online and not old.is_online and public.is_suspended(new.owner_profile_id) then
    raise exception 'This account is suspended'
      using errcode = 'insufficient_privilege', hint = 'account_suspended';
  end if;
  return new;
end;
$$;

create trigger providers_0_refuse_suspended
  before update of is_online on public.providers
  for each row execute function public.refuse_suspended_going_online();


-- ---------------------------------------------------------------------------
-- 3. Disputes, refunds and the payment ledger
-- ---------------------------------------------------------------------------
alter table public.orders
  add column refunded_amount numeric(12,2) not null default 0
    check (refunded_amount >= 0);

alter table public.orders
  add constraint orders_refund_within_total
    check (refunded_amount <= coalesce(total_amount, 0));

-- What the payment provider has to do. Written by the database when an order
-- is cancelled or a dispute is refunded; carried out by whoever holds the PSP
-- credentials (a worker once the Moyasar account exists, or by hand in its
-- dashboard until then) and marked done from the console with the PSP's
-- reference. The customer can see their own — "your refund is on its way"
-- is part of the promise.
create table public.payment_operations (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references public.orders (id) on delete restrict,
  kind          text not null check (kind in ('void', 'refund')),
  amount        numeric(12,2) not null check (amount >= 0),
  status        text not null default 'pending' check (status in ('pending', 'succeeded', 'failed')),
  reason        text not null,
  requested_by  uuid,
  created_at    timestamptz not null default now(),
  processed_at  timestamptz,
  processed_by  uuid,
  psp_reference text,
  last_error    text
);

create index payment_operations_pending_idx on public.payment_operations (created_at)
  where status = 'pending';
create index payment_operations_order_idx on public.payment_operations (order_id);

alter table public.payment_operations enable row level security;

create policy payment_operations_read on public.payment_operations
  for select to authenticated using (
    public.is_ops()
    or exists (select 1 from public.orders o
                where o.id = payment_operations.order_id and o.customer_id = auth.uid()));

revoke all on public.payment_operations from anon, authenticated;
grant select on public.payment_operations to authenticated;

create table public.order_disputes (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null references public.orders (id) on delete restrict,
  opened_by       uuid,
  opened_at       timestamptz not null default now(),
  reason          text not null,
  -- upheld: the work stands and the provider is paid in full.
  resolution      text check (resolution in ('upheld', 'partial_refund', 'full_refund')),
  refund_amount   numeric(12,2) check (refund_amount is null or refund_amount >= 0),
  resolution_note text,
  resolved_by     uuid,
  resolved_at     timestamptz,
  -- Set when the order had already been paid out to the provider: the refund
  -- then has to be recovered from them, which is a conversation, not a query.
  payout_already_built boolean not null default false,
  check ((resolved_at is null) = (resolution is null))
);

create unique index order_disputes_one_open on public.order_disputes (order_id)
  where resolved_at is null;

alter table public.order_disputes enable row level security;

create policy order_disputes_read on public.order_disputes
  for select to authenticated using (
    public.is_ops()
    or exists (select 1 from public.orders o
                where o.id = order_disputes.order_id
                  and (o.customer_id = auth.uid() or o.provider_id = public.current_provider_id())));

revoke all on public.order_disputes from anon, authenticated;
grant select on public.order_disputes to authenticated;

-- A dispute always has a record, however the order got there: the customer's
-- own update, an operator's, or the RPC in 0070 (which writes the reason
-- first; this then finds it and does nothing).
create or replace function public.record_dispute_opened()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'disputed' and old.status is distinct from 'disputed'
     and not exists (select 1 from public.order_disputes d
                      where d.order_id = new.id and d.resolved_at is null) then
    insert into public.order_disputes (order_id, opened_by, reason)
    values (new.id, auth.uid(), 'لم يُذكر سبب');
  end if;
  return null;
end;
$$;

create trigger orders_record_dispute
  after update of status on public.orders
  for each row execute function public.record_dispute_opened();

-- The way out of `disputed`. Only to completed: the job happened, and it is
-- already on the car's logbook. What the resolution changes is the money.
insert into public.order_transitions (fulfilment_mode, from_status, to_status)
select m.mode, 'disputed'::public.order_status, 'completed'::public.order_status
  from unnest(enum_range(null::public.fulfilment_mode)) as m(mode)
on conflict do nothing;

-- A cancelled order holds nobody's money. Whoever cancels — customer,
-- provider, operator — the authorisation is released and the PSP is asked to
-- void it.
create or replace function public.release_escrow_on_cancel()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'cancelled' and old.status is distinct from 'cancelled'
     and new.escrow_status = 'authorised' then
    perform public.begin_privileged_write();
    update public.orders set escrow_status = 'released' where id = new.id;
    perform public.end_privileged_write();

    insert into public.payment_operations (order_id, kind, amount, reason, requested_by)
    values (new.id, 'void',
            coalesce(new.total_amount, new.quoted_amount, 0),
            coalesce(nullif(trim(new.cancellation_reason), ''), 'إلغاء الطلب'),
            auth.uid());
  end if;
  return null;
end;
$$;

create trigger orders_release_escrow
  after update of status on public.orders
  for each row execute function public.release_escrow_on_cancel();

-- The state machine, carried forward from 0067 with three changes:
--   * an operator may confirm completion for a customer who confirmed by
--     phone (awaiting_approval → completed);
--   * only the customer or an operator opens a dispute. The provider could
--     until now, and a dispute nobody with a complaint opened is an order
--     stuck on the board and a payout frozen for no reason;
--   * disputed → completed is an operator's resolution, and does not write
--     the logbook entry a second time.
create or replace function public.enforce_order_transition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor        uuid := auth.uid();
  v_unapproved   int;
  v_service      record;
  v_provider     record;
  v_summary_ar   text;
  v_summary_en   text;
  v_event_type   public.timeline_event_type;
  v_attachments  jsonb;
  v_mileage      int;
begin
  if new.status = old.status then
    return new;
  end if;

  if not exists (
    select 1 from public.order_transitions t
    where t.fulfilment_mode = old.fulfilment_mode
      and t.from_status = old.status
      and t.to_status = new.status
  ) then
    raise exception '% orders cannot move from % to %',
      old.fulfilment_mode, old.status, new.status
      using errcode = 'check_violation';
  end if;

  if new.status = 'accepted' and old.status = 'quoted' then
    if coalesce(new.quoted_amount, 0) > 0 and new.escrow_status <> 'authorised' then
      raise exception 'An order cannot be accepted before payment is authorised'
        using errcode = 'check_violation',
              hint = 'Authorise the payment, then accept.';
    end if;
    if new.provider_id is null then
      raise exception 'An accepted order must have a provider'
        using errcode = 'check_violation';
    end if;
  end if;

  if new.status = 'awaiting_approval'
     or (new.status = 'completed' and old.status = 'in_progress') then
    select count(*) into v_unapproved
    from public.order_parts p
    where p.order_id = new.id and not p.approved_by_customer and p.declined_at is null;

    if v_unapproved > 0 then
      raise exception '% part line(s) are still waiting for the customer', v_unapproved
        using errcode = 'check_violation',
              hint = 'The customer approves or declines each part first; or remove the line.';
    end if;
  end if;

  if new.status = 'awaiting_approval' then
    perform public.assert_completion_evidence(new.id);
  end if;

  if new.status = 'completed' and old.status = 'in_progress' then
    perform public.assert_completion_evidence(new.id);
  end if;

  if new.status = 'completed' and old.status = 'awaiting_approval' then
    if not new.completed_by_timeout
       and v_actor is distinct from new.customer_id
       and not public.is_ops() then
      raise exception 'Only the customer may confirm completion'
        using errcode = 'insufficient_privilege',
              hint = 'The order auto-completes 24h after the customer stops responding.';
    end if;
  end if;

  if new.status = 'disputed'
     and v_actor is distinct from new.customer_id
     and not public.is_ops()
     and not public.is_privileged_write() then
    raise exception 'Only the customer or Habba may open a dispute'
      using errcode = 'insufficient_privilege';
  end if;

  if old.status = 'disputed' and not public.is_ops() and not public.is_privileged_write() then
    raise exception 'Only Habba resolves a dispute'
      using errcode = 'insufficient_privilege';
  end if;

  if new.status = 'completed' then
    new.completed_at := coalesce(new.completed_at, now());

    if new.warranty_days is not null then
      new.warranty_expires_at :=
        coalesce(new.warranty_expires_at,
                 new.completed_at + make_interval(days => new.warranty_days));
    end if;
  end if;

  if new.status = 'cancelled' then
    new.cancelled_at := coalesce(new.cancelled_at, now());
  end if;

  insert into public.order_events (order_id, from_status, to_status, actor_id)
  values (new.id, old.status, new.status, v_actor);

  -- Resolving a dispute returns the order to `completed`; its logbook entry
  -- was written the first time, and the hash chain would faithfully record a
  -- second one as a second service that never happened.
  if new.status = 'completed' and old.status <> 'disputed' then
    if new.vehicle_id is not null then
      select * into v_service from public.services where id = new.service_id;
      select * into v_provider from public.providers where id = new.provider_id;

      v_event_type := case
        when new.parent_order_id is not null then 'warranty_claimed'
        else 'service_completed'
      end;

      v_summary_ar := case
        when new.parent_order_id is not null
          then format('إعادة خدمة تحت الضمان: %s', coalesce(v_service.name_ar, 'خدمة'))
        else coalesce(v_service.name_ar, 'خدمة مكتملة')
      end;
      v_summary_en := case
        when new.parent_order_id is not null
          then format('Warranty re-service: %s', coalesce(v_service.name_en, 'service'))
        else coalesce(v_service.name_en, 'Service completed')
      end;

      v_attachments := coalesce(new.completion_media, '[]'::jsonb);
      v_mileage := coalesce(new.completion_mileage, new.mileage_at_order);

      perform public.append_vehicle_timeline_event(
        p_vehicle_id  => new.vehicle_id,
        p_event_type  => v_event_type,
        p_summary_ar  => v_summary_ar,
        p_summary_en  => v_summary_en,
        p_occurred_at => new.completed_at,
        p_mileage     => v_mileage,
        p_order_id    => new.id,
        p_provider_id => new.provider_id,
        p_details     => jsonb_strip_nulls(jsonb_build_object(
          'order_number', new.order_number,
          'service_kind', v_service.name_en,
          'provider_business_name', v_provider.business_name_ar,
          'warranty_days', new.warranty_days,
          'labour_amount', new.labour_amount,
          'parts_amount', new.parts_amount,
          'is_warranty_reservice', new.parent_order_id is not null
        )),
        p_attachments => v_attachments
      );
    else
      select * into v_service from public.services where id = new.service_id;

      if v_service.requires_vehicle then
        raise exception 'Order % has no vehicle but service % requires one',
          new.order_number, v_service.name_en
          using errcode = 'check_violation';
      end if;
    end if;
  end if;

  return new;
end;
$$;

-- The same reason for vehicle care: a resolved dispute is not a second
-- service, and must not reset what is due next.
drop trigger orders_absorb_into_vehicle_care on public.orders;
create trigger orders_absorb_into_vehicle_care
  after update of status on public.orders
  for each row
  when (new.status = 'completed'
        and old.status is distinct from 'completed'
        and old.status is distinct from 'disputed')
  execute function public.absorb_order_into_vehicle_care();

-- Payouts pay what the customer finally paid: a refunded amount is not the
-- provider's, and the commission follows the same share.
create or replace function public.build_payout(p_provider_id uuid, p_period_start date, p_period_end date)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payout_id uuid;
  v_gross numeric(12,2) := 0;
  v_commission numeric(12,2) := 0;
  v_count int := 0;
  v_order record;
  v_rate numeric;
  v_paid numeric(12,2);
  v_line_commission numeric(12,2);
begin
  if not public.is_ops() then
    raise exception 'Only ops may build payouts' using errcode = 'insufficient_privilege';
  end if;

  insert into public.payouts (
    provider_id, period_start, period_end, gross_amount, commission, net_amount, order_count
  ) values (p_provider_id, p_period_start, p_period_end, 0, 0, 0, 0)
  returning id into v_payout_id;

  for v_order in
    select o.*, s.category
    from public.orders o
    join public.services s on s.id = o.service_id
    where o.provider_id = p_provider_id
      and o.status = 'completed'
      and o.completed_at::date between p_period_start and p_period_end
      and o.escrow_status = 'captured'
      and coalesce(o.total_amount, 0) - o.refunded_amount > 0
      and not exists (select 1 from public.payout_orders po where po.order_id = o.id)
  loop
    v_rate := coalesce(public.commission_rate_for(v_order.category, p_period_end), 0.20);
    v_paid := v_order.total_amount - v_order.refunded_amount;

    -- Commission on the net, never on the VAT — and on the share of the net
    -- the customer actually ended up paying.
    v_line_commission := round(
      (v_order.parts_amount + v_order.labour_amount) * v_rate
        * (v_paid / v_order.total_amount), 2);

    insert into public.payout_orders (payout_id, order_id, gross, commission)
    values (v_payout_id, v_order.id, v_paid, v_line_commission);

    v_gross := v_gross + v_paid;
    v_commission := v_commission + v_line_commission;
    v_count := v_count + 1;
  end loop;

  update public.payouts
  set gross_amount = v_gross,
      commission = v_commission,
      net_amount = v_gross - v_commission,
      order_count = v_count
  where id = v_payout_id;

  return v_payout_id;
end;
$$;


-- ---------------------------------------------------------------------------
-- 6. Payment state is the payment functions' to write — for operators too
-- ---------------------------------------------------------------------------
create or replace function public.guard_order_payment_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public.is_privileged_write() then
    return new;
  end if;

  if new.escrow_status is distinct from old.escrow_status
     or new.payment_intent_id is distinct from old.payment_intent_id
     or new.refunded_amount is distinct from old.refunded_amount then
    raise exception 'Payment state cannot be set directly'
      using errcode = 'insufficient_privilege',
            hint = 'Refunds go through the dispute and cancellation functions, which record them for the payment provider.';
  end if;
  return new;
end;
$$;

create trigger orders_a_guard_payment_columns
  before update on public.orders
  for each row execute function public.guard_order_payment_columns();

-- Every role, service_role included (suite 16).
alter table public.orders enable always trigger orders_a_guard_payment_columns;


-- ---------------------------------------------------------------------------
-- 5. Moderation, notes, broadcasts, data requests
-- ---------------------------------------------------------------------------
alter table public.ratings
  add column hidden_at timestamptz,
  add column hidden_by uuid,
  add column hidden_reason text,
  add constraint ratings_hidden_has_reason
    check (hidden_at is null or length(trim(coalesce(hidden_reason, ''))) > 0);

-- A hidden review stops counting and stops showing, except to the person who
-- wrote it and to operators.
drop policy ratings_read on public.ratings;
create policy ratings_read on public.ratings
  for select to authenticated
  using (hidden_at is null or rater_id = auth.uid() or public.is_ops());

create or replace function public.recompute_provider_rating(p_provider_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.begin_privileged_write();

  update public.providers p
  set rating_avg = coalesce(sub.avg_stars, 0),
      rating_count = sub.n
  from (
    select round(avg(stars)::numeric, 2) as avg_stars, count(*)::int as n
    from public.ratings where provider_id = p_provider_id and hidden_at is null
  ) as sub
  where p.id = p_provider_id;

  perform public.end_privileged_write();
end;
$$;

revoke execute on function public.recompute_provider_rating(uuid) from public, anon, authenticated;

create or replace function public.refresh_provider_rating()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.recompute_provider_rating(new.provider_id);
  return null;
end;
$$;

-- Internal notes an operator leaves on anything they handle: "customer called,
-- confirmed by phone", "provider warned about lateness". Never shown to the
-- people they are about.
create table public.ops_notes (
  id           uuid primary key default gen_random_uuid(),
  target_table text not null check (target_table in ('orders', 'profiles', 'providers', 'vehicles')),
  target_id    uuid not null,
  body         text not null check (length(trim(body)) > 0),
  author_id    uuid not null,
  created_at   timestamptz not null default now()
);

create index ops_notes_target_idx on public.ops_notes (target_table, target_id, created_at desc);

alter table public.ops_notes enable row level security;
create policy ops_notes_read on public.ops_notes for select to authenticated using (public.is_ops());
revoke all on public.ops_notes from anon, authenticated;
grant select on public.ops_notes to authenticated;

create table public.ops_broadcasts (
  id          uuid primary key default gen_random_uuid(),
  audience    text not null check (audience in ('all', 'customers', 'providers', 'city')),
  city_id     uuid references public.cities (id),
  title_ar    text not null,
  body_ar     text not null,
  title_en    text not null,
  body_en     text not null,
  recipients  int not null default 0,
  sent_by     uuid not null,
  created_at  timestamptz not null default now(),
  check ((audience = 'city') = (city_id is not null))
);

alter table public.ops_broadcasts enable row level security;
create policy ops_broadcasts_read on public.ops_broadcasts for select to authenticated using (public.is_ops());
revoke all on public.ops_broadcasts from anon, authenticated;
grant select on public.ops_broadcasts to authenticated;

-- PDPL requests: access (an export of everything held about a person) and
-- erasure (anonymisation). The record of the request is itself kept — who
-- asked, who handled it, when — because being able to show that a request
-- was honoured is part of honouring it.
create table public.data_requests (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null,
  kind         text not null check (kind in ('export', 'erasure')),
  reason       text not null check (length(trim(reason)) > 0),
  handled_by   uuid not null,
  handled_at   timestamptz not null default now()
);

alter table public.data_requests enable row level security;
create policy data_requests_read on public.data_requests for select to authenticated using (public.is_ops());
revoke all on public.data_requests from anon, authenticated;
grant select on public.data_requests to authenticated;

-- An operator's correction to a car's logbook is a new entry, never an edit
-- (ADR-0003). This is its type.
alter type public.timeline_event_type add value if not exists 'record_annotated';

-- VAT rates had no write path at all; a rate change is an operator's job.
create policy vat_rates_write_ops on public.vat_rates
  for all to authenticated using (public.is_ops()) with check (public.is_ops());
grant insert, update, delete on public.vat_rates to authenticated;


-- ---------------------------------------------------------------------------
-- 7. The audit trail reaches the rest
-- ---------------------------------------------------------------------------
-- Rows whose key is not `id` were logged against ''. Now the first key that
-- is present names the row.
create or replace function public.audit_ops_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before jsonb := case when tg_op <> 'INSERT' then public.audit_redact(to_jsonb(old)) end;
  v_after  jsonb := case when tg_op <> 'DELETE' then public.audit_redact(to_jsonb(new)) end;
  v_row    jsonb := coalesce(v_after, v_before);
begin
  if not public.is_ops() then
    return null;
  end if;

  if tg_op = 'UPDATE' and v_before = v_after then
    return null;
  end if;

  insert into public.audit_log (actor_id, action, target_table, target_id, before, after, ip)
  values (
    auth.uid(),
    lower(tg_op),
    tg_table_name,
    coalesce(
      v_row ->> 'id', v_row ->> 'key', v_row ->> 'order_id', v_row ->> 'user_id',
      v_row ->> 'provider_id', v_row ->> 'item_type', ''
    ) || case
      when tg_table_name = 'user_roles' then ':' || (v_row ->> 'role')
      when tg_table_name = 'provider_services' then ':' || (v_row ->> 'service_id')
      else ''
    end,
    v_before,
    v_after,
    public.request_ip()
  );

  return null;
end;
$$;

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'platform_settings', 'account_suspensions', 'payment_operations', 'order_disputes',
    'ratings', 'ops_notes', 'ops_broadcasts', 'data_requests', 'vat_rates', 'profiles',
    'vehicles', 'habba_reports', 'ownership_transfers', 'provider_services', 'workshops',
    'appointment_slots', 'order_parts'
  ] loop
    execute format(
      'create trigger %I after insert or update or delete on public.%I
         for each row execute function public.audit_ops_change()',
      v_table || '_z_audit_ops', v_table);
  end loop;
end
$$;

-- A read of someone's personal data is recorded too, when it is a read of
-- everything about them (their profile page, an export). Called by the ops
-- functions in 0070; not callable by anyone directly.
create or replace function public.audit_ops_read(p_table text, p_id text, p_detail jsonb default null)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_log (actor_id, action, target_table, target_id, before, after, ip)
  values (auth.uid(), 'read', p_table, p_id, null, p_detail, public.request_ip());
$$;

revoke execute on function public.audit_ops_read(text, text, jsonb) from public, anon, authenticated;
