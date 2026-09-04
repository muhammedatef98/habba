-- 18 — invoice_sellers is row-scoped, not globally readable
--
-- Companion to 0038. The Habba seller row (provider_id is null) stays public,
-- since every simplified invoice names it. A per-provider row — the shape
-- ADR-0009 self-billing would create — must not be readable by a stranger who
-- has no invoice naming it.

\echo '── invoice_sellers row scoping'

begin;

insert into auth.users (id, phone) values
  ('11111111-0000-4000-8888-000000000001', '+966509400001'),
  ('22222222-0000-4000-8888-000000000002', '+966509400002'),
  ('33333333-0000-4000-8888-000000000003', '+966509400003');

insert into public.profiles (id, full_name, phone) values
  ('11111111-0000-4000-8888-000000000001', 'صاحب الورشة', '+966509400001'),
  ('22222222-0000-4000-8888-000000000002', 'زبون له فاتورة', '+966509400002'),
  ('33333333-0000-4000-8888-000000000003', 'زبون غريب', '+966509400003');

select test.grant_role('11111111-0000-4000-8888-000000000001', 'technician');

insert into public.cities (id, name_ar, name_en, region_ar, region_en, centroid) values
  ('c0000000-0000-4000-8888-000000000001', 'ر', 'CitySeller', 'ر', 'R',
   extensions.st_point(46.6753, 24.7136)::extensions.geography);

insert into public.providers
  (id, owner_profile_id, provider_type, business_name_ar, verification_status, city_id, cr_number)
values
  ('e0000000-0000-4000-8888-000000000001', '11111111-0000-4000-8888-000000000001',
   'workshop', 'ورشة الفوترة الذاتية', 'approved', 'c0000000-0000-4000-8888-000000000001',
   '1010888888');

-- The self-billing row ADR-0009 would create once resolved. No such row is
-- seeded in production today, but the column exists for exactly this shape,
-- so the policy must already be correct for it.
insert into public.invoice_sellers (id, provider_id, legal_name_ar, vat_number, cr_number)
values
  ('50000000-0000-4000-8888-000000000001', 'e0000000-0000-4000-8888-000000000001',
   'ورشة الفوترة الذاتية', '300000000000013', '1010888888');

insert into public.vehicle_makes (id, name_ar, name_en) values
  ('a0000000-0000-4000-8888-000000000001', 'م', 'MakeSeller');
insert into public.vehicle_models (id, make_id, name_ar, name_en, year_from) values
  ('b0000000-0000-4000-8888-000000000001', 'a0000000-0000-4000-8888-000000000001',
   'م', 'ModelSeller', 2015);
insert into public.vehicles (id, owner_id, make_id, model_id, year, plate_en) values
  ('d0000000-0000-4000-8888-000000000001', '22222222-0000-4000-8888-000000000002',
   'a0000000-0000-4000-8888-000000000001', 'b0000000-0000-4000-8888-000000000001',
   2020, 'ABJ 88');

select id as svc from public.services where name_en = 'Battery jump or replacement' \gset

-- An order and invoice inserted directly (not through the full state machine
-- or issue_zatca_invoice) so this test isolates the RLS check, the same way
-- 14_parts_guard seeds order_parts directly rather than driving the flow.
insert into public.orders
  (id, customer_id, vehicle_id, service_id, fulfilment_mode, status, provider_id,
   service_location, quoted_amount, labour_amount, total_amount, vat_amount, created_by)
values
  ('f0000000-0000-4000-8888-000000000001', '22222222-0000-4000-8888-000000000002',
   'd0000000-0000-4000-8888-000000000001', :'svc', 'mobile_ondemand', 'completed',
   'e0000000-0000-4000-8888-000000000001',
   extensions.st_point(46.6753, 24.7136)::extensions.geography,
   100, 100, 115, 15, '22222222-0000-4000-8888-000000000002');

insert into public.zatca_invoices
  (id, order_id, seller_id, invoice_number, invoice_type,
   net_amount, vat_amount, total_amount, vat_rate, qr_base64)
values
  ('60000000-0000-4000-8888-000000000001', 'f0000000-0000-4000-8888-000000000001',
   '50000000-0000-4000-8888-000000000001', 'HB-INV-TEST-000001', 'simplified',
   100, 15, 115, 0.15, 'dGVzdA==');


-- ===========================================================================
set role authenticated;
-- ===========================================================================

-- A customer with no relationship to this seller at all sees only the Habba
-- row — the per-provider row is invisible to them.
select test.become('33333333-0000-4000-8888-000000000003');
select test.assert_eq(
  (select count(*)::int from public.invoice_sellers
   where id = '50000000-0000-4000-8888-000000000001'),
  0,
  'a stranger cannot read another seller''s per-provider invoice_sellers row');
select test.assert(
  (select count(*)::int from public.invoice_sellers where provider_id is null) > 0,
  'the shared Habba row is still visible to any authenticated client');

-- The provider who owns the self-billing row can read their own entity.
select test.become('11111111-0000-4000-8888-000000000001');
select test.assert_eq(
  (select legal_name_ar from public.invoice_sellers
   where id = '50000000-0000-4000-8888-000000000001'),
  'ورشة الفوترة الذاتية',
  'a provider can read their own invoice_sellers row');

-- The customer who actually holds an invoice from this seller can read it —
-- the relationship zatca_invoices_read already grants extends here too.
select test.become('22222222-0000-4000-8888-000000000002');
select test.assert_eq(
  (select vat_number from public.invoice_sellers
   where id = '50000000-0000-4000-8888-000000000001'),
  '300000000000013',
  'a customer with a real invoice from this seller can read the seller row');

reset role;
rollback;

\echo '   invoice_sellers row scoping OK'
