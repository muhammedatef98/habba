-- 50 — The bill outgrows the hold: the customer tops it up
--
-- Companion to 0078.

\echo '── payment top-up'

begin;

insert into auth.users (id, phone) values
  ('11111111-0000-4000-5050-000000000001', '+966509500001'),  -- customer
  ('22222222-0000-4000-5050-000000000002', '+966509500002');  -- technician

insert into public.profiles (id, full_name, phone) values
  ('11111111-0000-4000-5050-000000000001', 'العميل', '+966509500001'),
  ('22222222-0000-4000-5050-000000000002', 'الفنّي', '+966509500002');

insert into public.cities (id, name_ar, name_en, region_ar, region_en, centroid) values
  ('c0000000-0000-4000-5050-000000000001', 'الخبر', 'KhobarTopUp', 'الشرقية', 'Eastern',
   extensions.st_point(50.2083, 26.2172)::extensions.geography);

insert into public.vehicle_makes (id, name_ar, name_en) values
  ('a0000000-0000-4000-5050-000000000001', 'ماركة', 'TestMakeTopUp');
insert into public.vehicle_models (id, make_id, name_ar, name_en, year_from) values
  ('b0000000-0000-4000-5050-000000000001', 'a0000000-0000-4000-5050-000000000001',
   'موديل', 'TestModelTopUp', 2015);
insert into public.vehicles (id, owner_id, make_id, model_id, year, plate_en, current_mileage) values
  ('d0000000-0000-4000-5050-000000000001', '11111111-0000-4000-5050-000000000001',
   'a0000000-0000-4000-5050-000000000001', 'b0000000-0000-4000-5050-000000000001',
   2021, 'KND 5050', 50000);

insert into public.providers
  (id, owner_profile_id, provider_type, business_name_ar, verification_status, is_online,
   city_id, acceptance_rate)
values
  ('e0000000-0000-4000-5050-000000000001', '22222222-0000-4000-5050-000000000002',
   'individual', 'فنّي الخبر', 'approved', true, 'c0000000-0000-4000-5050-000000000001', 90);

select id as svc from public.services where name_en = 'Battery jump or replacement' \gset

insert into public.provider_services (provider_id, service_id) values
  ('e0000000-0000-4000-5050-000000000001', :'svc');
insert into public.provider_locations (provider_id, location, updated_at) values
  ('e0000000-0000-4000-5050-000000000001',
   extensions.st_point(50.2085, 26.2174)::extensions.geography, now());

-- Two jobs with parts: one the customer confirms, one an operator closes.
set role authenticated;
select test.become('11111111-0000-4000-5050-000000000001');
select public.create_emergency_order(
  :'svc', 50.2084, 26.2173, 'd0000000-0000-4000-5050-000000000001',
  'الخبر', 'البطارية فارغة', 50100, '[]'::jsonb) as ord \gset
select public.authorise_order_payment(:'ord', 'pay_initial_5050');
select public.submit_order(:'ord');

select test.become('22222222-0000-4000-5050-000000000002');
select public.accept_order(:'ord');
update public.orders set status = 'en_route' where id = :'ord';
update public.orders set status = 'arrived' where id = :'ord';
update public.orders set status = 'in_progress' where id = :'ord';
insert into public.order_parts (order_id, name_ar, part_number, is_oem, quantity, unit_price)
values (:'ord', 'بطارية ٧٠ أمبير', 'BAT-70', true, 1, 320.00);

select test.become('11111111-0000-4000-5050-000000000001');
update public.order_parts set approved_by_customer = true, approved_at = now() where order_id = :'ord';

select test.become('22222222-0000-4000-5050-000000000002');
select public.record_completion_evidence(:'ord', 50150, test.completion_photos(:'ord'), 30);
update public.orders set status = 'awaiting_approval' where id = :'ord';

select test.become('11111111-0000-4000-5050-000000000001');
select public.order_top_up_due(:'ord') as due \gset
reset role;
select (total_amount - public.order_held_amount(:'ord')) as expected_due
  from public.orders where id = :'ord' \gset
select test.assert(:'due'::numeric > 0, 'the parts took the bill past what the card holds');
select test.assert_eq(:'due'::numeric, :'expected_due'::numeric,
  'the difference is the bill less what is held');

set role authenticated;
select test.become('11111111-0000-4000-5050-000000000001');
select test.assert_raises(
  format($$update public.orders set status = 'completed' where id = %L$$, :'ord'),
  'the customer cannot confirm while the difference is not held', '23514');

select test.assert_raises(
  format($$select public.authorise_order_top_up(%L, 'pay_short_5050', 1.00)$$, :'ord'),
  'a top-up for less than the difference is refused', '23514');

select test.become('22222222-0000-4000-5050-000000000002');
select test.assert_raises(
  format($$select public.authorise_order_top_up(%L, 'pay_tech_5050', %s)$$, :'ord', :'due'),
  'nobody but the customer can pay it', '42501');
select test.assert_eq(public.order_top_up_due(:'ord'), 0::numeric,
  'and nobody else is told what it is');

select test.become('11111111-0000-4000-5050-000000000001');
select public.authorise_order_top_up(:'ord', 'pay_topup_5050', :'due');
select test.assert_eq(public.order_top_up_due(:'ord'), 0::numeric, 'with the difference held, nothing is due');
update public.orders set status = 'completed' where id = :'ord';
select test.assert_eq((select status::text from public.orders where id = :'ord'), 'completed',
  'and the customer can confirm');

-- Live capture: one per hold, each for its own share.
reset role;
update public.platform_settings set value = '"moyasar"' where key = 'payments_gateway';
set role authenticated;
select test.become('11111111-0000-4000-5050-000000000001');
select public.capture_order_payment(:'ord');
reset role;

select test.assert_eq(
  (select string_agg(payment_id || '=' || amount::text, ',' order by amount)
     from public.payment_operations where order_id = :'ord' and kind = 'capture'),
  (select string_agg(payment_id || '=' || amount::text, ',' order by amount)
     from public.payment_holds where order_id = :'ord'),
  'each hold is captured for exactly what it holds');

select id as op1 from public.payment_operations
 where order_id = :'ord' and payment_id = 'pay_initial_5050' \gset
select id as op2 from public.payment_operations
 where order_id = :'ord' and payment_id = 'pay_topup_5050' \gset
select public.settle_payment_operation(:'op1', true, 'pay_initial_5050', null);
select test.assert_eq((select escrow_status::text from public.orders where id = :'ord'), 'authorised',
  'half captured is not captured');
select public.settle_payment_operation(:'op2', true, 'pay_topup_5050', null);
select test.assert_eq((select escrow_status::text from public.orders where id = :'ord'), 'captured',
  'captured once every hold is');


-- An operator closes a job the customer never topped up ------------------------------
update public.platform_settings set value = '"dev"' where key = 'payments_gateway';
set role authenticated;
select test.become('11111111-0000-4000-5050-000000000001');
select public.create_emergency_order(
  :'svc', 50.2084, 26.2173, 'd0000000-0000-4000-5050-000000000001',
  'الخبر', 'مرة ثانية', 50200, '[]'::jsonb) as ord2 \gset
select public.authorise_order_payment(:'ord2', 'pay_initial_5051');
select public.submit_order(:'ord2');
select test.become('22222222-0000-4000-5050-000000000002');
select public.accept_order(:'ord2');
update public.orders set status = 'en_route' where id = :'ord2';
update public.orders set status = 'arrived' where id = :'ord2';
update public.orders set status = 'in_progress' where id = :'ord2';
insert into public.order_parts (order_id, name_ar, part_number, is_oem, quantity, unit_price)
values (:'ord2', 'بطارية', 'BAT-60', false, 1, 250.00);
select test.become('11111111-0000-4000-5050-000000000001');
update public.order_parts set approved_by_customer = true, approved_at = now() where order_id = :'ord2';
select test.become('22222222-0000-4000-5050-000000000002');
select public.record_completion_evidence(:'ord2', 50250, test.completion_photos(:'ord2'), 30);
update public.orders set status = 'awaiting_approval' where id = :'ord2';

reset role;
update public.platform_settings set value = '"moyasar"' where key = 'payments_gateway';
insert into auth.users (id, phone) values ('33333333-0000-4000-5050-000000000003', '+966509500003');
insert into public.profiles (id, full_name, phone)
values ('33333333-0000-4000-5050-000000000003', 'المشغّل', '+966509500003');
select test.grant_role('33333333-0000-4000-5050-000000000003', 'ops');

set role authenticated;
select test.become('33333333-0000-4000-5050-000000000003');
select public.ops_confirm_completion(:'ord2', 'أكّد العميل الإنجاز هاتفياً');
select test.assert_eq(
  (select string_agg(h ->> 'kind', ',' order by h ->> 'created_at')
     from jsonb_array_elements(public.ops_order_detail(:'ord') -> 'payment_holds') h),
  'initial,top_up', 'the operator sees both holds on the order (0079)');
reset role;

select test.assert_eq(
  (select count(*)::int from public.payment_operations
    where order_id = :'ord2' and kind = 'capture' and status = 'pending'
      and payment_id = 'pay_initial_5051'),
  1, 'what is held is captured');
select test.assert(
  exists (select 1 from public.payment_operations
           where order_id = :'ord2' and kind = 'capture' and status = 'failed'
             and last_error like '%فرق الفاتورة%'),
  'and the uncovered difference is on the operator''s list, not dropped');


-- A refund is split across what was taken --------------------------------------------
insert into public.payment_operations (order_id, kind, amount, reason)
values (:'ord', 'refund', (select total_amount from public.orders where id = :'ord'), 'استرداد كامل');
select test.assert_eq(
  (select count(*)::int from public.payment_operations
    where order_id = :'ord' and kind = 'refund' and payment_id is not null),
  2, 'a full refund goes back to both payments');
select test.assert_eq(
  (select sum(amount) from public.payment_operations where order_id = :'ord' and kind = 'refund'),
  (select total_amount from public.orders where id = :'ord'),
  'for exactly the total, no more');


-- A booking hold that lapsed before the job (0080) ---------------------------------
update public.platform_settings set value = '"dev"' where key = 'payments_gateway';
set role authenticated;
select test.become('11111111-0000-4000-5050-000000000001');
select public.create_emergency_order(
  :'svc', 50.2084, 26.2173, 'd0000000-0000-4000-5050-000000000001',
  'الخبر', 'موعد بعيد', 50300, '[]'::jsonb) as ord3 \gset
select public.authorise_order_payment(:'ord3', 'pay_initial_5053');
select public.submit_order(:'ord3');
select test.become('22222222-0000-4000-5050-000000000002');
select public.accept_order(:'ord3');
update public.orders set status = 'en_route' where id = :'ord3';
update public.orders set status = 'arrived' where id = :'ord3';
update public.orders set status = 'in_progress' where id = :'ord3';
select public.record_completion_evidence(:'ord3', 50350, test.completion_photos(:'ord3'), 30);
update public.orders set status = 'awaiting_approval' where id = :'ord3';
reset role;

-- The card network let the booking hold go eight days ago.
update public.payment_holds set created_at = now() - interval '8 days' where order_id = :'ord3';

set role authenticated;
select test.become('11111111-0000-4000-5050-000000000001');
select test.assert_eq(
  public.order_top_up_due(:'ord3'),
  (select total_amount from public.orders where id = :'ord3'),
  'a lapsed hold does not count: the whole bill is due again, with no parts at all');
select test.assert_raises(
  format($$update public.orders set status = 'completed' where id = %L$$, :'ord3'),
  'and the customer is asked for it before confirming', '23514');
select public.authorise_order_top_up(:'ord3', 'pay_renewed_5053', public.order_top_up_due(:'ord3'));
update public.orders set status = 'completed' where id = :'ord3';
reset role;

update public.platform_settings set value = '"moyasar"' where key = 'payments_gateway';
set role authenticated;
select test.become('11111111-0000-4000-5050-000000000001');
select public.capture_order_payment(:'ord3');
reset role;

select test.assert_eq(
  (select string_agg(payment_id, ',') from public.payment_operations
    where order_id = :'ord3' and kind = 'capture'),
  'pay_renewed_5053', 'only the live hold is sent to the gateway');
select test.assert_eq(
  (select status from public.payment_holds where payment_id = 'pay_initial_5053'), 'expired',
  'the lapsed one is marked expired, not captured and not voided');

rollback;

\echo '   payment top-up OK'
