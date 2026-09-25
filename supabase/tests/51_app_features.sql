-- 51 — The app's parts, switched from the console
--
-- Companion to 0081. A switched-off part is refused by the database, not
-- merely hidden by the app.

\echo '── app feature switches'

begin;

insert into auth.users (id, phone) values
  ('11111111-0000-4000-5151-000000000001', '+966509510001'),
  ('22222222-0000-4000-5151-000000000002', '+966509510002');
insert into public.profiles (id, full_name, phone) values
  ('11111111-0000-4000-5151-000000000001', 'العميل', '+966509510001'),
  ('22222222-0000-4000-5151-000000000002', 'المتقدّم', '+966509510002');

insert into public.cities (id, name_ar, name_en, region_ar, region_en, centroid) values
  ('c0000000-0000-4000-5151-000000000001', 'الجبيل', 'JubailFeatures', 'الشرقية', 'Eastern',
   extensions.st_point(49.6583, 27.0046)::extensions.geography);
insert into public.vehicle_makes (id, name_ar, name_en) values
  ('a0000000-0000-4000-5151-000000000001', 'ماركة', 'TestMakeFeatures');
insert into public.vehicle_models (id, make_id, name_ar, name_en, year_from) values
  ('b0000000-0000-4000-5151-000000000001', 'a0000000-0000-4000-5151-000000000001',
   'موديل', 'TestModelFeatures', 2015);
insert into public.vehicles (id, owner_id, make_id, model_id, year, plate_en) values
  ('d0000000-0000-4000-5151-000000000001', '11111111-0000-4000-5151-000000000001',
   'a0000000-0000-4000-5151-000000000001', 'b0000000-0000-4000-5151-000000000001',
   2021, 'KND 5151');

select id as svc from public.services where name_en = 'Battery jump or replacement' \gset

select test.assert(
  (select bool_and(value = 'true'::jsonb) from public.platform_settings where category = 'features'),
  'every part of the app starts switched on');
select test.assert(
  (select get_public_settings ? 'feature_emergency' from public.get_public_settings()),
  'and the app can read the switches without signing in');

update public.platform_settings set value = 'false'
 where key in ('feature_emergency', 'feature_ownership_transfer', 'feature_habba_report',
               'feature_provider_applications');

set role authenticated;
select test.become('11111111-0000-4000-5151-000000000001');

select test.assert_raises(
  format($$select public.create_emergency_order(%L, 49.66, 27.0, %L, 'الجبيل', null, null, '[]'::jsonb)$$,
         :'svc', 'd0000000-0000-4000-5151-000000000001'),
  'an emergency is refused while emergencies are off', '23514');

select test.assert_raises(
  $$select public.initiate_ownership_transfer('d0000000-0000-4000-5151-000000000001', '+966509519999', null)$$,
  'a transfer is refused while transfers are off', '23514');

select test.assert_raises(
  $$select public.generate_habba_report('d0000000-0000-4000-5151-000000000001')$$,
  'a report is refused while reports are off', '23514');

select test.become('22222222-0000-4000-5151-000000000002');
select test.assert_raises(
  $$insert into public.providers (owner_profile_id, provider_type, business_name_ar, city_id)
    values ('22222222-0000-4000-5151-000000000002', 'individual', 'ورشة جديدة',
            'c0000000-0000-4000-5151-000000000001')$$,
  'an application is refused while applications are closed', '23514');

reset role;
update public.platform_settings set value = 'true'
 where key in ('feature_emergency', 'feature_ownership_transfer', 'feature_habba_report');

set role authenticated;
select test.become('11111111-0000-4000-5151-000000000001');
select public.create_emergency_order(:'svc', 49.66, 27.0, 'd0000000-0000-4000-5151-000000000001',
  'الجبيل', null, null, '[]'::jsonb) as ord \gset
select test.assert(:'ord' is not null, 'switched back on, an emergency goes through');
select public.generate_habba_report('d0000000-0000-4000-5151-000000000001') as tok \gset
select test.assert(:'tok' is not null, 'and so does a report');

rollback;

\echo '   app feature switches OK'
