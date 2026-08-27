-- 11 — Completion evidence
--
-- Build prompt §11: "Do not skip the completion photos/mileage. Without them
-- the moat is empty." This suite is what stops that from being a slogan.

\echo '── completion evidence'

begin;

insert into auth.users (id, phone) values
  ('11111111-0000-4000-d000-000000000001', '+966506000001'),
  ('22222222-0000-4000-d000-000000000002', '+966506000002');

insert into public.profiles (id, full_name, phone, role) values
  ('11111111-0000-4000-d000-000000000001', 'المالك', '+966506000001', 'customer'),
  ('22222222-0000-4000-d000-000000000002', 'الفنّي', '+966506000002', 'technician');

insert into public.cities (id, name_ar, name_en, region_ar, region_en, centroid) values
  ('c0000000-0000-4000-d000-000000000001', 'الدمام', 'DammamEvid', 'الشرقية', 'Eastern',
   extensions.st_point(50.1033, 26.4207)::extensions.geography);

insert into public.vehicle_makes (id, name_ar, name_en) values
  ('a0000000-0000-4000-d000-000000000001', 'ماركة دليل', 'TestMakeEvid');
insert into public.vehicle_models (id, make_id, name_ar, name_en, year_from) values
  ('b0000000-0000-4000-d000-000000000001', 'a0000000-0000-4000-d000-000000000001',
   'موديل دليل', 'TestModelEvid', 2015);
insert into public.vehicles (id, owner_id, make_id, model_id, year, plate_en, current_mileage) values
  ('d0000000-0000-4000-d000-000000000001', '11111111-0000-4000-d000-000000000001',
   'a0000000-0000-4000-d000-000000000001', 'b0000000-0000-4000-d000-000000000001',
   2020, 'ABJ 4444', 50000);

insert into public.providers
  (id, owner_profile_id, provider_type, business_name_ar, verification_status, is_online, city_id)
values
  ('e0000000-0000-4000-d000-000000000001', '22222222-0000-4000-d000-000000000002',
   'individual', 'فنّي الأدلة', 'approved', true, 'c0000000-0000-4000-d000-000000000001');

select id as svc_battery from public.services where name_en = 'Battery jump or replacement' \gset
select id as svc_fuel from public.services where name_en = 'Fuel delivery' \gset

insert into public.provider_services (provider_id, service_id) values
  ('e0000000-0000-4000-d000-000000000001', :'svc_battery'),
  ('e0000000-0000-4000-d000-000000000001', :'svc_fuel');


-- A job that genuinely produces evidence -------------------------------------
select test.become('11111111-0000-4000-d000-000000000001');

insert into public.orders
  (id, customer_id, vehicle_id, service_id, fulfilment_mode, service_location,
   provider_id, quoted_amount, created_by)
values
  ('f0000000-0000-4000-d000-000000000001',
   '11111111-0000-4000-d000-000000000001', 'd0000000-0000-4000-d000-000000000001',
   :'svc_battery', 'mobile_ondemand',
   extensions.st_point(50.105, 26.422)::extensions.geography,
   'e0000000-0000-4000-d000-000000000001', 120, '11111111-0000-4000-d000-000000000001');

update public.orders set status = 'searching' where id = 'f0000000-0000-4000-d000-000000000001';
update public.orders set status = 'quoted' where id = 'f0000000-0000-4000-d000-000000000001';
update public.orders set status = 'accepted', escrow_status = 'authorised',
  payment_intent_id = 'evid_1' where id = 'f0000000-0000-4000-d000-000000000001';
update public.orders set status = 'en_route' where id = 'f0000000-0000-4000-d000-000000000001';
update public.orders set status = 'arrived' where id = 'f0000000-0000-4000-d000-000000000001';
update public.orders set status = 'in_progress' where id = 'f0000000-0000-4000-d000-000000000001';

-- THE guard. Without evidence, the job cannot be handed back.
select test.assert_raises(
  $$update public.orders set status = 'awaiting_approval'
    where id = 'f0000000-0000-4000-d000-000000000001'$$,
  'a job cannot be handed back without an odometer reading',
  '23514');

-- Nor can the in_progress → completed shortcut be used to dodge it.
select test.assert_raises(
  $$update public.orders set status = 'completed'
    where id = 'f0000000-0000-4000-d000-000000000001'$$,
  'the shortcut straight to completed does not bypass the evidence guard',
  '23514');

-- Mileage alone is not enough.
update public.orders set completion_mileage = 51200
where id = 'f0000000-0000-4000-d000-000000000001';

select test.assert_raises(
  $$update public.orders set status = 'awaiting_approval'
    where id = 'f0000000-0000-4000-d000-000000000001'$$,
  'a reading without photos is still refused',
  '23514');

-- Nor is a single photo: "before/after" means both.
update public.orders
set completion_media = '[{"url":"https://example.test/b.jpg","kind":"before"}]'::jsonb
where id = 'f0000000-0000-4000-d000-000000000001';

select test.assert_raises(
  $$update public.orders set status = 'awaiting_approval'
    where id = 'f0000000-0000-4000-d000-000000000001'$$,
  'a before photo with no after photo is refused',
  '23514');

update public.orders
set completion_media = '[
  {"url":"https://example.test/b.jpg","kind":"before","caption":"البطارية القديمة"},
  {"url":"https://example.test/a.jpg","kind":"after","caption":"البطارية الجديدة"}
]'::jsonb
where id = 'f0000000-0000-4000-d000-000000000001';

update public.orders set status = 'awaiting_approval'
where id = 'f0000000-0000-4000-d000-000000000001';

select test.assert_eq(
  (select status from public.orders where id = 'f0000000-0000-4000-d000-000000000001'),
  'awaiting_approval'::order_status,
  'with a reading and both photos, the job hands back');

update public.orders set status = 'completed'
where id = 'f0000000-0000-4000-d000-000000000001';


-- The evidence reaches the logbook, where the hash chain protects it -----------
select test.assert_eq(
  (select mileage from public.vehicle_timeline
   where order_id = 'f0000000-0000-4000-d000-000000000001'),
  51200,
  'the completion reading — not the booking reading — reaches the logbook');

select test.assert_eq(
  (select jsonb_array_length(attachments) from public.vehicle_timeline
   where order_id = 'f0000000-0000-4000-d000-000000000001'),
  2, 'both photos are attached to the timeline entry');

select test.assert(
  (select attachments::text from public.vehicle_timeline
   where order_id = 'f0000000-0000-4000-d000-000000000001') like '%البطارية القديمة%',
  'the captions travel with the photos');

-- And because ADR-0004 put attachments inside the hashed payload, swapping a
-- photo after the fact breaks verification. That is what makes these evidence
-- rather than decoration.
select test.assert(
  (select is_valid from public.verify_vehicle_timeline('d0000000-0000-4000-d000-000000000001')),
  'the chain verifies with attachments present');

alter table public.vehicle_timeline disable trigger vehicle_timeline_no_update_delete;
update public.vehicle_timeline
set attachments = '[{"url":"https://example.test/someone-elses-battery.jpg","kind":"after"}]'::jsonb
where order_id = 'f0000000-0000-4000-d000-000000000001';

select test.assert(
  not (select is_valid from public.verify_vehicle_timeline('d0000000-0000-4000-d000-000000000001')),
  'swapping the completion photos breaks verification');

update public.vehicle_timeline
set attachments = '[
  {"url":"https://example.test/b.jpg","kind":"before","caption":"البطارية القديمة"},
  {"url":"https://example.test/a.jpg","kind":"after","caption":"البطارية الجديدة"}
]'::jsonb
where order_id = 'f0000000-0000-4000-d000-000000000001';
alter table public.vehicle_timeline enable always trigger vehicle_timeline_no_update_delete;


-- Services with nothing to photograph are exempt --------------------------------
-- Demanding a photo of a fuel delivery trains technicians to submit junk to
-- get past the screen, which is worse than asking for nothing: junk evidence
-- still looks like evidence on a resale report.
select test.assert(
  not (select requires_completion_photos from public.services where id = :'svc_fuel'),
  'fuel delivery does not demand before/after photos');

insert into public.orders
  (id, customer_id, vehicle_id, service_id, fulfilment_mode, service_location,
   provider_id, quoted_amount, created_by)
values
  ('f0000000-0000-4000-d000-000000000002',
   '11111111-0000-4000-d000-000000000001', 'd0000000-0000-4000-d000-000000000001',
   :'svc_fuel', 'mobile_ondemand',
   extensions.st_point(50.105, 26.422)::extensions.geography,
   'e0000000-0000-4000-d000-000000000001', 90, '11111111-0000-4000-d000-000000000001');

update public.orders set status = 'searching' where id = 'f0000000-0000-4000-d000-000000000002';
update public.orders set status = 'quoted' where id = 'f0000000-0000-4000-d000-000000000002';
update public.orders set status = 'accepted', escrow_status = 'authorised',
  payment_intent_id = 'evid_2' where id = 'f0000000-0000-4000-d000-000000000002';
update public.orders set status = 'en_route' where id = 'f0000000-0000-4000-d000-000000000002';
update public.orders set status = 'arrived' where id = 'f0000000-0000-4000-d000-000000000002';
update public.orders set status = 'in_progress' where id = 'f0000000-0000-4000-d000-000000000002';

-- The reading is still required — a fuel delivery still tells us where the
-- odometer was.
select test.assert_raises(
  $$update public.orders set status = 'awaiting_approval'
    where id = 'f0000000-0000-4000-d000-000000000002'$$,
  'a photo-exempt service still requires the odometer reading',
  '23514');

update public.orders set completion_mileage = 51500
where id = 'f0000000-0000-4000-d000-000000000002';

update public.orders set status = 'awaiting_approval'
where id = 'f0000000-0000-4000-d000-000000000002';

select test.assert_eq(
  (select status from public.orders where id = 'f0000000-0000-4000-d000-000000000002'),
  'awaiting_approval'::order_status,
  'a photo-exempt service hands back on the reading alone');


-- record_completion_evidence is the provider's single call ----------------------
select test.become('22222222-0000-4000-d000-000000000002');

insert into public.orders
  (id, customer_id, vehicle_id, service_id, fulfilment_mode, service_location,
   provider_id, quoted_amount, created_by)
values
  ('f0000000-0000-4000-d000-000000000003',
   '11111111-0000-4000-d000-000000000001', 'd0000000-0000-4000-d000-000000000001',
   :'svc_battery', 'mobile_ondemand',
   extensions.st_point(50.105, 26.422)::extensions.geography,
   'e0000000-0000-4000-d000-000000000001', 120, '11111111-0000-4000-d000-000000000001');

update public.orders set status = 'searching' where id = 'f0000000-0000-4000-d000-000000000003';
update public.orders set status = 'quoted' where id = 'f0000000-0000-4000-d000-000000000003';
update public.orders set status = 'accepted', escrow_status = 'authorised',
  payment_intent_id = 'evid_3' where id = 'f0000000-0000-4000-d000-000000000003';
update public.orders set status = 'en_route' where id = 'f0000000-0000-4000-d000-000000000003';
update public.orders set status = 'arrived' where id = 'f0000000-0000-4000-d000-000000000003';
update public.orders set status = 'in_progress' where id = 'f0000000-0000-4000-d000-000000000003';

select public.record_completion_evidence(
  'f0000000-0000-4000-d000-000000000003', 52000,
  '[{"url":"https://example.test/b3.jpg","kind":"before"},
    {"url":"https://example.test/a3.jpg","kind":"after"}]'::jsonb);

update public.orders set status = 'awaiting_approval'
where id = 'f0000000-0000-4000-d000-000000000003';

select test.assert_eq(
  (select completion_mileage from public.orders where id = 'f0000000-0000-4000-d000-000000000003'),
  52000, 'the single call records both halves of the evidence');

-- Somebody else's job is not theirs to close.
select test.become('11111111-0000-4000-d000-000000000001');
select test.assert_raises(
  $$select public.record_completion_evidence(
      'f0000000-0000-4000-d000-000000000003', 99999, '[]'::jsonb)$$,
  'only the assigned provider may record completion evidence',
  '42501');

rollback;

\echo '   completion evidence OK'
