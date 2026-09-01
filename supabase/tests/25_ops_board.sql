-- 25 — The dispatch board
--
-- Companion to 0046. The board's job is deciding what an operator looks at
-- first, so the assertions are about ordering and about the attention flag
-- being right — a board that calls everything urgent is a board nobody reads.

\echo '── ops board'

begin;

insert into auth.users (id, phone) values
  ('11111111-0000-4000-1000-000000000001', '+966507000001'),  -- ops
  ('22222222-0000-4000-1000-000000000002', '+966507000002'),  -- customer
  ('33333333-0000-4000-1000-000000000003', '+966507000003');  -- technician

insert into public.profiles (id, full_name, phone, role) values
  ('11111111-0000-4000-1000-000000000001', 'المشغّل', '+966507000001', 'ops'),
  ('22222222-0000-4000-1000-000000000002', 'العميل',  '+966507000002', 'customer'),
  ('33333333-0000-4000-1000-000000000003', 'الفنّي',  '+966507000003', 'technician');

insert into public.cities (id, name_ar, name_en, region_ar, region_en, centroid) values
  ('c0000000-0000-4000-1000-000000000001', 'الرياض', 'RiyadhBoard', 'الرياض', 'Riyadh',
   extensions.st_point(46.6753, 24.7136)::extensions.geography);

select id as svc from public.services where name_en = 'Towing' \gset

select test.become('22222222-0000-4000-1000-000000000002');

-- Three live orders and one finished, so the board has something to exclude.
insert into public.orders (id, customer_id, service_id, fulfilment_mode, service_location, quoted_amount, created_by)
select
  ('f0000000-0000-4000-1000-00000000000' || n)::uuid,
  '22222222-0000-4000-1000-000000000002', :'svc', 'mobile_ondemand',
  extensions.st_point(46.6753, 24.7136)::extensions.geography, 170.00,
  '22222222-0000-4000-1000-000000000002'
from generate_series(1, 3) n;

update public.orders set status = 'searching'
 where id in ('f0000000-0000-4000-1000-000000000001',
              'f0000000-0000-4000-1000-000000000002',
              'f0000000-0000-4000-1000-000000000003');


-- Who may read it ---------------------------------------------------------------
set role authenticated;

select test.become('22222222-0000-4000-1000-000000000002');
select test.assert_raises(
  $$select * from public.ops_active_orders()$$,
  'a customer cannot read the dispatch board — it is every order in the country',
  '42501');

select test.become('33333333-0000-4000-1000-000000000003');
select test.assert_raises(
  $$select * from public.ops_active_orders()$$,
  'nor can a technician',
  '42501');

select test.become('11111111-0000-4000-1000-000000000001');
select test.assert_eq(
  (select count(*)::int from public.ops_active_orders()),
  3,
  'ops sees every live order, and only the live ones');

reset role;


-- The attention flag -------------------------------------------------------------
-- One order has exhausted the ladder with nobody open: nothing more will
-- happen to it without a human.
update public.orders
   set dispatch_round = public.dispatch_max_round()
 where id = 'f0000000-0000-4000-1000-000000000001';

set role authenticated;
select test.become('11111111-0000-4000-1000-000000000001');

select test.assert_eq(
  (select attention::text from public.ops_active_orders()
    where order_id = 'f0000000-0000-4000-1000-000000000001'),
  'search_stuck',
  'a search that widened as far as it goes and found nobody is flagged for a human');

select test.assert_eq(
  (select attention::text from public.ops_active_orders()
    where order_id = 'f0000000-0000-4000-1000-000000000002'),
  'none',
  'a search that still has rungs left is not — a board that flags everything is a board nobody reads');

-- And the stuck one sorts first.
select test.assert_eq(
  (select order_id from public.ops_active_orders() limit 1),
  'f0000000-0000-4000-1000-000000000001'::uuid,
  'trouble sorts to the top: the operator works down the list');

reset role;


-- A long wait is flagged even with rungs remaining ---------------------------------
select public.begin_privileged_write();
update public.order_events set created_at = now() - interval '10 minutes'
 where order_id = 'f0000000-0000-4000-1000-000000000002' and to_status = 'searching';
select public.end_privileged_write();

set role authenticated;
select test.become('11111111-0000-4000-1000-000000000001');

select test.assert_eq(
  (select attention::text from public.ops_active_orders()
    where order_id = 'f0000000-0000-4000-1000-000000000002'),
  'search_slow',
  'ten minutes of searching is worth a look even if the ladder has not finished');

select test.assert(
  (select status_age > interval '9 minutes' from public.ops_active_orders()
    where order_id = 'f0000000-0000-4000-1000-000000000002'),
  'the age is measured from entering the status, not from the last write to the row');

reset role;


-- Finished orders leave the board --------------------------------------------------
update public.orders set status = 'cancelled'
 where id = 'f0000000-0000-4000-1000-000000000003';

set role authenticated;
select test.become('11111111-0000-4000-1000-000000000001');

select test.assert_eq(
  (select count(*)::int from public.ops_active_orders()),
  2,
  'a cancelled order is off the board — it needs nobody');

reset role;

rollback;
