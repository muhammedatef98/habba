-- 0065 — Push notifications: device tokens and a transactional outbox
--
-- Until now the only way a technician learned about a job was `shift.tsx`
-- polling `list_open_orders_for_provider` every ten seconds, with the app in
-- the foreground. A phone in a pocket received nothing. For an on-demand
-- dispatch business that is not a missing nicety — it is the product not
-- working: §7.1 gives a provider 45 seconds to answer before the search widens
-- past them, and a technician cannot answer a question they were never asked.
--
-- Two decisions shape this file.
--
-- **The outbox, not a poller.** The obvious design is an Edge Function that
-- scans `order_offers` for rows it has not seen. That function would have to
-- keep its own idea of "seen", would double-send whenever two ticks overlap,
-- and would send notifications for offers whose transaction later rolled back.
-- Instead a trigger enqueues a row in the same transaction as the event, so the
-- notification exists exactly when the thing it describes exists. The Edge
-- Function becomes pure transport, the same way `dispatch-tick` is pure
-- transport over `expand_stale_searches()`.
--
-- **The text is rendered here, not there.** The outbox carries the finished
-- Arabic and English strings, for the same reason `enforce_order_transition`
-- builds `v_summary_ar` in SQL: the copy belongs with the event, and what was
-- actually sent to a technician is then on record when they say they were never
-- told (§2.6). The sender needs no copy at all.


-- A single source of truth for the distance ladder -----------------------------
--
-- `list_open_orders_for_provider` had this CASE inline. The job-offer
-- notification needs the same words, and two copies of a ladder is a ladder
-- that drifts: a retune would leave the notification saying «أقل من ٢ كم» while
-- the list the technician opens says «٢–٥ كم», which reads as a bug in the
-- distance rather than in the copy.
--
-- Buckets, never metres — exact distances from several fixes allow
-- trilateration of the customer's position (ADR-0013).
create or replace function public.distance_bucket_ar(p_metres double precision)
returns text
language sql
immutable
parallel safe
as $$
  select case
    when p_metres is null   then 'قريب منك'
    when p_metres < 2000    then 'أقل من ٢ كم'
    when p_metres < 5000    then '٢–٥ كم'
    when p_metres < 10000   then '٥–١٠ كم'
    else 'أكثر من ١٠ كم'
  end;
$$;

create or replace function public.distance_bucket_en(p_metres double precision)
returns text
language sql
immutable
parallel safe
as $$
  select case
    when p_metres is null   then 'nearby'
    when p_metres < 2000    then 'under 2 km'
    when p_metres < 5000    then '2–5 km'
    when p_metres < 10000   then '5–10 km'
    else 'over 10 km'
  end;
$$;

grant execute on function public.distance_bucket_ar(double precision) to authenticated, service_role;
grant execute on function public.distance_bucket_en(double precision) to authenticated, service_role;


-- Device tokens ---------------------------------------------------------------

create table public.device_push_tokens (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid not null references public.profiles(id) on delete cascade,

  -- Unique across the whole table, not per profile. A token identifies a
  -- DEVICE, and the same device cannot belong to two accounts at once — see
  -- `register_push_token`, where that is the interesting case.
  token        text not null unique,
  platform     text not null check (platform in ('ios', 'android')),

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- Refreshed on every registration, so a token the app has not confirmed in
  -- months is identifiable as probably dead before Expo says so.
  last_seen_at timestamptz not null default now(),

  -- Retirement is a timestamp and a reason, never a DELETE — same rule as
  -- `user_roles` (§5.1.2). "Why did this technician stop getting offers in
  -- March" has to be answerable.
  disabled_at     timestamptz,
  disabled_reason text,

  -- ⚠️ Must agree with `isExpoPushToken` in packages/core/src/push/expo-push.ts.
  -- Rejecting a malformed token at registration rather than on send matters:
  -- stored, it fails in every future batch it lands in, and the cause is a
  -- registration that happened days ago on a device nobody is holding.
  constraint device_push_tokens_expo_shape
    check (token ~ '^Expo(nent)?PushToken\[[^\]]+\]$'),
  constraint device_push_tokens_disabled_has_reason
    check ((disabled_at is null) = (disabled_reason is null))
);

-- The only lookup that matters: live tokens for one recipient.
create index device_push_tokens_active_idx
  on public.device_push_tokens (profile_id)
  where disabled_at is null;

create trigger device_push_tokens_updated_at
  before update on public.device_push_tokens
  for each row execute function public.set_updated_at();

alter table public.device_push_tokens enable row level security;

comment on table public.device_push_tokens is
  'Expo push tokens per device. Writes go through register/unregister only; a token is retired with a reason, never deleted.';

-- Read your own, and nothing else. A token is a capability: anyone holding it
-- can send a notification to that phone, so the list of them is not something
-- one user may enumerate for another.
create policy device_push_tokens_read_own on public.device_push_tokens
  for select to authenticated
  using (profile_id = (select auth.uid()) or public.is_ops());

-- ⚠️ No insert, update or delete policy, deliberately. Every write goes through
-- the definer functions below, which is what lets `register_push_token` reassign
-- a token away from a previous owner — a thing no policy could express safely.


-- The outbox ------------------------------------------------------------------

create type public.notification_kind as enum (
  'job_offer',
  'order_accepted',
  'order_en_route',
  'order_arrived',
  'order_awaiting_approval',
  'order_completed'
);

create table public.notification_outbox (
  id           uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  kind         public.notification_kind not null,

  -- Both languages, resolved against `profiles.preferred_locale` at send time.
  -- Same shape as the timeline's summary_ar/summary_en, and for the same
  -- reason: the row is a record, and a record in one language is half a record.
  title_ar text not null,
  body_ar  text not null,
  title_en text not null,
  body_en  text not null,

  -- Routing for the tap. Strings only — the app reads this on a cold start,
  -- before the router exists.
  data       jsonb not null default '{}'::jsonb,
  channel_id text  not null default 'default',

  -- ⚠️ The most important column here.
  --
  -- A job offer delivered eleven minutes late, when the phone comes back on the
  -- network, is worse than one never delivered: the job is long gone, the
  -- technician drives to a call that was cancelled, and they learn to ignore
  -- the notification. `ttl_seconds` tells Apple and Google to drop it; the
  -- `expires_at` below stops US from sending it in the first place after a tick
  -- was delayed. Both are needed — they cover different halves of the delay.
  ttl_seconds int check (ttl_seconds is null or ttl_seconds > 0),
  expires_at  timestamptz,

  order_id uuid references public.orders(id) on delete cascade,

  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  sent_at    timestamptz,
  failed_at  timestamptz,
  attempts   int  not null default 0,
  last_error text,

  constraint notification_outbox_not_both
    check (sent_at is null or failed_at is null)
);

-- The drain query, and nothing else. Partial so it stays small: the table grows
-- forever and the pending set is almost always near-empty.
create index notification_outbox_pending_idx
  on public.notification_outbox (created_at)
  where sent_at is null and failed_at is null;

create index notification_outbox_order_idx
  on public.notification_outbox (order_id, created_at desc);

alter table public.notification_outbox enable row level security;

comment on table public.notification_outbox is
  'Queued push notifications, enqueued in the same transaction as the event that caused them. Drained by the push-tick Edge Function.';

-- ⚠️ No policy for `authenticated` at all, in any command.
--
-- Not an omission. The outbox holds one row per notification for every user in
-- the system, and a recipient reading their own is worth nothing to them — the
-- notification arrived on their phone. What a read policy WOULD do is create a
-- surface where a mistake in the predicate leaks other people's order activity.
-- Ops reads it through the service role, which leaves a trace.
create policy notification_outbox_read_ops on public.notification_outbox
  for select to authenticated
  using (public.is_ops());


-- Tunables, as functions, like every other one in this schema ------------------

create or replace function public.notification_max_attempts()
returns int language sql immutable parallel safe as $$ select 5 $$;

-- Long enough to ride out a deploy or a brief Expo outage; short enough that a
-- notification never arrives in a world it no longer describes.
create or replace function public.notification_default_ttl()
returns int language sql immutable parallel safe as $$ select 900 $$;

/**
 * How long a claim holds a notification before another tick may take it.
 *
 * ⚠️ `for update skip locked` alone does NOT give this. It stops two ticks
 * racing inside overlapping TRANSACTIONS; it does nothing about the ordinary
 * case, which is a tick that claims a row, commits, and is followed fifteen
 * seconds later by another tick that finds the row still pending and sends it
 * again. Without this lease the first test in suite 38 fails — and in
 * production a technician gets the same job offer every fifteen seconds until
 * the attempt budget runs out.
 *
 * Long enough to cover a slow Expo request; short enough that a sender which
 * died mid-batch — a function timeout, a redeploy — has its rows released
 * rather than stranded pending forever.
 */
create or replace function public.notification_claim_lease()
returns interval language sql immutable parallel safe as $$ select interval '2 minutes' $$;


-- Registration ----------------------------------------------------------------

create or replace function public.register_push_token(p_token text, p_platform text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception 'Sign in before registering for notifications'
      using errcode = 'insufficient_privilege';
  end if;

  if p_platform not in ('ios', 'android') then
    raise exception 'Unsupported platform %', p_platform using errcode = 'check_violation';
  end if;

  if p_token !~ '^Expo(nent)?PushToken\[[^\]]+\]$' then
    raise exception 'Not an Expo push token' using errcode = 'check_violation';
  end if;

  insert into public.device_push_tokens (profile_id, token, platform)
  values (v_actor, p_token, p_platform)
  on conflict (token) do update
    -- ⚠️ `profile_id` is reassigned, and that is the whole reason this is a
    -- function rather than an RLS-guarded upsert.
    --
    -- One phone, two people: a technician signs out and hands the device to a
    -- colleague, or a family shares a handset. Expo returns the SAME token to
    -- whoever is signed in. Without reassignment the row still names the first
    -- person, and THEIR order updates — «الفنّي في الطريق», a completed job,
    -- an approval request — are delivered to a phone someone else is now
    -- holding. The token follows the device; the device follows whoever proved
    -- they are signed in.
    set profile_id      = v_actor,
        platform        = excluded.platform,
        last_seen_at    = now(),
        -- Re-registering revives a token retired on sign-out, or one Expo
        -- reported dead before the app was reinstalled.
        disabled_at     = null,
        disabled_reason = null;
end;
$$;

grant execute on function public.register_push_token(text, text) to authenticated;

create or replace function public.unregister_push_token(p_token text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception 'Not signed in' using errcode = 'insufficient_privilege';
  end if;

  -- Scoped to the caller's own token. A signed-in user must not be able to
  -- silence someone else's phone by guessing a token — which is exactly what
  -- an unscoped version of this would allow, and it would look like a bug in
  -- dispatch rather than an attack.
  update public.device_push_tokens
     set disabled_at = now(), disabled_reason = 'signed_out'
   where token = p_token
     and profile_id = v_actor
     and disabled_at is null;
end;
$$;

grant execute on function public.unregister_push_token(text) to authenticated;

-- Called by the sender when Expo reports a token dead. Service role only: a
-- client that could disable tokens could disable anyone's.
create or replace function public.disable_push_token(p_token text, p_reason text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.device_push_tokens
     set disabled_at = now(), disabled_reason = coalesce(p_reason, 'unknown')
   where token = p_token and disabled_at is null;
$$;

grant execute on function public.disable_push_token(text, text) to service_role;


-- Enqueueing ------------------------------------------------------------------

create or replace function public.enqueue_notification(
  p_recipient_id uuid,
  p_kind         public.notification_kind,
  p_title_ar     text,
  p_body_ar      text,
  p_title_en     text,
  p_body_en      text,
  p_data         jsonb default '{}'::jsonb,
  p_channel_id   text default 'default',
  p_ttl_seconds  int default null,
  p_order_id     uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ttl int := coalesce(p_ttl_seconds, public.notification_default_ttl());
  v_id  uuid;
begin
  -- A recipient who no longer exists is not an error worth failing the parent
  -- transaction for. The order matters more than the notification about it.
  if p_recipient_id is null then return null; end if;

  insert into public.notification_outbox
    (recipient_id, kind, title_ar, body_ar, title_en, body_en,
     data, channel_id, ttl_seconds, expires_at, order_id)
  values
    (p_recipient_id, p_kind, p_title_ar, p_body_ar, p_title_en, p_body_en,
     coalesce(p_data, '{}'::jsonb), p_channel_id, v_ttl,
     now() + make_interval(secs => v_ttl), p_order_id)
  returning id into v_id;

  return v_id;
end;
$$;


-- The job offer ---------------------------------------------------------------

create or replace function public.notify_offer_sent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_provider  record;
  v_order     record;
  v_service   record;
  v_metres    double precision;
  v_payout    numeric(12,2);
  v_price_ar  text;
  v_price_en  text;
  v_bucket_ar text;
  v_bucket_en text;
begin
  select pr.* into v_provider from public.providers pr where pr.id = new.provider_id;
  if v_provider is null or v_provider.owner_profile_id is null then return new; end if;

  select o.* into v_order from public.orders o where o.id = new.order_id;
  select s.* into v_service from public.services s where s.id = v_order.service_id;

  select extensions.st_distance(pl.location, v_order.service_location)
    into v_metres
    from public.provider_locations pl
   where pl.provider_id = new.provider_id;

  v_bucket_ar := public.distance_bucket_ar(v_metres);
  v_bucket_en := public.distance_bucket_en(v_metres);
  v_payout    := coalesce(v_order.quoted_amount, v_service.base_price);

  -- `services.base_price` is null for a quote-only service (0017), and an
  -- unhandled null here renders as an empty string — «بطارية · ٢ كم ·  ريال»,
  -- which reads like a free job. Say what is actually true instead.
  v_price_ar := case
    when v_payout is null then 'حسب العرض'
    else trim(to_char(v_payout, 'FM999999990.00')) || ' ريال'
  end;
  v_price_en := case
    when v_payout is null then 'price on quote'
    else 'SAR ' || trim(to_char(v_payout, 'FM999999990.00'))
  end;

  -- ⚠️ What is NOT in this body is the point.
  --
  -- No address, no district, no customer name, no phone, no free-text problem
  -- description. ADR-0013 keeps all of that out of the API until the job is
  -- accepted, and a notification is the one surface that renders on a LOCKED
  -- screen, face-up on a table, to whoever is standing there. Putting the
  -- pickup address in a push would defeat the entire access model with none of
  -- its checks — and the customer never agreed to it.
  --
  -- What is here is what the technician needs to decide: what the job is, how
  -- far, what it pays.
  perform public.enqueue_notification(
    p_recipient_id => v_provider.owner_profile_id,
    p_kind         => 'job_offer',
    p_title_ar     => 'طلب جديد قريب منك',
    p_body_ar      => format('%s · %s · %s',
                             coalesce(v_service.name_ar, 'خدمة'), v_bucket_ar, v_price_ar),
    p_title_en     => 'A job near you',
    p_body_en      => format('%s · %s · %s',
                             coalesce(v_service.name_en, 'Service'), v_bucket_en, v_price_en),
    p_data         => jsonb_build_object(
                        'kind', 'job_offer',
                        'orderId', new.order_id::text
                      ),
    p_channel_id   => 'job-offers',
    -- Exactly as long as the offer is live. §7.1 widens the search after this
    -- window and `expand_stale_searches` then marks the superseded offers
    -- expired — so a notification that outlived it would be an invitation to
    -- accept a job that is already someone else's.
    p_ttl_seconds  => extract(epoch from public.dispatch_silence_window())::int,
    p_order_id     => new.order_id
  );

  return new;
end;
$$;

create trigger order_offers_notify
  after insert on public.order_offers
  for each row execute function public.notify_offer_sent();


-- The customer's side of the same job -----------------------------------------
--
-- Included here rather than left for later because a dispatch system that
-- notifies only one party is half a system — and because `awaiting_approval` is
-- the one the PROVIDER is waiting on: escrow captures when the customer
-- confirms (ADR-0006, ADR-0008), so a customer who never notices the request is
-- a technician who does not get paid for work they have finished.
create or replace function public.notify_order_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_service  record;
  v_provider record;
  v_name_ar  text;
  v_name_en  text;
begin
  if new.status is not distinct from old.status then return new; end if;
  if new.customer_id is null then return new; end if;

  select s.* into v_service from public.services s where s.id = new.service_id;
  select pr.* into v_provider from public.providers pr where pr.id = new.provider_id;

  v_name_ar := coalesce(v_provider.business_name_ar, 'مقدّم الخدمة');
  v_name_en := coalesce(v_provider.business_name_en, v_provider.business_name_ar, 'Your provider');

  if new.status = 'accepted' then
    perform public.enqueue_notification(
      new.customer_id, 'order_accepted',
      'تم قبول طلبك',
      format('%s قبل طلبك: %s', v_name_ar, coalesce(v_service.name_ar, 'خدمة')),
      'Your request was accepted',
      format('%s accepted your request: %s', v_name_en, coalesce(v_service.name_en, 'service')),
      jsonb_build_object('kind', 'order', 'orderId', new.id::text),
      'default', null, new.id);

  elsif new.status = 'en_route' then
    perform public.enqueue_notification(
      new.customer_id, 'order_en_route',
      'الفنّي في الطريق',
      format('%s في طريقه إليك الآن.', v_name_ar),
      'Your technician is on the way',
      format('%s is on the way to you now.', v_name_en),
      jsonb_build_object('kind', 'order', 'orderId', new.id::text),
      'default', null, new.id);

  elsif new.status = 'arrived' then
    perform public.enqueue_notification(
      new.customer_id, 'order_arrived',
      'الفنّي وصل',
      format('%s في الموقع.', v_name_ar),
      'Your technician has arrived',
      format('%s is at the location.', v_name_en),
      jsonb_build_object('kind', 'order', 'orderId', new.id::text),
      'default', null, new.id);

  elsif new.status = 'awaiting_approval' then
    perform public.enqueue_notification(
      new.customer_id, 'order_awaiting_approval',
      'العمل خلص — راجع واعتمد',
      format('%s أنهى العمل. راجع الصور وأكّد الإنهاء.', v_name_ar),
      'The work is done — review and confirm',
      format('%s has finished. Review the photos and confirm completion.', v_name_en),
      jsonb_build_object('kind', 'order', 'orderId', new.id::text),
      -- The one customer-facing notification that is urgent rather than
      -- informative: nobody is paid until it is acted on.
      'job-offers', null, new.id);

  elsif new.status = 'completed' then
    perform public.enqueue_notification(
      new.customer_id, 'order_completed',
      'تم تسجيل الخدمة في دفتر السيارة',
      coalesce(v_service.name_ar, 'الخدمة') || ' أُضيفت إلى سجل سيارتك.',
      'Recorded in your vehicle logbook',
      coalesce(v_service.name_en, 'The service') || ' has been added to your vehicle''s record.',
      jsonb_build_object('kind', 'order', 'orderId', new.id::text),
      'default', null, new.id);
  end if;

  return new;
end;
$$;

-- ⚠️ AFTER, not BEFORE. `enforce_order_transition` is a BEFORE trigger that can
-- still reject the change — an evidence-less hand-back raises, and a BEFORE
-- notification would already have told the customer the work was finished.
create trigger orders_notify_status
  after update of status on public.orders
  for each row execute function public.notify_order_status();


-- Draining --------------------------------------------------------------------

create or replace function public.claim_notification_batch(p_limit int default 100)
returns table (
  notification_id uuid,
  token           text,
  platform        text,
  title           text,
  body            text,
  data            jsonb,
  channel_id      text,
  ttl_seconds     int
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Anything past its window is retired unsent rather than delivered late. See
  -- the `expires_at` comment: a stale job offer costs more than a missing one.
  -- This pass is also what retires a notification for someone who never
  -- registers a device, which the claim below deliberately never picks up.
  update public.notification_outbox n
     set failed_at = now(), last_error = 'expired before send'
   where n.sent_at is null
     and n.failed_at is null
     and n.expires_at is not null
     and n.expires_at < now();

  return query
  -- ⚠️ `skip locked` is what makes overlapping ticks safe. The tick runs every
  -- fifteen seconds and a slow batch can outlive its slot, so two invocations
  -- WILL overlap in production. Without this they would claim the same rows and
  -- every notification would arrive twice — which, for a job offer, means two
  -- technicians driving to one car.
  with picked as (
    select n.id
      from public.notification_outbox n
     where n.sent_at is null
       and n.failed_at is null
       and n.attempts < public.notification_max_attempts()
       -- The lease. Everything above this line was already true of a row the
       -- previous tick claimed fifteen seconds ago and is still sending.
       and (n.claimed_at is null
            or n.claimed_at < now() - public.notification_claim_lease())
       -- Not claimed at all if there is nowhere to send it. Claiming would burn
       -- an attempt per tick against a person who simply has not registered a
       -- device yet; leaving it pending lets it go out the moment they do, and
       -- the expiry pass above retires it if they never do.
       and exists (
         select 1 from public.device_push_tokens t
          where t.profile_id = n.recipient_id and t.disabled_at is null
       )
     order by n.created_at
     limit greatest(p_limit, 1)
     for update skip locked
  ),
  claimed as (
    update public.notification_outbox n
       set claimed_at = now(), attempts = n.attempts + 1
      from picked
     where n.id = picked.id
    returning n.id, n.recipient_id, n.title_ar, n.body_ar, n.title_en, n.body_en,
              n.data, n.channel_id, n.ttl_seconds
  )
  -- One row per (notification, live device). Someone signed in on a phone and a
  -- tablet gets both, and each token is ticketed separately so one dead device
  -- does not retire the other.
  select
    c.id,
    t.token,
    t.platform,
    case when p.preferred_locale = 'en' then c.title_en else c.title_ar end,
    case when p.preferred_locale = 'en' then c.body_en  else c.body_ar  end,
    c.data,
    c.channel_id,
    c.ttl_seconds
  from claimed c
  join public.profiles p on p.id = c.recipient_id
  join public.device_push_tokens t
    on t.profile_id = c.recipient_id and t.disabled_at is null;
end;
$$;

grant execute on function public.claim_notification_batch(int) to service_role;

create or replace function public.mark_notifications_sent(p_ids uuid[])
returns void
language sql
security definer
set search_path = ''
as $$
  update public.notification_outbox
     set sent_at = now(), last_error = null
   where id = any(coalesce(p_ids, '{}'::uuid[]))
     and sent_at is null
     and failed_at is null;
$$;

grant execute on function public.mark_notifications_sent(uuid[]) to service_role;

create or replace function public.mark_notification_failed(p_id uuid, p_error text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.notification_outbox
     set last_error = p_error,
         -- Retried until the attempt budget is spent, then retired for good so
         -- a permanently broken row cannot occupy every batch forever.
         failed_at = case
           when attempts >= public.notification_max_attempts() then now()
           else null
         end
   where id = p_id and sent_at is null and failed_at is null;
$$;

grant execute on function public.mark_notification_failed(uuid, text) to service_role;


-- Rebuilt to use the shared ladder, so the list and the notification can never
-- disagree about how far away a job is. Body otherwise unchanged from 0021.
create or replace function public.list_open_orders_for_provider()
returns table (
  order_id         uuid,
  service_id       uuid,
  service_name_ar  text,
  fulfilment_mode  fulfilment_mode,
  distance_bucket  text,
  district_name_ar text,
  problem_summary  text,
  has_triage_video boolean,
  estimated_payout numeric(12,2),
  created_at       timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_provider record;
begin
  select p.* into v_provider
  from public.providers p
  where p.owner_profile_id = auth.uid();

  if v_provider is null then
    raise exception 'Not a provider' using errcode = 'insufficient_privilege';
  end if;

  if v_provider.verification_status <> 'approved' or not v_provider.is_online then
    return;
  end if;

  return query
  select
    o.id,
    o.service_id,
    s.name_ar,
    o.fulfilment_mode,
    public.distance_bucket_ar(extensions.st_distance(pl.location, o.service_location)),
    c.name_ar,
    left(coalesce(o.problem_description, ''), 60),
    jsonb_array_length(coalesce(o.triage_media, '[]'::jsonb)) > 0,
    coalesce(o.quoted_amount, s.base_price),
    o.created_at
  from public.orders o
  join public.services s on s.id = o.service_id
  join public.provider_locations pl on pl.provider_id = v_provider.id
  join public.provider_services ps
    on ps.provider_id = v_provider.id and ps.service_id = o.service_id
  left join public.cities c on c.id = v_provider.city_id
  where o.status = 'searching'
    and o.provider_id is null
    and extensions.st_dwithin(pl.location, o.service_location, 25000)
  order by o.created_at;
end;
$$;

grant execute on function public.list_open_orders_for_provider() to authenticated;
