-- 06 — Orders: state machine, guards, and the completion→logbook write
--
-- Phase 3's acceptance criterion is an end-to-end emergency order where the
-- completed job appears in the logbook automatically and payment is captured
-- only after the customer confirms. This suite proves the database half of
-- that, including every guard that would otherwise be "the app remembers to".

\echo '── orders'

begin;

-- Fixtures ------------------------------------------------------------------
insert into auth.users (id, phone) values
  ('11111111-0000-4000-8000-000000000001', '+966501000001'),  -- customer
  ('22222222-0000-4000-8000-000000000002', '+966501000002'),  -- technician
  ('33333333-0000-4000-8000-000000000003', '+966501000003');  -- ops

insert into public.profiles (id, full_name, phone, role) values
  ('11111111-0000-4000-8000-000000000001', 'العميل',  '+966501000001', 'customer'),
  ('22222222-0000-4000-8000-000000000002', 'الفنّي',  '+966501000002', 'technician'),
  ('33333333-0000-4000-8000-000000000003', 'المشغّل', '+966501000003', 'ops');

insert into public.cities (id, name_ar, name_en, region_ar, region_en, centroid) values
  ('c0000000-0000-4000-8000-000000000001', 'الدمام', 'DammamTest', 'المنطقة الشرقية',
   'Eastern Province', extensions.st_point(50.1033, 26.4207)::extensions.geography);

insert into public.vehicle_makes (id, name_ar, name_en) values
  ('a0000000-0000-4000-8000-000000000001', 'ماركة اختبار', 'TestMakeOrders');
insert into public.vehicle_models (id, make_id, name_ar, name_en, year_from) values
  ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001',
   'موديل اختبار', 'TestModelOrders', 2015);
insert into public.vehicles (id, owner_id, make_id, model_id, year, plate_en) values
  ('d0000000-0000-4000-8000-000000000001', '11111111-0000-4000-8000-000000000001',
   'a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001',
   2020, 'ABJ 7777');

insert into public.providers
  (id, owner_profile_id, provider_type, business_name_ar, verification_status,
   is_online, city_id, acceptance_rate)
values
  ('e0000000-0000-4000-8000-000000000001', '22222222-0000-4000-8000-000000000002',
   'individual', 'فنّي الاختبار', 'approved', true,
   'c0000000-0000-4000-8000-000000000001', 90);

-- The battery service: emergency, centrally fixed.
select id as svc_battery from public.services where name_en = 'Battery jump or replacement' \gset

insert into public.provider_services (provider_id, service_id)
values ('e0000000-0000-4000-8000-000000000001', :'svc_battery');

insert into public.provider_locations (provider_id, location, updated_at)
values ('e0000000-0000-4000-8000-000000000001',
        extensions.st_point(50.1040, 26.4210)::extensions.geography, now());


-- Central pricing is enforced, not merely documented (§11) -------------------
select test.assert_raises(
  format($$insert into public.provider_services (provider_id, service_id, custom_price)
           values ('e0000000-0000-4000-8000-000000000001', '%s', 300)$$, :'svc_battery'),
  'a provider cannot set their own price for an emergency service',
  '23514');


-- Creating the order ---------------------------------------------------------
select test.become('11111111-0000-4000-8000-000000000001');

insert into public.orders
  (id, customer_id, vehicle_id, service_id, fulfilment_mode, service_location,
   service_address_ar, problem_description, mileage_at_order, quoted_amount, created_by)
values
  ('f0000000-0000-4000-8000-000000000001',
   '11111111-0000-4000-8000-000000000001',
   'd0000000-0000-4000-8000-000000000001',
   :'svc_battery', 'mobile_ondemand',
   extensions.st_point(50.1050, 26.4220)::extensions.geography,
   'حي الشاطئ، شارع الأمير محمد، مبنى ١٢',
   'السيارة ما تشتغل، صوت طقطقة',
   91000, 120,
   '11111111-0000-4000-8000-000000000001');

select test.assert(
  (select order_number from public.orders where id = 'f0000000-0000-4000-8000-000000000001')
    like 'HB-%',
  'an order number is assigned automatically');


-- Illegal transitions are rejected --------------------------------------------
select test.assert_raises(
  $$update public.orders set status = 'completed'
    where id = 'f0000000-0000-4000-8000-000000000001'$$,
  'draft cannot jump straight to completed',
  '23514');

select test.assert_raises(
  $$update public.orders set status = 'checked_in'
    where id = 'f0000000-0000-4000-8000-000000000001'$$,
  'a mobile order cannot use the workshop-only checked_in state',
  '23514');

update public.orders set status = 'searching'
where id = 'f0000000-0000-4000-8000-000000000001';

select test.assert_raises(
  $$update public.orders set status = 'en_route'
    where id = 'f0000000-0000-4000-8000-000000000001'$$,
  'a searching order cannot skip straight to en_route',
  '23514');


-- Matching -------------------------------------------------------------------
select test.assert_eq(
  (select count(*)::int from public.match_providers('f0000000-0000-4000-8000-000000000001')),
  1, 'the nearby online approved provider is matched');

select test.assert(
  (select score from public.match_providers('f0000000-0000-4000-8000-000000000001') limit 1) > 50,
  'a close, well-rated, idle provider scores highly');

-- A stale position must not be dispatched on: a 20-minute-old fix produces the
-- false ETAs that ruin the tracking screen.
update public.provider_locations set updated_at = now() - interval '30 minutes'
where provider_id = 'e0000000-0000-4000-8000-000000000001';

select test.assert_eq(
  (select count(*)::int from public.match_providers('f0000000-0000-4000-8000-000000000001')),
  0, 'a provider with a stale location is not matched');

update public.provider_locations set updated_at = now()
where provider_id = 'e0000000-0000-4000-8000-000000000001';

-- An offline or unapproved provider is never matched.
update public.providers set is_online = false
where id = 'e0000000-0000-4000-8000-000000000001';
select test.assert_eq(
  (select count(*)::int from public.match_providers('f0000000-0000-4000-8000-000000000001')),
  0, 'an offline provider is not matched');
update public.providers set is_online = true
where id = 'e0000000-0000-4000-8000-000000000001';

-- Verification is an ops action since 0034; a provider cannot set it.
select test.become('33333333-0000-4000-8000-000000000003');
update public.providers set verification_status = 'pending'
where id = 'e0000000-0000-4000-8000-000000000001';
select test.become('11111111-0000-4000-8000-000000000001');
select test.assert_eq(
  (select count(*)::int from public.match_providers('f0000000-0000-4000-8000-000000000001')),
  0, 'an unverified provider is not matched');
select test.become('33333333-0000-4000-8000-000000000003');
update public.providers set verification_status = 'approved'
where id = 'e0000000-0000-4000-8000-000000000001';
select test.become('11111111-0000-4000-8000-000000000001');

-- Radius ladder (§7.1).
select test.assert_eq(public.match_radius_for_round(1), 8000, 'round 1 searches 8km');
select test.assert_eq(public.match_radius_for_round(2), 15000, 'round 2 expands to 15km');
select test.assert_eq(public.match_radius_for_round(3), 25000, 'round 3 expands to 25km');


-- Escrow guard: nobody drives out on an unfunded order ------------------------
-- The price is central for emergency services (§11) and set at creation, so
-- moving to `quoted` changes only the status.
update public.orders set status = 'quoted'
where id = 'f0000000-0000-4000-8000-000000000001';

-- Acceptance is the provider's action, and it is refused while the job is
-- unfunded: nobody drives out on an order nobody has paid for.
select test.become('22222222-0000-4000-8000-000000000002');
select test.assert_raises(
  $$select public.accept_order('f0000000-0000-4000-8000-000000000001')$$,
  'a provider cannot accept an unfunded job',
  '23514');

select test.become('11111111-0000-4000-8000-000000000001');
select public.authorise_order_payment('f0000000-0000-4000-8000-000000000001', 'test_intent_001');

select test.become('22222222-0000-4000-8000-000000000002');
select test.assert(
  public.accept_order('f0000000-0000-4000-8000-000000000001'),
  'the provider accepts once the money is held');
select test.become('11111111-0000-4000-8000-000000000001');

select test.assert_eq(
  (select escrow_status from public.orders where id = 'f0000000-0000-4000-8000-000000000001'),
  'authorised'::escrow_status,
  'money is authorised, not captured, at acceptance');


-- The job ---------------------------------------------------------------------
update public.orders set status = 'en_route' where id = 'f0000000-0000-4000-8000-000000000001';
update public.orders set status = 'arrived'  where id = 'f0000000-0000-4000-8000-000000000001';
update public.orders set status = 'in_progress' where id = 'f0000000-0000-4000-8000-000000000001';

-- Parts must be approved line by line before the job can be handed back.
insert into public.order_parts (order_id, name_ar, part_number, is_oem, quantity, unit_price)
values ('f0000000-0000-4000-8000-000000000001', 'بطارية ٧٠ أمبير', 'BAT-70-AGM', true, 1, 320.00);

-- The provider prices the work; the customer approves it. Since 0033 the
-- customer cannot write these columns at all.
select test.become('22222222-0000-4000-8000-000000000002');
update public.orders set parts_amount = 320.00, labour_amount = 120.00, vat_amount = 66.00,
  total_amount = 506.00, vat_rate_applied = 0.15, warranty_days = 90
where id = 'f0000000-0000-4000-8000-000000000001';
select test.become('11111111-0000-4000-8000-000000000001');

select test.assert_raises(
  $$update public.orders set status = 'awaiting_approval'
    where id = 'f0000000-0000-4000-8000-000000000001'$$,
  'work cannot be handed back while a part line is unapproved',
  '23514');

update public.order_parts set approved_by_customer = true, approved_at = now()
where order_id = 'f0000000-0000-4000-8000-000000000001';

-- Completion evidence is mandatory before hand-back (0032). Without it the
-- logbook entry this order produces would say a battery was replaced and
-- nothing more.
-- Recorded through the provider RPC; a customer cannot write evidence (0033).
select test.become('22222222-0000-4000-8000-000000000002');
select public.record_completion_evidence('f0000000-0000-4000-8000-000000000001', 91200, '[{"url":"https://example.test/b.jpg","kind":"before"},{"url":"https://example.test/a.jpg","kind":"after"}]'::jsonb);
select test.become('11111111-0000-4000-8000-000000000001');

update public.orders set status = 'awaiting_approval'
where id = 'f0000000-0000-4000-8000-000000000001';


-- Only the customer closes the job ---------------------------------------------
select test.become('22222222-0000-4000-8000-000000000002');
select test.assert_raises(
  $$update public.orders set status = 'completed'
    where id = 'f0000000-0000-4000-8000-000000000001'$$,
  'the provider cannot mark their own work complete',
  '42501');

select test.become('11111111-0000-4000-8000-000000000001');

-- The moat: completing writes the logbook in the same transaction.
select test.assert_eq(
  (select count(*)::int from public.vehicle_timeline
   where vehicle_id = 'd0000000-0000-4000-8000-000000000001'),
  0, 'the logbook is empty before completion');

update public.orders set status = 'completed'
where id = 'f0000000-0000-4000-8000-000000000001';

select test.assert_eq(
  (select count(*)::int from public.vehicle_timeline
   where vehicle_id = 'd0000000-0000-4000-8000-000000000001'
     and order_id = 'f0000000-0000-4000-8000-000000000001'),
  1, 'completing the order wrote a timeline entry automatically');

-- And it is genuinely verified, because Habba performed it.
select test.assert_eq(
  (select provenance from public.vehicle_timeline
   where order_id = 'f0000000-0000-4000-8000-000000000001'),
  'habba_verified'::public.timeline_provenance,
  'work done through a Habba order IS habba_verified');

-- The COMPLETION reading (91,200), not the booking reading (91,000). The car
-- was driven since it was booked, and the logbook should record where the
-- odometer actually stood when the work was done.
select test.assert_eq(
  (select mileage from public.vehicle_timeline
   where order_id = 'f0000000-0000-4000-8000-000000000001'),
  91200, 'the completion reading reaches the logbook, not the booking estimate');

select test.assert(
  (select warranty_expires_at from public.orders
   where id = 'f0000000-0000-4000-8000-000000000001') is not null,
  'the warranty window is computed at completion');

-- The chain still verifies after a machine-written entry.
select test.assert(
  (select is_valid from public.verify_vehicle_timeline('d0000000-0000-4000-8000-000000000001')),
  'the hash chain verifies after an order-generated entry');

-- Provider identity in the logbook is the BUSINESS name only (§7.3).
select test.assert(
  (select details ->> 'provider_business_name' from public.vehicle_timeline
   where order_id = 'f0000000-0000-4000-8000-000000000001') = 'فنّي الاختبار',
  'the logbook records the provider business name');
select test.assert(
  (select details::text from public.vehicle_timeline
   where order_id = 'f0000000-0000-4000-8000-000000000001') not like '%الفنّي%',
  'the technician''s personal name is not written to the logbook');


-- Ratings ----------------------------------------------------------------------
insert into public.ratings (order_id, rater_id, provider_id, stars, tags)
values ('f0000000-0000-4000-8000-000000000001', '11111111-0000-4000-8000-000000000001',
        'e0000000-0000-4000-8000-000000000001', 5, array['سرعة','نظافة']);

select test.assert_eq(
  (select rating_avg from public.providers where id = 'e0000000-0000-4000-8000-000000000001'),
  5.00::numeric, 'the provider aggregate is refreshed');
select test.assert_eq(
  (select rating_count from public.providers where id = 'e0000000-0000-4000-8000-000000000001'),
  1, 'the rating count is refreshed');

-- A second order, left incomplete, cannot be rated.
insert into public.orders
  (id, customer_id, vehicle_id, service_id, fulfilment_mode, service_location, created_by)
values ('f0000000-0000-4000-8000-000000000002',
        '11111111-0000-4000-8000-000000000001',
        'd0000000-0000-4000-8000-000000000001',
        :'svc_battery', 'mobile_ondemand',
        extensions.st_point(50.1050, 26.4220)::extensions.geography,
        '11111111-0000-4000-8000-000000000001');

select test.assert_raises(
  $$insert into public.ratings (order_id, rater_id, provider_id, stars)
    values ('f0000000-0000-4000-8000-000000000002','11111111-0000-4000-8000-000000000001',
            'e0000000-0000-4000-8000-000000000001', 5)$$,
  'an incomplete order cannot be rated',
  '23514');


-- Totals must reconcile, or ZATCA rejects the invoice (ADR-0007) ---------------
-- Checked as the provider, since only they may write amounts at all — the
-- reconciliation constraint is the thing under test here, not the guard.
select test.become('22222222-0000-4000-8000-000000000002');
select test.assert_raises(
  $$update public.orders
    set parts_amount = 100, labour_amount = 100, vat_amount = 30, total_amount = 999
    where id = 'f0000000-0000-4000-8000-000000000002'$$,
  'a total that does not equal parts + labour + VAT is rejected',
  '23514');

rollback;

\echo '   orders OK'
