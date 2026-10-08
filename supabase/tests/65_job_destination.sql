-- 65 — Where the technician is driving to
--
-- Companion to 0099: the assigned technician gets the customer's pin while
-- the job is live; nobody else ever does — not before acceptance (the offer
-- stays masked, ADR-0013), not another technician, not after the job ends.

\echo '── job destination'

begin;

insert into auth.users (id, phone) values
  ('11111111-0000-4000-6565-000000000001', '+966509650001'),
  ('22222222-0000-4000-6565-000000000002', '+966509650002'),
  ('44444444-0000-4000-6565-000000000004', '+966509650004');

insert into public.profiles (id, full_name, phone) values
  ('11111111-0000-4000-6565-000000000001', 'العميل', '+966509650001'),
  ('22222222-0000-4000-6565-000000000002', 'الفنّي', '+966509650002'),
  ('44444444-0000-4000-6565-000000000004', 'فنّي آخر', '+966509650004');

insert into public.cities (id, name_ar, name_en, region_ar, region_en, centroid) values
  ('c0000000-0000-4000-6565-000000000001', 'الدمام', 'DammamDest', 'الشرقية', 'Eastern',
   extensions.st_point(50.1033, 26.4207)::extensions.geography);

insert into public.vehicle_makes (id, name_ar, name_en) values
  ('a0000000-0000-4000-6565-000000000001', 'ماركة', 'TestMakeDest');
insert into public.vehicle_models (id, make_id, name_ar, name_en, year_from) values
  ('b0000000-0000-4000-6565-000000000001', 'a0000000-0000-4000-6565-000000000001',
   'موديل', 'TestModelDest', 2015);
insert into public.vehicles (id, owner_id, make_id, model_id, year, plate_en, current_mileage) values
  ('d0000000-0000-4000-6565-000000000001', '11111111-0000-4000-6565-000000000001',
   'a0000000-0000-4000-6565-000000000001', 'b0000000-0000-4000-6565-000000000001',
   2022, 'ABD 6565', 30000);

insert into public.providers
  (id, owner_profile_id, provider_type, business_name_ar, verification_status,
   is_online, city_id, acceptance_rate)
values
  ('e0000000-0000-4000-6565-000000000001', '22222222-0000-4000-6565-000000000002',
   'individual', 'فنّي البطاريات', 'approved', true,
   'c0000000-0000-4000-6565-000000000001', 90),
  ('e0000000-0000-4000-6565-000000000004', '44444444-0000-4000-6565-000000000004',
   'individual', 'فنّي آخر', 'approved', true,
   'c0000000-0000-4000-6565-000000000001', 90);
select test.grant_role('22222222-0000-4000-6565-000000000002', 'technician');
select test.grant_role('44444444-0000-4000-6565-000000000004', 'technician');

select id as svc_battery from public.services where name_en = 'Battery jump or replacement' \gset
insert into public.provider_services (provider_id, service_id) values
  ('e0000000-0000-4000-6565-000000000001', :'svc_battery'),
  ('e0000000-0000-4000-6565-000000000004', :'svc_battery');
insert into public.provider_locations (provider_id, location, updated_at) values
  ('e0000000-0000-4000-6565-000000000001',
   extensions.st_point(50.1040, 26.4210)::extensions.geography, now()),
  ('e0000000-0000-4000-6565-000000000004',
   extensions.st_point(50.1041, 26.4211)::extensions.geography, now());

select test.become('11111111-0000-4000-6565-000000000001');
select public.create_emergency_order(
  :'svc_battery', 50.1035, 26.4209, 'd0000000-0000-4000-6565-000000000001',
  'حي الشاطئ', 'البطارية فصلت', 30100) as job \gset
select public.authorise_order_payment(:'job', 'intent_dest_1');
select public.submit_order(:'job');

-- Before acceptance: an offer, masked.
select test.become('22222222-0000-4000-6565-000000000002');
select test.assert_eq(
  (select count(*)::int from public.job_destination(:'job')), 0,
  'an offer does not reveal the pin before it is accepted (ADR-0013)');

select test.assert(public.accept_order(:'job'), 'the technician accepts');

select lat, lon from public.job_destination(:'job') \gset
select test.assert(
  abs(:'lat'::float8 - 26.4209) < 0.00001 and abs(:'lon'::float8 - 50.1035) < 0.00001,
  'the assigned technician gets the exact pin the customer placed');

update public.orders set status = 'en_route' where id = :'job';
select test.assert_eq(
  (select count(*)::int from public.job_destination(:'job')), 1,
  'and keeps it while driving there');

-- Nobody else.
select test.become('44444444-0000-4000-6565-000000000004');
select test.assert_eq(
  (select count(*)::int from public.job_destination(:'job')), 0,
  'another technician gets nothing');

select test.become('11111111-0000-4000-6565-000000000001');
select test.assert_eq(
  (select count(*)::int from public.job_destination(:'job')), 0,
  'the customer is not a provider and gets nothing from this');

select test.become_anon();
select test.assert_eq(
  (select count(*)::int from public.job_destination(:'job')), 0,
  'a call with no identity gets nothing');
select test.assert(
  not has_function_privilege('anon', 'public.job_destination(uuid)', 'execute'),
  'and the anonymous role cannot call it at all');

rollback;
