-- 67 — The customer and the technician can talk, and nobody else can listen
--
-- Companion to 0101.

\echo '── order messages'

begin;

insert into auth.users (id, phone) values
  ('11111111-0000-4000-6767-000000000001', '+966509670001'),
  ('22222222-0000-4000-6767-000000000002', '+966509670002'),
  ('44444444-0000-4000-6767-000000000004', '+966509670004'),
  ('55555555-0000-4000-6767-000000000005', '+966509670005');

insert into public.profiles (id, full_name, phone) values
  ('11111111-0000-4000-6767-000000000001', 'العميل', '+966509670001'),
  ('22222222-0000-4000-6767-000000000002', 'الفنّي', '+966509670002'),
  ('44444444-0000-4000-6767-000000000004', 'فنّي آخر', '+966509670004'),
  ('55555555-0000-4000-6767-000000000005', 'غريب', '+966509670005');

insert into public.cities (id, name_ar, name_en, region_ar, region_en, centroid) values
  ('c0000000-0000-4000-6767-000000000001', 'الدمام', 'DammamChat', 'الشرقية', 'Eastern',
   extensions.st_point(50.1033, 26.4207)::extensions.geography);

insert into public.vehicle_makes (id, name_ar, name_en) values
  ('a0000000-0000-4000-6767-000000000001', 'ماركة', 'TestMakeChat');
insert into public.vehicle_models (id, make_id, name_ar, name_en, year_from) values
  ('b0000000-0000-4000-6767-000000000001', 'a0000000-0000-4000-6767-000000000001',
   'موديل', 'TestModelChat', 2015);
insert into public.vehicles (id, owner_id, make_id, model_id, year, plate_en, current_mileage) values
  ('d0000000-0000-4000-6767-000000000001', '11111111-0000-4000-6767-000000000001',
   'a0000000-0000-4000-6767-000000000001', 'b0000000-0000-4000-6767-000000000001',
   2022, 'ABD 6767', 30000);

insert into public.providers
  (id, owner_profile_id, provider_type, business_name_ar, verification_status,
   is_online, city_id, acceptance_rate)
values
  ('e0000000-0000-4000-6767-000000000001', '22222222-0000-4000-6767-000000000002',
   'individual', 'فنّي البطاريات', 'approved', true,
   'c0000000-0000-4000-6767-000000000001', 90),
  ('e0000000-0000-4000-6767-000000000004', '44444444-0000-4000-6767-000000000004',
   'individual', 'فنّي آخر', 'approved', true,
   'c0000000-0000-4000-6767-000000000001', 90);
select test.grant_role('22222222-0000-4000-6767-000000000002', 'technician');
select test.grant_role('44444444-0000-4000-6767-000000000004', 'technician');

select id as svc_battery from public.services where name_en = 'Battery jump or replacement' \gset
insert into public.provider_services (provider_id, service_id) values
  ('e0000000-0000-4000-6767-000000000001', :'svc_battery'),
  ('e0000000-0000-4000-6767-000000000004', :'svc_battery');
insert into public.provider_locations (provider_id, location, updated_at) values
  ('e0000000-0000-4000-6767-000000000001',
   extensions.st_point(50.1040, 26.4210)::extensions.geography, now()),
  ('e0000000-0000-4000-6767-000000000004',
   extensions.st_point(50.1041, 26.4211)::extensions.geography, now());

select test.become('11111111-0000-4000-6767-000000000001');
select public.create_emergency_order(
  :'svc_battery', 50.1035, 26.4209, 'd0000000-0000-4000-6767-000000000001',
  'حي الشاطئ', 'البطارية فصلت', 30100) as job \gset
select public.authorise_order_payment(:'job', 'intent_chat_1');
select public.submit_order(:'job');

select test.assert_raises(
  format($$select public.send_order_message('%s', 'مرحبا')$$, :'job'),
  'no talking before a technician has the job', '23514');

select test.become('22222222-0000-4000-6767-000000000002');
select test.assert(public.accept_order(:'job'), 'the technician accepts');

-- From here on as the app's role, so row security applies to every read.
set role authenticated;

select public.send_order_message(:'job', '  في الطريق إليك  ') as m1 \gset
select test.assert_eq(
  (select body from public.order_messages where id = :'m1'), 'في الطريق إليك',
  'the technician writes, trimmed');
select test.assert_eq(
  (select sender_side from public.order_messages where id = :'m1'), 'provider',
  'and is marked as the provider side');

select test.become('11111111-0000-4000-6767-000000000001');
select test.assert_eq(
  (select count(*)::int from public.order_messages where order_id = :'job'), 1,
  'the customer reads it');
reset role;
select test.assert(
  exists (select 1 from public.notification_outbox
           where user_id = '11111111-0000-4000-6767-000000000001'
             and kind = 'order_message' and data ->> 'route' = '/chat'),
  'and was notified');
set role authenticated;

select public.send_order_message(:'job', 'السيارة في الدور -2') as m2 \gset
reset role;
select test.assert(
  exists (select 1 from public.notification_outbox
           where user_id = '22222222-0000-4000-6767-000000000002' and kind = 'order_message'),
  'the customer answers, and the technician is notified');
set role authenticated;

select test.assert_raises(
  format($$select public.send_order_message('%s', '   ')$$, :'job'),
  'an empty message is refused', '23514');
select test.assert_raises(
  format($$select public.send_order_message('%s', repeat('ب', 1001))$$, :'job'),
  'an overlong message is refused', '23514');

select test.assert_raises(
  format($$insert into public.order_messages (order_id, sender_id, sender_side, body)
           values ('%s', '11111111-0000-4000-6767-000000000001', 'customer', 'مباشر')$$, :'job'),
  'nobody writes the table directly', '42501');
select test.assert_raises(
  format($$update public.order_messages set body = 'معدّل' where id = '%s'$$, :'m2'),
  'and nobody edits a message', '42501');

-- Nobody else.
select test.become('44444444-0000-4000-6767-000000000004');
select test.assert_eq(
  (select count(*)::int from public.order_messages where order_id = :'job'), 0,
  'another technician reads nothing');
select test.assert_raises(
  format($$select public.send_order_message('%s', 'مرحبا')$$, :'job'),
  'and cannot write in', '42501');

select test.become('55555555-0000-4000-6767-000000000005');
select test.assert_eq(
  (select count(*)::int from public.order_messages where order_id = :'job'), 0,
  'a stranger reads nothing');
select test.assert_raises(
  $$select public.send_order_message('00000000-0000-4000-8000-000000000000', 'مرحبا')$$,
  'and an order that does not exist answers the same as one that is not yours', '42501');

reset role;

-- Operators: only through the audited function, and only with a reason (0102).
insert into auth.users (id, phone) values ('66666666-0000-4000-6767-000000000006', '+966509670006');
insert into public.profiles (id, full_name, phone)
values ('66666666-0000-4000-6767-000000000006', 'التشغيل', '+966509670006');
select test.grant_role('66666666-0000-4000-6767-000000000006', 'ops');

select test.become('66666666-0000-4000-6767-000000000006');
set role authenticated;
select test.assert_eq(
  (select count(*)::int from public.order_messages where order_id = :'job'), 0,
  'an operator cannot read a thread directly');
select test.assert_raises(
  format($$select public.ops_order_messages('%s', '')$$, :'job'),
  'nor through the console without a reason', '23514');
select test.assert_eq(
  jsonb_array_length(public.ops_order_messages(:'job', 'شكوى العميل عن التأخير')), 2,
  'with a reason, the whole thread');
reset role;
select test.assert(
  exists (select 1 from public.audit_log
           where actor_id = '66666666-0000-4000-6767-000000000006'
             and action = 'read' and target_table = 'order_messages'
             and target_id = :'job' and after ->> 'reason' = 'شكوى العميل عن التأخير'),
  'and the read is on the record, with the reason');

select test.become('22222222-0000-4000-6767-000000000002');
set role authenticated;
select test.assert_raises(
  format($$select public.ops_order_messages('%s', 'فضول')$$, :'job'),
  'a party is not an operator', '42501');
reset role;

-- The person's words follow the person (0103).
select test.become('66666666-0000-4000-6767-000000000006');
select test.assert_eq(
  jsonb_array_length(public.ops_export_user_data('11111111-0000-4000-6767-000000000001',
                                                 'طلب العميل نسخة من بياناته') -> 'order_messages'),
  1, 'an export carries what the person wrote');

update public.orders set status = 'cancelled', cancellation_reason = 'اختبار' where id = :'job';
select test.become('11111111-0000-4000-6767-000000000001');
select public.delete_my_account('DELETE');
select test.assert_eq(
  (select body from public.order_messages where id = :'m2'), 'رسالة محذوفة',
  'deleting the account erases what they wrote');
select test.assert_eq(
  (select body from public.order_messages where id = :'m1'), 'في الطريق إليك',
  'and keeps what the other side wrote');

rollback;
