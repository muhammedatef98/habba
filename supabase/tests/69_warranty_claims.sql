-- 69 — A warranty the customer can claim, and the provider hears about
--
-- Companion to 0105.

\echo '── warranty claims'

begin;

insert into auth.users (id, phone) values
  ('11111111-0000-4000-6969-000000000001', '+966509690001'),
  ('22222222-0000-4000-6969-000000000002', '+966509690002'),
  ('44444444-0000-4000-6969-000000000004', '+966509690004'),
  ('66666666-0000-4000-6969-000000000006', '+966509690006');

insert into public.profiles (id, full_name, phone) values
  ('11111111-0000-4000-6969-000000000001', 'العميل', '+966509690001'),
  ('22222222-0000-4000-6969-000000000002', 'الفنّي', '+966509690002'),
  ('44444444-0000-4000-6969-000000000004', 'غريب', '+966509690004'),
  ('66666666-0000-4000-6969-000000000006', 'التشغيل', '+966509690006');
select test.grant_role('66666666-0000-4000-6969-000000000006', 'ops');

insert into public.cities (id, name_ar, name_en, region_ar, region_en, centroid) values
  ('c0000000-0000-4000-6969-000000000001', 'الدمام', 'DammamWarranty', 'الشرقية', 'Eastern',
   extensions.st_point(50.1033, 26.4207)::extensions.geography);
insert into public.vehicle_makes (id, name_ar, name_en) values
  ('a0000000-0000-4000-6969-000000000001', 'ماركة', 'TestMakeWarranty');
insert into public.vehicle_models (id, make_id, name_ar, name_en, year_from) values
  ('b0000000-0000-4000-6969-000000000001', 'a0000000-0000-4000-6969-000000000001',
   'موديل', 'TestModelWarranty', 2015);
insert into public.vehicles (id, owner_id, make_id, model_id, year, plate_en, current_mileage) values
  ('d0000000-0000-4000-6969-000000000001', '11111111-0000-4000-6969-000000000001',
   'a0000000-0000-4000-6969-000000000001', 'b0000000-0000-4000-6969-000000000001',
   2022, 'ABD 6969', 30000);

insert into public.providers
  (id, owner_profile_id, provider_type, business_name_ar, verification_status,
   is_online, city_id, acceptance_rate)
values
  ('e0000000-0000-4000-6969-000000000001', '22222222-0000-4000-6969-000000000002',
   'individual', 'فنّي البطاريات', 'approved', true,
   'c0000000-0000-4000-6969-000000000001', 90);
select test.grant_role('22222222-0000-4000-6969-000000000002', 'technician');

select id as svc_battery from public.services where name_en = 'Battery jump or replacement' \gset
insert into public.provider_services (provider_id, service_id) values
  ('e0000000-0000-4000-6969-000000000001', :'svc_battery');
insert into public.provider_locations (provider_id, location, updated_at) values
  ('e0000000-0000-4000-6969-000000000001',
   extensions.st_point(50.1040, 26.4210)::extensions.geography, now());

-- The original job, done and approved, with 90 days of cover.
select test.become('11111111-0000-4000-6969-000000000001');
select public.create_emergency_order(
  :'svc_battery', 50.1035, 26.4209, 'd0000000-0000-4000-6969-000000000001',
  'حي الشاطئ', 'البطارية فصلت', 30100) as job \gset
select public.authorise_order_payment(:'job', 'intent_warranty_1');
select public.submit_order(:'job');

select test.become('22222222-0000-4000-6969-000000000002');
select public.accept_order(:'job');
update public.orders set status = 'en_route' where id = :'job';
update public.orders set status = 'arrived' where id = :'job';
update public.orders set status = 'in_progress' where id = :'job';
select public.record_completion_evidence(:'job', 30150, test.completion_photos(:'job'), 90);
update public.orders set status = 'awaiting_approval' where id = :'job';

select test.become('11111111-0000-4000-6969-000000000001');
update public.orders set status = 'completed' where id = :'job';

select test.assert_raises(
  format($$select public.request_warranty_service('%s', 'لا')$$, :'job'),
  'a claim needs a description of what went wrong', '23514');

select test.become('44444444-0000-4000-6969-000000000004');
select test.assert_raises(
  format($$select public.request_warranty_service('%s', 'ليست سيارتي أصلاً')$$, :'job'),
  'a stranger cannot claim it', '42501');

select test.become('11111111-0000-4000-6969-000000000001');
select public.request_warranty_service(:'job', 'البطارية فصلت مرة ثانية بعد أسبوع') as claim \gset

select test.assert_eq((select status::text from public.orders where id = :'claim'), 'accepted',
  'the free re-service is confirmed at once');
select test.assert_eq(
  (select provider_id from public.orders where id = :'claim'),
  'e0000000-0000-4000-6969-000000000001'::uuid,
  'with the same technician');
select test.assert_eq((select total_amount from public.orders where id = :'claim'), 0::numeric,
  'and it costs nothing');
select test.assert_eq((select fulfilment_mode::text from public.orders where id = :'claim'),
  'mobile_scheduled', 'a planned visit, not a broadcast to every technician nearby');
select test.assert_eq(
  (select count(*)::int from public.order_offers where order_id = :'claim'), 0,
  'nobody else is offered it');
select test.assert(
  exists (select 1 from public.notification_outbox
           where user_id = '22222222-0000-4000-6969-000000000002' and kind = 'warranty_claim'),
  'the technician is told it is a warranty claim');
select test.assert(
  not exists (select 1 from public.notification_outbox
               where user_id = '22222222-0000-4000-6969-000000000002'
                 and kind = 'booking_confirmed'
                 and data ->> 'id' = :'claim'),
  'not as a booking with an empty appointment time');

select test.assert_raises(
  format($$select public.request_warranty_service('%s', 'مطالبة ثانية لنفس العمل')$$, :'job'),
  'one live claim per job', '23505');

select test.assert_eq(
  (select open_claim_id from public.vehicle_warranties('d0000000-0000-4000-6969-000000000001')
    where order_id = :'job'),
  (:'claim')::uuid, 'the logbook can lead to the open claim');
select test.assert_eq(
  (select fulfilment_mode::text from public.vehicle_warranties('d0000000-0000-4000-6969-000000000001')
    where order_id = :'job'),
  'mobile_ondemand', 'and knows how the original was done');

select test.become('66666666-0000-4000-6969-000000000006');
select test.assert_eq(
  jsonb_array_length(public.ops_order_detail(:'job') -> 'warranty_claims'), 1,
  'the original job''s file lists its claim for operators');

rollback;
