-- 46 — The inspection, as the app does it
--
-- Companion to 0073.

\echo '── inspections in the app'

begin;

insert into auth.users (id, phone) values
  ('11111111-0000-4000-e100-000000000001', '+966509800001'),  -- buyer
  ('22222222-0000-4000-e100-000000000002', '+966509800002');  -- inspector

insert into public.profiles (id, full_name, phone) values
  ('11111111-0000-4000-e100-000000000001', 'المشتري', '+966509800001'),
  ('22222222-0000-4000-e100-000000000002', 'الفاحص', '+966509800002');

insert into public.cities (id, name_ar, name_en, region_ar, region_en, centroid) values
  ('c0000000-0000-4000-e100-000000000001', 'الطائف', 'TaifInsp', 'مكة', 'Makkah',
   extensions.st_point(40.4158, 21.2703)::extensions.geography);

insert into public.providers
  (id, owner_profile_id, provider_type, business_name_ar, verification_status, city_id)
values
  ('e0000000-0000-4000-e100-000000000001', '22222222-0000-4000-e100-000000000002',
   'individual', 'فاحص الطائف', 'approved', 'c0000000-0000-4000-e100-000000000001');

select id as svc from public.services where name_en = 'Pre-purchase inspection' \gset
select id as diag from public.services where name_en = 'Computer diagnostics' \gset

select test.assert_eq(
  (select inspection_template_key from public.services where id = :'svc'), 'pre_purchase_v1',
  'the pre-purchase inspection names the template it is performed against');
select test.assert(
  (select inspection_template_key is null from public.services where id = :'diag'),
  'computer diagnostics, in the same category, files no structured report');

-- A second template, to prove the wrong one is refused.
insert into public.inspection_templates (key, name_ar, name_en, sections)
values ('quick_check_v1', 'فحص سريع', 'Quick check',
        '[{"key":"body","title_ar":"الهيكل","weight":1,"items":[{"key":"dents","label_ar":"صدمات","type":"rating","required":true}]}]');

insert into public.orders
  (id, customer_id, vehicle_id, service_id, fulfilment_mode, status,
   service_location, service_address_ar, provider_id, quoted_amount, escrow_status, created_by)
values
  ('f0000000-0000-4000-e100-000000000001', '11111111-0000-4000-e100-000000000001', null,
   :'svc', 'mobile_scheduled', 'draft',
   extensions.st_point(40.41, 21.27)::extensions.geography, 'معرض السيارات',
   'e0000000-0000-4000-e100-000000000001', 450, 'authorised',
   '11111111-0000-4000-e100-000000000001');

select public.begin_privileged_write();
update public.orders set status = 'accepted' where id = 'f0000000-0000-4000-e100-000000000001';
update public.orders set status = 'en_route' where id = 'f0000000-0000-4000-e100-000000000001';
update public.orders set status = 'arrived' where id = 'f0000000-0000-4000-e100-000000000001';
update public.orders set status = 'in_progress' where id = 'f0000000-0000-4000-e100-000000000001';
select public.end_privileged_write();

set role authenticated;
select test.become('22222222-0000-4000-e100-000000000002');

select test.assert_raises(
  $$update public.orders set status = 'awaiting_approval'
     where id = 'f0000000-0000-4000-e100-000000000001'$$,
  'the job cannot be handed back before the report is filed', '23514');

select test.assert_raises(
  $$select public.submit_inspection_report(
      'f0000000-0000-4000-e100-000000000001', 'quick_check_v1',
      '{"body":{"dents":{"rating":"pass"}}}'::jsonb, '1HGCM82633A004352')$$,
  'nor filed against a template other than the one its service names', '23514');

select public.submit_inspection_report(
  'f0000000-0000-4000-e100-000000000001', 'pre_purchase_v1',
  (select jsonb_object_agg(s ->> 'key',
            (select jsonb_object_agg(i ->> 'key', jsonb_build_object('rating', 'pass'))
               from jsonb_array_elements(s -> 'items') as i))
     from public.inspection_templates t, jsonb_array_elements(t.sections) as s
    where t.key = 'pre_purchase_v1'),
  '1HGCM82633A004352', null, 'هوندا', 'أكورد', 2019, 88000);

update public.orders set status = 'awaiting_approval' where id = 'f0000000-0000-4000-e100-000000000001';
select test.assert_eq(
  (select status::text from public.orders where id = 'f0000000-0000-4000-e100-000000000001'),
  'awaiting_approval', 'with the report filed, the job is handed back');

reset role;
rollback;

\echo '   inspections in the app OK'
