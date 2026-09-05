-- 14 — Part-line and alert guards
--
-- The parts attack is the one that matters here: the state machine requires
-- every line to be approved before hand-back, and a provider could change the
-- price AFTER approval while the flag stayed true. The customer would have
-- approved a number that no longer existed.

\echo '── parts and alert guards'

begin;

insert into auth.users (id, phone) values
  ('11111111-0000-4000-2222-000000000001', '+966509100001'),
  ('22222222-0000-4000-2222-000000000002', '+966509100002');

insert into public.profiles (id, full_name, phone) values
  ('11111111-0000-4000-2222-000000000001', 'العميل', '+966509100001'),
  ('22222222-0000-4000-2222-000000000002', 'الفنّي', '+966509100002');

select test.grant_role('22222222-0000-4000-2222-000000000002', 'technician');

insert into public.cities (id, name_ar, name_en, region_ar, region_en, centroid) values
  ('c0000000-0000-4000-2222-000000000001', 'ر', 'CityParts', 'ر', 'R',
   extensions.st_point(46.6753, 24.7136)::extensions.geography);

insert into public.vehicle_makes (id, name_ar, name_en) values
  ('a0000000-0000-4000-2222-000000000001', 'م', 'MakeParts');
insert into public.vehicle_models (id, make_id, name_ar, name_en, year_from) values
  ('b0000000-0000-4000-2222-000000000001', 'a0000000-0000-4000-2222-000000000001',
   'م', 'ModelParts', 2015);
insert into public.vehicles (id, owner_id, make_id, model_id, year, plate_en) values
  ('d0000000-0000-4000-2222-000000000001', '11111111-0000-4000-2222-000000000001',
   'a0000000-0000-4000-2222-000000000001', 'b0000000-0000-4000-2222-000000000001',
   2020, 'ABJ 11');

insert into public.providers
  (id, owner_profile_id, provider_type, business_name_ar, verification_status, city_id)
values
  ('e0000000-0000-4000-2222-000000000002', '22222222-0000-4000-2222-000000000002',
   'individual', 'ورشة', 'approved', 'c0000000-0000-4000-2222-000000000001');

select id as svc from public.services where name_en = 'Battery jump or replacement' \gset
insert into public.provider_services (provider_id, service_id)
values ('e0000000-0000-4000-2222-000000000002', :'svc');

insert into public.orders
  (id, customer_id, vehicle_id, service_id, fulfilment_mode, status, provider_id,
   service_location, quoted_amount, parts_amount, created_by)
values
  ('f0000000-0000-4000-2222-000000000001',
   '11111111-0000-4000-2222-000000000001', 'd0000000-0000-4000-2222-000000000001',
   :'svc', 'mobile_ondemand', 'in_progress', 'e0000000-0000-4000-2222-000000000002',
   extensions.st_point(46.6753, 24.7136)::extensions.geography,
   120, 320, '11111111-0000-4000-2222-000000000001');

insert into public.order_parts (id, order_id, name_ar, unit_price, quantity)
values ('10000000-0000-4000-2222-000000000001',
        'f0000000-0000-4000-2222-000000000001', 'بطارية ٧٠ أمبير', 320, 1);


-- ===========================================================================
set role authenticated;
-- ===========================================================================

-- The customer cannot price the parts they are being sold.
select test.become('11111111-0000-4000-2222-000000000001');
select test.assert_raises(
  $$update public.order_parts set unit_price = 1
    where id = '10000000-0000-4000-2222-000000000001'$$,
  'a customer CANNOT set the price of a part',
  '42501');

-- The provider cannot approve on the customer's behalf.
select test.become('22222222-0000-4000-2222-000000000002');
select test.assert_raises(
  $$update public.order_parts set approved_by_customer = true, approved_at = now()
    where id = '10000000-0000-4000-2222-000000000001'$$,
  'a provider CANNOT approve a part line for the customer',
  '42501');


-- THE attack ---------------------------------------------------------------------
select test.become('11111111-0000-4000-2222-000000000001');
update public.order_parts set approved_by_customer = true, approved_at = now()
where id = '10000000-0000-4000-2222-000000000001';

select test.assert(
  (select approved_by_customer from public.order_parts
   where id = '10000000-0000-4000-2222-000000000001'),
  'the customer approved the line at 320');

-- The provider raises the price on the approved line. This is allowed — a
-- genuine mis-type must be correctable — but it REVOKES the approval, so the
-- customer cannot end up paying for a number they never saw.
select test.become('22222222-0000-4000-2222-000000000002');
update public.order_parts set unit_price = 1200
where id = '10000000-0000-4000-2222-000000000001';

select test.assert(
  not (select approved_by_customer from public.order_parts
       where id = '10000000-0000-4000-2222-000000000001'),
  'changing the price of an approved line REVOKES the approval');

select test.assert(
  (select approved_at from public.order_parts
   where id = '10000000-0000-4000-2222-000000000001') is null,
  'the approval timestamp is cleared too');

-- And the state machine now blocks hand-back, which is how the customer finds
-- out. Before 0035 the flag stayed true and the job sailed through at 1200.
select test.assert_raises(
  $$update public.orders set status = 'awaiting_approval'
    where id = 'f0000000-0000-4000-2222-000000000001'$$,
  'the job cannot be handed back until the new price is approved',
  '23514');

-- Re-approving the corrected line lets it proceed.
select test.become('11111111-0000-4000-2222-000000000001');
update public.order_parts set approved_by_customer = true, approved_at = now()
where id = '10000000-0000-4000-2222-000000000001';

select test.become('22222222-0000-4000-2222-000000000002');
select public.record_completion_evidence(
  'f0000000-0000-4000-2222-000000000001', 51000,
  '[{"url":"https://example.test/b.jpg","kind":"before"},
    {"url":"https://example.test/a.jpg","kind":"after"}]'::jsonb);
update public.orders set parts_amount = 1200, labour_amount = 0, vat_amount = 180,
  total_amount = 1380
where id = 'f0000000-0000-4000-2222-000000000001';
update public.orders set status = 'awaiting_approval'
where id = 'f0000000-0000-4000-2222-000000000001';

select test.assert_eq(
  (select status from public.orders where id = 'f0000000-0000-4000-2222-000000000001'),
  'awaiting_approval'::order_status,
  'once re-approved, the job hands back normally');

-- A part line cannot be moved onto a different order.
select test.assert_raises(
  $$update public.order_parts set order_id = gen_random_uuid()
    where id = '10000000-0000-4000-2222-000000000001'$$,
  'a part line cannot be moved to another order',
  '42501');


-- Alerts are Habba's words ----------------------------------------------------------
-- Rules and alerts are ops/system data, so they are seeded as the privileged
-- role rather than by the customer.
reset role;
insert into public.maintenance_rules (id, service_id, name_ar, name_en, due_every_km)
values ('20000000-0000-4000-2222-000000000001', :'svc', 'قاعدة', 'rule', 7000);

insert into public.maintenance_alerts
  (id, vehicle_id, rule_id, service_id, confidence, message_ar, message_en)
values ('30000000-0000-4000-2222-000000000001',
        'd0000000-0000-4000-2222-000000000001',
        '20000000-0000-4000-2222-000000000001', :'svc',
        'generic', 'تقدير عام', 'general estimate');

set role authenticated;
select test.become('11111111-0000-4000-2222-000000000001');

-- Flipping `generic` to `oem` would turn Habba's estimate into a claim of
-- manufacturer guidance — the exact overclaim the alert copy avoids.
update public.maintenance_alerts set confidence = 'oem', message_ar = 'الوكيل يوصي'
where id = '30000000-0000-4000-2222-000000000001';

select test.assert_eq(
  (select confidence from public.maintenance_alerts
   where id = '30000000-0000-4000-2222-000000000001'),
  'generic'::maintenance_confidence,
  'an owner cannot rewrite Habba''s own maintenance advice');

-- Dismissal still works, because it goes through the function rather than a
-- direct write.
select public.dismiss_alert('30000000-0000-4000-2222-000000000001');
select test.assert_eq(
  (select status from public.maintenance_alerts
   where id = '30000000-0000-4000-2222-000000000001'),
  'dismissed'::alert_status,
  'dismissing an alert still works through dismiss_alert');

reset role;
rollback;

\echo '   parts and alert guards OK'
