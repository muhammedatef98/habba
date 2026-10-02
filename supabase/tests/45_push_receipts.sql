-- 45 — Knowing a notification arrived, not only that it left
--
-- Companion to 0072.

\echo '── push receipts'

begin;

insert into auth.users (id, phone) values
  ('11111111-0000-4000-ef00-000000000001', '+966509700001');
insert into public.profiles (id, full_name, phone) values
  ('11111111-0000-4000-ef00-000000000001', 'صاحب الجوالين', '+966509700001');

set role authenticated;
select test.become('11111111-0000-4000-ef00-000000000001');
select public.register_push_device('ExponentPushToken[receipt-phone-1]', 'ios', 'ar');
select public.register_push_device('ExponentPushToken[receipt-phone-2]', 'android', 'ar');

select test.assert_raises($$select * from public.claim_push_receipts()$$,
  'a client cannot ask for receipts', '42501');
select test.assert_raises($$select * from public.push_tickets$$,
  'or read the tickets', '42501');
reset role;

select public.enqueue_notification('11111111-0000-4000-ef00-000000000001', 'order_accepted',
  'تم قبول طلبك', 'Accepted', 'الفنّي في الطريق', 'On the way', '{}'::jsonb, 'receipt-test-1');
select id as n1 from public.notification_outbox where dedupe_key = 'receipt-test-1' \gset

select test.become_anon();
set role service_role;

select count(*) from public.claim_push_notifications(500);

-- Expo accepted it for both phones.
select public.record_push_results(
  array[:'n1']::uuid[], '{}', '{}', null,
  jsonb_build_array(
    jsonb_build_object('ticket_id', 'tk-1', 'notification_id', :'n1', 'token', 'ExponentPushToken[receipt-phone-1]'),
    jsonb_build_object('ticket_id', 'tk-2', 'notification_id', :'n1', 'token', 'ExponentPushToken[receipt-phone-2]')));

select test.assert(
  not exists (select 1 from public.claim_push_receipts() where ticket_id in ('tk-1', 'tk-2')),
  'a receipt is not asked for before it is due');

reset role;
update public.push_tickets set created_at = now() - interval '20 minutes' where ticket_id in ('tk-1', 'tk-2');
set role service_role;

select test.assert_eq(
  (select count(*)::int from public.claim_push_receipts() where ticket_id in ('tk-1', 'tk-2')),
  2, 'fifteen minutes on, both are due');

select test.assert_eq(
  (select count(*)::int from public.claim_push_receipts() where ticket_id in ('tk-1', 'tk-2')),
  0, 'and a second tick running at the same time does not ask again');

-- Delivered to the first phone; the second app was uninstalled.
select public.record_push_receipts(jsonb_build_array(
  jsonb_build_object('ticket_id', 'tk-1', 'status', 'ok', 'error', null),
  jsonb_build_object('ticket_id', 'tk-2', 'status', 'error', 'error', 'DeviceNotRegistered')));
reset role;

select test.assert(
  (select delivered_at is not null from public.notification_outbox where id = :'n1'),
  'a notification that reached one phone is marked delivered');

select test.assert(
  (select disabled_at is not null from public.push_devices
    where token = 'ExponentPushToken[receipt-phone-2]'),
  'an uninstalled app is retired, so nothing is sent to it again');

select test.assert(
  (select disabled_at is null from public.push_devices
    where token = 'ExponentPushToken[receipt-phone-1]'),
  'while the phone that works keeps receiving');


-- A failure on the only device says why; a receipt not ready yet is asked again.
select public.enqueue_notification('11111111-0000-4000-ef00-000000000001', 'order_arrived',
  'وصل الفنّي', 'Arrived', 'عند سيارتك', 'At your car', '{}'::jsonb, 'receipt-test-2');
select id as n2 from public.notification_outbox where dedupe_key = 'receipt-test-2' \gset

set role service_role;
select count(*) from public.claim_push_notifications(500);
select public.record_push_results(array[:'n2']::uuid[], '{}', '{}', null,
  jsonb_build_array(
    jsonb_build_object('ticket_id', 'tk-3', 'notification_id', :'n2', 'token', 'ExponentPushToken[receipt-phone-1]'),
    jsonb_build_object('ticket_id', 'tk-4', 'notification_id', :'n2', 'token', 'ExponentPushToken[receipt-phone-1]')));
reset role;
update public.push_tickets set created_at = now() - interval '20 minutes' where ticket_id in ('tk-3', 'tk-4');
set role service_role;

select count(*) from public.claim_push_receipts();
select public.record_push_receipts(jsonb_build_array(
  jsonb_build_object('ticket_id', 'tk-3', 'status', 'error', 'error', 'MessageRateExceeded'),
  jsonb_build_object('ticket_id', 'tk-4', 'status', 'pending', 'error', null)));
reset role;

select test.assert(
  (select delivered_at is null and last_error = 'receipt: MessageRateExceeded'
     from public.notification_outbox where id = :'n2'),
  'a notification that failed says why, where the console shows it');

select test.assert(
  (select checked_at is null and claimed_at is null from public.push_tickets where ticket_id = 'tk-4'),
  'a receipt Expo has not produced yet is released to be asked for again');


-- After a day there is no receipt to ask for.
update public.push_tickets set created_at = now() - interval '25 hours' where ticket_id = 'tk-4';
set role service_role;
select test.assert(
  not exists (select 1 from public.claim_push_receipts() where ticket_id = 'tk-4'),
  'a ticket older than a day is not asked about');
reset role;
select test.assert_eq(
  (select status from public.push_tickets where ticket_id = 'tk-4'), 'expired',
  'it is closed as expired instead');

rollback;

\echo '   push receipts OK'
