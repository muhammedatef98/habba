-- 23 — Handover codes and live progress
--
-- Companion to 0047. Both features exist to be withheld from someone, so the
-- assertions that matter are the negative ones: the provider must not be able
-- to read the code they are being checked against, and nobody but the customer
-- may ask how far away their technician is.

\echo '── handover and live progress'

begin;

-- Fixtures ------------------------------------------------------------------
insert into auth.users (id, phone) values
  ('11111111-0000-4000-a000-000000000001', '+966502000001'),  -- customer
  ('22222222-0000-4000-a000-000000000002', '+966502000002'),  -- technician
  ('33333333-0000-4000-a000-000000000003', '+966502000003');  -- unrelated customer

insert into public.profiles (id, full_name, phone, role) values
  ('11111111-0000-4000-a000-000000000001', 'العميل',  '+966502000001', 'customer'),
  ('22222222-0000-4000-a000-000000000002', 'الفنّي',  '+966502000002', 'technician'),
  ('33333333-0000-4000-a000-000000000003', 'فضولي',   '+966502000003', 'customer');

insert into public.cities (id, name_ar, name_en, region_ar, region_en, centroid) values
  ('c0000000-0000-4000-a000-000000000001', 'الرياض', 'RiyadhHandover', 'الرياض',
   'Riyadh', extensions.st_point(46.6753, 24.7136)::extensions.geography);

insert into public.vehicle_makes (id, name_ar, name_en) values
  ('a0000000-0000-4000-a000-000000000001', 'ماركة', 'TestMakeHandover');
insert into public.vehicle_models (id, make_id, name_ar, name_en, year_from) values
  ('b0000000-0000-4000-a000-000000000001', 'a0000000-0000-4000-a000-000000000001',
   'موديل', 'TestModelHandover', 2015);
insert into public.vehicles (id, owner_id, make_id, model_id, year, plate_en) values
  ('d0000000-0000-4000-a000-000000000001', '11111111-0000-4000-a000-000000000001',
   'a0000000-0000-4000-a000-000000000001', 'b0000000-0000-4000-a000-000000000001',
   2021, 'ABJ 8888');

insert into public.providers
  (id, owner_profile_id, provider_type, business_name_ar, verification_status,
   is_online, city_id, acceptance_rate)
values
  ('e0000000-0000-4000-a000-000000000001', '22222222-0000-4000-a000-000000000002',
   'individual', 'ونش الاختبار', 'approved', true,
   'c0000000-0000-4000-a000-000000000001', 90);

select id as svc_tow from public.services where name_en = 'Towing' \gset

insert into public.provider_services (provider_id, service_id)
values ('e0000000-0000-4000-a000-000000000001', :'svc_tow');

-- 1 km north of the customer, fresh.
insert into public.provider_locations (provider_id, location, updated_at)
values ('e0000000-0000-4000-a000-000000000001',
        extensions.st_point(46.6753, 24.7226)::extensions.geography, now());

select test.become('11111111-0000-4000-a000-000000000001');

insert into public.orders
  (id, customer_id, vehicle_id, service_id, fulfilment_mode, service_location,
   service_address_ar, quoted_amount, created_by)
values
  ('f0000000-0000-4000-a000-000000000001',
   '11111111-0000-4000-a000-000000000001',
   'd0000000-0000-4000-a000-000000000001',
   :'svc_tow', 'mobile_ondemand',
   extensions.st_point(46.6753, 24.7136)::extensions.geography,
   'طريق الملك عبدالله', 170.00,
   '11111111-0000-4000-a000-000000000001');


-- A code is issued exactly once, on acceptance -------------------------------
select test.assert(
  not exists (select 1 from public.order_handovers
              where order_id = 'f0000000-0000-4000-a000-000000000001'),
  'no handover code exists before the job is accepted');

-- The real path, not a hand-set status: acceptance is the provider's action
-- and is refused while the job is unfunded (0033). Driving the trigger through
-- the genuine transition is the only way to know it fires in production.
update public.orders set status = 'searching'
 where id = 'f0000000-0000-4000-a000-000000000001';
update public.orders set status = 'quoted'
 where id = 'f0000000-0000-4000-a000-000000000001';

select public.authorise_order_payment('f0000000-0000-4000-a000-000000000001', 'test_intent_handover');

select test.become('22222222-0000-4000-a000-000000000002');
select test.assert(
  public.accept_order('f0000000-0000-4000-a000-000000000001'),
  'the provider accepts the funded job');

select test.become('11111111-0000-4000-a000-000000000001');

select test.assert_eq(
  (select count(*)::int from public.order_handovers
    where order_id = 'f0000000-0000-4000-a000-000000000001'),
  1,
  'accepting the job issues exactly one handover code');

select test.assert(
  (select code ~ '^[0-9]{4}$' from public.order_handovers
    where order_id = 'f0000000-0000-4000-a000-000000000001'),
  'the code is four digits, leading zeros allowed');

select code as handover_code from public.order_handovers
 where order_id = 'f0000000-0000-4000-a000-000000000001' \gset


-- Who may read it ------------------------------------------------------------
set role authenticated;

select test.become('11111111-0000-4000-a000-000000000001');
select test.assert_eq(
  (select count(*)::int from public.order_handovers
    where order_id = 'f0000000-0000-4000-a000-000000000001'),
  1,
  'the customer can read their own handover code');

-- ⚠️ The assertion this whole table exists for. A provider who can read the
-- code can walk up to any car and recite it.
select test.become('22222222-0000-4000-a000-000000000002');
select test.assert_eq(
  (select count(*)::int from public.order_handovers
    where order_id = 'f0000000-0000-4000-a000-000000000001'),
  0,
  'the assigned provider CANNOT read the handover code they are checked against');

select test.become('33333333-0000-4000-a000-000000000003');
select test.assert_eq(
  (select count(*)::int from public.order_handovers
    where order_id = 'f0000000-0000-4000-a000-000000000001'),
  0,
  'an unrelated customer cannot read someone else''s handover code');


-- Verification ---------------------------------------------------------------
select test.become('33333333-0000-4000-a000-000000000003');
select test.assert_raises(
  format($$select public.verify_handover_code('f0000000-0000-4000-a000-000000000001', '%s')$$,
         :'handover_code'),
  'a stranger cannot spend the attempt budget',
  '42501');

select test.become('22222222-0000-4000-a000-000000000002');
select test.assert_eq(
  public.verify_handover_code('f0000000-0000-4000-a000-000000000001', '0000')
    is not distinct from
  (:'handover_code' = '0000'),
  true,
  'a wrong guess returns false rather than raising');

select test.assert_eq(
  public.verify_handover_code('f0000000-0000-4000-a000-000000000001', :'handover_code'),
  true,
  'the assigned provider can verify the correct code');

-- Read back as the customer: the provider still cannot see this table, which
-- is exactly why the assertion has to switch identity to check it.
select test.become('11111111-0000-4000-a000-000000000001');
select test.assert(
  (select verified_at is not null from public.order_handovers
    where order_id = 'f0000000-0000-4000-a000-000000000001'),
  'a successful verification is recorded');

reset role;


-- The attempt budget is real -------------------------------------------------
insert into public.order_handovers (order_id, code, attempts)
values ('f0000000-0000-4000-a000-000000000001', '1234', 99)
on conflict (order_id) do update set code = '1234', attempts = 99, verified_at = null;

set role authenticated;
select test.become('22222222-0000-4000-a000-000000000002');

select test.assert_raises(
  $$select public.verify_handover_code('f0000000-0000-4000-a000-000000000001', '1234')$$,
  'the code locks after too many attempts, even for a correct guess',
  '23514');

reset role;


-- Live progress ---------------------------------------------------------------
update public.orders set status = 'en_route'
 where id = 'f0000000-0000-4000-a000-000000000001';

set role authenticated;
select test.become('11111111-0000-4000-a000-000000000001');

select test.assert(
  (select distance_m between 900 and 1100
     from public.order_live_progress('f0000000-0000-4000-a000-000000000001')),
  'the customer gets a distance of roughly 1 km');

select test.assert(
  (select eta_minutes >= 1
     from public.order_live_progress('f0000000-0000-4000-a000-000000000001')),
  'the ETA is at least a minute — never zero');

-- The provider knows where they are; nobody else needs to.
select test.become('22222222-0000-4000-a000-000000000002');
select test.assert_raises(
  $$select * from public.order_live_progress('f0000000-0000-4000-a000-000000000001')$$,
  'the provider cannot read live progress',
  '42501');

select test.become('33333333-0000-4000-a000-000000000003');
select test.assert_raises(
  $$select * from public.order_live_progress('f0000000-0000-4000-a000-000000000001')$$,
  'an unrelated customer cannot track someone else''s technician',
  '42501');

reset role;


-- A stale fix reports nothing rather than a confident wrong number ------------
update public.provider_locations
   set updated_at = now() - interval '30 minutes'
 where provider_id = 'e0000000-0000-4000-a000-000000000001';

set role authenticated;
select test.become('11111111-0000-4000-a000-000000000001');

select test.assert_eq(
  (select count(*)::int from public.order_live_progress('f0000000-0000-4000-a000-000000000001')),
  0,
  'a stale position yields no row, so the screen degrades instead of lying');

reset role;

-- And nothing is reported once the journey is over.
update public.provider_locations set updated_at = now()
 where provider_id = 'e0000000-0000-4000-a000-000000000001';
-- Via `arrived`: a mobile job cannot skip it, and the machine says so.
update public.orders set status = 'arrived'
 where id = 'f0000000-0000-4000-a000-000000000001';
update public.orders set status = 'in_progress'
 where id = 'f0000000-0000-4000-a000-000000000001';

set role authenticated;
select test.become('11111111-0000-4000-a000-000000000001');

select test.assert_eq(
  (select count(*)::int from public.order_live_progress('f0000000-0000-4000-a000-000000000001')),
  0,
  'live progress stops once the technician is no longer travelling');

reset role;

rollback;
