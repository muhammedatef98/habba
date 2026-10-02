-- 44 — An order the customer never confirms still ends
--
-- Companion to 0071.

\echo '── orders close without the customer'

begin;

insert into auth.users (id, phone) values
  ('11111111-0000-4000-ee00-000000000001', '+966509600001'),  -- customer
  ('22222222-0000-4000-ee00-000000000002', '+966509600002');  -- technician

insert into public.profiles (id, full_name, phone) values
  ('11111111-0000-4000-ee00-000000000001', 'العميل الغائب', '+966509600001'),
  ('22222222-0000-4000-ee00-000000000002', 'الفنّي', '+966509600002');

insert into public.cities (id, name_ar, name_en, region_ar, region_en, centroid) values
  ('c0000000-0000-4000-ee00-000000000001', 'الجبيل', 'JubailTimeout', 'الشرقية', 'Eastern',
   extensions.st_point(49.6583, 27.0046)::extensions.geography);

insert into public.vehicle_makes (id, name_ar, name_en) values
  ('a0000000-0000-4000-ee00-000000000001', 'ماركة', 'TestMakeTimeout');
insert into public.vehicle_models (id, make_id, name_ar, name_en, year_from) values
  ('b0000000-0000-4000-ee00-000000000001', 'a0000000-0000-4000-ee00-000000000001',
   'موديل', 'TestModelTimeout', 2015);
insert into public.vehicles (id, owner_id, make_id, model_id, year, plate_en, current_mileage) values
  ('d0000000-0000-4000-ee00-000000000001', '11111111-0000-4000-ee00-000000000001',
   'a0000000-0000-4000-ee00-000000000001', 'b0000000-0000-4000-ee00-000000000001',
   2020, 'KND 4444', 70000);

insert into public.providers
  (id, owner_profile_id, provider_type, business_name_ar, verification_status, is_online,
   city_id, acceptance_rate)
values
  ('e0000000-0000-4000-ee00-000000000001', '22222222-0000-4000-ee00-000000000002',
   'individual', 'فنّي الجبيل', 'approved', true, 'c0000000-0000-4000-ee00-000000000001', 90);

select id as svc from public.services where name_en = 'Battery jump or replacement' \gset

insert into public.provider_services (provider_id, service_id) values
  ('e0000000-0000-4000-ee00-000000000001', :'svc');
insert into public.provider_locations (provider_id, location, updated_at) values
  ('e0000000-0000-4000-ee00-000000000001',
   extensions.st_point(49.6590, 27.0050)::extensions.geography, now());

set role authenticated;

select test.become('11111111-0000-4000-ee00-000000000001');

select test.assert_raises(
  $$select public.begin_privileged_write()$$,
  'no client can switch the guards off, even for its own transaction', '42501');

select public.create_emergency_order(
  :'svc', 49.6585, 27.0048, 'd0000000-0000-4000-ee00-000000000001',
  'الجبيل البلد', 'البطارية فارغة', 70100, '[]'::jsonb) as ord \gset
select public.authorise_order_payment(:'ord', 'intent_timeout_1');
select public.submit_order(:'ord');

select test.become('22222222-0000-4000-ee00-000000000002');
select public.accept_order(:'ord');
update public.orders set status = 'en_route' where id = :'ord';
update public.orders set status = 'arrived' where id = :'ord';
update public.orders set status = 'in_progress' where id = :'ord';
select public.record_completion_evidence(:'ord', 70150, test.completion_photos(:'ord'), 30);
update public.orders set status = 'awaiting_approval' where id = :'ord';

select test.assert_raises(
  $$select * from public.auto_complete_awaiting_orders()$$,
  'the provider cannot close their own job by calling the clock', '42501');

-- The customer never comes back. The scheduler runs as the service role,
-- with no user behind it.
reset role;
select test.become_anon();
set role service_role;

select test.assert(
  not exists (select 1 from public.auto_complete_awaiting_orders(500, now()) where order_id = :'ord'),
  'a job just handed back is left alone');

select test.assert(
  exists (select 1 from public.auto_complete_awaiting_orders(500, now() + interval '13 hours')
           where order_id = :'ord' and outcome = 'reminded'),
  'half-way through the window the customer is reminded');

select * from public.auto_complete_awaiting_orders(500, now() + interval '14 hours');

reset role;
select test.assert_eq(
  (select count(*)::int from public.notification_outbox
    where user_id = '11111111-0000-4000-ee00-000000000001' and kind = 'approval_reminder'),
  1, 'once — a second pass does not remind them again');
set role service_role;

select test.assert(
  exists (select 1 from public.auto_complete_awaiting_orders(500, now() + interval '25 hours')
           where order_id = :'ord' and outcome = 'completed'),
  'past the window the order completes by itself');
reset role;

select test.assert(
  (select status = 'completed' and completed_by_timeout and escrow_status = 'captured'
     from public.orders where id = :'ord'),
  'marked as completed by timeout, with the payment captured');

select test.assert(
  (select (details ->> 'completed_by_timeout')::boolean
          and created_by = '11111111-0000-4000-ee00-000000000001'
     from public.vehicle_timeline where order_id = :'ord'),
  'the logbook has the service, and says nobody confirmed it');

select test.assert(
  (select is_valid from public.verify_vehicle_timeline('d0000000-0000-4000-ee00-000000000001')),
  'and the chain still verifies');

select test.assert(
  exists (select 1 from public.notification_outbox
           where user_id = '11111111-0000-4000-ee00-000000000001' and kind = 'order_auto_completed'),
  'the customer is told the order closed, and how to report a problem');

set role authenticated;
select test.become('11111111-0000-4000-ee00-000000000001');
select public.open_order_dispute(:'ord', 'لم أكن متاحاً، والبطارية فصلت مجدداً');
select test.assert_eq(
  (select status::text from public.orders where id = :'ord'), 'disputed',
  'and can still complain about it afterwards');

reset role;
rollback;

\echo '   orders close without the customer OK'
