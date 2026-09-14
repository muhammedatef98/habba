-- 33 — A warranty follows the car (0055, ADR-0021)
--
-- تقرير هبّة has always printed live cover on the car with no reference to who
-- paid for the work. `claim_warranty` authorised on `orders.customer_id` — who
-- paid. Nothing could complete a transfer, so the two never disagreed; 0054
-- made them able to, and the report is the one that would have been wrong in
-- public.
--
-- The assertion this suite exists for is the pair at the end of section 3: the
-- buyer can claim, and the seller cannot. Everything else supports it.

\echo '── warranty follows the car'

begin;

-- Seeded through the shim's GoTrue stand-in, not by INSERT: a bare
-- `insert into auth.users` leaves `phone_confirmed_at` null, and since 0044
-- that means `phone_verified` is false — so the transfer in section 2 would be
-- addressed to someone who can never discover it.
select public.test_seed_auth_user('ff111111-0000-4000-c000-000000000001', '+966505200001');
select public.test_seed_auth_user('ff111111-0000-4000-c000-000000000002', '+966505200002');
select public.test_seed_auth_user('ff111111-0000-4000-c000-000000000003', '+966505200003');

insert into public.profiles (id, full_name, phone) values
  ('ff111111-0000-4000-c000-000000000001', 'البائع', '+966505200001'),
  ('ff111111-0000-4000-c000-000000000002', 'المشتري', '+966505200002'),
  ('ff111111-0000-4000-c000-000000000003', 'صاحب الورشة', '+966505200003');

select test.grant_role('ff111111-0000-4000-c000-000000000003', 'workshop_admin');

insert into public.cities (id, name_ar, name_en, region_ar, region_en, centroid) values
  ('ff000000-0000-4000-c000-00000000000c', 'الدمام', 'DammamWarranty', 'المنطقة الشرقية',
   'Eastern Province', extensions.st_point(50.1033, 26.4207)::extensions.geography);

insert into public.vehicle_makes (id, name_ar, name_en) values
  ('ff000000-0000-4000-c000-000000000001', 'ماركة الضمان', 'TestMakeWarranty');
insert into public.vehicle_models (id, make_id, name_ar, name_en, year_from) values
  ('ff000000-0000-4000-c000-000000000002', 'ff000000-0000-4000-c000-000000000001',
   'موديل الضمان', 'TestModelWarranty', 2015);
insert into public.vehicles (id, owner_id, make_id, model_id, year, plate_en) values
  ('ff000000-0000-4000-c000-0000000000a1', 'ff111111-0000-4000-c000-000000000001',
   'ff000000-0000-4000-c000-000000000001', 'ff000000-0000-4000-c000-000000000002',
   2020, 'ABJ 8888');

insert into public.providers
  (id, owner_profile_id, provider_type, business_name_ar, cr_number,
   verification_status, city_id)
values
  ('ff000000-0000-4000-c000-0000000000e1', 'ff111111-0000-4000-c000-000000000003',
   'workshop', 'ورشة الضمان', '2020202020', 'approved',
   'ff000000-0000-4000-c000-00000000000c');

insert into public.workshops (provider_id, address_ar, location, bay_count, opening_hours)
values ('ff000000-0000-4000-c000-0000000000e1', 'شارع الأمير محمد، الدمام',
        extensions.st_point(50.1040, 26.4210)::extensions.geography, 2,
        '{"sun": [["08:00","20:00"]]}'::jsonb);

select id as svc from public.services where name_en = 'Oil and filter change' \gset

insert into public.provider_services (provider_id, service_id)
values ('ff000000-0000-4000-c000-0000000000e1', :'svc');

-- A completed workshop job with cover still running. Workshop mode on purpose:
-- it takes the location question off the table for section 3, which is about
-- who may claim. Section 4 puts the location question back.
insert into public.orders (
  id, customer_id, vehicle_id, service_id, fulfilment_mode, status,
  provider_id, workshop_id, problem_description, mileage_at_order,
  quoted_amount, parts_amount, labour_amount, vat_amount, total_amount,
  escrow_status, warranty_days, completed_at, warranty_expires_at, created_by
) values (
  'ff000000-0000-4000-c000-0000000000d1',
  'ff111111-0000-4000-c000-000000000001',
  'ff000000-0000-4000-c000-0000000000a1',
  :'svc', 'workshop', 'completed',
  'ff000000-0000-4000-c000-0000000000e1', 'ff000000-0000-4000-c000-0000000000e1',
  'تغيير زيت', 70000,
  200, 0, 200, 30, 230,
  'captured', 90, now() - interval '10 days', now() + interval '80 days',
  'ff111111-0000-4000-c000-000000000001'
);


-- ---------------------------------------------------------------------------
-- 1. Before any transfer, nothing changes for the person who paid
-- ---------------------------------------------------------------------------
set role authenticated;
select test.become('ff111111-0000-4000-c000-000000000001');

select test.assert_eq(
  (select count(*)::int from public.active_warranties
   where order_id = 'ff000000-0000-4000-c000-0000000000d1'),
  1, 'the payer sees their own live cover, as they always did');

select test.assert_eq(
  (select count(*)::int from public.vehicle_warranties(
     'ff000000-0000-4000-c000-0000000000a1')),
  1, 'and the car''s cover, because they still own the car');

reset role;


-- ---------------------------------------------------------------------------
-- 2. A live claim blocks the handover (ADR-0021)
-- ---------------------------------------------------------------------------
set role authenticated;
select test.become('ff111111-0000-4000-c000-000000000001');
select public.claim_warranty(
  'ff000000-0000-4000-c000-0000000000d1', 'الزيت ينقص بسرعة') as claim \gset

select test.assert_raises(
  $$select public.initiate_ownership_transfer(
      'ff000000-0000-4000-c000-0000000000a1', '+966505200002', null)$$,
  'a car with a re-service in flight cannot be handed over',
  '23514');

-- The seller's remedy, and the reason the refusal is acceptable: it is theirs
-- to clear, on a screen they already have.
update public.orders set status = 'cancelled', cancellation_reason = 'سأبيع السيارة'
where id = :'claim';
reset role;

set role authenticated;
select test.become('ff111111-0000-4000-c000-000000000001');
select transfer_id as tid, code as otp
from public.initiate_ownership_transfer(
  'ff000000-0000-4000-c000-0000000000a1', '+966505200002', null) \gset
reset role;


-- ---------------------------------------------------------------------------
-- 3. The claim right moves with the car — the whole point
-- ---------------------------------------------------------------------------
set role authenticated;
select test.become('ff111111-0000-4000-c000-000000000002');

-- Shown BEFORE accepting. ADR-0021 makes this the buyer's on acceptance, so
-- revealing it only afterwards would be selling the car on a fact they were
-- not told.
select test.assert_eq(
  (select open_warranties from public.pending_ownership_transfer_for_me()),
  1, 'the buyer is told about live cover before they accept, not after');

select public.accept_ownership_transfer((:'tid')::uuid, :'otp');
reset role;

set role authenticated;
select test.become('ff111111-0000-4000-c000-000000000002');

select test.assert_eq(
  (select count(*)::int from public.vehicle_warranties(
     'ff000000-0000-4000-c000-0000000000a1')),
  1, 'the new owner can SEE the cover the report prints for this car');

select test.assert_eq(
  (select count(*)::int from public.orders
   where id = 'ff000000-0000-4000-c000-0000000000d1'),
  0, 'without being able to read the seller''s order — no amounts, no address');

select public.claim_warranty(
  'ff000000-0000-4000-c000-0000000000d1', 'نفس المشكلة رجعت') as buyer_claim \gset

select test.assert_eq(
  (select customer_id from public.orders where id = :'buyer_claim'),
  'ff111111-0000-4000-c000-000000000002'::uuid,
  'the claim order belongs to the claimant, or they could not read the order they just booked');

select test.assert_eq(
  (select provider_id from public.orders where id = :'buyer_claim'),
  'ff000000-0000-4000-c000-0000000000e1'::uuid,
  'and is still auto-routed back to the ORIGINAL provider — §1.5 is about the work');

reset role;

-- The other half. The seller paid for this job and can still read the invoice;
-- what they lost is the right to send someone back to a car they sold.
set role authenticated;
select test.become('ff111111-0000-4000-c000-000000000001');

select test.assert_eq(
  (select count(*)::int from public.orders
   where id = 'ff000000-0000-4000-c000-0000000000d1'),
  1, 'the seller keeps their order and its invoice — that is financial history');

select test.assert_eq(
  (select count(*)::int from public.vehicle_warranties(
     'ff000000-0000-4000-c000-0000000000a1')),
  0, 'but the car''s cover is no longer theirs to read');

reset role;

-- Cancel the buyer's claim so the last assertion is about authorisation and
-- not about the one-live-claim guard firing first.
set role authenticated;
select test.become('ff111111-0000-4000-c000-000000000002');
update public.orders set status = 'cancelled' where id = :'buyer_claim';
reset role;

set role authenticated;
select test.become('ff111111-0000-4000-c000-000000000001');
select test.assert_raises(
  $$select public.claim_warranty(
      'ff000000-0000-4000-c000-0000000000d1', 'أريد إعادة الخدمة')$$,
  'the person who PAID cannot claim on a car they no longer own',
  '42501');
reset role;


-- ---------------------------------------------------------------------------
-- 4. A mobile claim by a new owner does not inherit the seller's address
-- ---------------------------------------------------------------------------
-- The parent carries `service_address_ar` and `service_location` — where the
-- PAYER was. Copying them would both send a technician to the wrong door and
-- print the seller's home address inside an order the buyer can read.
insert into public.orders (
  id, customer_id, vehicle_id, service_id, fulfilment_mode, status,
  provider_id, service_location, service_address_ar,
  problem_description, mileage_at_order,
  quoted_amount, parts_amount, labour_amount, vat_amount, total_amount,
  escrow_status, warranty_days, completed_at, warranty_expires_at, created_by
) values (
  'ff000000-0000-4000-c000-0000000000d2',
  'ff111111-0000-4000-c000-000000000001',
  'ff000000-0000-4000-c000-0000000000a1',
  :'svc', 'mobile_scheduled', 'completed',
  'ff000000-0000-4000-c000-0000000000e1',
  extensions.st_point(50.2000, 26.3000)::extensions.geography,
  'بيت البائع، حي النور',
  'بطارية', 70500,
  150, 0, 150, 22.5, 172.5,
  'captured', 60, now() - interval '5 days', now() + interval '55 days',
  'ff111111-0000-4000-c000-000000000001'
);

set role authenticated;
select test.become('ff111111-0000-4000-c000-000000000002');

select test.assert_raises(
  $$select public.claim_warranty(
      'ff000000-0000-4000-c000-0000000000d2', 'البطارية فصلت')$$,
  'a mobile claim by someone who did not pay must say where the car IS',
  '23514');

select public.claim_warranty(
  'ff000000-0000-4000-c000-0000000000d2', 'البطارية فصلت',
  50.1500, 26.4500, 'بيت المشتري') as mobile_claim \gset

select test.assert_eq(
  (select service_address_ar from public.orders where id = :'mobile_claim'),
  'بيت المشتري',
  'and the claim carries the claimant''s address, never the seller''s');

select test.assert(
  (select extensions.st_distance(
     service_location,
     extensions.st_point(50.2000, 26.3000)::extensions.geography) > 1000
   from public.orders where id = :'mobile_claim'),
  'nor the seller''s coordinates — the technician is sent to the car, not to the receipt');

reset role;


-- ---------------------------------------------------------------------------
-- 5. vehicle_warranties is gated on ownership, not on knowing a vehicle id
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER reaches past `orders_read_customer`, so the ownership check
-- inside the function is the only thing standing there.
set role authenticated;
select test.become('ff111111-0000-4000-c000-000000000003');
select test.assert_eq(
  (select count(*)::int from public.vehicle_warranties(
     'ff000000-0000-4000-c000-0000000000a1')),
  0, 'a third party holding the vehicle id learns nothing about its cover');
reset role;

rollback;

\echo '   warranty follows the car OK'
