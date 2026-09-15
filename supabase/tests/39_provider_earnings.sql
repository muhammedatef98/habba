-- 39 — Provider earnings
--
-- Companion to 0067. One assertion here matters more than the rest: the figure
-- a technician is SHOWN must equal the figure they are PAID. Everything else in
-- this file is about who can see whose money.

\echo '── provider earnings'

begin;

select public.test_seed_auth_user('11111111-0000-4000-9000-000000000001', '+966509000001');  -- customer
select public.test_seed_auth_user('22222222-0000-4000-9000-000000000002', '+966509000002');  -- technician
select public.test_seed_auth_user('33333333-0000-4000-9000-000000000003', '+966509000003');  -- another technician

insert into public.profiles (id, full_name, phone) values
  ('11111111-0000-4000-9000-000000000001', 'العميل', '+966509000001'),
  ('22222222-0000-4000-9000-000000000002', 'الفنّي', '+966509000002'),
  ('33333333-0000-4000-9000-000000000003', 'فنّي آخر', '+966509000003');

select test.grant_role('22222222-0000-4000-9000-000000000002', 'technician');
select test.grant_role('33333333-0000-4000-9000-000000000003', 'technician');

insert into public.cities (id, name_ar, name_en, region_ar, region_en, centroid) values
  ('c0000000-0000-4000-9000-000000000001', 'الجبيل', 'JubailEarn', 'الشرقية', 'Eastern',
   extensions.st_point(49.6600, 27.0046)::extensions.geography);

insert into public.vehicle_makes (id, name_ar, name_en) values
  ('a0000000-0000-4000-9000-000000000001', 'ماركة أرباح', 'TestMakeEarn');
insert into public.vehicle_models (id, make_id, name_ar, name_en, year_from) values
  ('b0000000-0000-4000-9000-000000000001', 'a0000000-0000-4000-9000-000000000001',
   'موديل أرباح', 'TestModelEarn', 2015);
insert into public.vehicles (id, owner_id, make_id, model_id, year, plate_en, current_mileage) values
  ('d0000000-0000-4000-9000-000000000001', '11111111-0000-4000-9000-000000000001',
   'a0000000-0000-4000-9000-000000000001', 'b0000000-0000-4000-9000-000000000001',
   2020, 'ABJ 1212', 80000);

insert into public.providers
  (id, owner_profile_id, provider_type, business_name_ar, verification_status, is_online, city_id)
values
  ('e0000000-0000-4000-9000-000000000001', '22222222-0000-4000-9000-000000000002',
   'individual', 'فنّي الجبيل', 'approved', true, 'c0000000-0000-4000-9000-000000000001'),
  ('e0000000-0000-4000-9000-000000000002', '33333333-0000-4000-9000-000000000003',
   'individual', 'فنّي ثانٍ', 'approved', true, 'c0000000-0000-4000-9000-000000000001');

select id as svc_battery from public.services where name_en = 'Battery jump or replacement' \gset

insert into public.provider_services (provider_id, service_id) values
  ('e0000000-0000-4000-9000-000000000001', :'svc_battery');


-- Three jobs in three states -------------------------------------------------
-- Only the first should ever count: one completed and captured, one completed
-- but never captured, one still in progress.
-- The identity switches inside are the point, not ceremony: since 0033 a
-- customer cannot write the money columns or the evidence, and only the
-- customer may authorise and capture. A fixture that did the whole chain as one
-- actor would be exercising a permission model the app does not have.
create or replace function pg_temp.complete_job(
  p_id uuid, p_parts numeric, p_labour numeric, p_vat numeric, p_capture boolean
) returns void language plpgsql as $$
declare
  v_customer uuid := '11111111-0000-4000-9000-000000000001';
  v_tech     uuid := '22222222-0000-4000-9000-000000000002';
begin
  perform test.become(v_customer);

  insert into public.orders
    (id, customer_id, vehicle_id, service_id, fulfilment_mode, service_location,
     provider_id, quoted_amount, created_by)
  values
    (p_id, v_customer, 'd0000000-0000-4000-9000-000000000001',
     (select id from public.services where name_en = 'Battery jump or replacement'),
     'mobile_ondemand', extensions.st_point(49.66, 27.00)::extensions.geography,
     'e0000000-0000-4000-9000-000000000001', p_parts + p_labour, v_customer);

  update public.orders set status = 'searching' where id = p_id;
  update public.orders set status = 'quoted' where id = p_id;
  perform public.authorise_order_payment(p_id, 'earn_' || left(p_id::text, 8));

  perform test.become(v_tech);

  update public.orders set status = 'accepted'    where id = p_id;
  update public.orders set status = 'en_route'    where id = p_id;
  update public.orders set status = 'arrived'     where id = p_id;
  update public.orders set status = 'in_progress' where id = p_id;

  update public.orders
     set parts_amount = p_parts, labour_amount = p_labour, vat_amount = p_vat,
         total_amount = p_parts + p_labour + p_vat, vat_rate_applied = 0.15
   where id = p_id;

  perform public.record_completion_evidence(p_id, 80500,
    '[{"url":"x/b.jpg","kind":"before"},{"url":"x/a.jpg","kind":"after"}]'::jsonb);
  update public.orders set status = 'awaiting_approval' where id = p_id;

  -- The customer closes the job and only then may the escrow be taken
  -- (ADR-0006, ADR-0008).
  perform test.become(v_customer);
  update public.orders set status = 'completed' where id = p_id;
  if p_capture then perform public.capture_order_payment(p_id); end if;
end;
$$;

set role authenticated;

-- 200 parts + 100 labour + 45 VAT = 345 gross. Commission is 20% of 300 = 60.
select pg_temp.complete_job('f0000000-0000-4000-9000-000000000001', 200, 100, 45, true);
-- 100 + 100 + 30 = 230 gross, commission 20% of 200 = 40.
select pg_temp.complete_job('f0000000-0000-4000-9000-000000000002', 100, 100, 30, true);
-- Completed, but the capture never happened. Paying out on this would be paying
-- the technician out of Habba's own pocket.
select pg_temp.complete_job('f0000000-0000-4000-9000-000000000003', 500, 500, 150, false);

reset role;


-- What the technician is shown ------------------------------------------------
set role authenticated;
select test.become('22222222-0000-4000-9000-000000000002');

select test.assert_eq(
  (select unsettled_count from public.my_earnings_summary()),
  2,
  'only completed AND captured work counts — an uncaptured order is not money');

select test.assert_eq(
  (select unsettled_gross from public.my_earnings_summary()),
  575.00::numeric(12,2),
  'the gross is what the customer paid, VAT included');

-- ⚠️ Commission on the NET. 20% of (300 + 200) = 100, not 20% of 575.
-- Charging on the gross would take a cut of money that belongs to ZATCA.
select test.assert_eq(
  (select unsettled_commission from public.my_earnings_summary()),
  100.00::numeric(12,2),
  'commission is taken on parts and labour, never on the VAT');

select test.assert_eq(
  (select unsettled_net from public.my_earnings_summary()),
  475.00::numeric(12,2),
  'and the net is the difference');

select test.assert_eq(
  (select count(*)::int from public.my_unsettled_orders()),
  2,
  'the list agrees with the total it is shown beside');

reset role;


-- ⚠️ THE assertion this file exists for --------------------------------------
--
-- The estimate and the payout must come from one piece of code. A second
-- implementation of the arithmetic on the earnings screen would drift the first
-- time either changed — commission on the gross, a different eligibility rule,
-- two halalas of rounding per line — and a technician told 475 and paid 460
-- does not file a bug report. They stop using the app and tell the others why.
set role authenticated;
select test.become('22222222-0000-4000-9000-000000000002');
select unsettled_net as shown, unsettled_gross as shown_gross,
       unsettled_commission as shown_commission
from public.my_earnings_summary() \gset
reset role;

select test.grant_role('11111111-0000-4000-9000-000000000001', 'ops');
set role authenticated;
select test.become('11111111-0000-4000-9000-000000000001');
select public.build_payout(
  'e0000000-0000-4000-9000-000000000001',
  current_date - 30, current_date) as payout \gset
reset role;

select test.assert_eq(
  (select net_amount from public.payouts where id = (:'payout')::uuid),
  (:'shown')::numeric(12,2),
  'the payout pays exactly what the earnings screen promised');

select test.assert_eq(
  (select gross_amount from public.payouts where id = (:'payout')::uuid),
  (:'shown_gross')::numeric(12,2),
  'gross too, to the halala');

select test.assert_eq(
  (select commission from public.payouts where id = (:'payout')::uuid),
  (:'shown_commission')::numeric(12,2),
  'and the commission the technician was shown is the commission taken');


-- Paid work leaves the unsettled figure ---------------------------------------
set role authenticated;
select test.become('22222222-0000-4000-9000-000000000002');

select test.assert_eq(
  (select unsettled_count from public.my_earnings_summary()),
  0,
  'once an order is in a payout it is no longer owed — an order is paid once, ever');

-- Still zero: an approved payout is a promise, not money received. The two
-- figures sit next to each other on one screen and their difference has to mean
-- what it says.
select test.assert_eq(
  (select paid_net from public.my_earnings_summary()),
  0.00::numeric(12,2),
  'a pending payout is not "paid"');

reset role;

update public.payouts set status = 'paid', paid_at = now() where id = (:'payout')::uuid;

set role authenticated;
select test.become('22222222-0000-4000-9000-000000000002');

select test.assert_eq(
  (select paid_net from public.my_earnings_summary()),
  475.00::numeric(12,2),
  'and once it is actually paid, it shows as paid');

select test.assert_eq(
  (select count(*)::int from public.my_payout_lines((:'payout')::uuid)),
  2,
  'the payout can be reconciled against the jobs it covers');

select test.assert(
  exists (select 1 from public.my_payout_lines((:'payout')::uuid)
           where order_number is not null and service_name_ar is not null),
  'with names and order numbers — six uuids is not a statement anyone can check');

reset role;


-- Nobody reads anybody else's earnings ----------------------------------------
set role authenticated;
select test.become('33333333-0000-4000-9000-000000000003');

select test.assert_eq(
  (select coalesce(unsettled_count, 0) from public.my_earnings_summary()),
  0,
  'another technician sees none of it');

select test.assert_eq(
  (select count(*)::int from public.payouts),
  0,
  'and cannot read the payout row either — RLS, not just the function');

-- ⚠️ The function takes no provider id precisely so this cannot be attempted.
-- `payable_order_lines` does take one, which is why it is not granted to
-- `authenticated`: an argument is a thing a client can change.
select test.assert_raises(
  $$select * from public.payable_order_lines('e0000000-0000-4000-9000-000000000001')$$,
  'the id-taking version is not reachable by a signed-in user',
  '42501');

select test.assert_eq(
  (select count(*)::int from public.my_payout_lines((:'payout')::uuid)),
  0,
  'and someone else''s payout id returns nothing rather than raising — no probing for ids');

reset role;


-- A customer is not a provider -------------------------------------------------
set role authenticated;
select test.become('11111111-0000-4000-9000-000000000001');

select test.assert_eq(
  (select count(*)::int from public.my_unsettled_orders()),
  0,
  'a user with no provider record gets an empty answer, not an error');

reset role;

rollback;
