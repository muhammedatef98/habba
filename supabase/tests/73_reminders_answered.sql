-- 73 — Every warning, and whether the owner acted on it
--
-- Companion to 0109.

\echo '── reminders answered'

begin;

insert into auth.users (id, phone) values
  ('11111111-0000-4000-7373-000000000001', '+966509690001'),
  ('22222222-0000-4000-7373-000000000002', '+966509690002'),
  ('44444444-0000-4000-7373-000000000004', '+966509690004'),
  ('66666666-0000-4000-7373-000000000006', '+966509690006');

insert into public.profiles (id, full_name, phone) values
  ('11111111-0000-4000-7373-000000000001', 'العميل', '+966509690001'),
  ('22222222-0000-4000-7373-000000000002', 'الفنّي', '+966509690002'),
  ('44444444-0000-4000-7373-000000000004', 'غريب', '+966509690004'),
  ('66666666-0000-4000-7373-000000000006', 'التشغيل', '+966509690006');
select test.grant_role('66666666-0000-4000-7373-000000000006', 'ops');

insert into public.cities (id, name_ar, name_en, region_ar, region_en, centroid) values
  ('c0000000-0000-4000-7373-000000000001', 'الدمام', 'DammamRemind', 'الشرقية', 'Eastern',
   extensions.st_point(50.1033, 26.4207)::extensions.geography);
insert into public.vehicle_makes (id, name_ar, name_en) values
  ('a0000000-0000-4000-7373-000000000001', 'ماركة', 'TestMakeRemind');
insert into public.vehicle_models (id, make_id, name_ar, name_en, year_from) values
  ('b0000000-0000-4000-7373-000000000001', 'a0000000-0000-4000-7373-000000000001',
   'موديل', 'TestModelRemind', 2015);
insert into public.vehicles (id, owner_id, make_id, model_id, year, plate_en, current_mileage) values
  ('d0000000-0000-4000-7373-000000000001', '11111111-0000-4000-7373-000000000001',
   'a0000000-0000-4000-7373-000000000001', 'b0000000-0000-4000-7373-000000000001',
   2022, 'ABD 7373', 30000);

insert into public.providers
  (id, owner_profile_id, provider_type, business_name_ar, verification_status,
   is_online, city_id, acceptance_rate)
values
  ('e0000000-0000-4000-7373-000000000001', '22222222-0000-4000-7373-000000000002',
   'individual', 'فنّي البطاريات', 'approved', true,
   'c0000000-0000-4000-7373-000000000001', 90);
select test.grant_role('22222222-0000-4000-7373-000000000002', 'technician');

select id as svc_battery from public.services where name_en = 'Battery jump or replacement' \gset
insert into public.provider_services (provider_id, service_id) values
  ('e0000000-0000-4000-7373-000000000001', :'svc_battery');
insert into public.provider_locations (provider_id, location, updated_at) values
  ('e0000000-0000-4000-7373-000000000001',
   extensions.st_point(50.1040, 26.4210)::extensions.geography, now());

-- The original job, done and approved, with 90 days of cover.
select test.become('11111111-0000-4000-7373-000000000001');
select public.create_emergency_order(
  :'svc_battery', 50.1035, 26.4209, 'd0000000-0000-4000-7373-000000000001',
  'حي الشاطئ', 'البطارية فصلت', 30100) as job \gset
select public.authorise_order_payment(:'job', 'intent_remind_1');
select public.submit_order(:'job');

select test.become('22222222-0000-4000-7373-000000000002');
select public.accept_order(:'job');
update public.orders set status = 'en_route' where id = :'job';
update public.orders set status = 'arrived' where id = :'job';
update public.orders set status = 'in_progress' where id = :'job';
select public.record_completion_evidence(:'job', 30150, test.completion_photos(:'job'), 90);
update public.orders set status = 'awaiting_approval' where id = :'job';

select test.become('11111111-0000-4000-7373-000000000001');
update public.orders set status = 'completed' where id = :'job';

-- The original job is logged as Habba-verified. Its warranty claim is the
-- live job the technician is on.
select public.request_warranty_service(:'job', 'البطارية فصلت مرة ثانية بعد أسبوع') as live \gset

-- The oil is long overdue on this car.
select public.start_vehicle_care(
  'd0000000-0000-4000-7373-000000000001',
  p_odometer_km => 30200,
  p_last_oil_km => 20000,
  p_last_oil_at => now() - interval '8 months');

reset role;
select public.sweep_vehicle_care('d0000000-0000-4000-7373-000000000001') as reminder \gset
select test.assert(:'reminder' is not null, 'the sweep reminds the owner about the oil');
set role authenticated;

select test.become('22222222-0000-4000-7373-000000000002');
select test.assert(
  exists (select 1 from jsonb_array_elements(public.job_vehicle_history(:'live') -> 'due') d
           where (d ->> 'is_due')::boolean),
  'the technician at the car sees what is due on it');
select test.assert(
  (public.job_vehicle_history(:'live') -> 'events') is not null,
  'alongside the history it already had');

select test.become('11111111-0000-4000-7373-000000000001');
select item_id as oil from public.vehicle_maintenance_status('d0000000-0000-4000-7373-000000000001')
 where item_type = 'engine_oil' \gset
select public.snooze_maintenance_item(:'oil', 14);

reset role;
select test.assert_eq(
  (select response::text from public.vehicle_reminders where id = :'reminder'), 'snoozed',
  '«ذكّرني لاحقاً» on the item answers the reminder that carried it');

-- A second reminder, sent the day before, still unanswered.
insert into public.vehicle_reminders (vehicle_id, user_id, sent_on, sent_at, items,
                                      title_ar, title_en, body_ar, body_en)
values ('d0000000-0000-4000-7373-000000000001', '11111111-0000-4000-7373-000000000001',
        current_date - 1, now() - interval '1 day',
        jsonb_build_array(jsonb_build_object('item_id', :'oil')),
        'تذكير', 'Reminder', 'الزيت', 'Oil')
returning id as earlier \gset
set role authenticated;

select test.become('11111111-0000-4000-7373-000000000001');
select public.mark_maintenance_item_done(:'oil');

reset role;
select test.assert_eq(
  (select response::text from public.vehicle_reminders where id = :'earlier'), 'done',
  '«تم» answers it as done');
select test.assert_eq(
  (select response::text from public.vehicle_reminders where id = :'reminder'), 'snoozed',
  'and an answered one keeps its answer');
select test.assert(
  (select data ->> 'id' from public.notification_outbox
    where dedupe_key = format('reminder:%s', :'reminder')) = 'd0000000-0000-4000-7373-000000000001',
  'the notification names the car, so it opens its logbook');
set role authenticated;

select test.become('66666666-0000-4000-7373-000000000006');
select test.assert_eq(
  jsonb_array_length(public.ops_vehicle_detail('d0000000-0000-4000-7373-000000000001') -> 'reminders'), 2,
  'ops see every reminder the car''s owner was sent');
select test.assert(
  (public.ops_vehicle_detail('d0000000-0000-4000-7373-000000000001') -> 'chain') is not null,
  'and the vehicle file still carries its seal');

select test.become('44444444-0000-4000-7373-000000000004');
select test.assert_raises(
  format($$select public.job_vehicle_history('%s')$$, :'live'),
  'still nobody else''s to read', '42501');

reset role;
rollback;
