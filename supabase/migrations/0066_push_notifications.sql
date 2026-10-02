-- 0066 — Push notifications: the app reaches people when it is closed
--
-- Until now nothing left the server unless someone was looking. A technician
-- saw a new emergency only while the shift screen was open and polling; a
-- customer learned their technician had arrived only by staring at the
-- tracking screen; the care reminders of 0062 were recorded and never sent.
-- The stack names the channel (Expo Push → FCM/APNs, CLAUDE.md §3); this is
-- the server half of it.
--
-- Same split as dispatch (0051): every rule — who is told what, when, and
-- for how long it is still worth telling them — lives here, in SQL, where it
-- is tested. The `push-tick` Edge Function is transport: it claims what is
-- due, hands it to Expo, and reports back.
--
--   push_devices          where a person can be reached (their tokens)
--   notification_outbox   what they should be told, written by triggers
--   claim / record        the sender's two calls, service role only


-- ---------------------------------------------------------------------------
-- push_devices
-- ---------------------------------------------------------------------------
create table public.push_devices (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  -- One row per token, not per person: a token identifies an install, and an
  -- install is signed in as one person at a time.
  token        text not null unique,
  platform     text not null check (platform in ('ios', 'android')),
  -- The language the phone should be spoken to in, as the app last knew it.
  locale       text not null default 'ar' check (locale in ('ar', 'en')),
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  -- Set when Expo reports the install gone (uninstalled, token revoked).
  -- Kept rather than deleted so a burst of failures is diagnosable.
  disabled_at  timestamptz,

  -- An Expo push token, and nothing else: this column is handed verbatim to a
  -- third-party API by the sender.
  constraint push_devices_token_format check (
    token ~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]{10,}\]$'
  )
);

create index push_devices_user_idx on public.push_devices (user_id) where disabled_at is null;

alter table public.push_devices enable row level security;

-- Read your own, for "is this phone registered". Written only through the
-- functions below, so there is no write policy at all.
create policy push_devices_read_own on public.push_devices
  for select to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.push_devices from anon;
revoke insert, update, delete on public.push_devices from authenticated;


-- Registers this phone for the signed-in person.
--
-- If the token is already on file for somebody else, it MOVES. The phone
-- belongs to whoever is signed in on it now: a technician who signs out and
-- hands the phone to their brother, who signs in, must stop receiving the
-- technician's job offers on it immediately — not after the next token
-- rotation.
create or replace function public.register_push_device(
  p_token    text,
  p_platform text,
  p_locale   text default 'ar'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = 'insufficient_privilege';
  end if;

  insert into public.push_devices (user_id, token, platform, locale)
  values (auth.uid(), p_token, p_platform, coalesce(p_locale, 'ar'))
  on conflict (token) do update
    set user_id      = excluded.user_id,
        platform     = excluded.platform,
        locale       = excluded.locale,
        last_seen_at = now(),
        disabled_at  = null;
end;
$$;

-- Sign-out. Only your own: a token is not a secret, and knowing someone
-- else's must not let you silence their phone.
create or replace function public.unregister_push_device(p_token text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.push_devices
   where token = p_token and user_id = (select auth.uid());
$$;

revoke execute on function public.register_push_device(text, text, text) from public, anon;
revoke execute on function public.unregister_push_device(text) from public, anon;
grant execute on function public.register_push_device(text, text, text) to authenticated;
grant execute on function public.unregister_push_device(text) to authenticated;


-- ---------------------------------------------------------------------------
-- notification_outbox
-- ---------------------------------------------------------------------------
create table public.notification_outbox (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  kind         text not null,
  title_ar     text not null,
  title_en     text not null,
  body_ar      text not null,
  body_en      text not null,
  -- Where a tap should land: {"route": "/tracking", "id": "<order>"}.
  data         jsonb not null default '{}'::jsonb,

  -- Written by triggers that can fire more than once for the same fact (a
  -- re-broadcast, a retried transition). One notification per fact.
  dedupe_key   text not null unique,

  created_at   timestamptz not null default now(),
  -- Past this, telling them is worse than not: "your technician is on the
  -- way", three hours late, is a lie with a timestamp. See notification_ttl().
  expires_at   timestamptz not null,

  -- The sender's lease. A claim holds a row for two minutes; a tick that dies
  -- mid-send releases it by expiry rather than leaving it stuck.
  claimed_at   timestamptz,
  attempts     int not null default 0,
  sent_at      timestamptz,
  -- Given up: expired, out of attempts, or nobody to deliver to.
  abandoned_at timestamptz,
  last_error   text,

  constraint notification_outbox_data_is_object check (jsonb_typeof(data) = 'object')
);

create index notification_outbox_due_idx
  on public.notification_outbox (created_at)
  where sent_at is null and abandoned_at is null;

-- Nobody reads or writes this from a client. It is the sender's queue, and it
-- says what everyone is being told — including other people.
alter table public.notification_outbox enable row level security;
revoke all on public.notification_outbox from anon, authenticated;

comment on table public.notification_outbox is
  'What each person should be told. Written by triggers, drained by push-tick through claim/record. No client access. 0066.';


-- How long each kind is worth delivering.
create or replace function public.notification_ttl(p_kind text)
returns interval
language sql
immutable
as $$
  select case
    -- An offer is a race decided in seconds; one that arrives after someone
    -- else has taken the job only teaches the technician to ignore offers.
    when p_kind = 'job_offer' then interval '5 minutes'
    -- A booking lands on a schedule that is days away.
    when p_kind = 'booking_confirmed' then interval '12 hours'
    when p_kind = 'care_reminder' then interval '12 hours'
    else interval '30 minutes'
  end;
$$;

create or replace function public.enqueue_notification(
  p_user_id   uuid,
  p_kind      text,
  p_title_ar  text,
  p_title_en  text,
  p_body_ar   text,
  p_body_en   text,
  p_data      jsonb,
  p_dedupe    text
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notification_outbox
    (user_id, kind, title_ar, title_en, body_ar, body_en, data, dedupe_key, expires_at)
  values
    (p_user_id, p_kind, p_title_ar, p_title_en, p_body_ar, p_body_en,
     coalesce(p_data, '{}'::jsonb), p_dedupe, now() + public.notification_ttl(p_kind))
  on conflict (dedupe_key) do nothing;
$$;

-- Server-side only. A client that could enqueue could send any text to anyone.
revoke execute on function public.enqueue_notification(uuid, text, text, text, text, text, jsonb, text)
  from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- What each event says, and to whom
-- ---------------------------------------------------------------------------

-- A job offer, to the technician it was offered to.
create or replace function public.notify_job_offer()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner   uuid;
  v_service record;
begin
  select pr.owner_profile_id into v_owner from public.providers pr where pr.id = new.provider_id;
  select s.name_ar, s.name_en into v_service
    from public.orders o join public.services s on s.id = o.service_id
   where o.id = new.order_id;

  if v_owner is null then
    return new;
  end if;

  perform public.enqueue_notification(
    v_owner, 'job_offer',
    'طلب جديد قريب منك',
    'New request near you',
    format('%s — افتحه لترى المسافة والأجر.', v_service.name_ar),
    format('%s — open it to see the distance and pay.', v_service.name_en),
    jsonb_build_object('route', '/job', 'id', new.order_id),
    format('offer:%s:%s', new.order_id, new.provider_id)
  );
  return new;
end;
$$;

create trigger order_offers_notify
  after insert on public.order_offers
  for each row execute function public.notify_job_offer();


-- Order progress, to whichever side did not cause it.
create or replace function public.notify_order_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor    uuid := auth.uid();
  v_service  record;
  v_provider record;
  v_track    jsonb := jsonb_build_object('route', '/tracking', 'id', new.id);
  v_job      jsonb := jsonb_build_object('route', '/job', 'id', new.id);
  v_key      text := format('order:%s:%s', new.id, new.status);
  v_name_ar  text;
  v_name_en  text;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  select s.name_ar, s.name_en into v_service from public.services s where s.id = new.service_id;
  select pr.owner_profile_id, pr.business_name_ar, coalesce(pr.business_name_en, pr.business_name_ar) as business_name_en
    into v_provider
    from public.providers pr where pr.id = new.provider_id;

  v_name_ar := coalesce(v_provider.business_name_ar, 'الفنّي');
  v_name_en := coalesce(v_provider.business_name_en, 'Your technician');

  -- A booking just confirmed: it is the PROVIDER who needs to know, and the
  -- customer is the one who just confirmed it.
  if new.status = 'accepted' and new.fulfilment_mode <> 'mobile_ondemand' then
    if v_provider.owner_profile_id is not null then
      perform public.enqueue_notification(
        v_provider.owner_profile_id, 'booking_confirmed',
        format('حجز جديد: %s', v_service.name_ar),
        format('New booking: %s', v_service.name_en),
        format('الموعد %s بتوقيت الرياض.',
               to_char(new.scheduled_for at time zone 'Asia/Riyadh', 'YYYY-MM-DD HH24:MI')),
        format('Appointment %s, Riyadh time.',
               to_char(new.scheduled_for at time zone 'Asia/Riyadh', 'YYYY-MM-DD HH24:MI')),
        v_job, v_key);
    end if;
    return new;
  end if;

  -- What the customer is waiting to hear. Each is something they would
  -- otherwise have had to keep the tracking screen open to find out.
  if new.status in ('accepted', 'en_route', 'arrived', 'checked_in', 'awaiting_approval')
     and v_actor is distinct from new.customer_id then
    perform public.enqueue_notification(
      new.customer_id, 'order_' || new.status::text,
      case new.status
        when 'accepted'          then 'تم قبول طلبك'
        when 'en_route'          then 'الفنّي في الطريق إليك'
        when 'arrived'           then 'وصل الفنّي'
        when 'checked_in'        then 'استلمت الورشة سيارتك'
        when 'awaiting_approval' then 'انتهى العمل — راجعه واعتمده'
      end,
      case new.status
        when 'accepted'          then 'Your request was accepted'
        when 'en_route'          then 'Your technician is on the way'
        when 'arrived'           then 'Your technician has arrived'
        when 'checked_in'        then 'The workshop has your car'
        when 'awaiting_approval' then 'The work is done — review and approve'
      end,
      case new.status
        when 'accepted'          then format('%s قبل طلبك وسيتوجّه إليك قريباً.', v_name_ar)
        when 'en_route'          then format('%s في الطريق. تابع وصوله من التطبيق.', v_name_ar)
        when 'arrived'           then format('%s عند سيارتك الآن.', v_name_ar)
        when 'checked_in'        then format('%s: سنُعلمك عند انتهاء العمل.', v_service.name_ar)
        when 'awaiting_approval' then 'راجع الصور والفاتورة، ثم اعتمد لإنهاء الطلب.'
      end,
      case new.status
        when 'accepted'          then format('%s accepted your request and will head to you shortly.', v_name_en)
        when 'en_route'          then format('%s is on the way. Follow them in the app.', v_name_en)
        when 'arrived'           then format('%s is at your car now.', v_name_en)
        when 'checked_in'        then format('%s: we will tell you when the work is done.', v_service.name_en)
        when 'awaiting_approval' then 'Review the photos and the bill, then approve to close the job.'
      end,
      v_track, v_key);
    return new;
  end if;

  -- What the provider is waiting to hear.
  if new.status = 'completed' and v_provider.owner_profile_id is not null
     and v_actor is distinct from v_provider.owner_profile_id then
    perform public.enqueue_notification(
      v_provider.owner_profile_id, 'order_completed',
      'اعتمد العميل العمل',
      'The customer approved the work',
      format('%s مكتمل. شكراً لك.', v_service.name_ar),
      format('%s is complete. Thank you.', v_service.name_en),
      v_job, v_key);
    return new;
  end if;

  -- A cancellation, to whoever did not cancel.
  if new.status = 'cancelled' then
    if v_provider.owner_profile_id is not null
       and v_actor is distinct from v_provider.owner_profile_id then
      perform public.enqueue_notification(
        v_provider.owner_profile_id, 'order_cancelled',
        'أُلغي الطلب', 'The job was cancelled',
        format('ألغى العميل طلب %s.', v_service.name_ar),
        format('The customer cancelled %s.', v_service.name_en),
        jsonb_build_object('route', '/'), v_key || ':provider');
    end if;
    if v_actor is distinct from new.customer_id then
      perform public.enqueue_notification(
        new.customer_id, 'order_cancelled',
        'أُلغي طلبك', 'Your request was cancelled',
        format('أُلغي طلب %s. لم يُخصم منك شيء.', v_service.name_ar),
        format('Your %s request was cancelled. You were not charged.', v_service.name_en),
        v_track, v_key || ':customer');
    end if;
  end if;

  return new;
end;
$$;

create trigger orders_notify_status
  after update of status on public.orders
  for each row execute function public.notify_order_status();


-- A parts quote waiting on the customer — work stops until they answer.
create or replace function public.notify_parts_quote()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer uuid;
begin
  if new.approved_by_customer then
    return new;
  end if;

  select o.customer_id into v_customer from public.orders o where o.id = new.order_id;

  perform public.enqueue_notification(
    v_customer, 'parts_quote',
    'قطعة غيار بانتظار موافقتك',
    'A part is waiting for your approval',
    format('%s — راجع السعر ووافق قبل التركيب.', new.name_ar),
    format('%s — review the price and approve before it is fitted.', new.name_ar),
    jsonb_build_object('route', '/quote', 'id', new.order_id),
    format('part:%s', new.id));
  return new;
end;
$$;

create trigger order_parts_notify
  after insert on public.order_parts
  for each row execute function public.notify_parts_quote();


-- The care reminders 0062 has been recording, finally delivered. The row
-- already carries its own words and already passed the daily cap, the repeat
-- window and the snooze — this only carries it to the phone.
create or replace function public.notify_care_reminder()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.enqueue_notification(
    new.user_id, 'care_reminder',
    new.title_ar, new.title_en, new.body_ar, new.body_en,
    jsonb_build_object('route', '/vehicles', 'vehicleId', new.vehicle_id),
    format('reminder:%s', new.id));
  return new;
end;
$$;

create trigger vehicle_reminders_notify
  after insert on public.vehicle_reminders
  for each row execute function public.notify_care_reminder();


-- ---------------------------------------------------------------------------
-- The sender's two calls
-- ---------------------------------------------------------------------------

-- Claims what is due and returns one row per (notification, device), already
-- in the device's language. Leased for two minutes, `skip locked`, so two
-- ticks running at once split the queue rather than both sending it.
--
-- Settles, without sending, what is no longer worth sending: expired rows,
-- and rows for someone with no working device — held back, "your technician
-- arrived" would be delivered the next time they install the app.
create or replace function public.claim_push_notifications(p_limit int default 100)
returns table (
  notification_id uuid,
  kind            text,
  token           text,
  title           text,
  body            text,
  data            jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.notification_outbox n
     set abandoned_at = now(),
         last_error = case when n.expires_at <= now() then 'expired' else 'no_device' end
   where n.sent_at is null
     and n.abandoned_at is null
     and (n.expires_at <= now()
          or not exists (select 1 from public.push_devices d
                          where d.user_id = n.user_id and d.disabled_at is null));

  return query
  with due as (
    select n.id
      from public.notification_outbox n
     where n.sent_at is null
       and n.abandoned_at is null
       and (n.claimed_at is null or n.claimed_at < now() - interval '2 minutes')
     order by n.created_at
     limit greatest(1, least(p_limit, 500))
       for update skip locked
  ),
  claimed as (
    update public.notification_outbox n
       set claimed_at = now(),
           attempts = n.attempts + 1
      from due
     where n.id = due.id
    returning n.*
  )
  select c.id, c.kind, d.token,
         case when d.locale = 'en' then c.title_en else c.title_ar end,
         case when d.locale = 'en' then c.body_en else c.body_ar end,
         c.data
    from claimed c
    join public.push_devices d on d.user_id = c.user_id and d.disabled_at is null;
end;
$$;

-- Reports back. `p_sent` reached at least one device; `p_retry` failed for a
-- reason worth trying again (released now, abandoned after five attempts);
-- `p_dead_tokens` are installs Expo says are gone.
create or replace function public.record_push_results(
  p_sent        uuid[],
  p_retry       uuid[],
  p_dead_tokens text[],
  p_error       text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.notification_outbox
     set sent_at = now(), claimed_at = null, last_error = null
   where id = any(coalesce(p_sent, '{}'));

  update public.notification_outbox
     set claimed_at = null,
         last_error = coalesce(p_error, 'retry'),
         abandoned_at = case when attempts >= 5 then now() end
   where id = any(coalesce(p_retry, '{}'))
     and sent_at is null;

  update public.push_devices
     set disabled_at = now()
   where token = any(coalesce(p_dead_tokens, '{}'))
     and disabled_at is null;
end;
$$;

revoke execute on function public.claim_push_notifications(int) from public, anon, authenticated;
revoke execute on function public.record_push_results(uuid[], uuid[], text[], text) from public, anon, authenticated;
grant execute on function public.claim_push_notifications(int) to service_role;
grant execute on function public.record_push_results(uuid[], uuid[], text[], text) to service_role;
