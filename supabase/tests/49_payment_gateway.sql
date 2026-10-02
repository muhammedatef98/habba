-- 49 — A real payment gateway
--
-- Companion to 0077. With `payments_gateway` switched to moyasar, the phone's
-- word is no longer enough: the hold is recorded only by the payment service,
-- for exactly the right amount, and money is taken only when the gateway says
-- it has been.

\echo '── payment gateway'

begin;

insert into auth.users (id, phone) values
  ('11111111-0000-4000-4949-000000000001', '+966509490001'),  -- customer
  ('22222222-0000-4000-4949-000000000002', '+966509490002');  -- technician

insert into public.profiles (id, full_name, phone) values
  ('11111111-0000-4000-4949-000000000001', 'العميل', '+966509490001'),
  ('22222222-0000-4000-4949-000000000002', 'الفنّي', '+966509490002');

insert into public.cities (id, name_ar, name_en, region_ar, region_en, centroid) values
  ('c0000000-0000-4000-4949-000000000001', 'الخبر', 'KhobarPay', 'الشرقية', 'Eastern',
   extensions.st_point(50.2083, 26.2172)::extensions.geography);

insert into public.vehicle_makes (id, name_ar, name_en) values
  ('a0000000-0000-4000-4949-000000000001', 'ماركة', 'TestMakePay');
insert into public.vehicle_models (id, make_id, name_ar, name_en, year_from) values
  ('b0000000-0000-4000-4949-000000000001', 'a0000000-0000-4000-4949-000000000001',
   'موديل', 'TestModelPay', 2015);
insert into public.vehicles (id, owner_id, make_id, model_id, year, plate_en, current_mileage) values
  ('d0000000-0000-4000-4949-000000000001', '11111111-0000-4000-4949-000000000001',
   'a0000000-0000-4000-4949-000000000001', 'b0000000-0000-4000-4949-000000000001',
   2021, 'KND 4949', 50000);

insert into public.providers
  (id, owner_profile_id, provider_type, business_name_ar, verification_status, is_online,
   city_id, acceptance_rate)
values
  ('e0000000-0000-4000-4949-000000000001', '22222222-0000-4000-4949-000000000002',
   'individual', 'فنّي الخبر', 'approved', true, 'c0000000-0000-4000-4949-000000000001', 90);

select id as svc from public.services where name_en = 'Battery jump or replacement' \gset

insert into public.provider_services (provider_id, service_id) values
  ('e0000000-0000-4000-4949-000000000001', :'svc');
insert into public.provider_locations (provider_id, location, updated_at) values
  ('e0000000-0000-4000-4949-000000000001',
   extensions.st_point(50.2085, 26.2174)::extensions.geography, now());

update public.platform_settings set value = '"moyasar"' where key = 'payments_gateway';

set role authenticated;
select test.become('11111111-0000-4000-4949-000000000001');
select public.create_emergency_order(
  :'svc', 50.2084, 26.2173, 'd0000000-0000-4000-4949-000000000001',
  'الخبر', 'البطارية فارغة', 50100, '[]'::jsonb) as ord \gset


-- The hold ----------------------------------------------------------------------------
select test.assert_raises(
  format($$select public.authorise_order_payment(%L, 'pay_forged_by_the_phone')$$, :'ord'),
  'once live, the phone cannot say a payment was made', '42501');

select test.assert_raises(
  format($$select public.record_payment_authorisation(%L, %L, 'pay_x', 1)$$,
         :'ord', '11111111-0000-4000-4949-000000000001'),
  'nor call the payment service''s own function', '42501');

reset role;
select public.order_hold_amount(:'ord') as hold \gset

select test.assert_raises(
  format($$select public.record_payment_authorisation(%L, %L, 'pay_small_1234', 1.00)$$,
         :'ord', '11111111-0000-4000-4949-000000000001'),
  'a hold for less than the order is refused', '23514');

select test.assert_raises(
  format($$select public.record_payment_authorisation(%L, %L, 'pay_other_1234', %s)$$,
         :'ord', '22222222-0000-4000-4949-000000000002', :'hold'),
  'a hold is recorded only for the order''s own customer', 'P0002');

select public.record_payment_authorisation(
  :'ord', '11111111-0000-4000-4949-000000000001', 'pay_real_1234', :'hold');

select test.assert_eq(
  (select escrow_status::text || '/' || payment_intent_id from public.orders where id = :'ord'),
  'authorised/pay_real_1234', 'the verified hold is on the order');


-- The job, and the capture ---------------------------------------------------------------
set role authenticated;
select test.become('11111111-0000-4000-4949-000000000001');
select public.submit_order(:'ord');

select test.become('22222222-0000-4000-4949-000000000002');
select public.accept_order(:'ord');
update public.orders set status = 'en_route' where id = :'ord';
update public.orders set status = 'arrived' where id = :'ord';
update public.orders set status = 'in_progress' where id = :'ord';
select public.record_completion_evidence(:'ord', 50150, test.completion_photos(:'ord'), 30);
update public.orders set status = 'awaiting_approval' where id = :'ord';

select test.become('11111111-0000-4000-4949-000000000001');
update public.orders set status = 'completed' where id = :'ord';
select public.capture_order_payment(:'ord');
select public.capture_order_payment(:'ord');

reset role;
select test.assert_eq(
  (select escrow_status::text from public.orders where id = :'ord'), 'authorised',
  'confirming does not mark the money taken — the gateway has not taken it yet');
select test.assert_eq(
  (select count(*)::int from public.payment_operations where order_id = :'ord' and kind = 'capture'),
  1, 'the capture is queued once, however often it is asked for');

set role authenticated;
select test.become('11111111-0000-4000-4949-000000000001');
select test.assert_raises(
  $$select * from public.claim_payment_operations(10)$$,
  'a client cannot take the queue', '42501');
select test.assert_raises(
  format($$select public.settle_payment_operation(
            (select id from public.payment_operations where order_id = %L), true, 'x', null)$$,
         :'ord'),
  'nor say an operation succeeded', '42501');
reset role;

select operation_id as op, payment_id as pay
  from public.claim_payment_operations(10) where order_id = :'ord' \gset
select test.assert_eq(:'pay'::text, 'pay_real_1234'::text, 'the queue hands the tick the payment to capture');
select test.assert_eq(
  (select count(*)::int from public.claim_payment_operations(10) where order_id = :'ord'), 0,
  'a claimed operation is leased, not handed to a second tick');

select public.settle_payment_operation(:'op', false, null, 'Moyasar 400: Amount exceeds');
select test.assert_eq(
  (select escrow_status::text from public.orders where id = :'ord'), 'authorised',
  'a failed capture leaves the money where it was');
select test.assert_eq(
  (select last_error from public.payment_operations where id = :'op'),
  'Moyasar 400: Amount exceeds', 'with the gateway''s reason kept for the operator');

-- An operator re-queues it after fixing the cause; this time it goes through.
update public.payment_operations set status = 'pending', attempted_at = null where id = :'op';
select public.settle_payment_operation(:'op', true, 'pay_real_1234', null);
select test.assert_eq(
  (select escrow_status::text from public.orders where id = :'ord'), 'captured',
  'only a capture the gateway confirmed marks the order captured');

rollback;

\echo '   payment gateway OK'
