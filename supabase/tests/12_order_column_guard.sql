-- 12 — Column-level write control on orders
--
-- The vulnerability this closes survived six phases of tests because every
-- test went through the flow honestly. Nothing stopped anyone from not doing
-- that: `orders_update_customer` grants UPDATE on the whole row, and RLS
-- cannot say "these columns but not those".
--
-- Each assertion below is an attack that worked before 0033.

\echo '── order column guard'

begin;

insert into auth.users (id, phone) values
  ('11111111-0000-4000-f000-000000000001', '+966507000001'),
  ('22222222-0000-4000-f000-000000000002', '+966507000002'),
  ('44444444-0000-4000-f000-000000000004', '+966507000004');

insert into public.profiles (id, full_name, phone) values
  ('11111111-0000-4000-f000-000000000001', 'العميل', '+966507000001'),
  ('22222222-0000-4000-f000-000000000002', 'الفنّي', '+966507000002'),
  ('44444444-0000-4000-f000-000000000004', 'فنّي آخر', '+966507000004');

select test.grant_role('22222222-0000-4000-f000-000000000002', 'technician');
select test.grant_role('44444444-0000-4000-f000-000000000004', 'technician');

insert into public.cities (id, name_ar, name_en, region_ar, region_en, centroid) values
  ('c0000000-0000-4000-f000-000000000001', 'الرياض', 'RiyadhGuard', 'ر', 'R',
   extensions.st_point(46.6753, 24.7136)::extensions.geography);

insert into public.vehicle_makes (id, name_ar, name_en) values
  ('a0000000-0000-4000-f000-000000000001', 'ماركة', 'TestMakeGuard');
insert into public.vehicle_models (id, make_id, name_ar, name_en, year_from) values
  ('b0000000-0000-4000-f000-000000000001', 'a0000000-0000-4000-f000-000000000001',
   'موديل', 'TestModelGuard', 2015);
insert into public.vehicles (id, owner_id, make_id, model_id, year, plate_en) values
  ('d0000000-0000-4000-f000-000000000001', '11111111-0000-4000-f000-000000000001',
   'a0000000-0000-4000-f000-000000000001', 'b0000000-0000-4000-f000-000000000001',
   2020, 'ABJ 2222');

insert into public.providers
  (id, owner_profile_id, provider_type, business_name_ar, verification_status, is_online, city_id)
values
  ('e0000000-0000-4000-f000-000000000002', '22222222-0000-4000-f000-000000000002',
   'individual', 'فنّي الحراسة', 'approved', true, 'c0000000-0000-4000-f000-000000000001'),
  ('e0000000-0000-4000-f000-000000000004', '44444444-0000-4000-f000-000000000004',
   'individual', 'فنّي آخر', 'approved', true, 'c0000000-0000-4000-f000-000000000001');

select id as svc from public.services where name_en = 'Battery jump or replacement' \gset

insert into public.provider_services (provider_id, service_id) values
  ('e0000000-0000-4000-f000-000000000002', :'svc'),
  ('e0000000-0000-4000-f000-000000000004', :'svc');

insert into public.orders
  (id, customer_id, vehicle_id, service_id, fulfilment_mode, status,
   service_location, quoted_amount, created_by)
values
  ('f0000000-0000-4000-f000-000000000001',
   '11111111-0000-4000-f000-000000000001', 'd0000000-0000-4000-f000-000000000001',
   :'svc', 'mobile_ondemand', 'quoted',
   extensions.st_point(46.6753, 24.7136)::extensions.geography,
   120, '11111111-0000-4000-f000-000000000001');


-- ===========================================================================
set role authenticated;
select test.become('11111111-0000-4000-f000-000000000001');   -- the customer
-- ===========================================================================

-- THE attack. Before 0033 this succeeded, and the escrow guard in the state
-- machine then waved the order through because it only checks that
-- escrow_status reads 'authorised' — which the customer had just written.
select test.assert_raises(
  $$update public.orders
    set escrow_status = 'authorised', payment_intent_id = 'forged'
    where id = 'f0000000-0000-4000-f000-000000000001'$$,
  'a customer CANNOT declare their own order paid',
  '42501');

select test.assert_eq(
  (select escrow_status from public.orders where id = 'f0000000-0000-4000-f000-000000000001'),
  'none'::escrow_status,
  'the order is still unpaid after the attempt');

-- Rewriting the price of the work.
select test.assert_raises(
  $$update public.orders set quoted_amount = 1
    where id = 'f0000000-0000-4000-f000-000000000001'$$,
  'a customer CANNOT rewrite the quoted price',
  '42501');

select test.assert_raises(
  $$update public.orders set labour_amount = 0, total_amount = 0
    where id = 'f0000000-0000-4000-f000-000000000001'$$,
  'a customer CANNOT zero the amounts',
  '42501');

-- Fabricating the evidence the logbook depends on.
select test.assert_raises(
  $$update public.orders set completion_mileage = 999999
    where id = 'f0000000-0000-4000-f000-000000000001'$$,
  'a customer CANNOT write completion evidence',
  '42501');

-- Changing what the order even is.
select test.assert_raises(
  $$update public.orders set customer_id = '22222222-0000-4000-f000-000000000002'
    where id = 'f0000000-0000-4000-f000-000000000001'$$,
  'a customer CANNOT reassign the order to someone else',
  '42501');

select test.assert_raises(
  $$update public.orders set vehicle_id = null
    where id = 'f0000000-0000-4000-f000-000000000001'$$,
  'a customer CANNOT detach the vehicle from the order',
  '42501');

-- Choosing their own technician, bypassing matching entirely.
select test.assert_raises(
  $$update public.orders set provider_id = 'e0000000-0000-4000-f000-000000000002'
    where id = 'f0000000-0000-4000-f000-000000000001'$$,
  'a customer CANNOT hand the job to a provider of their choosing',
  '42501');


-- The legitimate path -----------------------------------------------------------
reset role;
set role authenticated;
select test.become('11111111-0000-4000-f000-000000000001');

select public.authorise_order_payment(
  'f0000000-0000-4000-f000-000000000001', 'pi_test_guard_1');

select test.assert_eq(
  (select escrow_status from public.orders where id = 'f0000000-0000-4000-f000-000000000001'),
  'authorised'::escrow_status,
  'the payment function CAN set the escrow state');

-- The privileged flag is transaction-scoped, so it must not still be open on
-- the next statement. If it leaked, every guard above would be bypassable by
-- calling a payment function first.
select test.assert_raises(
  $$update public.orders set quoted_amount = 5
    where id = 'f0000000-0000-4000-f000-000000000001'$$,
  'the privileged flag does not linger after the function returns',
  '42501');

-- Double-authorising is refused rather than silently re-writing the intent.
select test.assert_raises(
  $$select public.authorise_order_payment(
      'f0000000-0000-4000-f000-000000000001', 'pi_second')$$,
  'an order cannot be authorised twice',
  '23514');


-- The provider's side --------------------------------------------------------------
select test.become('22222222-0000-4000-f000-000000000002');

-- Accepting goes through accept_order: a provider has no UPDATE policy on an
-- unassigned order, so a direct write silently matched zero rows — RLS was
-- hiding the fact that acceptance was impossible.
select test.assert(
  public.accept_order('f0000000-0000-4000-f000-000000000001'),
  'a provider CAN accept an unassigned job for themselves');

select test.assert_eq(
  (select provider_id from public.orders where id = 'f0000000-0000-4000-f000-000000000001'),
  'e0000000-0000-4000-f000-000000000002'::uuid,
  'the job is assigned to the accepting provider');

-- Losing the race is not an error: four of five broadcast providers lose every
-- time, and "someone got there first" is the honest message.
select test.become('44444444-0000-4000-f000-000000000004');
select test.assert(
  not public.accept_order('f0000000-0000-4000-f000-000000000001'),
  'a second provider accepting an already-taken job is told they lost, not errored');
select test.become('22222222-0000-4000-f000-000000000002');

-- But not for a competitor, and not once taken.
select test.assert_raises(
  $$update public.orders set provider_id = 'e0000000-0000-4000-f000-000000000004'
    where id = 'f0000000-0000-4000-f000-000000000001'$$,
  'the assigned provider cannot be swapped',
  '42501');

-- The provider prices the work — that is their job.
update public.orders set labour_amount = 120, vat_amount = 18, total_amount = 138
where id = 'f0000000-0000-4000-f000-000000000001';

select test.assert_eq(
  (select total_amount from public.orders where id = 'f0000000-0000-4000-f000-000000000001'),
  138.00::numeric, 'the assigned provider CAN set the amounts');

-- But not the payment state, even though they are assigned.
select test.assert_raises(
  $$update public.orders set escrow_status = 'captured'
    where id = 'f0000000-0000-4000-f000-000000000001'$$,
  'not even the assigned provider may declare the money captured',
  '42501');

-- A different provider cannot touch it at all. (RLS already hides the row, so
-- the update matches nothing rather than raising — the outcome that matters is
-- that the amount is unchanged.)
select test.become('44444444-0000-4000-f000-000000000004');
update public.orders set total_amount = 9999
where id = 'f0000000-0000-4000-f000-000000000001';

reset role;
select test.assert_eq(
  (select total_amount from public.orders where id = 'f0000000-0000-4000-f000-000000000001'),
  138.00::numeric, 'an unassigned provider changed nothing');


-- Capture happens only after the customer confirms -----------------------------------
select test.assert_raises(
  $$select public.capture_order_payment('f0000000-0000-4000-f000-000000000001')$$,
  'capture is refused while the job is still running',
  '23514');

set role authenticated;
select test.become('22222222-0000-4000-f000-000000000002');
update public.orders set status = 'en_route' where id = 'f0000000-0000-4000-f000-000000000001';
update public.orders set status = 'arrived' where id = 'f0000000-0000-4000-f000-000000000001';
update public.orders set status = 'in_progress' where id = 'f0000000-0000-4000-f000-000000000001';

select public.record_completion_evidence(
  'f0000000-0000-4000-f000-000000000001', 45500,
  '[{"url":"https://example.test/b.jpg","kind":"before"},
    {"url":"https://example.test/a.jpg","kind":"after"}]'::jsonb);

update public.orders set status = 'awaiting_approval'
where id = 'f0000000-0000-4000-f000-000000000001';

select test.become('11111111-0000-4000-f000-000000000001');
update public.orders set status = 'completed' where id = 'f0000000-0000-4000-f000-000000000001';

select public.capture_order_payment('f0000000-0000-4000-f000-000000000001');

select test.assert_eq(
  (select escrow_status from public.orders where id = 'f0000000-0000-4000-f000-000000000001'),
  'captured'::escrow_status,
  'capture succeeds only once the customer has confirmed');

reset role;
rollback;

\echo '   order column guard OK'
