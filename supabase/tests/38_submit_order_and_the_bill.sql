-- 38 — The customer's request goes somewhere, and the job ends with a bill
--
-- Companion to 0065. Walked in the order the app walks it: create, fund,
-- submit, accept, work, hand back — with nobody setting a status or an amount
-- by hand along the way.

\echo '── submit order and the bill'

begin;

insert into auth.users (id, phone) values
  ('11111111-0000-4000-e800-000000000001', '+966508100001'),  -- customer
  ('22222222-0000-4000-e800-000000000002', '+966508100002'),  -- technician
  ('33333333-0000-4000-e800-000000000003', '+966508100003'),  -- workshop owner
  ('44444444-0000-4000-e800-000000000004', '+966508100004');  -- stranger

insert into public.profiles (id, full_name, phone) values
  ('11111111-0000-4000-e800-000000000001', 'العميل', '+966508100001'),
  ('22222222-0000-4000-e800-000000000002', 'الفنّي', '+966508100002'),
  ('33333333-0000-4000-e800-000000000003', 'الورشة', '+966508100003'),
  ('44444444-0000-4000-e800-000000000004', 'غريب', '+966508100004');

insert into public.cities (id, name_ar, name_en, region_ar, region_en, centroid) values
  ('c0000000-0000-4000-e800-000000000001', 'الدمام', 'DammamSubmit', 'الشرقية', 'Eastern',
   extensions.st_point(50.1033, 26.4207)::extensions.geography);

insert into public.vehicle_makes (id, name_ar, name_en) values
  ('a0000000-0000-4000-e800-000000000001', 'ماركة', 'TestMakeSubmit');
insert into public.vehicle_models (id, make_id, name_ar, name_en, year_from) values
  ('b0000000-0000-4000-e800-000000000001', 'a0000000-0000-4000-e800-000000000001',
   'موديل', 'TestModelSubmit', 2015);
insert into public.vehicles (id, owner_id, make_id, model_id, year, plate_en, current_mileage) values
  ('d0000000-0000-4000-e800-000000000001', '11111111-0000-4000-e800-000000000001',
   'a0000000-0000-4000-e800-000000000001', 'b0000000-0000-4000-e800-000000000001',
   2022, 'ABJ 3838', 30000);

insert into public.providers
  (id, owner_profile_id, provider_type, business_name_ar, cr_number, verification_status,
   is_online, city_id, acceptance_rate)
values
  ('e0000000-0000-4000-e800-000000000001', '22222222-0000-4000-e800-000000000002',
   'individual', 'فنّي البطاريات', null, 'approved', true,
   'c0000000-0000-4000-e800-000000000001', 90),
  ('e0000000-0000-4000-e800-000000000002', '33333333-0000-4000-e800-000000000003',
   'workshop', 'ورشة الاختبار', '4040404040', 'approved', false,
   'c0000000-0000-4000-e800-000000000001', 90);

select id as svc_battery from public.services where name_en = 'Battery jump or replacement' \gset
select base_price as battery_price from public.services where name_en = 'Battery jump or replacement' \gset
select id as svc_oil from public.services where name_en = 'Oil and filter change' \gset

insert into public.provider_services (provider_id, service_id) values
  ('e0000000-0000-4000-e800-000000000001', :'svc_battery'),
  ('e0000000-0000-4000-e800-000000000002', :'svc_oil');

insert into public.provider_locations (provider_id, location, updated_at) values
  ('e0000000-0000-4000-e800-000000000001',
   extensions.st_point(50.1040, 26.4210)::extensions.geography, now());

insert into public.workshops (provider_id, address_ar, location, bay_count, opening_hours)
values ('e0000000-0000-4000-e800-000000000002', 'طريق الملك فهد، الدمام',
        extensions.st_point(50.11, 26.43)::extensions.geography, 2,
        '{"sun": [["08:00","20:00"]]}'::jsonb);

insert into public.appointment_slots (id, provider_id, starts_at, ends_at, capacity)
values ('50000000-0000-4000-e800-000000000001', 'e0000000-0000-4000-e800-000000000002',
        now() + interval '2 days', now() + interval '2 days 1 hour', 2);


-- Emergency: nothing moves until the customer commits -------------------------
select test.become('11111111-0000-4000-e800-000000000001');

select public.create_emergency_order(
  :'svc_battery', 50.1035, 26.4209, 'd0000000-0000-4000-e800-000000000001',
  'حي الشاطئ', 'البطارية فصلت', 30100) as emergency \gset

select test.assert_eq(
  (select count(*)::int from public.order_offers where order_id = :'emergency'),
  0, 'a created order is not broadcast until it is submitted');

select test.assert_raises(
  format($$select public.submit_order('%s')$$, :'emergency'),
  'an unfunded order cannot be submitted — nobody drives out on it',
  '23514');

select test.become('44444444-0000-4000-e800-000000000004');
select test.assert_raises(
  format($$select public.submit_order('%s')$$, :'emergency'),
  'only the customer submits their order',
  '42501');

select test.become('11111111-0000-4000-e800-000000000001');
select public.authorise_order_payment(:'emergency', 'intent_submit_1');

select test.assert_eq(
  public.submit_order(:'emergency'), 'searching'::order_status,
  'a funded emergency is submitted into the search');

select test.assert(
  (select count(*) > 0 from public.order_offers where order_id = :'emergency'),
  'and is broadcast to the nearby technician');

select test.assert_eq(
  public.submit_order(:'emergency'), 'searching'::order_status,
  'submitting again after a dropped response is not an error');


-- The technician accepts and works it ---------------------------------------------
select test.become('22222222-0000-4000-e800-000000000002');

select test.assert(
  exists (select 1 from public.list_open_orders_for_provider() where order_id = :'emergency'),
  'the technician sees it among their open jobs');

select test.assert(public.accept_order(:'emergency'), 'the technician accepts it');

update public.orders set status = 'en_route' where id = :'emergency';
update public.orders set status = 'arrived' where id = :'emergency';
update public.orders set status = 'in_progress' where id = :'emergency';
-- The warranty is given with the evidence, in the one hand-back call.
select public.record_completion_evidence(:'emergency', 30150,
  test.completion_photos(:'emergency'), 90);
update public.orders set status = 'awaiting_approval' where id = :'emergency';


-- The bill is the server's ----------------------------------------------------------
select test.assert_eq(
  (select labour_amount from public.orders where id = :'emergency'),
  (:'battery_price')::numeric, 'labour is the catalogue price the customer was shown');

select test.assert_eq(
  (select vat_amount from public.orders where id = :'emergency'),
  round((:'battery_price')::numeric * public.vat_rate_on(current_date), 2),
  'VAT is the rate in force, rounded to the halala');

select test.assert_eq(
  (select total_amount from public.orders where id = :'emergency'),
  round((:'battery_price')::numeric * (1 + public.vat_rate_on(current_date)), 2),
  'the total is labour plus VAT, with nobody having typed it');

select test.become('11111111-0000-4000-e800-000000000001');
update public.orders set status = 'completed' where id = :'emergency';
select public.capture_order_payment(:'emergency');

select test.assert_eq(
  (select escrow_status from public.orders where id = :'emergency'),
  'captured'::escrow_status, 'the customer confirms and the payment is captured');

select test.assert_eq(
  (select warranty_days from public.orders where id = :'emergency'),
  90, 'the warranty the technician gave at hand-back is on the job');


-- Approved parts are on the bill; unapproved ones never are ---------------------------
select public.create_emergency_order(
  :'svc_battery', 50.1035, 26.4209, 'd0000000-0000-4000-e800-000000000001',
  null, 'بطارية جديدة', 30200) as with_parts \gset
select public.authorise_order_payment(:'with_parts', 'intent_submit_2');
select public.submit_order(:'with_parts');

select test.become('22222222-0000-4000-e800-000000000002');
select public.accept_order(:'with_parts');
update public.orders set status = 'en_route' where id = :'with_parts';
update public.orders set status = 'arrived' where id = :'with_parts';
update public.orders set status = 'in_progress' where id = :'with_parts';

insert into public.order_parts (order_id, name_ar, quantity, unit_price)
values (:'with_parts', 'بطارية ٧٠ أمبير', 1, 350.00);

-- The customer approves it, as they would from the quote screen (0067: a
-- line cannot be inserted already approved).
select test.become('11111111-0000-4000-e800-000000000001');
update public.order_parts set approved_by_customer = true, approved_at = now()
 where order_id = :'with_parts';
select test.become('22222222-0000-4000-e800-000000000002');

select test.assert_raises(
  format($$select public.record_completion_evidence('%s', 30210, '[]'::jsonb, 400)$$, :'with_parts'),
  'a warranty longer than a year is refused', '22023');

select public.record_completion_evidence(:'with_parts', 30210,
  test.completion_photos(:'with_parts'));
update public.orders set status = 'awaiting_approval' where id = :'with_parts';

select test.assert_eq(
  (select parts_amount from public.orders where id = :'with_parts'),
  350.00::numeric, 'the approved part is on the bill');

select test.assert_eq(
  (select total_amount from public.orders where id = :'with_parts'),
  round(((:'battery_price')::numeric + 350.00) * (1 + public.vat_rate_on(current_date)), 2),
  'VAT covers labour and parts together');


-- An amount set explicitly is not overwritten ------------------------------------------
select test.become('11111111-0000-4000-e800-000000000001');
select public.create_emergency_order(
  :'svc_battery', 50.1035, 26.4209, 'd0000000-0000-4000-e800-000000000001',
  null, null, 30300) as explicit \gset
select public.authorise_order_payment(:'explicit', 'intent_submit_3');
select public.submit_order(:'explicit');
select test.become('22222222-0000-4000-e800-000000000002');
select public.accept_order(:'explicit');
update public.orders set status = 'en_route' where id = :'explicit';
update public.orders set status = 'arrived' where id = :'explicit';
update public.orders set status = 'in_progress' where id = :'explicit';
select public.record_completion_evidence(:'explicit', 30310, test.completion_photos(:'explicit'));
update public.orders
   set labour_amount = 100, parts_amount = 0, vat_amount = 15, total_amount = 115
 where id = :'explicit';
update public.orders set status = 'awaiting_approval' where id = :'explicit';

select test.assert_eq(
  (select total_amount from public.orders where id = :'explicit'),
  115.00::numeric, 'a bill that was already set is left alone');


-- Booking: submitting confirms it with the provider the customer chose -------------------
select test.become('11111111-0000-4000-e800-000000000001');

select public.book_appointment(
  '50000000-0000-4000-e800-000000000001', :'svc_oil',
  'd0000000-0000-4000-e800-000000000001', 'تغيير زيت', 30400) as booking \gset

select test.assert_raises(
  format($$select public.submit_order('%s')$$, :'booking'),
  'an unfunded booking is not confirmed',
  '23514');

select public.authorise_order_payment(:'booking', 'intent_submit_4');

select test.assert_eq(
  public.submit_order(:'booking'), 'accepted'::order_status,
  'a funded booking is confirmed with the workshop the customer chose');

select test.become('33333333-0000-4000-e800-000000000003');
select public.check_in_vehicle(:'booking');
select test.assert_eq(
  (select status from public.orders where id = :'booking'),
  'checked_in'::order_status, 'and the workshop can check the car in');


-- A free warranty re-service needs no payment to be submitted ----------------------------
select test.become('11111111-0000-4000-e800-000000000001');
select public.claim_warranty(:'emergency', 'البطارية فصلت مرة ثانية') as warranty_claim \gset

select test.assert_eq(
  public.submit_order(:'warranty_claim'), 'searching'::order_status,
  'a zero-amount re-service goes out without a payment authorisation');

-- A booking is quoted at the price the customer chose it for -----------------------------
select id as svc_brakes from public.services where name_en = 'Brake inspection' \gset

insert into public.appointment_slots (id, provider_id, starts_at, ends_at, capacity)
values ('50000000-0000-4000-e800-000000000002', 'e0000000-0000-4000-e800-000000000002',
        now() + interval '3 days', now() + interval '3 days 1 hour', 3);

update public.provider_services set custom_price = 150.00
 where provider_id = 'e0000000-0000-4000-e800-000000000002' and service_id = :'svc_oil';
insert into public.provider_services (provider_id, service_id)
values ('e0000000-0000-4000-e800-000000000002', :'svc_brakes');

select test.become('11111111-0000-4000-e800-000000000001');
select public.book_appointment(
  '50000000-0000-4000-e800-000000000002', :'svc_oil',
  'd0000000-0000-4000-e800-000000000001', null, 30500) as custom_booking \gset

select test.assert_eq(
  (select quoted_amount from public.orders where id = :'custom_booking'),
  150.00::numeric, 'the workshop''s own price, as shown on its card, not the catalogue''s 180');

select test.assert_raises(
  $$select public.book_appointment(
      '50000000-0000-4000-e800-000000000002',
      (select id from public.services where name_en = 'Brake inspection'),
      'd0000000-0000-4000-e800-000000000001', null, 30500)$$,
  'a service nobody has priced cannot be booked — it would be done for nothing',
  '23514');

select test.assert_eq(
  (select booked_count from public.appointment_slots
    where id = '50000000-0000-4000-e800-000000000002'),
  1, 'and the refused booking did not keep a place in the slot');

rollback;

\echo '   submit order and the bill OK'
