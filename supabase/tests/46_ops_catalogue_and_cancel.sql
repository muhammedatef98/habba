-- 46 — The catalogue, and ending an order from the board
--
-- Two more console surfaces, and the rules under both.
--
-- **The catalogue** is what every price in the app is quoted from, so an
-- operator editing it is one keystroke from changing what customers pay. The
-- property that makes it safe to expose at all is that an order carries its own
-- `quoted_amount` from the moment it is placed — so a correction can never
-- re-price work somebody already agreed to. That is asserted here rather than
-- assumed, because the whole screen rests on it.
--
-- **Cancelling from the board** is the action the board was built to make
-- possible and did not offer: «لا أحد متاح» after three dispatch rounds, with a
-- customer waiting next to a broken-down car, and nothing an operator could do
-- about it but watch.

\echo '── ops catalogue and cancellation'

begin;

select public.test_seed_auth_user('11111111-0000-4000-e000-000000000001', '+966507000001');
select public.test_seed_auth_user('22222222-0000-4000-e000-000000000002', '+966507000002');
select public.test_seed_auth_user('33333333-0000-4000-e000-000000000003', '+966507000003');

insert into public.profiles (id, full_name, phone) values
  ('11111111-0000-4000-e000-000000000001', 'العميل', '+966507000001'),
  ('22222222-0000-4000-e000-000000000002', 'المشغّل', '+966507000002'),
  ('33333333-0000-4000-e000-000000000003', 'الفنّي', '+966507000003');

select test.grant_role('22222222-0000-4000-e000-000000000002', 'ops');
select test.grant_role('33333333-0000-4000-e000-000000000003', 'technician');

insert into public.cities (id, name_ar, name_en, region_ar, region_en, centroid) values
  ('c0000000-0000-4000-e000-000000000001', 'الطائف', 'TaifOps', 'مكة', 'Makkah',
   extensions.st_point(40.4158, 21.2703)::extensions.geography);

-- A real approved provider, not merely a role grant. The cancellation section
-- below is about what an approved provider with no claim on THIS order can do,
-- which is a different question from what someone with no provider record can.
insert into public.providers
  (id, owner_profile_id, provider_type, business_name_ar, verification_status, city_id)
values
  ('e0000000-0000-4000-e000-000000000001', '33333333-0000-4000-e000-000000000003',
   'individual', 'فنّي الطائف', 'approved', 'c0000000-0000-4000-e000-000000000001');

insert into public.vehicle_makes (id, name_ar, name_en) values
  ('a0000000-0000-4000-e000-000000000001', 'ماركة تشغيل', 'TestMakeOps');
insert into public.vehicle_models (id, make_id, name_ar, name_en, year_from) values
  ('b0000000-0000-4000-e000-000000000001', 'a0000000-0000-4000-e000-000000000001',
   'موديل تشغيل', 'TestModelOps', 2015);
insert into public.vehicles (id, owner_id, make_id, model_id, year, plate_en) values
  ('d0000000-0000-4000-e000-000000000001', '11111111-0000-4000-e000-000000000001',
   'a0000000-0000-4000-e000-000000000001', 'b0000000-0000-4000-e000-000000000001',
   2021, 'ABJ 9090');

select id as svc_battery from public.services where name_en = 'Battery jump or replacement' \gset
select base_price as original_price from public.services where id = :'svc_battery' \gset


-- ===================================================================================
-- The catalogue
-- ===================================================================================
set role authenticated;

-- A customer cannot touch it. `services_write` (0022) is ops-only, and the
-- price of every service in the country is not a thing a signed-in user edits.
select test.become('11111111-0000-4000-e000-000000000001');
update public.services set base_price = 1 where id = :'svc_battery';

select test.assert_eq(
  (select base_price from public.services where id = :'svc_battery'),
  (:'original_price')::numeric(12,2),
  'a customer cannot edit the catalogue — the write finds no row');

-- Nor can a technician, who has the most to gain from it.
select test.become('33333333-0000-4000-e000-000000000003');
update public.services set base_price = 9999 where id = :'svc_battery';

select test.assert_eq(
  (select base_price from public.services where id = :'svc_battery'),
  (:'original_price')::numeric(12,2),
  'and neither can a provider');

-- An operator can.
select test.become('22222222-0000-4000-e000-000000000002');
update public.services set base_price = 175.00 where id = :'svc_battery';

select test.assert_eq(
  (select base_price from public.services where id = :'svc_battery'),
  175.00::numeric(12,2),
  'an operator sets the price');

reset role;


-- A retired service stays visible to ops and disappears for everyone else -------------
set role authenticated;
select test.become('22222222-0000-4000-e000-000000000002');
update public.services set is_active = false where id = :'svc_battery';

select test.assert_eq(
  (select count(*)::int from public.services where id = :'svc_battery'),
  1, 'ops still sees a retired service, which is how it gets put back');

select test.become('11111111-0000-4000-e000-000000000001');
select test.assert_eq(
  (select count(*)::int from public.services where id = :'svc_battery'),
  0, 'and a customer no longer sees it at all');

select test.become('22222222-0000-4000-e000-000000000002');
update public.services set is_active = true where id = :'svc_battery';
reset role;


-- ⚠️ The property the whole screen rests on -------------------------------------------
-- An order carries the price it was placed at. Editing the catalogue afterwards
-- must not move it — otherwise a correction typed at 2am silently re-prices
-- work a customer already agreed to.
set role authenticated;
select test.become('11111111-0000-4000-e000-000000000001');

insert into public.orders
  (id, customer_id, vehicle_id, service_id, fulfilment_mode, service_location,
   quoted_amount, created_by)
values
  ('f0000000-0000-4000-e000-000000000001',
   '11111111-0000-4000-e000-000000000001', 'd0000000-0000-4000-e000-000000000001',
   :'svc_battery', 'mobile_ondemand',
   extensions.st_point(40.42, 21.27)::extensions.geography,
   175.00, '11111111-0000-4000-e000-000000000001');

reset role;

set role authenticated;
select test.become('22222222-0000-4000-e000-000000000002');
update public.services set base_price = 500.00 where id = :'svc_battery';
reset role;

select test.assert_eq(
  (select quoted_amount from public.orders where id = 'f0000000-0000-4000-e000-000000000001'),
  175.00::numeric(12,2),
  'an order keeps the price it was placed at, whatever the catalogue does later');


-- ===================================================================================
-- Ending an order from the board
-- ===================================================================================
set role authenticated;
select test.become('11111111-0000-4000-e000-000000000001');
update public.orders set status = 'searching'
 where id = 'f0000000-0000-4000-e000-000000000001';
reset role;

-- ⚠️ An approved provider with no claim on the order cannot end it — and the
-- reason is one step earlier than the write: 0022 grants a provider read on an
-- order only through `provider_id = current_provider_id()`, and deliberately
-- has no policy for any other order. So the row is not merely un-writable, it
-- is invisible. Open-order discovery goes through
-- `list_open_orders_for_provider`, which masks the location (ADR-0013).
set role authenticated;
select test.become('33333333-0000-4000-e000-000000000003');

select test.assert_eq(
  (select count(*)::int from public.orders
    where id = 'f0000000-0000-4000-e000-000000000001'),
  0, 'an unassigned provider cannot even see somebody else''s order');

update public.orders set status = 'cancelled'
 where id = 'f0000000-0000-4000-e000-000000000001';
reset role;

-- Read back as the one role that can see it, because the assertion is about
-- the row, not about what the technician can see of it.
select test.assert_eq(
  (select status::text from public.orders where id = 'f0000000-0000-4000-e000-000000000001'),
  'searching',
  'and their cancellation touches nothing');

-- The operator can, with a reason recorded alongside it.
set role authenticated;
select test.become('22222222-0000-4000-e000-000000000002');
update public.orders
   set status = 'cancelled', cancellation_reason = 'لا يوجد فنّي متاح في المنطقة'
 where id = 'f0000000-0000-4000-e000-000000000001';

select test.assert_eq(
  (select status::text from public.orders where id = 'f0000000-0000-4000-e000-000000000001'),
  'cancelled', 'an operator ends a request nobody can serve');

select test.assert(
  (select cancellation_reason from public.orders
    where id = 'f0000000-0000-4000-e000-000000000001') is not null,
  'and the reason is on the row, because the customer is told something');

reset role;


-- A finished order is not ops' to reopen or cancel ------------------------------------
-- ⚠️ 0020's transition table has no edge out of `completed`, and ops is not
-- exempt from it. The console does not decide what is terminal; the state
-- machine does, and it refuses this for everyone.
set role authenticated;
select test.become('11111111-0000-4000-e000-000000000001');

insert into public.orders
  (id, customer_id, vehicle_id, service_id, fulfilment_mode, status, service_location,
   quoted_amount, created_by)
values
  ('f0000000-0000-4000-e000-000000000002',
   '11111111-0000-4000-e000-000000000001', 'd0000000-0000-4000-e000-000000000001',
   :'svc_battery', 'mobile_ondemand', 'completed',
   extensions.st_point(40.42, 21.27)::extensions.geography,
   175.00, '11111111-0000-4000-e000-000000000001');

reset role;

set role authenticated;
select test.become('22222222-0000-4000-e000-000000000002');

select test.assert_raises(
  $$update public.orders set status = 'cancelled'
     where id = 'f0000000-0000-4000-e000-000000000002'$$,
  'a completed order cannot be cancelled, by ops or anybody',
  '23514');

reset role;

rollback;
