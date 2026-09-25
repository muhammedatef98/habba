-- 42 — What the console stands on: settings, suspension, disputes, refunds
--
-- Companion to 0069. Run as `authenticated`, so the policies and grants are
-- what is being tested, not the table owner's bypass.

\echo '── console foundations'

begin;

insert into auth.users (id, phone) values
  ('11111111-0000-4000-ec00-000000000001', '+966509400001'),  -- customer
  ('22222222-0000-4000-ec00-000000000002', '+966509400002'),  -- technician
  ('33333333-0000-4000-ec00-000000000003', '+966509400003'),  -- operator
  ('44444444-0000-4000-ec00-000000000004', '+966509400004');  -- stranger

insert into public.profiles (id, full_name, phone) values
  ('11111111-0000-4000-ec00-000000000001', 'العميل', '+966509400001'),
  ('22222222-0000-4000-ec00-000000000002', 'الفنّي', '+966509400002'),
  ('33333333-0000-4000-ec00-000000000003', 'المشغّل', '+966509400003'),
  ('44444444-0000-4000-ec00-000000000004', 'غريب', '+966509400004');

select test.grant_role('33333333-0000-4000-ec00-000000000003', 'ops');

insert into public.cities (id, name_ar, name_en, region_ar, region_en, centroid) values
  ('c0000000-0000-4000-ec00-000000000001', 'الدمام', 'DammamConsole', 'الشرقية', 'Eastern',
   extensions.st_point(50.1033, 26.4207)::extensions.geography);

insert into public.vehicle_makes (id, name_ar, name_en) values
  ('a0000000-0000-4000-ec00-000000000001', 'ماركة', 'TestMakeConsole');
insert into public.vehicle_models (id, make_id, name_ar, name_en, year_from) values
  ('b0000000-0000-4000-ec00-000000000001', 'a0000000-0000-4000-ec00-000000000001',
   'موديل', 'TestModelConsole', 2015);
insert into public.vehicles (id, owner_id, make_id, model_id, year, plate_en, current_mileage) values
  ('d0000000-0000-4000-ec00-000000000001', '11111111-0000-4000-ec00-000000000001',
   'a0000000-0000-4000-ec00-000000000001', 'b0000000-0000-4000-ec00-000000000001',
   2021, 'ABJ 4242', 40000);

insert into public.providers
  (id, owner_profile_id, provider_type, business_name_ar, verification_status, is_online,
   city_id, acceptance_rate)
values
  ('e0000000-0000-4000-ec00-000000000001', '22222222-0000-4000-ec00-000000000002',
   'individual', 'فنّي الاختبار', 'approved', true, 'c0000000-0000-4000-ec00-000000000001', 90);

select id as svc from public.services where name_en = 'Battery jump or replacement' \gset

insert into public.provider_services (provider_id, service_id) values
  ('e0000000-0000-4000-ec00-000000000001', :'svc');
insert into public.provider_locations (provider_id, location, updated_at) values
  ('e0000000-0000-4000-ec00-000000000001',
   extensions.st_point(50.1040, 26.4210)::extensions.geography, now());

set role authenticated;


-- Settings: operators change the numbers; nobody else sees the operational ones -------
select test.become('11111111-0000-4000-ec00-000000000001');

select test.assert_eq((select count(*)::int from public.platform_settings), 0,
  'a customer cannot read the settings table');

select test.assert(
  public.get_public_settings() ? 'new_orders_paused'
  and not (public.get_public_settings() ? 'otp_send_limit'),
  'the app reads the public switches, never the security limits');

update public.platform_settings set value = '9' where key = 'dispatch_max_round';
select test.assert_raises($$select public.dispatch_max_round()$$,
  'nor can a customer read an operational number through its function (0084)', '42501');
reset role;
select test.assert_eq(public.dispatch_max_round(), 3,
  'a customer''s update changes nothing');
set role authenticated;

select test.become('33333333-0000-4000-ec00-000000000003');

update public.platform_settings set value = '5' where key = 'dispatch_max_round';
reset role;
select test.assert_eq(public.dispatch_max_round(), 5,
  'an operator changes a number and every function that used the constant follows');
set role authenticated;

select test.assert_raises(
  $$update public.platform_settings set value = '50' where key = 'dispatch_max_round'$$,
  'but not outside the bounds the migration set', '23514');

select test.assert_raises(
  $$update public.platform_settings set value = '"many"' where key = 'dispatch_max_round'$$,
  'nor to a value of the wrong type', '23514');

select test.assert_raises(
  $$update public.platform_settings set max_value = 1000 where key = 'dispatch_max_round'$$,
  'nor redefine what the number means — only the value is theirs', '42501');

select test.assert_eq(
  (select count(*)::int from public.audit_log
    where target_table = 'platform_settings' and target_id = 'dispatch_max_round'),
  1, 'and the change is on the audit record');

update public.platform_settings set value = '3' where key = 'dispatch_max_round';


-- Pausing new orders ---------------------------------------------------------------------------------
update public.platform_settings set value = 'true' where key = 'new_orders_paused';

select test.become('11111111-0000-4000-ec00-000000000001');
select public.create_emergency_order(
  :'svc', 50.1035, 26.4209, 'd0000000-0000-4000-ec00-000000000001',
  'حي الشاطئ', 'البطارية فصلت', 40100, '[]'::jsonb) as paused_order \gset
select public.authorise_order_payment(:'paused_order', 'intent_console_1');

select test.assert_raises(
  format($$select public.submit_order('%s')$$, :'paused_order'),
  'while new orders are paused, nothing is sent out', '23514');

select test.become('33333333-0000-4000-ec00-000000000003');
update public.platform_settings set value = 'false' where key = 'new_orders_paused';

select test.become('11111111-0000-4000-ec00-000000000001');
select test.assert_eq(public.submit_order(:'paused_order'), 'searching'::public.order_status,
  'and resuming lets the same order go');


-- Cancelling releases the hold -------------------------------------------------------------------------
update public.orders set status = 'cancelled', cancellation_reason = 'غيّرت رأيي'
 where id = :'paused_order';

select test.assert_eq(
  (select escrow_status::text from public.orders where id = :'paused_order'), 'released',
  'a cancelled order no longer holds the customer''s money');

select test.assert(
  (select kind = 'void' and status = 'pending' and reason = 'غيّرت رأيي'
     from public.payment_operations where order_id = :'paused_order'),
  'and the payment provider is asked to void the authorisation');

select test.assert_eq(
  (select count(*)::int from public.payment_operations where order_id = :'paused_order'), 1,
  'which the customer can see is on its way');


-- Suspension -------------------------------------------------------------------------------------------------
select test.become('33333333-0000-4000-ec00-000000000003');
select public.ops_set_suspension('22222222-0000-4000-ec00-000000000002', true, 'شكاوى متكررة من العملاء');

select test.assert(
  not (select is_online from public.providers where id = 'e0000000-0000-4000-ec00-000000000001'),
  'suspending a technician takes them off the road at once');

select test.become('22222222-0000-4000-ec00-000000000002');

select test.assert_raises(
  $$update public.providers set is_online = true where id = 'e0000000-0000-4000-ec00-000000000001'$$,
  'a suspended technician cannot go back online', '42501');

select test.assert(
  (select (public.my_account_status() ->> 'suspended')::boolean
      and public.my_account_status() ->> 'reason' = 'شكاوى متكررة من العملاء'),
  'and the app can tell them why');

select test.become('11111111-0000-4000-ec00-000000000001');
select public.create_emergency_order(
  :'svc', 50.1035, 26.4209, 'd0000000-0000-4000-ec00-000000000001',
  'حي الشاطئ', 'مرة ثانية', 40200, '[]'::jsonb) as order_two \gset
select public.authorise_order_payment(:'order_two', 'intent_console_2');
select public.submit_order(:'order_two');

select test.become('22222222-0000-4000-ec00-000000000002');
select test.assert_raises(
  format($$select public.accept_order('%s')$$, :'order_two'),
  'nor take a job, even one they can see', '42501');

select test.assert_raises(
  $$insert into public.account_suspensions (user_id, reason, suspended_by)
    values ('11111111-0000-4000-ec00-000000000001', 'x', '22222222-0000-4000-ec00-000000000002')$$,
  'nobody writes a suspension by hand', '42501');

select test.become('33333333-0000-4000-ec00-000000000003');
select public.ops_set_suspension('22222222-0000-4000-ec00-000000000002', false, 'بعد المراجعة والتحذير');

select test.become('22222222-0000-4000-ec00-000000000002');
update public.providers set is_online = true where id = 'e0000000-0000-4000-ec00-000000000001';
select test.assert(public.accept_order(:'order_two'), 'reinstated, they work again');

select test.become('44444444-0000-4000-ec00-000000000004');
select test.assert_eq((select count(*)::int from public.account_suspensions), 0,
  'a stranger sees nobody''s suspension history');


-- A dispute, resolved with a partial refund ------------------------------------------------------------
select test.become('22222222-0000-4000-ec00-000000000002');
update public.orders set status = 'en_route' where id = :'order_two';
update public.orders set status = 'arrived' where id = :'order_two';
update public.orders set status = 'in_progress' where id = :'order_two';
select public.record_completion_evidence(:'order_two', 40250, test.completion_photos(:'order_two'), 30);
update public.orders set status = 'awaiting_approval' where id = :'order_two';

select test.become('11111111-0000-4000-ec00-000000000001');
update public.orders set status = 'completed' where id = :'order_two';
select public.capture_order_payment(:'order_two');

select total_amount as order_total from public.orders where id = :'order_two' \gset

select test.become('22222222-0000-4000-ec00-000000000002');
select test.assert_raises(
  format($$update public.orders set status = 'disputed' where id = '%s'$$, :'order_two'),
  'the provider cannot put their own job into dispute', '42501');

select test.become('11111111-0000-4000-ec00-000000000001');
select public.open_order_dispute(:'order_two', 'البطارية الجديدة فصلت بعد يومين');

select test.assert(
  (select o.status = 'disputed' and d.reason = 'البطارية الجديدة فصلت بعد يومين' and d.resolved_at is null
     from public.orders o join public.order_disputes d on d.order_id = o.id
    where o.id = :'order_two'),
  'the customer opens a dispute, with their reason on record');

select test.assert_raises(
  format($$update public.orders set status = 'completed' where id = '%s'$$, :'order_two'),
  'and cannot close it themselves', '42501');

select test.become('33333333-0000-4000-ec00-000000000003');
select test.assert_raises(
  format($$update public.orders set escrow_status = 'refunded' where id = '%s'$$, :'order_two'),
  'an operator cannot mark an order refunded by editing it', '42501');

select public.ops_resolve_dispute(:'order_two', 'partial_refund', 10, 'تعويض جزئي عن التأخير في الإصلاح');

select test.assert(
  (select status = 'completed' and refunded_amount = 10 and escrow_status = 'captured'
     from public.orders where id = :'order_two'),
  'a partial refund returns the order to completed, 10 SAR refunded');

select test.assert(
  (select kind = 'refund' and amount = 10 and status = 'pending'
     from public.payment_operations where order_id = :'order_two'),
  'and asks the payment provider to refund exactly that');

select test.assert_eq(
  (select count(*)::int from public.vehicle_timeline where order_id = :'order_two'), 1,
  'the resolution does not write the service to the logbook a second time');

select public.build_payout('e0000000-0000-4000-ec00-000000000001', current_date - 1, current_date + 1)
  as payout \gset

select test.assert_eq(
  (select gross from public.payout_orders where order_id = :'order_two'),
  (:'order_total')::numeric - 10,
  'the provider is paid what the customer finally paid');


-- A review taken down ---------------------------------------------------------------------------------------
select test.become('11111111-0000-4000-ec00-000000000001');
insert into public.ratings (order_id, rater_id, stars, comment)
values (:'order_two', '11111111-0000-4000-ec00-000000000001', 1, 'كلام مسيء');

select test.become('33333333-0000-4000-ec00-000000000003');
select public.ops_set_rating_hidden(
  (select id from public.ratings where order_id = :'order_two'), true, 'ألفاظ مسيئة');

select test.assert_eq(
  (select rating_count from public.providers where id = 'e0000000-0000-4000-ec00-000000000001'), 0,
  'a hidden review stops counting towards the provider''s rating');

select test.become('44444444-0000-4000-ec00-000000000004');
select test.assert_eq(
  (select count(*)::int from public.ratings where order_id = :'order_two'), 0,
  'and stops showing to everyone else');

select test.become('11111111-0000-4000-ec00-000000000001');
select test.assert_eq(
  (select count(*)::int from public.ratings where order_id = :'order_two'), 1,
  'while the person who wrote it can still see what they wrote');

reset role;
rollback;

\echo '   console foundations OK'
