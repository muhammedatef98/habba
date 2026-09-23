-- 43 — The console's reach: every read and action, and who may not use them
--
-- Companion to 0070.

\echo '── console functions'

begin;

insert into auth.users (id, phone) values
  ('11111111-0000-4000-ed00-000000000001', '+966509500001'),  -- customer
  ('22222222-0000-4000-ed00-000000000002', '+966509500002'),  -- technician A
  ('33333333-0000-4000-ed00-000000000003', '+966509500003'),  -- operator
  ('44444444-0000-4000-ed00-000000000004', '+966509500004'),  -- super admin
  ('55555555-0000-4000-ed00-000000000005', '+966509500005'),  -- technician B
  ('66666666-0000-4000-ed00-000000000006', '+966509500006');  -- to be erased

insert into public.profiles (id, full_name, phone) values
  ('11111111-0000-4000-ed00-000000000001', 'سارة العميلة', '+966509500001'),
  ('22222222-0000-4000-ed00-000000000002', 'الفنّي أ', '+966509500002'),
  ('33333333-0000-4000-ed00-000000000003', 'المشغّل', '+966509500003'),
  ('44444444-0000-4000-ed00-000000000004', 'المشرف العام', '+966509500004'),
  ('55555555-0000-4000-ed00-000000000005', 'الفنّي ب', '+966509500005'),
  ('66666666-0000-4000-ed00-000000000006', 'خالد المغادر', '+966509500006');

select test.grant_role('33333333-0000-4000-ed00-000000000003', 'ops');
select test.grant_role('44444444-0000-4000-ed00-000000000004', 'super_admin');

insert into public.cities (id, name_ar, name_en, region_ar, region_en, centroid) values
  ('c0000000-0000-4000-ed00-000000000001', 'الخبر', 'KhobarConsole', 'الشرقية', 'Eastern',
   extensions.st_point(50.2083, 26.2172)::extensions.geography);

insert into public.vehicle_makes (id, name_ar, name_en) values
  ('a0000000-0000-4000-ed00-000000000001', 'ماركة', 'TestMakeConsoleFn');
insert into public.vehicle_models (id, make_id, name_ar, name_en, year_from) values
  ('b0000000-0000-4000-ed00-000000000001', 'a0000000-0000-4000-ed00-000000000001',
   'موديل', 'TestModelConsoleFn', 2015);
insert into public.vehicles (id, owner_id, make_id, model_id, year, plate_en, current_mileage) values
  ('d0000000-0000-4000-ed00-000000000001', '11111111-0000-4000-ed00-000000000001',
   'a0000000-0000-4000-ed00-000000000001', 'b0000000-0000-4000-ed00-000000000001',
   2020, 'HXD 7373', 60000),
  ('d0000000-0000-4000-ed00-000000000006', '66666666-0000-4000-ed00-000000000006',
   'a0000000-0000-4000-ed00-000000000001', 'b0000000-0000-4000-ed00-000000000001',
   2018, 'LZN 1010', 90000);

insert into public.providers
  (id, owner_profile_id, provider_type, business_name_ar, verification_status, is_online,
   city_id, acceptance_rate, national_id_encrypted)
values
  ('e0000000-0000-4000-ed00-000000000001', '22222222-0000-4000-ed00-000000000002',
   'individual', 'فنّي الخبر أ', 'approved', false, 'c0000000-0000-4000-ed00-000000000001', 90,
   'vault:never-shown'),
  ('e0000000-0000-4000-ed00-000000000005', '55555555-0000-4000-ed00-000000000005',
   'individual', 'فنّي الخبر ب', 'approved', false, 'c0000000-0000-4000-ed00-000000000001', 90,
   null);

select id as svc from public.services where name_en = 'Battery jump or replacement' \gset

insert into public.provider_services (provider_id, service_id) values
  ('e0000000-0000-4000-ed00-000000000001', :'svc'),
  ('e0000000-0000-4000-ed00-000000000005', :'svc');

set role authenticated;

-- A customer with a live, funded order nobody has taken (every technician is offline).
select test.become('11111111-0000-4000-ed00-000000000001');
select public.register_push_device('ExponentPushToken[console-test-1]', 'ios', 'ar');
select public.create_emergency_order(
  :'svc', 50.2085, 26.2175, 'd0000000-0000-4000-ed00-000000000001',
  'الخبر الشمالية', 'السيارة لا تشتغل', 60100, '[]'::jsonb) as stuck \gset
select public.authorise_order_payment(:'stuck', 'intent_fn_1');
select public.submit_order(:'stuck');
select order_number as stuck_number from public.orders where id = :'stuck' \gset


-- Nobody but an operator in a verified session -----------------------------------------------------
select test.assert_raises($$select public.ops_dashboard()$$,
  'a customer cannot open the dashboard', '42501');
select test.assert_raises($$select * from public.ops_search('0509')$$,
  'or search everyone', '42501');
select test.assert_raises(
  $$select public.ops_user_detail('66666666-0000-4000-ed00-000000000006')$$,
  'or read another person''s file', '42501');
select test.assert_raises(
  format($$select public.ops_cancel_order('%s', 'سبب كافٍ')$$, :'stuck'),
  'or act as an operator', '42501');

select test.become_password_only('33333333-0000-4000-ed00-000000000003');
select test.assert_raises($$select public.ops_dashboard()$$,
  'an operator without the second factor reaches nothing either', '42501');


-- Reading ------------------------------------------------------------------------------------------------------------
select test.become('33333333-0000-4000-ed00-000000000003');

select test.assert(
  (select (d ->> 'searching_now')::int >= 1 and jsonb_array_length(d -> 'by_day') = 14
     from public.ops_dashboard() d),
  'the dashboard counts what is happening, with fourteen days of history');

select test.assert(
  exists (select 1 from public.ops_search(:'stuck_number') where kind = 'order' and id = :'stuck'),
  'search finds an order by its number');
select test.assert(
  exists (select 1 from public.ops_search('0509500001') where kind = 'user'
           and id = '11111111-0000-4000-ed00-000000000001'),
  'a person by the phone number as they say it (05…)');
select test.assert(
  exists (select 1 from public.ops_search('هـ ص د ٧٣٧٣') where kind = 'vehicle'
           and id = 'd0000000-0000-4000-ed00-000000000001'),
  'and a car by its plate typed in Arabic');

select test.assert(
  exists (select 1 from public.ops_list_orders('open') where id = :'stuck'),
  'the order list shows open orders');

select test.assert(
  (select jsonb_array_length(d -> 'events') >= 1 and d -> 'customer' ->> 'full_name' = 'سارة العميلة'
     from public.ops_order_detail(:'stuck') d),
  'an order''s file has its history and its customer');

select test.assert(
  (select not (d -> 'provider' ? 'national_id_encrypted') and (d -> 'provider' ->> 'has_national_id')::boolean
     from public.ops_provider_detail('e0000000-0000-4000-ed00-000000000001') d),
  'a provider''s file says an ID is on record without handing over its ciphertext');

select public.ops_user_detail('11111111-0000-4000-ed00-000000000001');
select test.assert_eq(
  (select count(*)::int from public.audit_log
    where action = 'read' and target_table = 'profiles'
      and target_id = '11111111-0000-4000-ed00-000000000001'
      and actor_id = '33333333-0000-4000-ed00-000000000003'),
  1, 'opening a person''s file is itself recorded');


-- Orders -----------------------------------------------------------------------------------------------------------------
select test.assert_raises(
  format($$select public.ops_assign_provider('%s', 'e0000000-0000-4000-ed00-000000000001', '')$$, :'stuck'),
  'every action needs a reason', '23514');

select public.ops_assign_provider(:'stuck', 'e0000000-0000-4000-ed00-000000000001',
  'لا أحد قبل خلال عشر دقائق، تواصلنا مع الفنّي هاتفياً');

select test.assert(
  (select status = 'accepted' and provider_id = 'e0000000-0000-4000-ed00-000000000001'
     from public.orders where id = :'stuck'),
  'an operator gives a stuck order to a named technician');
-- The outbox is closed to every client (0066); read it as the owner.
reset role;
select test.assert(
  exists (select 1 from public.notification_outbox
           where user_id = '22222222-0000-4000-ed00-000000000002' and kind = 'job_assigned'),
  'who is told on their phone');
set role authenticated;

select public.ops_assign_provider(:'stuck', 'e0000000-0000-4000-ed00-000000000005',
  'الفنّي الأول اعتذر قبل التحرك');
select test.assert_eq(
  (select provider_id from public.orders where id = :'stuck'),
  'e0000000-0000-4000-ed00-000000000005'::uuid,
  'and can hand it to another before anyone sets off');

-- The replacement works it; the customer confirms on the phone rather than in the app.
select test.become('55555555-0000-4000-ed00-000000000005');
update public.orders set status = 'en_route' where id = :'stuck';
update public.orders set status = 'arrived' where id = :'stuck';
update public.orders set status = 'in_progress' where id = :'stuck';
select public.record_completion_evidence(:'stuck', 60150, test.completion_photos(:'stuck'), 30);
update public.orders set status = 'awaiting_approval' where id = :'stuck';

select test.become('33333333-0000-4000-ed00-000000000003');
select public.ops_confirm_completion(:'stuck', 'العميلة أكدت هاتفياً أن السيارة تعمل');
select test.assert(
  (select status = 'completed' and escrow_status = 'captured' from public.orders where id = :'stuck'),
  'an operator confirms completion for a customer who confirmed by phone, and the payment is taken');

select test.assert_raises(
  format($$select public.ops_cancel_order('%s', 'تجربة الإلغاء')$$, :'stuck'),
  'a finished order is not cancelled — it is disputed', '23514');

select public.ops_open_dispute(:'stuck', 'العميلة اتصلت: المشكلة عادت');
select public.ops_resolve_dispute(:'stuck', 'full_refund', null, 'استرداد كامل، ضمان لم يُحترم');
select test.assert(
  (select escrow_status = 'refunded' and refunded_amount = total_amount from public.orders where id = :'stuck'),
  'a full refund leaves nothing of the order''s money with Habba');

select id as refund_op from public.payment_operations where order_id = :'stuck' and kind = 'refund' \gset
select test.assert_raises(
  format($$select public.ops_record_payment_operation('%s', 'succeeded', '')$$, :'refund_op'),
  'a refund is marked done only with the payment provider''s reference', '23514');
select public.ops_record_payment_operation(:'refund_op', 'succeeded', 'moyasar_rf_123');
select test.assert(
  (select status = 'succeeded' and psp_reference = 'moyasar_rf_123' from public.payment_operations
    where id = :'refund_op'),
  'and then is');


-- Staff -----------------------------------------------------------------------------------------------------------------
select test.assert_raises(
  $$select public.ops_set_staff_role('55555555-0000-4000-ed00-000000000005', 'ops', true)$$,
  'an operator cannot make someone else an operator', '42501');

select test.assert_raises(
  $$select public.ops_set_suspension('44444444-0000-4000-ed00-000000000004', true, 'محاولة')$$,
  'or suspend a super admin', '42501');

select test.become('44444444-0000-4000-ed00-000000000004');
select public.ops_set_staff_role('55555555-0000-4000-ed00-000000000005', 'ops', true);
select test.assert(public.has_role('55555555-0000-4000-ed00-000000000005', 'ops'),
  'a super admin can');

select test.assert_raises(
  $$select public.ops_set_staff_role('44444444-0000-4000-ed00-000000000004', 'super_admin', false)$$,
  'but cannot remove their own super admin role — there is always one left', '23514');

select test.assert_raises(
  $$select public.ops_set_staff_role('55555555-0000-4000-ed00-000000000005', 'technician', true)$$,
  'and provider roles are never handed out by hand', '22023');

select public.ops_set_staff_role('55555555-0000-4000-ed00-000000000005', 'ops', false);
select test.assert(not public.has_role('55555555-0000-4000-ed00-000000000005', 'ops'),
  'a staff role is revoked as easily');


-- The logbook: corrected by addition, never by edit ------------------------------------------------------
select test.become('33333333-0000-4000-ed00-000000000003');
select public.ops_annotate_vehicle('d0000000-0000-4000-ed00-000000000001',
  'قراءة العداد في الإدخال السابق خاطئة: الصحيح 60,150 كم');

select test.assert(
  (select provenance = 'habba_verified' and summary_ar like 'ملاحظة من هبّة:%'
     from public.vehicle_timeline
    where vehicle_id = 'd0000000-0000-4000-ed00-000000000001' and event_type = 'record_annotated'),
  'an operator''s correction is a new logbook entry, signed by Habba');

select test.assert(
  (select is_valid from public.verify_vehicle_timeline('d0000000-0000-4000-ed00-000000000001')),
  'and the chain still verifies');


-- Telling people ------------------------------------------------------------------------------------------------------------
select public.ops_broadcast('all', null, 'تحديث مهم', 'نعمل على تحسين الخدمة الليلة.', null, null)
  as recipients \gset

reset role;
select test.assert(
  exists (select 1 from public.notification_outbox
           where user_id = '11111111-0000-4000-ed00-000000000001' and kind = 'announcement'),
  'a broadcast reaches everyone with a phone registered');
select test.assert_eq(
  (select recipients from public.ops_broadcasts order by created_at desc limit 1), (:'recipients')::int,
  'and records how many it reached');
set role authenticated;
select test.become('33333333-0000-4000-ed00-000000000003');


-- PDPL ----------------------------------------------------------------------------------------------------------------------------
select test.assert(
  (select d -> 'profile' ->> 'phone' = '+966509500006'
          and jsonb_array_length(d -> 'vehicles') = 1
     from public.ops_export_user_data('66666666-0000-4000-ed00-000000000006', 'طلب نسخة من البيانات بالبريد') d),
  'an export hands a person everything Habba holds about them');

select test.assert_raises(
  $$select public.ops_anonymise_user('66666666-0000-4000-ed00-000000000006', 'طلب حذف')$$,
  'erasure is for a super admin, not any operator', '42501');

select test.become('44444444-0000-4000-ed00-000000000004');
select public.ops_anonymise_user('66666666-0000-4000-ed00-000000000006', 'طلب حذف الحساب بالبريد');

select test.assert(
  (select full_name = 'مستخدم محذوف' and phone is null and email is null
     from public.profiles where id = '66666666-0000-4000-ed00-000000000006'),
  'erasure removes who the person was');
select test.assert(public.is_suspended('66666666-0000-4000-ed00-000000000006'),
  'and the account can no longer act');
select test.assert(
  (select is_valid from public.verify_vehicle_timeline('d0000000-0000-4000-ed00-000000000006')),
  'while the car''s logbook — the car''s, not the person''s — still verifies');
select test.assert_eq(
  (select count(*)::int from public.data_requests where user_id = '66666666-0000-4000-ed00-000000000006'),
  2, 'and both requests are on record: the export and the erasure');

reset role;
rollback;

\echo '   console functions OK'
