-- 38 — Push notifications: tokens and the outbox
--
-- Companion to 0065. The notification is how work reaches a technician, so the
-- assertions here are about the three ways this quietly goes wrong:
-- a notification that leaks what ADR-0013 withholds, a notification sent twice
-- because two ticks overlapped, and a notification delivered to the wrong
-- person because one phone had two owners.

\echo '── push notifications'

begin;

insert into auth.users (id, phone) values
  ('11111111-0000-4000-f000-000000000001', '+966508000001'),  -- customer
  ('22222222-0000-4000-f000-000000000002', '+966508000002'),  -- technician
  ('33333333-0000-4000-f000-000000000003', '+966508000003');  -- the next person on that phone

insert into public.profiles (id, full_name, phone, preferred_locale) values
  ('11111111-0000-4000-f000-000000000001', 'العميل', '+966508000001', 'ar'),
  ('22222222-0000-4000-f000-000000000002', 'الفنّي', '+966508000002', 'ar'),
  ('33333333-0000-4000-f000-000000000003', 'زميله',  '+966508000003', 'en');

select test.grant_role('22222222-0000-4000-f000-000000000002', 'technician');

insert into public.cities (id, name_ar, name_en, region_ar, region_en, centroid) values
  ('c0000000-0000-4000-f000-000000000001', 'الدمام', 'DammamPush', 'الشرقية', 'Eastern',
   extensions.st_point(50.1033, 26.4207)::extensions.geography);

insert into public.vehicle_makes (id, name_ar, name_en) values
  ('a0000000-0000-4000-f000-000000000001', 'ماركة دفع', 'TestMakePush');
insert into public.vehicle_models (id, make_id, name_ar, name_en, year_from) values
  ('b0000000-0000-4000-f000-000000000001', 'a0000000-0000-4000-f000-000000000001',
   'موديل دفع', 'TestModelPush', 2015);
insert into public.vehicles (id, owner_id, make_id, model_id, year, plate_en, current_mileage) values
  ('d0000000-0000-4000-f000-000000000001', '11111111-0000-4000-f000-000000000001',
   'a0000000-0000-4000-f000-000000000001', 'b0000000-0000-4000-f000-000000000001',
   2020, 'ABJ 9999', 70000);

insert into public.providers
  (id, owner_profile_id, provider_type, business_name_ar, business_name_en,
   verification_status, is_online, city_id)
values
  ('e0000000-0000-4000-f000-000000000001', '22222222-0000-4000-f000-000000000002',
   'individual', 'ونش الشرقية', 'Eastern Recovery', 'approved', true,
   'c0000000-0000-4000-f000-000000000001');

select id as svc_battery from public.services where name_en = 'Battery jump or replacement' \gset

insert into public.provider_services (provider_id, service_id) values
  ('e0000000-0000-4000-f000-000000000001', :'svc_battery');


-- Token registration ----------------------------------------------------------
set role authenticated;
select test.become('22222222-0000-4000-f000-000000000002');

select test.assert_raises(
  $$select public.register_push_token('not-an-expo-token', 'ios')$$,
  'a token that is not an Expo token is refused at registration, not on send',
  '23514');

select test.assert_raises(
  $$select public.register_push_token('ExponentPushToken[tech-phone]', 'windows')$$,
  'an unknown platform is refused',
  '23514');

select public.register_push_token('ExponentPushToken[tech-phone]', 'ios');

select test.assert_eq(
  (select count(*)::int from public.device_push_tokens
    where profile_id = '22222222-0000-4000-f000-000000000002' and disabled_at is null),
  1,
  'the technician registers their phone');

-- Idempotent: the app registers on every launch.
select public.register_push_token('ExponentPushToken[tech-phone]', 'ios');
select test.assert_eq(
  (select count(*)::int from public.device_push_tokens),
  1,
  're-registering the same device does not create a second row');

reset role;


-- A job offer notifies, and says only what it may -----------------------------
set role authenticated;
select test.become('11111111-0000-4000-f000-000000000001');

insert into public.orders
  (id, customer_id, vehicle_id, service_id, fulfilment_mode, service_location,
   service_address_ar, problem_description, quoted_amount, created_by)
values
  ('f0000000-0000-4000-f000-000000000001',
   '11111111-0000-4000-f000-000000000001', 'd0000000-0000-4000-f000-000000000001',
   :'svc_battery', 'mobile_ondemand',
   extensions.st_point(50.105, 26.422)::extensions.geography,
   'حي الفيصلية، شارع ١٢، فيلا ٧', 'السيارة ما تشتغل وجوالي 0501234567', 120,
   '11111111-0000-4000-f000-000000000001');

reset role;

insert into public.order_offers (order_id, provider_id, round, radius_m)
values ('f0000000-0000-4000-f000-000000000001',
        'e0000000-0000-4000-f000-000000000001', 1, 8000);

select test.assert_eq(
  (select count(*)::int from public.notification_outbox
    where kind = 'job_offer'
      and recipient_id = '22222222-0000-4000-f000-000000000002'),
  1,
  'sending an offer enqueues a notification for that provider, in the same transaction');

-- ⚠️ The assertion that matters most in this file.
--
-- A notification renders on a LOCKED screen, face-up on a table, to whoever is
-- standing there. ADR-0013 keeps the address out of the API until the job is
-- accepted; putting it in a push would route around the whole access model with
-- none of its checks, and the customer never agreed to it.
select test.assert(
  not exists (
    select 1 from public.notification_outbox n
     where n.kind = 'job_offer'
       and (n.body_ar like '%الفيصلية%' or n.body_ar like '%فيلا%'
         or n.body_ar like '%0501234567%' or n.body_ar like '%ما تشتغل%'
         or n.body_en like '%Faisaliyah%' or n.body_en like '%0501234567%')
  ),
  'the offer notification carries no address, no phone and no problem text');

select test.assert(
  exists (
    select 1 from public.notification_outbox n
     where n.kind = 'job_offer' and n.body_ar like '%120.00%'
  ),
  'it does carry what the technician decides on: the pay');

select test.assert(
  exists (
    select 1 from public.notification_outbox n
     where n.kind = 'job_offer' and n.channel_id = 'job-offers'
  ),
  'and it uses the channel that survives Do Not Disturb');

-- §7.1 widens the search after the silence window and expires the superseded
-- offers, so a notification that outlived it would invite a technician to
-- accept a job that is already someone else's.
select test.assert_eq(
  (select ttl_seconds from public.notification_outbox where kind = 'job_offer'),
  extract(epoch from public.dispatch_silence_window())::int,
  'the offer notification dies exactly when the offer does');

-- No second row for the same offer: `broadcast_order` re-runs every round.
insert into public.order_offers (order_id, provider_id, round, radius_m)
values ('f0000000-0000-4000-f000-000000000001',
        'e0000000-0000-4000-f000-000000000001', 2, 15000)
on conflict (order_id, provider_id) do nothing;

select test.assert_eq(
  (select count(*)::int from public.notification_outbox where kind = 'job_offer'),
  1,
  'a re-broadcast to an already-offered provider notifies nothing — the offer row is unchanged');


-- Draining, and the thing that makes overlapping ticks safe --------------------
reset role;

select test.assert_eq(
  (select count(*)::int from public.claim_notification_batch(100)),
  1,
  'the first tick claims the notification');

-- ⚠️ The assertion that found the bug this lease exists for.
--
-- `for update skip locked` stops two ticks racing inside overlapping
-- TRANSACTIONS. It does nothing about the ordinary case: a tick claims a row,
-- commits, and the next tick fifteen seconds later finds it still pending. The
-- first version of this function had exactly that hole, and in production it
-- would have meant the same job offer arriving every fifteen seconds — or two
-- technicians driving to one car.
select test.assert_eq(
  (select count(*)::int from public.claim_notification_batch(100)),
  0,
  'a second tick claims nothing: a claimed notification is not offered twice');

-- The other half of the lease. A sender that died mid-batch — a function
-- timeout, a redeploy — must not strand the row pending forever, so the claim
-- is released rather than permanent.
update public.notification_outbox
   set claimed_at = now() - public.notification_claim_lease() - interval '1 second'
 where kind = 'job_offer';

select test.assert_eq(
  (select count(*)::int from public.claim_notification_batch(100)),
  1,
  'once the lease expires the notification is retried — a crashed sender loses nothing');

select public.mark_notifications_sent(array(
  select id from public.notification_outbox where kind = 'job_offer'));

select test.assert_eq(
  (select count(*)::int from public.claim_notification_batch(100)),
  0,
  'and a sent notification is never claimed again');


-- Language follows the recipient ----------------------------------------------
select public.enqueue_notification(
  '33333333-0000-4000-f000-000000000003', 'order_completed',
  'عربي', 'نص عربي', 'English', 'English body');

set role authenticated;
select test.become('33333333-0000-4000-f000-000000000003');
select public.register_push_token('ExponentPushToken[colleague-phone]', 'android');
reset role;

select test.assert_eq(
  (select title from public.claim_notification_batch(100)
    where token = 'ExponentPushToken[colleague-phone]'),
  'English',
  'a recipient whose preferred_locale is en is sent English');


-- One phone, two people --------------------------------------------------------
-- The technician signs out and hands the device over. Expo returns the SAME
-- token to whoever is signed in, so without reassignment the row still names
-- the first person and THEIR order updates are delivered to a phone someone
-- else is holding.
set role authenticated;
select test.become('33333333-0000-4000-f000-000000000003');
select public.register_push_token('ExponentPushToken[tech-phone]', 'ios');
reset role;

select test.assert_eq(
  (select profile_id from public.device_push_tokens
    where token = 'ExponentPushToken[tech-phone]'),
  '33333333-0000-4000-f000-000000000003'::uuid,
  'the token follows the device, and the device follows whoever is signed in');

select test.assert_eq(
  (select count(*)::int from public.device_push_tokens
    where profile_id = '22222222-0000-4000-f000-000000000002' and disabled_at is null),
  0,
  'and the previous owner keeps none of it');


-- A token is retired, never deleted --------------------------------------------
select public.disable_push_token('ExponentPushToken[colleague-phone]', 'device_not_registered');

select test.assert_eq(
  (select disabled_reason from public.device_push_tokens
    where token = 'ExponentPushToken[colleague-phone]'),
  'device_not_registered',
  'a dead device is retired with a reason — "why did they stop getting offers in March" is answerable');

select test.assert(
  exists (select 1 from public.device_push_tokens
           where token = 'ExponentPushToken[colleague-phone]'),
  'and the row is still there: retirement is a timestamp, like user_roles');

-- Re-registering revives it, which is what a reinstall looks like.
set role authenticated;
select test.become('33333333-0000-4000-f000-000000000003');
select public.register_push_token('ExponentPushToken[colleague-phone]', 'android');
reset role;

select test.assert(
  (select disabled_at from public.device_push_tokens
    where token = 'ExponentPushToken[colleague-phone]') is null,
  'reinstalling revives the token rather than stranding the person');


-- Nobody silences anybody else --------------------------------------------------
set role authenticated;
select test.become('22222222-0000-4000-f000-000000000002');

select public.unregister_push_token('ExponentPushToken[colleague-phone]');

select test.assert(
  (select disabled_at from public.device_push_tokens
    where token = 'ExponentPushToken[colleague-phone]') is null,
  'a signed-in user cannot retire a token that is not theirs — that would be a way to silence a competitor');

-- Zero, not two. This technician handed their phone over a few lines ago, so
-- they now own no device at all — and the read policy is `profile_id =
-- auth.uid()`, not "everything". A token is a capability: anyone holding one
-- can send a notification to that phone, so the list is not something one user
-- may enumerate for another.
select test.assert_eq(
  (select count(*)::int from public.device_push_tokens),
  0,
  'and they cannot enumerate other people''s devices — RLS shows only their own, which is now none');

reset role;


-- Expiry, not late delivery -----------------------------------------------------
-- A job offer delivered eleven minutes late is worse than one never delivered:
-- the job is gone and the technician drives to a cancelled call.
select public.enqueue_notification(
  '33333333-0000-4000-f000-000000000003', 'job_offer',
  'قديم', 'نص', 'Stale', 'body', '{}'::jsonb, 'job-offers', 60);

update public.notification_outbox
   set expires_at = now() - interval '1 minute'
 where title_ar = 'قديم';

select test.assert_eq(
  (select count(*)::int from public.claim_notification_batch(100) where title = 'Stale'),
  0,
  'an expired notification is never sent');

select test.assert_eq(
  (select last_error from public.notification_outbox where title_ar = 'قديم'),
  'expired before send',
  'it is retired with a reason rather than left in the queue forever');


-- The customer hears about their own job ----------------------------------------
-- `awaiting_approval` is the one the PROVIDER is waiting on: escrow captures
-- when the customer confirms, so a customer who never notices is a technician
-- who is not paid for finished work.
-- Assigning the provider is not the customer's to do (guard_order_columns), and
-- authorising the escrow is not anyone else's — so the two happen under
-- different roles.
update public.orders set provider_id = 'e0000000-0000-4000-f000-000000000001'
 where id = 'f0000000-0000-4000-f000-000000000001';

set role authenticated;
select test.become('11111111-0000-4000-f000-000000000001');

update public.orders set status = 'searching'
 where id = 'f0000000-0000-4000-f000-000000000001';
update public.orders set status = 'quoted'
 where id = 'f0000000-0000-4000-f000-000000000001';
select public.authorise_order_payment('f0000000-0000-4000-f000-000000000001', 'push_1');
update public.orders set status = 'accepted'
 where id = 'f0000000-0000-4000-f000-000000000001';

reset role;

select test.assert_eq(
  (select count(*)::int from public.notification_outbox
    where kind = 'order_accepted'
      and recipient_id = '11111111-0000-4000-f000-000000000001'),
  1,
  'the customer is told their request was accepted');

select test.assert(
  exists (select 1 from public.notification_outbox
           where kind = 'order_accepted' and body_ar like '%ونش الشرقية%'),
  'and told who by — they are about to meet them');

-- From `en_route` on, the PROVIDER acts. `guard_order_columns` (0033) refuses a
-- customer the evidence columns entirely, which is a separate guard from the
-- evidence requirement itself and the reason the role changes here.
set role authenticated;
select test.become('22222222-0000-4000-f000-000000000002');

update public.orders set status = 'en_route'
 where id = 'f0000000-0000-4000-f000-000000000001';
update public.orders set status = 'arrived'
 where id = 'f0000000-0000-4000-f000-000000000001';
update public.orders set status = 'in_progress'
 where id = 'f0000000-0000-4000-f000-000000000001';

select public.record_completion_evidence(
  'f0000000-0000-4000-f000-000000000001', 71000,
  '[{"url":"x/b.jpg","kind":"before"},{"url":"x/a.jpg","kind":"after"}]'::jsonb);

update public.orders set status = 'awaiting_approval'
 where id = 'f0000000-0000-4000-f000-000000000001';

reset role;

select test.assert_eq(
  (select channel_id from public.notification_outbox where kind = 'order_awaiting_approval'),
  'job-offers',
  'the approval request is urgent, not informative: nobody is paid until it is acted on');


-- The outbox is not readable by the people in it --------------------------------
set role authenticated;
select test.become('11111111-0000-4000-f000-000000000001');

select test.assert_eq(
  (select count(*)::int from public.notification_outbox),
  0,
  'a customer cannot read the outbox — not even their own rows; the notification already arrived on their phone');

select test.become('22222222-0000-4000-f000-000000000002');
select test.assert_eq(
  (select count(*)::int from public.notification_outbox),
  0,
  'and neither can a provider');

reset role;

rollback;
