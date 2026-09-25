-- 40 — Parts: quoted while the job is open, answered by the customer
--
-- Companion to 0067.

\echo '── parts answered before hand-back'

begin;

insert into auth.users (id, phone) values
  ('11111111-0000-4000-ea00-000000000001', '+966509200001'),  -- customer
  ('22222222-0000-4000-ea00-000000000002', '+966509200002'),  -- technician
  ('33333333-0000-4000-ea00-000000000003', '+966509200003');  -- another technician

insert into public.profiles (id, full_name, phone) values
  ('11111111-0000-4000-ea00-000000000001', 'العميل', '+966509200001'),
  ('22222222-0000-4000-ea00-000000000002', 'الفنّي', '+966509200002'),
  ('33333333-0000-4000-ea00-000000000003', 'فنّي آخر', '+966509200003');

insert into public.cities (id, name_ar, name_en, region_ar, region_en, centroid) values
  ('c0000000-0000-4000-ea00-000000000001', 'الدمام', 'DammamParts', 'الشرقية', 'Eastern',
   extensions.st_point(50.1033, 26.4207)::extensions.geography);

insert into public.vehicle_makes (id, name_ar, name_en) values
  ('a0000000-0000-4000-ea00-000000000001', 'ماركة', 'TestMakeParts');
insert into public.vehicle_models (id, make_id, name_ar, name_en, year_from) values
  ('b0000000-0000-4000-ea00-000000000001', 'a0000000-0000-4000-ea00-000000000001',
   'موديل', 'TestModelParts', 2015);
insert into public.vehicles (id, owner_id, make_id, model_id, year, plate_en, current_mileage) values
  ('d0000000-0000-4000-ea00-000000000001', '11111111-0000-4000-ea00-000000000001',
   'a0000000-0000-4000-ea00-000000000001', 'b0000000-0000-4000-ea00-000000000001',
   2022, 'ABJ 4040', 30000);

insert into public.providers
  (id, owner_profile_id, provider_type, business_name_ar, verification_status, is_online, city_id, acceptance_rate)
values
  ('e0000000-0000-4000-ea00-000000000001', '22222222-0000-4000-ea00-000000000002',
   'individual', 'فنّي القطع', 'approved', true, 'c0000000-0000-4000-ea00-000000000001', 90),
  ('e0000000-0000-4000-ea00-000000000002', '33333333-0000-4000-ea00-000000000003',
   'individual', 'فنّي آخر', 'approved', true, 'c0000000-0000-4000-ea00-000000000001', 90);

select id as svc_battery from public.services where name_en = 'Battery jump or replacement' \gset
insert into public.provider_services (provider_id, service_id) values
  ('e0000000-0000-4000-ea00-000000000001', :'svc_battery');
insert into public.provider_locations (provider_id, location, updated_at) values
  ('e0000000-0000-4000-ea00-000000000001',
   extensions.st_point(50.1040, 26.4210)::extensions.geography, now());

select test.become('11111111-0000-4000-ea00-000000000001');
select public.create_emergency_order(:'svc_battery', 50.1035, 26.4209,
  'd0000000-0000-4000-ea00-000000000001', null, 'البطارية', 30100) as job \gset
select public.authorise_order_payment(:'job', 'intent_parts_1');
select public.submit_order(:'job');

select test.become('22222222-0000-4000-ea00-000000000002');
select public.accept_order(:'job');
update public.orders set status = 'en_route' where id = :'job';
update public.orders set status = 'arrived' where id = :'job';
update public.orders set status = 'in_progress' where id = :'job';


-- Quoting --------------------------------------------------------------------------------
set role authenticated;
select test.become('22222222-0000-4000-ea00-000000000002');

insert into public.order_parts
  (id, order_id, name_ar, part_number, is_oem, quantity, unit_price, approved_by_customer, approved_at)
values
  ('10000000-0000-4000-ea00-000000000001', :'job', 'بطارية ٧٠ أمبير', 'BAT-70A', false, 1, 350.00, true, now()),
  ('10000000-0000-4000-ea00-000000000002', :'job', 'أطراف بطارية', null, true, 2, 25.00, false, null);

select test.assert(
  (select not approved_by_customer and approved_at is null
     from public.order_parts where id = '10000000-0000-4000-ea00-000000000001'),
  'a line inserted "already approved" arrives unapproved — the hole 0067 closes');

select test.assert_raises(
  format($$insert into public.order_parts (order_id, name_ar, quantity, unit_price)
           values ('%s', '   ', 1, 10)$$, :'job'),
  'a part needs a name', '23514');

select test.become('33333333-0000-4000-ea00-000000000003');
select test.assert_raises(
  format($$insert into public.order_parts (order_id, name_ar, quantity, unit_price)
           values ('%s', 'قطعة دخيلة', 1, 999)$$, :'job'),
  'another technician cannot quote on this job', '42501');

select test.become('11111111-0000-4000-ea00-000000000001');
select test.assert_raises(
  format($$insert into public.order_parts (order_id, name_ar, quantity, unit_price)
           values ('%s', 'قطعة', 1, 1)$$, :'job'),
  'the customer cannot write the quote', '42501');


-- Answering ------------------------------------------------------------------------------
select test.become('22222222-0000-4000-ea00-000000000002');
select test.assert_raises(
  $$update public.order_parts set approved_by_customer = true, approved_at = now()
     where id = '10000000-0000-4000-ea00-000000000001'$$,
  'the technician cannot approve their own quote', '42501');

select test.become('11111111-0000-4000-ea00-000000000001');
select test.assert_raises(
  $$update public.order_parts set unit_price = 1
     where id = '10000000-0000-4000-ea00-000000000001'$$,
  'the customer cannot change a price, only answer it', '42501');

update public.order_parts set declined_at = now()
 where id = '10000000-0000-4000-ea00-000000000002';

select test.assert_raises(
  $$update public.order_parts set approved_by_customer = true, approved_at = now()
     where id = '10000000-0000-4000-ea00-000000000002'$$,
  'a line cannot be both approved and declined', '23514');
reset role;


-- Hand-back waits for every answer ------------------------------------------------------------
select test.become('22222222-0000-4000-ea00-000000000002');
select public.record_completion_evidence(:'job', 30150, test.completion_photos(:'job'), 30);

select test.assert_raises(
  format($$update public.orders set status = 'awaiting_approval' where id = '%s'$$, :'job'),
  'hand-back is refused while a quoted part has no answer', '23514');

set role authenticated;
select test.become('22222222-0000-4000-ea00-000000000002');
select test.assert_raises(
  $$delete from public.order_parts where id = '10000000-0000-4000-ea00-000000000002'$$,
  'a declined line stays on the record', '23514');

-- The technician corrects the price after it was answered; the answer lapses.
select test.become('11111111-0000-4000-ea00-000000000001');
update public.order_parts set approved_by_customer = true, approved_at = now()
 where id = '10000000-0000-4000-ea00-000000000001';
select test.become('22222222-0000-4000-ea00-000000000002');
update public.order_parts set unit_price = 320.00
 where id = '10000000-0000-4000-ea00-000000000001';
reset role;

select test.assert(
  (select not approved_by_customer from public.order_parts
    where id = '10000000-0000-4000-ea00-000000000001'),
  'a re-priced line is a new question — the old yes no longer applies');

set role authenticated;
select test.become('11111111-0000-4000-ea00-000000000001');
update public.order_parts set approved_by_customer = true, approved_at = now()
 where id = '10000000-0000-4000-ea00-000000000001';
reset role;

select test.become('22222222-0000-4000-ea00-000000000002');
update public.orders set status = 'awaiting_approval' where id = :'job';

select test.assert_eq(
  (select parts_amount from public.orders where id = :'job'),
  320.00::numeric, 'every line answered: the approved one is billed, the declined one is not');


-- After hand-back the quote is settled ------------------------------------------------------------
set role authenticated;
select test.become('22222222-0000-4000-ea00-000000000002');
select test.assert_raises(
  format($$insert into public.order_parts (order_id, name_ar, quantity, unit_price)
           values ('%s', 'قطعة متأخرة', 1, 50)$$, :'job'),
  'no new parts after hand-back', '23514');
select test.assert_raises(
  $$update public.order_parts set unit_price = 999
     where id = '10000000-0000-4000-ea00-000000000001'$$,
  'no re-pricing after hand-back', '23514');
select test.assert_raises(
  $$delete from public.order_parts where id = '10000000-0000-4000-ea00-000000000001'$$,
  'no removing after hand-back', '23514');

select test.become('11111111-0000-4000-ea00-000000000001');
select test.assert_raises(
  $$update public.order_parts set approved_by_customer = false, approved_at = null
     where id = '10000000-0000-4000-ea00-000000000001'$$,
  'and no changing an answer the bill is already built on', '23514');
reset role;

rollback;

\echo '   parts answered before hand-back OK'
