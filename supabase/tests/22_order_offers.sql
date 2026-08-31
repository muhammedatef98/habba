-- 22 — Dispatch offers and telemetry
--
-- Companion to 0042. The counts belong to the customer; the identities do not.
-- Most of what follows is about that line.

\echo '── dispatch offers'

begin;

insert into auth.users (id, phone) values
  ('11111111-0000-4000-c000-000000000001', '+966504000001'),
  ('22222222-0000-4000-c000-000000000002', '+966504000002'),
  ('33333333-0000-4000-c000-000000000003', '+966504000003');

insert into public.profiles (id, full_name, phone, role) values
  ('11111111-0000-4000-c000-000000000001', 'العميل', '+966504000001', 'customer'),
  ('22222222-0000-4000-c000-000000000002', 'فنّي أ', '+966504000002', 'technician'),
  ('33333333-0000-4000-c000-000000000003', 'فنّي ب', '+966504000003', 'technician');

insert into public.cities (id, name_ar, name_en, region_ar, region_en, centroid) values
  ('c0000000-0000-4000-c000-000000000001', 'الرياض', 'RiyadhOffers', 'الرياض', 'Riyadh',
   extensions.st_point(46.6753, 24.7136)::extensions.geography);

select id as svc_tow from public.services where name_en = 'Towing' \gset

insert into public.providers
  (id, owner_profile_id, provider_type, business_name_ar, verification_status,
   is_online, city_id, acceptance_rate)
values
  ('e0000000-0000-4000-c000-000000000001', '22222222-0000-4000-c000-000000000002',
   'individual', 'ونش أ', 'approved', true, 'c0000000-0000-4000-c000-000000000001', 90),
  ('e0000000-0000-4000-c000-000000000002', '33333333-0000-4000-c000-000000000003',
   'individual', 'ونش ب', 'approved', true, 'c0000000-0000-4000-c000-000000000001', 80);

insert into public.provider_services (provider_id, service_id) values
  ('e0000000-0000-4000-c000-000000000001', :'svc_tow'),
  ('e0000000-0000-4000-c000-000000000002', :'svc_tow');

-- Both within the round-1 radius, both with a fresh fix.
insert into public.provider_locations (provider_id, location, updated_at) values
  ('e0000000-0000-4000-c000-000000000001',
   extensions.st_point(46.6760, 24.7150)::extensions.geography, now()),
  ('e0000000-0000-4000-c000-000000000002',
   extensions.st_point(46.6800, 24.7200)::extensions.geography, now());

select test.become('11111111-0000-4000-c000-000000000001');

insert into public.orders
  (id, customer_id, service_id, fulfilment_mode, service_location, quoted_amount, created_by)
values
  ('f0000000-0000-4000-c000-000000000001',
   '11111111-0000-4000-c000-000000000001', :'svc_tow', 'mobile_ondemand',
   extensions.st_point(46.6753, 24.7136)::extensions.geography, 170.00,
   '11111111-0000-4000-c000-000000000001');


-- The broadcast happens on its own -------------------------------------------
select test.assert_eq(
  (select count(*)::int from public.order_offers
    where order_id = 'f0000000-0000-4000-c000-000000000001'),
  0,
  'nothing is broadcast before the order starts searching');

update public.orders set status = 'searching'
 where id = 'f0000000-0000-4000-c000-000000000001';

select test.assert_eq(
  (select count(*)::int from public.order_offers
    where order_id = 'f0000000-0000-4000-c000-000000000001'),
  2,
  'entering `searching` broadcasts to every nearby provider at once (§7.1)');

select test.assert(
  (select bool_and(radius_m = public.match_radius_for_round(1))
     from public.order_offers where order_id = 'f0000000-0000-4000-c000-000000000001'),
  'each offer records the radius it was sent at, not the radius now');

-- Re-broadcasting must not double-count: the number the customer watches is
-- the one figure that has to stay honest.
select test.assert_eq(
  public.broadcast_order('f0000000-0000-4000-c000-000000000001', 1),
  0,
  're-broadcasting the same round adds nobody');


-- Who can see what -----------------------------------------------------------
set role authenticated;

select test.become('22222222-0000-4000-c000-000000000002');
select test.assert_eq(
  (select count(*)::int from public.order_offers),
  1,
  'a provider sees their own offer — that is their job queue');

-- ⚠️ The assertion the definer function exists for.
select test.become('11111111-0000-4000-c000-000000000001');
select test.assert_eq(
  (select count(*)::int from public.order_offers),
  0,
  'the CUSTOMER cannot list the offers: the counts are theirs, the names are not');

select test.assert_eq(
  (select contacted_count from public.order_dispatch_telemetry('f0000000-0000-4000-c000-000000000001')),
  2,
  'but the customer does get the count, through the definer function');

select test.become('33333333-0000-4000-c000-000000000003');
select test.assert_raises(
  $$select * from public.order_dispatch_telemetry('f0000000-0000-4000-c000-000000000001')$$,
  'a provider cannot read the customer''s dispatch telemetry',
  '42501');

reset role;


-- The groups the waiting screen shows ----------------------------------------
update public.order_offers set outcome = 'viewed', viewed_at = now()
 where provider_id = 'e0000000-0000-4000-c000-000000000001';
update public.order_offers set outcome = 'declined', responded_at = now()
 where provider_id = 'e0000000-0000-4000-c000-000000000002';

set role authenticated;
select test.become('11111111-0000-4000-c000-000000000001');

select test.assert_eq(
  (select reviewing_count from public.order_dispatch_telemetry('f0000000-0000-4000-c000-000000000001')),
  1,
  'one is reviewing');

select test.assert_eq(
  (select busy_count from public.order_dispatch_telemetry('f0000000-0000-4000-c000-000000000001')),
  1,
  'one is busy — declined and expired read the same to the customer');

select test.assert(
  (select area_median_seconds is null
     from public.order_dispatch_telemetry('f0000000-0000-4000-c000-000000000001')),
  'the median is null without enough history, so the screen shows nothing rather than a guess');

reset role;


-- ⚠️ A provider cannot declare themselves the winner --------------------------
-- Without the column guard this is a plain UPDATE that walks past
-- accept_order() and its check that the order is funded (0033) — a provider
-- marking themselves accepted on an order nobody has paid for.
set role authenticated;
select test.become('22222222-0000-4000-c000-000000000002');

select test.assert_raises(
  $$update public.order_offers set outcome = 'accepted'
     where provider_id = 'e0000000-0000-4000-c000-000000000001'$$,
  'a provider cannot self-accept an offer and bypass the escrow check',
  '42501');

select test.assert_raises(
  $$update public.order_offers set radius_m = 99999
     where provider_id = 'e0000000-0000-4000-c000-000000000001'$$,
  'nor rewrite what was sent to them',
  '42501');

-- Responding IS allowed — that is the whole point of the row.
update public.order_offers set outcome = 'declined', responded_at = now()
 where provider_id = 'e0000000-0000-4000-c000-000000000001';

select test.assert_eq(
  (select outcome::text from public.order_offers
    where provider_id = 'e0000000-0000-4000-c000-000000000001'),
  'declined',
  'but declining is theirs to do');

reset role;


-- Telemetry stops once the search is over ------------------------------------
update public.orders set status = 'quoted'
 where id = 'f0000000-0000-4000-c000-000000000001';

set role authenticated;
select test.become('11111111-0000-4000-c000-000000000001');

select test.assert_eq(
  (select count(*)::int from public.order_dispatch_telemetry('f0000000-0000-4000-c000-000000000001')),
  0,
  'no telemetry after matching: the customer has no use for how many declined');

reset role;

rollback;
