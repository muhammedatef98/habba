-- 58 — Photos on inspection items
--
-- Companion to 0090. A report may carry photos on its items, and only this
-- order's inspection photos that were actually uploaded.

\echo '── inspection photos'

begin;

insert into auth.users (id, phone) values
  ('11111111-0000-4000-e200-000000000001', '+966509810001'),  -- buyer
  ('22222222-0000-4000-e200-000000000002', '+966509810002');  -- inspector
insert into public.profiles (id, full_name, phone) values
  ('11111111-0000-4000-e200-000000000001', 'المشتري', '+966509810001'),
  ('22222222-0000-4000-e200-000000000002', 'الفاحص', '+966509810002');

insert into public.cities (id, name_ar, name_en, region_ar, region_en, centroid) values
  ('c0000000-0000-4000-e200-000000000001', 'أبها', 'AbhaPhotos', 'عسير', 'Asir',
   extensions.st_point(42.5053, 18.2164)::extensions.geography);

insert into public.providers
  (id, owner_profile_id, provider_type, business_name_ar, verification_status, city_id)
values
  ('e0000000-0000-4000-e200-000000000001', '22222222-0000-4000-e200-000000000002',
   'individual', 'فاحص أبها', 'approved', 'c0000000-0000-4000-e200-000000000001');

select id as svc from public.services where name_en = 'Pre-purchase inspection' \gset

insert into public.orders
  (id, customer_id, vehicle_id, service_id, fulfilment_mode, status,
   service_location, service_address_ar, provider_id, quoted_amount, escrow_status, created_by)
values
  ('f0000000-0000-4000-e200-000000000001', '11111111-0000-4000-e200-000000000001', null,
   :'svc', 'mobile_scheduled', 'draft',
   extensions.st_point(42.50, 18.21)::extensions.geography, 'معرض أبها',
   'e0000000-0000-4000-e200-000000000001', 450, 'authorised',
   '11111111-0000-4000-e200-000000000001');

select public.begin_privileged_write();
update public.orders set status = 'accepted' where id = 'f0000000-0000-4000-e200-000000000001';
update public.orders set status = 'en_route' where id = 'f0000000-0000-4000-e200-000000000001';
update public.orders set status = 'arrived' where id = 'f0000000-0000-4000-e200-000000000001';
update public.orders set status = 'in_progress' where id = 'f0000000-0000-4000-e200-000000000001';
select public.end_privileged_write();

-- What the inspector uploaded, and a file from some other order.
insert into storage.objects (bucket_id, name) values
  ('completion-media', 'f0000000-0000-4000-e200-000000000001/insp-body-dents-1.jpg'),
  ('completion-media', 'f0000000-0000-4000-e200-000000000001/insp-body-dents-2.jpg'),
  ('completion-media', 'f0000000-0000-4000-e200-000000000009/insp-body-dents-1.jpg');

-- Every item passed, then photos put on the first item of the first section.
select s ->> 'key' as sec, (s -> 'items' -> 0) ->> 'key' as itm
  from public.inspection_templates t, jsonb_array_elements(t.sections) with ordinality as x(s, n)
 where t.key = 'pre_purchase_v1' and n = 1 \gset
select jsonb_object_agg(s ->> 'key',
         (select jsonb_object_agg(i ->> 'key', jsonb_build_object('rating', 'pass'))
            from jsonb_array_elements(s -> 'items') as i)) as base
  from public.inspection_templates t, jsonb_array_elements(t.sections) as s
 where t.key = 'pre_purchase_v1' \gset

create temporary table photo_results (label text primary key, results jsonb) on commit drop;
insert into photo_results values
  ('foreign', jsonb_set(:'base'::jsonb, array[:'sec', :'itm', 'photos'],
     '["storage://completion-media/f0000000-0000-4000-e200-000000000009/insp-body-dents-1.jpg"]')),
  ('missing', jsonb_set(:'base'::jsonb, array[:'sec', :'itm', 'photos'],
     '["storage://completion-media/f0000000-0000-4000-e200-000000000001/insp-never.jpg"]')),
  ('outside', jsonb_set(:'base'::jsonb, array[:'sec', :'itm', 'photos'],
     '["https://example.com/some-car.jpg"]')),
  ('too_many', jsonb_set(:'base'::jsonb, array[:'sec', :'itm', 'photos'],
     '["storage://completion-media/f0000000-0000-4000-e200-000000000001/insp-body-dents-1.jpg",
       "storage://completion-media/f0000000-0000-4000-e200-000000000001/insp-body-dents-1.jpg",
       "storage://completion-media/f0000000-0000-4000-e200-000000000001/insp-body-dents-1.jpg",
       "storage://completion-media/f0000000-0000-4000-e200-000000000001/insp-body-dents-1.jpg",
       "storage://completion-media/f0000000-0000-4000-e200-000000000001/insp-body-dents-2.jpg"]')),
  ('good', jsonb_set(:'base'::jsonb, array[:'sec', :'itm', 'photos'],
     '["storage://completion-media/f0000000-0000-4000-e200-000000000001/insp-body-dents-1.jpg",
       "storage://completion-media/f0000000-0000-4000-e200-000000000001/insp-body-dents-2.jpg"]'));
grant select on photo_results to authenticated;

set role authenticated;
select test.become('22222222-0000-4000-e200-000000000002');

select test.assert_raises(
  $$select public.submit_inspection_report('f0000000-0000-4000-e200-000000000001', 'pre_purchase_v1',
      (select results from photo_results where label = 'foreign'), '1HGCM82633A004352')$$,
  'a photo from another order is refused', '22023');
select test.assert_raises(
  $$select public.submit_inspection_report('f0000000-0000-4000-e200-000000000001', 'pre_purchase_v1',
      (select results from photo_results where label = 'missing'), '1HGCM82633A004352')$$,
  'a photo that was never uploaded is refused', '22023');
select test.assert_raises(
  $$select public.submit_inspection_report('f0000000-0000-4000-e200-000000000001', 'pre_purchase_v1',
      (select results from photo_results where label = 'outside'), '1HGCM82633A004352')$$,
  'a picture from anywhere else is refused', '22023');
select test.assert_raises(
  $$select public.submit_inspection_report('f0000000-0000-4000-e200-000000000001', 'pre_purchase_v1',
      (select results from photo_results where label = 'too_many'), '1HGCM82633A004352')$$,
  'at most four photos on one item', '23514');

select public.submit_inspection_report('f0000000-0000-4000-e200-000000000001', 'pre_purchase_v1',
  (select results from photo_results where label = 'good'), '1HGCM82633A004352');
reset role;

select test.assert_eq(
  (select jsonb_array_length(results -> :'sec' -> :'itm' -> 'photos')
     from public.inspection_reports where order_id = 'f0000000-0000-4000-e200-000000000001'),
  2, 'this order''s uploaded inspection photos are kept on the item');

set role authenticated;
select test.become('11111111-0000-4000-e200-000000000001');
select test.assert(
  public.can_read_completion_media('f0000000-0000-4000-e200-000000000001'),
  'and the buyer may look at them');
reset role;

rollback;

\echo '   inspection photos OK'
