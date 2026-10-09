-- 71 — A workshop says where it is; ops see the calendar
--
-- Companion to 0107.

\echo '── workshop profile and calendar view'

begin;

insert into auth.users (id, phone) values
  ('33333333-0000-4000-7171-000000000003', '+966509710003'),
  ('55555555-0000-4000-7171-000000000005', '+966509710005'),
  ('66666666-0000-4000-7171-000000000006', '+966509710006');
insert into public.profiles (id, full_name, phone) values
  ('33333333-0000-4000-7171-000000000003', 'الورشة', '+966509710003'),
  ('55555555-0000-4000-7171-000000000005', 'عميل', '+966509710005'),
  ('66666666-0000-4000-7171-000000000006', 'التشغيل', '+966509710006');
select test.grant_role('66666666-0000-4000-7171-000000000006', 'ops');
insert into public.cities (id, name_ar, name_en, region_ar, region_en, centroid) values
  ('c0000000-0000-4000-7171-000000000001', 'الدمام', 'DammamWorkshop', 'الشرقية', 'Eastern',
   extensions.st_point(50.1033, 26.4207)::extensions.geography);
insert into public.providers
  (id, owner_profile_id, provider_type, business_name_ar, cr_number, verification_status, city_id)
values
  ('e0000000-0000-4000-7171-000000000003', '33333333-0000-4000-7171-000000000003',
   'workshop', 'ورشة الاختبار', '4040404040', 'approved', 'c0000000-0000-4000-7171-000000000001');
select test.grant_role('33333333-0000-4000-7171-000000000003', 'workshop_admin');

set role authenticated;

select test.become('55555555-0000-4000-7171-000000000005');
select test.assert_raises($$select * from public.my_workshop()$$, 'a customer has no workshop', '42501');

select test.become('33333333-0000-4000-7171-000000000003');
select test.assert_eq((select count(*)::int from public.my_workshop()), 0,
  'a newly approved workshop has no address yet');
select public.upsert_workshop('طريق الملك فهد، الدمام', 50.11, 26.43, 3,
  '{"sun": [["08:00","20:00"]]}'::jsonb);
select test.assert_eq((select address_ar from public.my_workshop()), 'طريق الملك فهد، الدمام',
  'it saves its address');
select test.assert_eq((select round(lat::numeric, 2) from public.my_workshop()), 26.43::numeric,
  'and reads its point back');
select test.assert_eq((select bay_count from public.my_workshop()), 3, 'and its bays');

select public.publish_availability(
  array[((now() at time zone 'Asia/Riyadh')::date + 1)]::date[], 540, 660, 60);

select test.become('66666666-0000-4000-7171-000000000006');
select test.assert_eq(
  (public.ops_provider_detail('e0000000-0000-4000-7171-000000000003') -> 'availability' ->> 'open')::int,
  2, 'ops see the open times in the provider''s file');

reset role;
rollback;
