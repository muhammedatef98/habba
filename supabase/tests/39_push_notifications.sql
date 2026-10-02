-- 39 — Push notifications: who is told what, and that nobody else can be
--
-- Companion to 0066.

\echo '── push notifications'

begin;

insert into auth.users (id, phone) values
  ('11111111-0000-4000-e900-000000000001', '+966509100001'),  -- customer
  ('22222222-0000-4000-e900-000000000002', '+966509100002'),  -- technician
  ('33333333-0000-4000-e900-000000000003', '+966509100003'),  -- workshop owner
  ('44444444-0000-4000-e900-000000000004', '+966509100004');  -- someone else

insert into public.profiles (id, full_name, phone) values
  ('11111111-0000-4000-e900-000000000001', 'العميل', '+966509100001'),
  ('22222222-0000-4000-e900-000000000002', 'الفنّي', '+966509100002'),
  ('33333333-0000-4000-e900-000000000003', 'الورشة', '+966509100003'),
  ('44444444-0000-4000-e900-000000000004', 'آخر', '+966509100004');

insert into public.cities (id, name_ar, name_en, region_ar, region_en, centroid) values
  ('c0000000-0000-4000-e900-000000000001', 'الدمام', 'DammamPush', 'الشرقية', 'Eastern',
   extensions.st_point(50.1033, 26.4207)::extensions.geography);

insert into public.vehicle_makes (id, name_ar, name_en) values
  ('a0000000-0000-4000-e900-000000000001', 'ماركة', 'TestMakePush');
insert into public.vehicle_models (id, make_id, name_ar, name_en, year_from) values
  ('b0000000-0000-4000-e900-000000000001', 'a0000000-0000-4000-e900-000000000001',
   'موديل', 'TestModelPush', 2015);
insert into public.vehicles (id, owner_id, make_id, model_id, year, plate_en, current_mileage) values
  ('d0000000-0000-4000-e900-000000000001', '11111111-0000-4000-e900-000000000001',
   'a0000000-0000-4000-e900-000000000001', 'b0000000-0000-4000-e900-000000000001',
   2022, 'ABJ 3939', 30000);

insert into public.providers
  (id, owner_profile_id, provider_type, business_name_ar, business_name_en, cr_number,
   verification_status, is_online, city_id, acceptance_rate)
values
  ('e0000000-0000-4000-e900-000000000001', '22222222-0000-4000-e900-000000000002',
   'individual', 'فنّي البطاريات', 'Battery Tech', null, 'approved', true,
   'c0000000-0000-4000-e900-000000000001', 90),
  ('e0000000-0000-4000-e900-000000000002', '33333333-0000-4000-e900-000000000003',
   'workshop', 'ورشة الإشعارات', null, '5050505050', 'approved', false,
   'c0000000-0000-4000-e900-000000000001', 90);

select id as svc_battery from public.services where name_en = 'Battery jump or replacement' \gset
select id as svc_oil from public.services where name_en = 'Oil and filter change' \gset

insert into public.provider_services (provider_id, service_id) values
  ('e0000000-0000-4000-e900-000000000001', :'svc_battery'),
  ('e0000000-0000-4000-e900-000000000002', :'svc_oil');

insert into public.provider_locations (provider_id, location, updated_at) values
  ('e0000000-0000-4000-e900-000000000001',
   extensions.st_point(50.1040, 26.4210)::extensions.geography, now());

insert into public.workshops (provider_id, address_ar, location, bay_count, opening_hours)
values ('e0000000-0000-4000-e900-000000000002', 'الدمام',
        extensions.st_point(50.11, 26.43)::extensions.geography, 2, '{}'::jsonb);

insert into public.appointment_slots (id, provider_id, starts_at, ends_at, capacity)
values ('50000000-0000-4000-e900-000000000001', 'e0000000-0000-4000-e900-000000000002',
        '2031-03-02 07:00:00+00', '2031-03-02 08:00:00+00', 2);


-- Devices ------------------------------------------------------------------------------
set role authenticated;

select test.become('11111111-0000-4000-e900-000000000001');
select public.register_push_device('ExponentPushToken[customer-phone-0001]', 'ios', 'ar');

select test.become('22222222-0000-4000-e900-000000000002');
select public.register_push_device('ExponentPushToken[technician-phone-01]', 'android', 'en');

select test.become('33333333-0000-4000-e900-000000000003');
select public.register_push_device('ExponentPushToken[workshop-phone-0001]', 'android', 'ar');

select test.assert_eq(
  (select count(*)::int from public.push_devices), 1,
  'a person sees their own devices and nobody else''s');

select test.assert_raises(
  $$select public.register_push_device('not a token', 'ios', 'ar')$$,
  'only an Expo push token is accepted — it is handed verbatim to a third party',
  '23514');

select test.assert_raises(
  $$insert into public.push_devices (user_id, token, platform)
    values ('33333333-0000-4000-e900-000000000003', 'ExponentPushToken[direct-insert-01]', 'ios')$$,
  'devices are written only through register_push_device()',
  '42501');

-- Someone else signs in on the customer's phone: the token moves.
select test.become('44444444-0000-4000-e900-000000000004');
select public.register_push_device('ExponentPushToken[customer-phone-0001]', 'ios', 'ar');
reset role;

select test.assert_eq(
  (select user_id from public.push_devices where token = 'ExponentPushToken[customer-phone-0001]'),
  '44444444-0000-4000-e900-000000000004'::uuid,
  'a phone belongs to whoever is signed in on it now');

set role authenticated;
select test.become('11111111-0000-4000-e900-000000000001');
select public.unregister_push_device('ExponentPushToken[customer-phone-0001]');
reset role;
select test.assert_eq(
  (select count(*)::int from public.push_devices where token = 'ExponentPushToken[customer-phone-0001]'),
  1, 'nobody can unregister a token that is not theirs');

-- Back to the customer, as the app does after they sign in again.
set role authenticated;
select test.become('11111111-0000-4000-e900-000000000001');
select public.register_push_device('ExponentPushToken[customer-phone-0001]', 'ios', 'ar');

select test.assert_raises(
  $$select * from public.notification_outbox$$,
  'the outbox — what everyone is being told — is closed to clients',
  '42501');

select test.assert_raises(
  $$select public.enqueue_notification('11111111-0000-4000-e900-000000000001', 'x',
      'a', 'a', 'b', 'b', '{}'::jsonb, 'forged')$$,
  'a client cannot send anyone a notification',
  '42501');

select test.assert_raises(
  $$select * from public.claim_push_notifications(10)$$,
  'a client cannot drain the queue',
  '42501');
reset role;


-- An emergency, told to the right person at each step ---------------------------------
select test.become('11111111-0000-4000-e900-000000000001');
select public.create_emergency_order(:'svc_battery', 50.1035, 26.4209,
  'd0000000-0000-4000-e900-000000000001', null, 'البطارية', 30100) as emergency \gset
select public.authorise_order_payment(:'emergency', 'intent_push_1');
select public.submit_order(:'emergency');

select test.assert_eq(
  (select count(*)::int from public.notification_outbox
    where kind = 'job_offer' and user_id = '22222222-0000-4000-e900-000000000002'
      and data ->> 'id' = :'emergency'),
  1, 'the technician is told about the job the moment it is offered to them');

select test.assert(
  (select data ->> 'route' = '/job' from public.notification_outbox where kind = 'job_offer'),
  'and a tap opens the job');

select public.broadcast_order(:'emergency', 1);
select test.assert_eq(
  (select count(*)::int from public.notification_outbox where kind = 'job_offer'),
  1, 'a re-broadcast does not ping the same technician twice');

select test.assert_eq(
  (select count(*)::int from public.notification_outbox
    where user_id = '11111111-0000-4000-e900-000000000001'),
  0, 'the customer is not told about what they just did themselves');

select test.become('22222222-0000-4000-e900-000000000002');
select public.accept_order(:'emergency');
update public.orders set status = 'en_route' where id = :'emergency';
update public.orders set status = 'arrived' where id = :'emergency';
update public.orders set status = 'in_progress' where id = :'emergency';

-- Mid-job, the technician quotes a part.
insert into public.order_parts (order_id, name_ar, quantity, unit_price)
values (:'emergency', 'بطارية ٧٠ أمبير', 1, 350.00);

-- The customer answers before hand-back (0067).
select test.become('11111111-0000-4000-e900-000000000001');
update public.order_parts set approved_by_customer = true, approved_at = now()
 where order_id = :'emergency';
select test.become('22222222-0000-4000-e900-000000000002');

select public.record_completion_evidence(:'emergency', 30150, test.completion_photos(:'emergency'), 30);
update public.orders set status = 'awaiting_approval' where id = :'emergency';

select test.assert_eq(
  -- Sorted by kind: inside one transaction every row shares now().
  (select array_agg(kind order by kind)::text from public.notification_outbox
    where user_id = '11111111-0000-4000-e900-000000000001' and kind like 'order_%'),
  '{order_accepted,order_arrived,order_awaiting_approval,order_en_route}',
  'the customer hears each step they would otherwise watch the screen for — and not "work started"');

select test.assert(
  (select title_en = 'Your technician is on the way'
      and body_ar like 'فنّي البطاريات%'
      and data ->> 'route' = '/tracking'
     from public.notification_outbox where kind = 'order_en_route'),
  'in both languages, naming the technician, opening the tracking screen');

select test.become('11111111-0000-4000-e900-000000000001');
-- Parts took the bill past the hold: the customer covers the difference
-- before confirming (0078).
select public.authorise_order_top_up(:'emergency', 'test_top_up_rgency', d)
  from (select public.order_top_up_due(:'emergency') as d) due where d > 0;
update public.orders set status = 'completed' where id = :'emergency';

select test.assert_eq(
  (select count(*)::int from public.notification_outbox
    where kind = 'order_completed' and user_id = '22222222-0000-4000-e900-000000000002'),
  1, 'the technician hears that the customer approved');


-- A booking, told to the workshop ------------------------------------------------------
select public.book_appointment('50000000-0000-4000-e900-000000000001', :'svc_oil',
  'd0000000-0000-4000-e900-000000000001', null, 30200) as booking \gset
select public.authorise_order_payment(:'booking', 'intent_push_2');
select public.submit_order(:'booking');

select test.assert(
  (select title_ar = 'حجز جديد: تغيير زيت وفلتر' and body_ar like '%2031-03-02 10:00%'
     from public.notification_outbox
    where kind = 'booking_confirmed' and user_id = '33333333-0000-4000-e900-000000000003'),
  'the workshop is told about the booking, with the time in Riyadh');

update public.orders set status = 'cancelled', cancellation_reason = 'تغيّرت الخطة'
 where id = :'booking';

select test.assert_eq(
  (select count(*)::int from public.notification_outbox
    where kind = 'order_cancelled' and user_id = '33333333-0000-4000-e900-000000000003'),
  1, 'and hears when the customer cancels it');

select test.assert_eq(
  (select count(*)::int from public.notification_outbox
    where kind = 'order_cancelled' and user_id = '11111111-0000-4000-e900-000000000001'),
  0, 'while the customer, who cancelled, is not told their own news');


-- Parts and care reminders -------------------------------------------------------------
select test.assert(
  (select data ->> 'route' = '/quote' from public.notification_outbox where kind = 'parts_quote'),
  'a part waiting on the customer reaches them, and opens the quote');

select public.begin_privileged_write();
insert into public.vehicle_reminders (vehicle_id, user_id, title_ar, title_en, body_ar, body_en)
values ('d0000000-0000-4000-e900-000000000001', '11111111-0000-4000-e900-000000000001',
        'حان موعد تغيير الزيت', 'Oil change due', 'بقي ٥٠٠ كم', '500 km to go');
select public.end_privileged_write();

select test.assert(
  (select title_ar = 'حان موعد تغيير الزيت' from public.notification_outbox where kind = 'care_reminder'),
  'the care reminders 0062 records are finally delivered');


-- The sender -----------------------------------------------------------------------------
-- Someone with no working device, and a notification whose moment has passed.
select public.enqueue_notification('44444444-0000-4000-e900-000000000004', 'order_arrived',
  'ع', 'e', 'ع', 'e', '{}'::jsonb, 'test:nobody');
delete from public.push_devices where user_id = '44444444-0000-4000-e900-000000000004';

select public.enqueue_notification('22222222-0000-4000-e900-000000000002', 'job_offer',
  'قديم', 'Old', 'قديم', 'Old', '{}'::jsonb, 'test:stale');
update public.notification_outbox set expires_at = now() - interval '1 minute'
 where dedupe_key = 'test:stale';

set role service_role;
create temp table claimed as select * from public.claim_push_notifications(100);
reset role;

select test.assert_eq(
  (select last_error from public.notification_outbox where dedupe_key = 'test:stale'),
  'expired', 'a notification past its moment is dropped, not delivered late');

select test.assert_eq(
  (select last_error from public.notification_outbox where dedupe_key = 'test:nobody'),
  'no_device', 'one for someone with no phone registered is settled, not retried forever');

select test.assert_eq(
  (select title from claimed where kind = 'order_en_route'),
  'الفنّي في الطريق إليك', 'the customer''s phone is spoken to in Arabic, as it asked');

select test.assert_eq(
  (select title from claimed where kind = 'order_completed'),
  'The customer approved the work', 'and the technician''s in English, as theirs did');

select test.assert_eq(
  (select data ->> 'route' from claimed where kind = 'order_completed'),
  '/job', 'with where a tap should land');

set role service_role;
select test.assert_eq(
  (select count(*)::int from public.claim_push_notifications(100)), 0,
  'claimed rows are leased: a second tick running at once gets none of them');
reset role;

-- Report: one delivered, one to retry, one install gone.
select id as sent_id from public.notification_outbox where kind = 'order_completed' \gset
select id as retry_id from public.notification_outbox where kind = 'booking_confirmed' \gset

set role service_role;
select public.record_push_results(
  array[:'sent_id']::uuid[], array[:'retry_id']::uuid[],
  array['ExponentPushToken[workshop-phone-0001]'], 'MessageRateExceeded');
reset role;

select test.assert(
  (select sent_at is not null from public.notification_outbox where id = :'sent_id'),
  'delivered is recorded');

select test.assert(
  (select claimed_at is null and sent_at is null and abandoned_at is null
     from public.notification_outbox where id = :'retry_id'),
  'a transient failure is released for the next tick');

select test.assert(
  (select disabled_at is not null from public.push_devices
    where token = 'ExponentPushToken[workshop-phone-0001]'),
  'an install Expo says is gone stops being sent to');

update public.notification_outbox set attempts = 5, claimed_at = now() where id = :'retry_id';
set role service_role;
select public.record_push_results('{}', array[:'retry_id']::uuid[], '{}', 'still failing');
reset role;
select test.assert(
  (select abandoned_at is not null from public.notification_outbox where id = :'retry_id'),
  'after five attempts it is given up, not retried forever');

rollback;

\echo '   push notifications OK'
