-- 72 — The sealed logbook, on all three surfaces
--
-- Companion to 0108.

\echo '── logbook seal'

begin;

insert into auth.users (id, phone) values
  ('11111111-0000-4000-7272-000000000001', '+966509690001'),
  ('22222222-0000-4000-7272-000000000002', '+966509690002'),
  ('44444444-0000-4000-7272-000000000004', '+966509690004'),
  ('66666666-0000-4000-7272-000000000006', '+966509690006');

insert into public.profiles (id, full_name, phone) values
  ('11111111-0000-4000-7272-000000000001', 'العميل', '+966509690001'),
  ('22222222-0000-4000-7272-000000000002', 'الفنّي', '+966509690002'),
  ('44444444-0000-4000-7272-000000000004', 'غريب', '+966509690004'),
  ('66666666-0000-4000-7272-000000000006', 'التشغيل', '+966509690006');
select test.grant_role('66666666-0000-4000-7272-000000000006', 'ops');

insert into public.cities (id, name_ar, name_en, region_ar, region_en, centroid) values
  ('c0000000-0000-4000-7272-000000000001', 'الدمام', 'DammamSeal', 'الشرقية', 'Eastern',
   extensions.st_point(50.1033, 26.4207)::extensions.geography);
insert into public.vehicle_makes (id, name_ar, name_en) values
  ('a0000000-0000-4000-7272-000000000001', 'ماركة', 'TestMakeSeal');
insert into public.vehicle_models (id, make_id, name_ar, name_en, year_from) values
  ('b0000000-0000-4000-7272-000000000001', 'a0000000-0000-4000-7272-000000000001',
   'موديل', 'TestModelSeal', 2015);
insert into public.vehicles (id, owner_id, make_id, model_id, year, plate_en, current_mileage) values
  ('d0000000-0000-4000-7272-000000000001', '11111111-0000-4000-7272-000000000001',
   'a0000000-0000-4000-7272-000000000001', 'b0000000-0000-4000-7272-000000000001',
   2022, 'ABD 7272', 30000);

insert into public.providers
  (id, owner_profile_id, provider_type, business_name_ar, verification_status,
   is_online, city_id, acceptance_rate)
values
  ('e0000000-0000-4000-7272-000000000001', '22222222-0000-4000-7272-000000000002',
   'individual', 'فنّي البطاريات', 'approved', true,
   'c0000000-0000-4000-7272-000000000001', 90);
select test.grant_role('22222222-0000-4000-7272-000000000002', 'technician');

select id as svc_battery from public.services where name_en = 'Battery jump or replacement' \gset
insert into public.provider_services (provider_id, service_id) values
  ('e0000000-0000-4000-7272-000000000001', :'svc_battery');
insert into public.provider_locations (provider_id, location, updated_at) values
  ('e0000000-0000-4000-7272-000000000001',
   extensions.st_point(50.1040, 26.4210)::extensions.geography, now());

-- The original job, done and approved, with 90 days of cover.
select test.become('11111111-0000-4000-7272-000000000001');
select public.create_emergency_order(
  :'svc_battery', 50.1035, 26.4209, 'd0000000-0000-4000-7272-000000000001',
  'حي الشاطئ', 'البطارية فصلت', 30100) as job \gset
select public.authorise_order_payment(:'job', 'intent_seal_1');
select public.submit_order(:'job');

select test.become('22222222-0000-4000-7272-000000000002');
select public.accept_order(:'job');
update public.orders set status = 'en_route' where id = :'job';
update public.orders set status = 'arrived' where id = :'job';
update public.orders set status = 'in_progress' where id = :'job';
select public.record_completion_evidence(:'job', 30150, test.completion_photos(:'job'), 90);
update public.orders set status = 'awaiting_approval' where id = :'job';

select test.become('11111111-0000-4000-7272-000000000001');
update public.orders set status = 'completed' where id = :'job';

-- The original job is logged as Habba-verified. Its warranty claim is the
-- live job the technician is on.
select public.request_warranty_service(:'job', 'البطارية فصلت مرة ثانية بعد أسبوع') as live \gset

select test.assert_eq(
  (select is_valid from public.logbook_seal('d0000000-0000-4000-7272-000000000001')), true,
  'the owner sees their logbook is sealed');
select test.assert(
  (select verified_entries >= 1 and entries >= verified_entries
     from public.logbook_seal('d0000000-0000-4000-7272-000000000001')),
  'and how much of it Habba verified');
select test.assert_eq(
  (select odometer_replaced from public.logbook_seal('d0000000-0000-4000-7272-000000000001')), false,
  'and that the odometer was never replaced');
select test.assert_raises(
  $$select * from public.job_vehicle_history('00000000-0000-4000-7272-000000000099')$$,
  'a customer cannot read a job''s history as a provider', '42501');

select test.become('44444444-0000-4000-7272-000000000004');
select test.assert_raises(
  $$select * from public.logbook_seal('d0000000-0000-4000-7272-000000000001')$$,
  'nobody else can read the seal', '42501');

select test.become('22222222-0000-4000-7272-000000000002');
select test.assert_eq(
  (public.job_vehicle_history(:'live') ->> 'is_valid')::boolean, true,
  'the technician on the live job sees the history is sealed');
select test.assert(
  exists (select 1 from jsonb_array_elements(public.job_vehicle_history(:'live') -> 'events') e
           where e ->> 'event_type' = 'service_completed' and e ->> 'provenance' = 'habba_verified'),
  'and the earlier job, as Habba verified');
select test.assert(
  not exists (select 1 from jsonb_array_elements(public.job_vehicle_history(:'live') -> 'events') e
               where e ? 'details' or e ? 'attachments'),
  'summaries only: no details, no photos');
select test.assert_raises(
  format($$select public.job_vehicle_history('%s')$$, :'job'),
  'a finished job no longer opens the car''s history', '42501');

reset role;
update public.platform_settings set value = 'false' where key = 'feature_job_history';
set role authenticated;
select test.become('22222222-0000-4000-7272-000000000002');
select test.assert_raises(
  format($$select public.job_vehicle_history('%s')$$, :'live'),
  'ops can switch it off', '23514');
reset role;
update public.platform_settings set value = 'true' where key = 'feature_job_history';

set role authenticated;
select test.become('66666666-0000-4000-7272-000000000006');
select test.assert_eq(
  (public.ops_vehicle_detail('d0000000-0000-4000-7272-000000000001') -> 'chain' ->> 'is_valid')::boolean,
  true, 'the vehicle file shows the chain is intact');
select test.assert(
  not exists (select 1 from jsonb_array_elements(public.ops_verify_timelines() -> 'broken') b
               where b ->> 'vehicle_id' = 'd0000000-0000-4000-7272-000000000001'),
  'the sweep finds nothing wrong with it');

-- Tamper as someone with database access would.
reset role;
alter table public.vehicle_timeline disable trigger vehicle_timeline_no_update_delete;
update public.vehicle_timeline set mileage = 100
 where vehicle_id = 'd0000000-0000-4000-7272-000000000001' and mileage is not null;
alter table public.vehicle_timeline enable always trigger vehicle_timeline_no_update_delete;

set role authenticated;
select test.become('66666666-0000-4000-7272-000000000006');
select test.assert(
  exists (select 1 from jsonb_array_elements(public.ops_verify_timelines() -> 'broken') b
           where b ->> 'vehicle_id' = 'd0000000-0000-4000-7272-000000000001'),
  'the sweep catches an edited row');
select test.assert(
  exists (select 1 from public.audit_log
           where target_table = 'vehicle_timeline' and actor_id = '66666666-0000-4000-7272-000000000006'),
  'and the sweep is on the audit log');
select test.become('11111111-0000-4000-7272-000000000001');
select test.assert_eq(
  (select is_valid from public.logbook_seal('d0000000-0000-4000-7272-000000000001')), false,
  'and the owner''s seal shows it broken');

select test.become('11111111-0000-4000-7272-000000000001');
select test.assert_raises($$select public.ops_verify_timelines()$$, 'a customer cannot sweep', '42501');

reset role;
rollback;
