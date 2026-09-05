-- 26 — Expanding a quiet search
--
-- Companion to 0051. The interesting cases are the ones where nothing should
-- happen: a search that is still fresh, one that already reached the last
-- rung, and one that stopped searching.

\echo '── dispatch expansion'

begin;

insert into auth.users (id, phone) values
  ('11111111-0000-4000-d000-000000000001', '+966505000001'),
  ('22222222-0000-4000-d000-000000000002', '+966505000002');

insert into public.profiles (id, full_name, phone) values
  ('11111111-0000-4000-d000-000000000001', 'العميل', '+966505000001'),
  ('22222222-0000-4000-d000-000000000002', 'فنّي', '+966505000002');

insert into public.cities (id, name_ar, name_en, region_ar, region_en, centroid) values
  ('c0000000-0000-4000-d000-000000000001', 'الدمام', 'DammamExpand', 'الشرقية', 'Eastern',
   extensions.st_point(50.1033, 26.4207)::extensions.geography);

select id as svc_tow from public.services where name_en = 'Towing' \gset

insert into public.providers
  (id, owner_profile_id, provider_type, business_name_ar, verification_status,
   is_online, city_id, acceptance_rate)
values
  ('e0000000-0000-4000-d000-000000000001', '22222222-0000-4000-d000-000000000002',
   'individual', 'ونش بعيد', 'approved', true, 'c0000000-0000-4000-d000-000000000001', 90);

insert into public.provider_services (provider_id, service_id)
values ('e0000000-0000-4000-d000-000000000001', :'svc_tow');

-- ~12km away: outside the 8km first rung, inside the 15km second.
insert into public.provider_locations (provider_id, location, updated_at)
values ('e0000000-0000-4000-d000-000000000001',
        extensions.st_point(50.2200, 26.4207)::extensions.geography, now());

select test.become('11111111-0000-4000-d000-000000000001');

insert into public.orders
  (id, customer_id, service_id, fulfilment_mode, service_location, quoted_amount, created_by)
values
  ('f0000000-0000-4000-d000-000000000001',
   '11111111-0000-4000-d000-000000000001', :'svc_tow', 'mobile_ondemand',
   extensions.st_point(50.1033, 26.4207)::extensions.geography, 170.00,
   '11111111-0000-4000-d000-000000000001');

update public.orders set status = 'searching'
 where id = 'f0000000-0000-4000-d000-000000000001';

select test.assert_eq(
  (select count(*)::int from public.order_offers
    where order_id = 'f0000000-0000-4000-d000-000000000001'),
  0,
  'round 1 reaches nobody — the only provider is beyond 8km');


-- Nothing happens while the search is still fresh ------------------------------
select test.assert_eq(
  (select count(*)::int from public.expand_stale_searches()),
  0,
  'a search that just started is not stale, however empty it looks');


-- Once it has gone quiet, the radius widens ------------------------------------
-- Backdate the transition, not `orders.updated_at`: a trigger rewrites that
-- column on every update, so it cannot be moved and is the wrong clock anyway.
update public.order_events set created_at = now() - interval '2 minutes'
 where order_id = 'f0000000-0000-4000-d000-000000000001' and to_status = 'searching';

select test.assert_eq(
  (select round from public.expand_stale_searches()
    where order_id = 'f0000000-0000-4000-d000-000000000001'),
  2,
  'silence past the window advances to the second rung');

select test.assert_eq(
  (select count(*)::int from public.order_offers
    where order_id = 'f0000000-0000-4000-d000-000000000001'),
  1,
  'and the wider radius finds the provider that round 1 could not');

select test.assert_eq(
  (select radius_m from public.order_offers
    where order_id = 'f0000000-0000-4000-d000-000000000001'),
  public.match_radius_for_round(2),
  'the offer records the radius it was actually sent at');


-- Superseded offers are closed, not left pending -------------------------------
-- `sent_at` is system-owned and the column guard refuses to let it be
-- rewritten — which is the point of the guard. Backdating it here is a system
-- action, so it goes through the same privileged path the triggers use.
select public.begin_privileged_write();
update public.order_offers set sent_at = now() - interval '2 minutes'
 where order_id = 'f0000000-0000-4000-d000-000000000001';
select public.end_privileged_write();

select public.expand_stale_searches();

select test.assert_eq(
  (select outcome::text from public.order_offers
    where order_id = 'f0000000-0000-4000-d000-000000000001' and round = 2),
  'expired',
  'a round that has been superseded expires, so the counters stop claiming someone is reviewing');


-- The ladder has an end --------------------------------------------------------
select public.begin_privileged_write();
update public.order_offers set sent_at = now() - interval '5 minutes'
 where order_id = 'f0000000-0000-4000-d000-000000000001';
select public.end_privileged_write();

select test.assert_eq(
  (select count(*)::int from public.expand_stale_searches()),
  0,
  'past the last rung it stops widening rather than searching the country');


-- And it only touches orders that are still searching ---------------------------
update public.orders set status = 'cancelled'
 where id = 'f0000000-0000-4000-d000-000000000001';

select test.assert_eq(
  (select count(*)::int from public.expand_stale_searches()),
  0,
  'a cancelled order is not a quiet search');


-- Not a lever a client can pull -------------------------------------------------
set role authenticated;
select test.become('11111111-0000-4000-d000-000000000001');

select test.assert_raises(
  $$select * from public.expand_stale_searches()$$,
  'a customer cannot widen their own search on demand and jump the queue',
  '42501');

reset role;

rollback;
