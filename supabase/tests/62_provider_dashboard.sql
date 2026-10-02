-- 62 — The technician's own dashboard
--
-- Companion to 0095. A customer-only user and an applicant still in review
-- are refused outright (§5.1.3: no earnings surface for them, even by a
-- hand-written call). An approved provider sees their own completed job in
-- today's numbers, net of commission exactly as build_payout would take it,
-- as unpaid until a payout claims it, and their review without the name of
-- whoever wrote it.

\echo '── provider dashboard'

begin;

insert into auth.users (id, phone) values
  ('11111111-0000-4000-6262-000000000001', '+966509620001'),
  ('22222222-0000-4000-6262-000000000002', '+966509620002'),
  ('44444444-0000-4000-6262-000000000004', '+966509620004');

insert into public.profiles (id, full_name, phone) values
  ('11111111-0000-4000-6262-000000000001', 'العميل', '+966509620001'),
  ('22222222-0000-4000-6262-000000000002', 'الورشة', '+966509620002'),
  ('44444444-0000-4000-6262-000000000004', 'المتقدّم', '+966509620004');

select test.grant_role('22222222-0000-4000-6262-000000000002', 'workshop_admin');

insert into public.cities (id, name_ar, name_en, region_ar, region_en, centroid) values
  ('c0000000-0000-4000-6262-000000000001', 'الخبر', 'KhobarDash', 'الشرقية', 'Eastern',
   extensions.st_point(50.2083, 26.2794)::extensions.geography);

insert into public.vehicle_makes (id, name_ar, name_en) values
  ('a0000000-0000-4000-6262-000000000001', 'ماركة لوحة', 'TestMakeDash');
insert into public.vehicle_models (id, make_id, name_ar, name_en, year_from) values
  ('b0000000-0000-4000-6262-000000000001', 'a0000000-0000-4000-6262-000000000001',
   'موديل لوحة', 'TestModelDash', 2015);
insert into public.vehicles (id, owner_id, make_id, model_id, year, plate_en, current_mileage) values
  ('d0000000-0000-4000-6262-000000000001', '11111111-0000-4000-6262-000000000001',
   'a0000000-0000-4000-6262-000000000001', 'b0000000-0000-4000-6262-000000000001',
   2020, 'ABD 6262', 40000);

insert into public.providers
  (id, owner_profile_id, provider_type, business_name_ar, cr_number,
   verification_status, city_id)
values
  ('e0000000-0000-4000-6262-000000000001', '22222222-0000-4000-6262-000000000002',
   'workshop', 'ورشة اللوحة', '1010626262', 'approved',
   'c0000000-0000-4000-6262-000000000001'),
  ('e0000000-0000-4000-6262-000000000004', '44444444-0000-4000-6262-000000000004',
   'individual', 'فنّي قيد المراجعة', null, 'pending',
   'c0000000-0000-4000-6262-000000000001');

insert into public.workshops (provider_id, address_ar, location, bay_count, opening_hours)
values ('e0000000-0000-4000-6262-000000000001', 'عنوان',
        extensions.st_point(50.209, 26.280)::extensions.geography, 2,
        '{"sun": [["08:00","20:00"]]}'::jsonb);

select id as svc_oil from public.services where name_en = 'Oil and filter change' \gset


-- Who is refused ---------------------------------------------------------------
select test.become('11111111-0000-4000-6262-000000000001');
select test.assert_raises(
  $$select public.provider_dashboard()$$,
  'a customer-only user has no dashboard, even calling it by hand', '42501');

select test.become('44444444-0000-4000-6262-000000000004');
select test.assert_raises(
  $$select public.provider_dashboard()$$,
  'an applicant still in review has no dashboard', '42501');

select test.become_anon();
select test.assert_raises(
  $$select public.provider_dashboard()$$,
  'nobody signed in may call it', '42501');


-- An approved provider with nothing done yet ------------------------------------------
select test.become('22222222-0000-4000-6262-000000000002');
select public.provider_dashboard() as empty \gset
select test.assert_eq((:'empty'::jsonb -> 'profile' ->> 'business_name_ar'), 'ورشة اللوحة',
  'the dashboard is the caller''s own provider');
select test.assert_eq((:'empty'::jsonb -> 'periods' -> 'today' ->> 'jobs')::int, 0,
  'no jobs yet reads as zero, not missing');
select test.assert_eq(jsonb_array_length(:'empty'::jsonb -> 'recent'), 0,
  'no recent jobs is an empty list');


-- One job, completed today ------------------------------------------------------------
select test.become('11111111-0000-4000-6262-000000000001');
insert into public.orders
  (id, customer_id, vehicle_id, service_id, fulfilment_mode, status,
   workshop_id, provider_id, quoted_amount, created_by)
values
  ('f0000000-0000-4000-6262-000000000001',
   '11111111-0000-4000-6262-000000000001', 'd0000000-0000-4000-6262-000000000001',
   :'svc_oil', 'workshop', 'draft',
   'e0000000-0000-4000-6262-000000000001', 'e0000000-0000-4000-6262-000000000001',
   180, '11111111-0000-4000-6262-000000000001');

update public.orders set status = 'quoted' where id = 'f0000000-0000-4000-6262-000000000001';
select public.authorise_order_payment('f0000000-0000-4000-6262-000000000001', 'dash_1');
update public.orders set status = 'accepted' where id = 'f0000000-0000-4000-6262-000000000001';
update public.orders set status = 'checked_in' where id = 'f0000000-0000-4000-6262-000000000001';
update public.orders set status = 'in_progress' where id = 'f0000000-0000-4000-6262-000000000001';
select test.become('22222222-0000-4000-6262-000000000002');
select public.record_completion_evidence('f0000000-0000-4000-6262-000000000001', 40500,
  test.completion_photos('f0000000-0000-4000-6262-000000000001'));
update public.orders
set labour_amount = 180, vat_amount = 27, total_amount = 207, vat_rate_applied = 0.15
where id = 'f0000000-0000-4000-6262-000000000001';
select test.become('11111111-0000-4000-6262-000000000001');
update public.orders set status = 'awaiting_approval'
where id = 'f0000000-0000-4000-6262-000000000001';
update public.orders set status = 'completed'
where id = 'f0000000-0000-4000-6262-000000000001';

-- Capture goes through the payment function, after the customer confirms.
select public.capture_order_payment('f0000000-0000-4000-6262-000000000001');

insert into public.ratings (order_id, rater_id, provider_id, stars, tags, comment)
values ('f0000000-0000-4000-6262-000000000001', '11111111-0000-4000-6262-000000000001',
        'e0000000-0000-4000-6262-000000000001', 4, array['سرعة'], 'شغل نظيف');

select test.become('22222222-0000-4000-6262-000000000002');
select public.provider_dashboard() as dash \gset

select test.assert_eq((:'dash'::jsonb -> 'periods' -> 'today' ->> 'jobs')::int, 1,
  'a job completed today counts today');
select test.assert_eq((:'dash'::jsonb -> 'periods' -> 'month' ->> 'jobs')::int, 1,
  'and this month');
select test.assert_eq((:'dash'::jsonb -> 'periods' -> 'today' ->> 'gross')::numeric, 207.00,
  'gross is what the customer paid');
select round(207 - 180 * coalesce(public.commission_rate_for(s.category,
         (now() at time zone 'Asia/Riyadh')::date), 0.20), 2) as expected_net
  from public.services s where s.id = :'svc_oil' \gset
select test.assert_eq((:'dash'::jsonb -> 'periods' -> 'today' ->> 'net')::numeric,
  (:'expected_net')::numeric,
  'net takes commission off parts and labour (180), never off the VAT (27)');
select test.assert_eq(jsonb_array_length(:'dash'::jsonb -> 'recent'), 1,
  'the job is in the recent list');
select test.assert_eq((:'dash'::jsonb -> 'stars' ->> '4')::int, 1,
  'the review counts in its star bucket');
select test.assert_eq((:'dash'::jsonb -> 'reviews' -> 0 ->> 'comment'), 'شغل نظيف',
  'the review''s words are shown');
select test.assert(
  not ((:'dash'::jsonb -> 'reviews' -> 0) ? 'rater_id'),
  'but never who wrote it');
select test.assert_eq((:'dash'::jsonb -> 'unpaid' ->> 'jobs')::int, 1,
  'a captured job not yet in a payout is waiting to be paid');

-- Once a payout claims it, it is no longer waiting.
select test.grant_role('11111111-0000-4000-6262-000000000001', 'ops');
select test.become('11111111-0000-4000-6262-000000000001');
select public.build_payout('e0000000-0000-4000-6262-000000000001',
  (now() - interval '2 days')::date, (now() + interval '1 day')::date);
select test.become('22222222-0000-4000-6262-000000000002');
select public.provider_dashboard() as paid \gset
select test.assert_eq((:'paid'::jsonb -> 'unpaid' ->> 'jobs')::int, 0,
  'a job in a payout is no longer waiting');
select test.assert_eq(jsonb_array_length(:'paid'::jsonb -> 'payouts'), 1,
  'and the payout is listed');

-- Someone else's dashboard is not reachable by any argument: there is none.
select test.assert(
  not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'provider_dashboard' and p.pronargs > 0),
  'the dashboard takes no provider id — it is always the caller''s own');

rollback;
