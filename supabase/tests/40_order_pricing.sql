-- 40 — Order pricing: parts, labour, and the approval gate
--
-- Companion to 0068. The assertion that matters most is the bypass: before
-- this migration a provider could add unapproved part lines, leave
-- `orders.parts_amount` at zero, and hand the job back — because the gate in
-- 0032 is written `if new.parts_amount > 0`, and that column is written by the
-- same person the gate exists to check.

\echo '── order pricing'

begin;

select public.test_seed_auth_user('11111111-0000-4000-8000-000000000001', '+966510000001');
select public.test_seed_auth_user('22222222-0000-4000-8000-000000000002', '+966510000002');

insert into public.profiles (id, full_name, phone) values
  ('11111111-0000-4000-8000-000000000001', 'العميل', '+966510000001'),
  ('22222222-0000-4000-8000-000000000002', 'الفنّي', '+966510000002');

select test.grant_role('22222222-0000-4000-8000-000000000002', 'technician');

insert into public.cities (id, name_ar, name_en, region_ar, region_en, centroid) values
  ('c0000000-0000-4000-8000-000000000001', 'الأحساء', 'AhsaPrice', 'الشرقية', 'Eastern',
   extensions.st_point(49.5877, 25.3833)::extensions.geography);

insert into public.vehicle_makes (id, name_ar, name_en) values
  ('a0000000-0000-4000-8000-000000000001', 'ماركة تسعير', 'TestMakePrice');
insert into public.vehicle_models (id, make_id, name_ar, name_en, year_from) values
  ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001',
   'موديل تسعير', 'TestModelPrice', 2015);
insert into public.vehicles (id, owner_id, make_id, model_id, year, plate_en, current_mileage) values
  ('d0000000-0000-4000-8000-000000000001', '11111111-0000-4000-8000-000000000001',
   'a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001',
   2020, 'ABJ 3434', 90000);

insert into public.providers
  (id, owner_profile_id, provider_type, business_name_ar, verification_status, is_online, city_id)
values
  ('e0000000-0000-4000-8000-000000000001', '22222222-0000-4000-8000-000000000002',
   'individual', 'ورشة الأحساء', 'approved', true, 'c0000000-0000-4000-8000-000000000001');

select id as svc_battery from public.services where name_en = 'Battery jump or replacement' \gset

insert into public.provider_services (provider_id, service_id) values
  ('e0000000-0000-4000-8000-000000000001', :'svc_battery');


-- An open job ----------------------------------------------------------------
set role authenticated;
select test.become('11111111-0000-4000-8000-000000000001');

insert into public.orders
  (id, customer_id, vehicle_id, service_id, fulfilment_mode, service_location,
   provider_id, quoted_amount, created_by)
values
  ('f0000000-0000-4000-8000-000000000001',
   '11111111-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001',
   :'svc_battery', 'mobile_ondemand',
   extensions.st_point(49.59, 25.38)::extensions.geography,
   'e0000000-0000-4000-8000-000000000001', 150, '11111111-0000-4000-8000-000000000001');

update public.orders set status = 'searching' where id = 'f0000000-0000-4000-8000-000000000001';
update public.orders set status = 'quoted' where id = 'f0000000-0000-4000-8000-000000000001';
select public.authorise_order_payment('f0000000-0000-4000-8000-000000000001', 'price_1');
update public.orders set status = 'accepted' where id = 'f0000000-0000-4000-8000-000000000001';

select test.become('22222222-0000-4000-8000-000000000002');
update public.orders set status = 'en_route'    where id = 'f0000000-0000-4000-8000-000000000001';
update public.orders set status = 'arrived'     where id = 'f0000000-0000-4000-8000-000000000001';
update public.orders set status = 'in_progress' where id = 'f0000000-0000-4000-8000-000000000001';


-- Parts price themselves -------------------------------------------------------
insert into public.order_parts
  (id, order_id, name_ar, part_number, is_oem, quantity, unit_price, warranty_days)
values
  ('aa000000-0000-4000-8000-000000000001', 'f0000000-0000-4000-8000-000000000001',
   'بطارية ٧٠ أمبير', 'VAR-570-901', true, 1, 320.00, 365);

select test.assert_eq(
  (select parts_amount from public.orders where id = 'f0000000-0000-4000-8000-000000000001'),
  320.00::numeric(12,2),
  'adding a line reprices the order — parts_amount is derived, not asserted');

-- Two of something, to prove quantity is in the total rather than decoration.
insert into public.order_parts
  (id, order_id, name_ar, part_number, is_oem, quantity, unit_price)
values
  ('aa000000-0000-4000-8000-000000000002', 'f0000000-0000-4000-8000-000000000001',
   'طرف بطارية', 'TRM-02', false, 2, 15.00);

select test.assert_eq(
  (select parts_amount from public.orders where id = 'f0000000-0000-4000-8000-000000000001'),
  350.00::numeric(12,2),
  'quantity multiplies — 320 + (2 × 15)');

select public.set_order_labour('f0000000-0000-4000-8000-000000000001', 100);

-- ⚠️ VAT on parts AND labour, at 15% (§5). 450 × 0.15 = 67.50.
select test.assert_eq(
  (select vat_amount from public.orders where id = 'f0000000-0000-4000-8000-000000000001'),
  67.50::numeric(12,2),
  'VAT is computed server-side on parts plus labour');

select test.assert_eq(
  (select total_amount from public.orders where id = 'f0000000-0000-4000-8000-000000000001'),
  517.50::numeric(12,2),
  'and the total is the three of them, which is what the check constraint says');

select test.assert_eq(
  (select vat_rate_applied from public.orders where id = 'f0000000-0000-4000-8000-000000000001'),
  0.1500::numeric,
  'the rate is snapshotted, so a future change cannot restate this invoice (ADR-0007)');

-- Removing a line reprices too. A total that only ever goes up is not derived.
delete from public.order_parts where id = 'aa000000-0000-4000-8000-000000000002';

select test.assert_eq(
  (select total_amount from public.orders where id = 'f0000000-0000-4000-8000-000000000001'),
  483.00::numeric(12,2),
  'deleting a line reprices as well — 320 + 100 + 63');


-- ⚠️ THE bypass this migration closes ------------------------------------------
--
-- Before 0068 the provider could set parts_amount back to zero and hand the job
-- straight back, because 0032's gate reads `if new.parts_amount > 0`. The new
-- assertion asks whether any line is unapproved instead, and never consults the
-- column the provider writes.
select public.record_completion_evidence('f0000000-0000-4000-8000-000000000001', 90500,
  '[{"url":"x/b.jpg","kind":"before"},{"url":"x/a.jpg","kind":"after"}]'::jsonb);

select test.assert_raises(
  $$update public.orders set status = 'awaiting_approval'
    where id = 'f0000000-0000-4000-8000-000000000001'$$,
  'a job cannot be handed back while a part line is unapproved',
  '23514');

-- The attack itself.
--
-- ⚠️ Note it restates all three money columns together. `orders_totals_reconcile`
-- (0019) refuses a lone `parts_amount = 0`, which is a useful accident but not
-- the protection: every one of these columns is the provider's to write, so a
-- consistent restatement — parts 0, labour 100, VAT 15, total 115 — is accepted
-- by the constraint and by the column guard. That is precisely the shape the
-- old gate could not see.
update public.orders
   set parts_amount = 0, vat_amount = 15.00, total_amount = 115.00
 where id = 'f0000000-0000-4000-8000-000000000001';

select test.assert_eq(
  (select parts_amount from public.orders where id = 'f0000000-0000-4000-8000-000000000001'),
  0.00::numeric(12,2),
  'the restatement itself is accepted — nothing here refuses a provider their own amounts');

select test.assert_raises(
  $$update public.orders set status = 'awaiting_approval'
    where id = 'f0000000-0000-4000-8000-000000000001'$$,
  'but the hand-back is still refused — the gate no longer reads the column the provider writes',
  '23514');

-- The write above was accepted by the column guard (a provider may set the
-- amounts), so the derived value is stale until something reprices. Proving it
-- recovers rather than staying wrong.
select public.set_order_labour('f0000000-0000-4000-8000-000000000001', 100);
select test.assert_eq(
  (select parts_amount from public.orders where id = 'f0000000-0000-4000-8000-000000000001'),
  320.00::numeric(12,2),
  'and a reprice restores the derived figure from the lines');

reset role;


-- Only the customer approves, and only the provider prices --------------------
set role authenticated;
select test.become('22222222-0000-4000-8000-000000000002');

select test.assert_raises(
  $$update public.order_parts set approved_by_customer = true, approved_at = now()
    where id = 'aa000000-0000-4000-8000-000000000001'$$,
  'the provider cannot approve their own price',
  '42501');

select test.become('11111111-0000-4000-8000-000000000001');

select test.assert_raises(
  $$select public.set_order_labour('f0000000-0000-4000-8000-000000000001', 5)$$,
  'and the customer cannot price the job',
  '42501');

update public.order_parts set approved_by_customer = true, approved_at = now()
 where id = 'aa000000-0000-4000-8000-000000000001';

select test.assert_eq(
  (select count(*)::int from public.order_parts
    where order_id = 'f0000000-0000-4000-8000-000000000001' and approved_by_customer),
  1,
  'the customer approves the line');

reset role;


-- Re-pricing an approved line revokes the approval ----------------------------
-- 0035's rule, re-asserted here because the pricing screen is what makes it
-- reachable: a provider who corrects a typo must not carry the old approval
-- forward onto a new number.
set role authenticated;
select test.become('22222222-0000-4000-8000-000000000002');

update public.order_parts set unit_price = 420.00
 where id = 'aa000000-0000-4000-8000-000000000001';

select test.assert(
  not (select approved_by_customer from public.order_parts
        where id = 'aa000000-0000-4000-8000-000000000001'),
  'changing the price of an approved line revokes the approval');

select test.assert_eq(
  (select parts_amount from public.orders where id = 'f0000000-0000-4000-8000-000000000001'),
  420.00::numeric(12,2),
  'and reprices the order in the same breath');

reset role;


-- The hand-back works once every line is agreed --------------------------------
set role authenticated;
select test.become('11111111-0000-4000-8000-000000000001');
update public.order_parts set approved_by_customer = true, approved_at = now()
 where id = 'aa000000-0000-4000-8000-000000000001';

select test.become('22222222-0000-4000-8000-000000000002');
update public.orders set status = 'awaiting_approval'
 where id = 'f0000000-0000-4000-8000-000000000001';

select test.assert_eq(
  (select status::text from public.orders where id = 'f0000000-0000-4000-8000-000000000001'),
  'awaiting_approval',
  'with every line approved and the evidence recorded, the job hands back');

-- ⚠️ And the window closes behind it. A line appearing now would move a total
-- the customer is in the middle of approving.
select test.assert_raises(
  $$insert into public.order_parts (order_id, name_ar, quantity, unit_price)
    values ('f0000000-0000-4000-8000-000000000001', 'قطعة متأخرة', 1, 900)$$,
  'no part can be added once the job is with the customer',
  '23514');

reset role;


-- A closed order is never repriced ---------------------------------------------
-- Its figures are what was invoiced and what a payout was built from (0067).
set role authenticated;
select test.become('11111111-0000-4000-8000-000000000001');
update public.orders set status = 'completed' where id = 'f0000000-0000-4000-8000-000000000001';
reset role;

select total_amount as closed_total from public.orders
 where id = 'f0000000-0000-4000-8000-000000000001' \gset

-- Force a reprice as the service role; the figures must not move.
select public.reprice_order('f0000000-0000-4000-8000-000000000001');

select test.assert_eq(
  (select total_amount from public.orders where id = 'f0000000-0000-4000-8000-000000000001'),
  (:'closed_total')::numeric(12,2),
  'a completed order keeps the figures it was invoiced and paid on');

rollback;
