-- 07 — Provider access control
--
-- ADR-0013. The build prompt contradicts itself here: §6.9 grants providers
-- RLS read on open orders, while §7.1 and §9.2 forbid showing the exact
-- address before acceptance. RLS grants whole rows, so the literal reading
-- hands every online provider the precise coordinates of any customer with an
-- open emergency — at night, roadside, often alone.
--
-- The dangerous property of that bug is that it is INVISIBLE in UI review: the
-- app renders only a distance, while the API returns the address to anyone who
-- calls it directly. So it is asserted here, at the layer that actually
-- decides.

\echo '── provider access'

begin;

insert into auth.users (id, phone) values
  ('11111111-0000-4000-9000-000000000001', '+966502000001'),  -- customer
  ('22222222-0000-4000-9000-000000000002', '+966502000002'),  -- assigned provider
  ('44444444-0000-4000-9000-000000000004', '+966502000004');  -- other provider

insert into public.profiles (id, full_name, phone, role) values
  ('11111111-0000-4000-9000-000000000001', 'العميل',      '+966502000001', 'customer'),
  ('22222222-0000-4000-9000-000000000002', 'الفنّي',      '+966502000002', 'technician'),
  ('44444444-0000-4000-9000-000000000004', 'فنّي آخر',    '+966502000004', 'technician');

insert into public.cities (id, name_ar, name_en, region_ar, region_en, centroid) values
  ('c0000000-0000-4000-9000-000000000001', 'الخبر', 'KhobarTest', 'المنطقة الشرقية',
   'Eastern Province', extensions.st_point(50.2083, 26.2794)::extensions.geography);

insert into public.vehicle_makes (id, name_ar, name_en) values
  ('a0000000-0000-4000-9000-000000000001', 'ماركة اختبار', 'TestMakeAccess');
insert into public.vehicle_models (id, make_id, name_ar, name_en, year_from) values
  ('b0000000-0000-4000-9000-000000000001', 'a0000000-0000-4000-9000-000000000001',
   'موديل اختبار', 'TestModelAccess', 2015);
insert into public.vehicles (id, owner_id, make_id, model_id, year, plate_en) values
  ('d0000000-0000-4000-9000-000000000001', '11111111-0000-4000-9000-000000000001',
   'a0000000-0000-4000-9000-000000000001', 'b0000000-0000-4000-9000-000000000001',
   2020, 'ABJ 8888');

insert into public.providers
  (id, owner_profile_id, provider_type, business_name_ar, verification_status,
   is_online, city_id)
values
  ('e0000000-0000-4000-9000-000000000002', '22222222-0000-4000-9000-000000000002',
   'individual', 'ورشة الفنّي', 'approved', true, 'c0000000-0000-4000-9000-000000000001'),
  ('e0000000-0000-4000-9000-000000000004', '44444444-0000-4000-9000-000000000004',
   'individual', 'ورشة أخرى', 'approved', true, 'c0000000-0000-4000-9000-000000000001');

select id as svc from public.services where name_en = 'Tyre puncture or change' \gset

insert into public.provider_services (provider_id, service_id) values
  ('e0000000-0000-4000-9000-000000000002', :'svc'),
  ('e0000000-0000-4000-9000-000000000004', :'svc');

insert into public.provider_locations (provider_id, location, updated_at) values
  ('e0000000-0000-4000-9000-000000000002',
   extensions.st_point(50.2090, 26.2800)::extensions.geography, now()),
  ('e0000000-0000-4000-9000-000000000004',
   extensions.st_point(50.2100, 26.2810)::extensions.geography, now());

insert into public.orders
  (id, customer_id, vehicle_id, service_id, fulfilment_mode, status,
   service_location, service_address_ar, problem_description, created_by)
values
  ('f0000000-0000-4000-9000-000000000001',
   '11111111-0000-4000-9000-000000000001',
   'd0000000-0000-4000-9000-000000000001',
   :'svc', 'mobile_ondemand', 'searching',
   extensions.st_point(50.2095, 26.2805)::extensions.geography,
   'حي العقربية، شارع ٧، فيلا ٢٢',
   'إطار مثقوب، الموقع قريب من مسجد الحي',
   '11111111-0000-4000-9000-000000000001');


-- ===========================================================================
set role authenticated;
-- ===========================================================================

-- Pre-acceptance ------------------------------------------------------------
select test.become('22222222-0000-4000-9000-000000000002');

-- The core assertion. Not "the query returns no address" — the row itself is
-- unreachable, so there is no column to leak.
select test.assert_eq(
  (select count(*)::int from public.orders
   where id = 'f0000000-0000-4000-9000-000000000001'),
  0,
  'a provider CANNOT read an unassigned open order row at all');

-- Explicitly naming the sensitive columns, in case a future policy grants the
-- row while the app still only renders a distance.
select test.assert_eq(
  (select count(*)::int from public.orders
   where id = 'f0000000-0000-4000-9000-000000000001'
     and (service_address_ar is not null or service_location is not null)),
  0,
  'the exact address and coordinates are unreachable pre-acceptance');

-- Discovery works, and returns a bucket rather than a number.
select test.assert_eq(
  (select count(*)::int from public.list_open_orders_for_provider()),
  1, 'the provider CAN discover the open order through the masked RPC');

select test.assert(
  (select distance_bucket from public.list_open_orders_for_provider() limit 1)
    in ('أقل من ٢ كم', '٢–٥ كم', '٥–١٠ كم', 'أكثر من ١٠ كم'),
  'discovery returns a distance bucket, never an exact distance');

-- Exact metres from several providers over time allow trilateration of the
-- customer's position, which is why the bucket exists.
select test.assert(
  (select problem_summary from public.list_open_orders_for_provider() limit 1)
    not like '%فيلا%',
  'the street address never appears in the discovery payload');


-- Competitor positions are not readable ---------------------------------------
select test.assert_eq(
  (select count(*)::int from public.provider_locations
   where provider_id = 'e0000000-0000-4000-9000-000000000004'),
  0, 'a provider cannot read another provider''s live position');


-- After acceptance -------------------------------------------------------------
reset role;
select test.become('11111111-0000-4000-9000-000000000001');
update public.orders
set status = 'quoted', quoted_amount = 100
where id = 'f0000000-0000-4000-9000-000000000001';
update public.orders
set status = 'accepted',
    provider_id = 'e0000000-0000-4000-9000-000000000002',
    escrow_status = 'authorised',
    payment_intent_id = 'test_intent_007'
where id = 'f0000000-0000-4000-9000-000000000001';

set role authenticated;
select test.become('22222222-0000-4000-9000-000000000002');

-- One mechanism, one moment of disclosure: the standard RLS policy now grants
-- the row because provider_id matches.
select test.assert_eq(
  (select service_address_ar from public.orders
   where id = 'f0000000-0000-4000-9000-000000000001'),
  'حي العقربية، شارع ٧، فيلا ٢٢',
  'the assigned provider CAN read the address after acceptance');

-- The other provider still cannot, assigned or not.
select test.become('44444444-0000-4000-9000-000000000004');
select test.assert_eq(
  (select count(*)::int from public.orders
   where id = 'f0000000-0000-4000-9000-000000000001'),
  0, 'an unassigned provider still cannot read the order after it is taken');

select test.assert_eq(
  (select count(*)::int from public.list_open_orders_for_provider()),
  0, 'an accepted order disappears from open discovery');


-- The customer's view of the technician's position is time-boxed ---------------
select test.become('11111111-0000-4000-9000-000000000001');
select test.assert_eq(
  (select count(*)::int from public.provider_locations
   where provider_id = 'e0000000-0000-4000-9000-000000000002'),
  1, 'the customer CAN see their assigned technician while the job is live');

reset role;
update public.orders set status = 'en_route' where id = 'f0000000-0000-4000-9000-000000000001';
update public.orders set status = 'arrived' where id = 'f0000000-0000-4000-9000-000000000001';
update public.orders set status = 'in_progress' where id = 'f0000000-0000-4000-9000-000000000001';
update public.orders
set completion_mileage = 40100, completion_media = '[{"url":"https://example.test/b.jpg","kind":"before"},{"url":"https://example.test/a.jpg","kind":"after"}]'::jsonb
where id = 'f0000000-0000-4000-9000-000000000001';
select test.become('11111111-0000-4000-9000-000000000001');
update public.orders set status = 'completed' where id = 'f0000000-0000-4000-9000-000000000001';

set role authenticated;
select test.become('11111111-0000-4000-9000-000000000001');

-- "Active order" read loosely would leave the customer with a live feed of a
-- technician's whereabouts indefinitely after the job.
select test.assert_eq(
  (select count(*)::int from public.provider_locations
   where provider_id = 'e0000000-0000-4000-9000-000000000002'),
  0, 'the customer STOPS seeing the technician once the job is complete');


-- A provider may read the logbook rows their own work produced ------------------
select test.become('22222222-0000-4000-9000-000000000002');
select test.assert_eq(
  (select count(*)::int from public.vehicle_timeline
   where order_id = 'f0000000-0000-4000-9000-000000000001'),
  1, 'a provider can read the timeline entry from their own completed order');

-- But not the rest of that car's history.
select test.assert_eq(
  (select count(*)::int from public.vehicle_timeline
   where vehicle_id = 'd0000000-0000-4000-9000-000000000001' and order_id is null),
  0, 'a provider cannot read the rest of the vehicle''s logbook');

reset role;
rollback;

\echo '   provider access OK'
