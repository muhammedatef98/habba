-- 47 — The invoice is issued when the job is done
--
-- Companion to 0074.

\echo '── invoices issued at completion'

begin;

insert into auth.users (id, phone) values
  ('11111111-0000-4000-ef00-000000000001', '+966509700001'),  -- customer
  ('22222222-0000-4000-ef00-000000000002', '+966509700002'),  -- technician
  ('33333333-0000-4000-ef00-000000000003', '+966509700003');  -- a stranger

insert into public.profiles (id, full_name, phone) values
  ('11111111-0000-4000-ef00-000000000001', 'العميل', '+966509700001'),
  ('22222222-0000-4000-ef00-000000000002', 'الفنّي', '+966509700002'),
  ('33333333-0000-4000-ef00-000000000003', 'غريب', '+966509700003');

insert into public.cities (id, name_ar, name_en, region_ar, region_en, centroid) values
  ('c0000000-0000-4000-ef00-000000000001', 'ينبع', 'YanbuInvoice', 'المدينة', 'Madinah',
   extensions.st_point(38.0618, 24.0895)::extensions.geography);

insert into public.vehicle_makes (id, name_ar, name_en) values
  ('a0000000-0000-4000-ef00-000000000001', 'ماركة', 'TestMakeInvoice');
insert into public.vehicle_models (id, make_id, name_ar, name_en, year_from) values
  ('b0000000-0000-4000-ef00-000000000001', 'a0000000-0000-4000-ef00-000000000001',
   'موديل', 'TestModelInvoice', 2015);
insert into public.vehicles (id, owner_id, make_id, model_id, year, plate_en, current_mileage) values
  ('d0000000-0000-4000-ef00-000000000001', '11111111-0000-4000-ef00-000000000001',
   'a0000000-0000-4000-ef00-000000000001', 'b0000000-0000-4000-ef00-000000000001',
   2021, 'KND 4747', 50000);

insert into public.providers
  (id, owner_profile_id, provider_type, business_name_ar, verification_status, is_online,
   city_id, acceptance_rate)
values
  ('e0000000-0000-4000-ef00-000000000001', '22222222-0000-4000-ef00-000000000002',
   'individual', 'فنّي ينبع', 'approved', true, 'c0000000-0000-4000-ef00-000000000001', 90);

select id as svc from public.services where name_en = 'Battery jump or replacement' \gset

insert into public.provider_services (provider_id, service_id) values
  ('e0000000-0000-4000-ef00-000000000001', :'svc');
insert into public.provider_locations (provider_id, location, updated_at) values
  ('e0000000-0000-4000-ef00-000000000001',
   extensions.st_point(38.0620, 24.0897)::extensions.geography, now());

set role authenticated;

select test.become('11111111-0000-4000-ef00-000000000001');
select public.create_emergency_order(
  :'svc', 38.0619, 24.0896, 'd0000000-0000-4000-ef00-000000000001',
  'ينبع البحر', 'البطارية فارغة', 50100, '[]'::jsonb) as ord \gset
select public.authorise_order_payment(:'ord', 'intent_invoice_1');
select public.submit_order(:'ord');

select test.become('22222222-0000-4000-ef00-000000000002');
select public.accept_order(:'ord');
update public.orders set status = 'en_route' where id = :'ord';
update public.orders set status = 'arrived' where id = :'ord';
update public.orders set status = 'in_progress' where id = :'ord';
select public.record_completion_evidence(:'ord', 50150, test.completion_photos(:'ord'), 30);
update public.orders set status = 'awaiting_approval' where id = :'ord';

select test.assert(
  not exists (select 1 from public.zatca_invoices where order_id = :'ord'),
  'nothing is invoiced before the customer accepts the work');

select test.assert_raises(
  format($$select public.issue_zatca_invoice(%L)$$, :'ord'),
  'no client can issue a tax invoice directly', '42501');

select test.become('11111111-0000-4000-ef00-000000000001');
update public.orders set status = 'completed' where id = :'ord';

select test.assert_eq(
  (select count(*)::int from public.zatca_invoices where order_id = :'ord'), 1,
  'completing the order issues its invoice');

select test.assert_eq(
  (select total_amount from public.zatca_invoices where order_id = :'ord'),
  (select total_amount from public.orders where id = :'ord'),
  'for what the customer was charged');

select test.assert(
  (select invoice_number from public.zatca_invoices where order_id = :'ord') like 'HB-INV-%',
  'numbered, and the customer can read it');

select test.become('33333333-0000-4000-ef00-000000000003');
select test.assert(
  not exists (select 1 from public.zatca_invoices where order_id = :'ord'),
  'a stranger cannot read it');

reset role;
select test.assert_raises(
  format($$select public.issue_zatca_invoice(%L)$$, :'ord'),
  'an order is never invoiced twice', '23505');


-- With no seller configured the order still completes, uninvoiced; ops issues
-- it once the seller exists.
update public.invoice_sellers set is_active = false where provider_id is null;

set role authenticated;
select test.become('11111111-0000-4000-ef00-000000000001');
select public.create_emergency_order(
  :'svc', 38.0619, 24.0896, 'd0000000-0000-4000-ef00-000000000001',
  'ينبع البحر', 'مرة أخرى', 50200, '[]'::jsonb) as ord2 \gset
select public.authorise_order_payment(:'ord2', 'intent_invoice_2');
select public.submit_order(:'ord2');
select test.become('22222222-0000-4000-ef00-000000000002');
select public.accept_order(:'ord2');
update public.orders set status = 'en_route' where id = :'ord2';
update public.orders set status = 'arrived' where id = :'ord2';
update public.orders set status = 'in_progress' where id = :'ord2';
select public.record_completion_evidence(:'ord2', 50250, test.completion_photos(:'ord2'), 30);
update public.orders set status = 'awaiting_approval' where id = :'ord2';
select test.become('11111111-0000-4000-ef00-000000000001');
update public.orders set status = 'completed' where id = :'ord2';

select test.assert_eq(
  (select status::text from public.orders where id = :'ord2'), 'completed',
  'with no seller configured, the order still completes');
select test.assert(
  not exists (select 1 from public.zatca_invoices where order_id = :'ord2'),
  'and is left uninvoiced rather than failing');

reset role;
update public.invoice_sellers set is_active = true where provider_id is null;
select test.grant_role('33333333-0000-4000-ef00-000000000003', 'ops');

set role authenticated;
select test.become('11111111-0000-4000-ef00-000000000001');
select test.assert_raises(
  format($$select public.ops_issue_invoice(%L)$$, :'ord2'),
  'the customer cannot use the ops path', '42501');

select test.become('33333333-0000-4000-ef00-000000000003');
select public.ops_issue_invoice(:'ord2');
reset role;
select test.assert_eq(
  (select count(*)::int from public.zatca_invoices where order_id = :'ord2'), 1,
  'ops issues it once the seller is back');
select test.assert(
  exists (select 1 from public.audit_log a
           where a.target_table = 'zatca_invoices' and a.action = 'insert'
             and a.actor_id = '33333333-0000-4000-ef00-000000000003'
             and a.after ->> 'order_id' = :'ord2'),
  'an invoice issued from the console is in the audit log');
select test.assert(
  not exists (select 1 from public.audit_log a
               where a.target_table = 'zatca_invoices' and a.after ->> 'order_id' = :'ord'),
  'one issued by completion is no one''s act, and is not');

rollback;

\echo '   invoices issued at completion OK'
