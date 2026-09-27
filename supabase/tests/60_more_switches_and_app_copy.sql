-- 60 — More switches, and the app's words from the console
--
-- Companion to 0093. Each new switch with a server path is refused by the
-- database when off; app_copy is readable by anyone and writable by
-- operators only.

\echo '── more switches and app copy'

begin;

insert into auth.users (id, phone) values
  ('11111111-0000-4000-6060-000000000001', '+966509600001'),
  ('22222222-0000-4000-6060-000000000002', '+966509600002'),
  ('33333333-0000-4000-6060-000000000003', '+966509600003');
insert into public.profiles (id, full_name, phone) values
  ('11111111-0000-4000-6060-000000000001', 'العميل', '+966509600001'),
  ('22222222-0000-4000-6060-000000000002', 'الورشة', '+966509600002'),
  ('33333333-0000-4000-6060-000000000003', 'المشغّل', '+966509600003');

select test.grant_role('22222222-0000-4000-6060-000000000002', 'workshop_admin');
select test.grant_role('33333333-0000-4000-6060-000000000003', 'ops');

insert into public.cities (id, name_ar, name_en, region_ar, region_en, centroid) values
  ('c0000000-0000-4000-6060-000000000001', 'الرياض', 'RiyadhSwitches', 'منطقة الرياض',
   'Riyadh Region', extensions.st_point(46.6753, 24.7136)::extensions.geography);
insert into public.vehicle_makes (id, name_ar, name_en) values
  ('a0000000-0000-4000-6060-000000000001', 'ماركة', 'TestMakeSwitches');
insert into public.vehicle_models (id, make_id, name_ar, name_en, year_from) values
  ('b0000000-0000-4000-6060-000000000001', 'a0000000-0000-4000-6060-000000000001',
   'موديل', 'TestModelSwitches', 2015);
insert into public.vehicles (id, owner_id, make_id, model_id, year, plate_en) values
  ('d0000000-0000-4000-6060-000000000001', '11111111-0000-4000-6060-000000000001',
   'a0000000-0000-4000-6060-000000000001', 'b0000000-0000-4000-6060-000000000001',
   2021, 'KND 6060');

insert into public.providers
  (id, owner_profile_id, provider_type, business_name_ar, cr_number,
   verification_status, city_id)
values
  ('e0000000-0000-4000-6060-000000000001', '22222222-0000-4000-6060-000000000002',
   'workshop', 'ورشة المفاتيح', '1010106060', 'approved',
   'c0000000-0000-4000-6060-000000000001');
insert into public.workshops (provider_id, address_ar, location, bay_count, opening_hours)
values ('e0000000-0000-4000-6060-000000000001', 'الرياض',
        extensions.st_point(46.6760, 24.7140)::extensions.geography, 2,
        '{"sun": [["08:00","20:00"]]}'::jsonb);

select id as svc_oil from public.services where name_en = 'Oil and filter change' \gset
insert into public.provider_services (provider_id, service_id)
values ('e0000000-0000-4000-6060-000000000001', :'svc_oil');
insert into public.appointment_slots (id, provider_id, starts_at, ends_at, capacity)
values ('50000000-0000-4000-6060-000000000001', 'e0000000-0000-4000-6060-000000000001',
        now() + interval '2 days', now() + interval '2 days 1 hour', 2);


-- The switches ---------------------------------------------------------------
select test.assert(
  (select count(*) = 7 and bool_and(value = 'true'::jsonb and is_public)
     from public.platform_settings
    where key in ('feature_booking_mobile', 'feature_booking_workshop', 'feature_record_service',
                  'feature_care_reminders', 'feature_ratings', 'feature_map_search',
                  'feature_saved_places')),
  'the seven new switches exist, start on, and the app can read them');

update public.platform_settings set value = 'false'
 where key in ('feature_booking_workshop', 'feature_record_service', 'feature_ratings',
               'feature_care_reminders');

set role authenticated;
select test.become('11111111-0000-4000-6060-000000000001');

select test.assert_raises(
  format($$select public.book_appointment('50000000-0000-4000-6060-000000000001', %L,
           'd0000000-0000-4000-6060-000000000001', null, 90000)$$, :'svc_oil'),
  'a workshop booking is refused while workshop bookings are off', '23514');

select test.assert_raises(
  $$select public.record_past_service('d0000000-0000-4000-6060-000000000001',
      'تغيير زيت', now() - interval '1 month', 80000)$$,
  'an owner cannot add a past service while that is off', '23514');

select test.assert_raises(
  $$insert into public.ratings (order_id, rater_id, provider_id, stars)
    values (gen_random_uuid(), '11111111-0000-4000-6060-000000000001',
            'e0000000-0000-4000-6060-000000000001', 5)$$,
  'a rating is refused while ratings are off', '23514');

select public.record_mileage('d0000000-0000-4000-6060-000000000001', 81000) as reading \gset
select test.assert(
  (select count(*) = 1 from public.vehicle_timeline
    where vehicle_id = 'd0000000-0000-4000-6060-000000000001'
      and event_type = 'mileage_recorded'),
  'an odometer reading is not a past service, and still goes in');

reset role;
select test.assert_eq(public.run_vehicle_care_sweep(), 0,
  'the reminder sweep sends nothing while reminders are off');

update public.platform_settings set value = 'true'
 where key in ('feature_booking_workshop', 'feature_record_service');

set role authenticated;
select test.become('11111111-0000-4000-6060-000000000001');
select public.book_appointment('50000000-0000-4000-6060-000000000001', :'svc_oil',
  'd0000000-0000-4000-6060-000000000001', null, 90000) as ord \gset
select test.assert(:'ord' is not null, 'switched back on, the workshop booking goes through');
select public.record_past_service('d0000000-0000-4000-6060-000000000001',
  'تغيير زيت', now() - interval '1 month', 80000) as ev \gset
select test.assert(:'ev' is not null, 'and so does a past service');


-- app_copy -------------------------------------------------------------------
reset role;
insert into public.app_copy (key, ar) values ('home.emergencyCta', 'اطلب مساعدة');

set role anon;
select test.become_anon();
select test.assert_eq(
  (select ar from public.app_copy where key = 'home.emergencyCta'), 'اطلب مساعدة',
  'anyone can read the words, signed in or not');
select test.assert_raises(
  $$insert into public.app_copy (key, ar) values ('home.bookTitle', 'x')$$,
  'but a visitor cannot write them', '42501');

set role authenticated;
select test.become('11111111-0000-4000-6060-000000000001');
select test.assert_raises(
  $$insert into public.app_copy (key, ar) values ('home.bookTitle', 'احجز')$$,
  'nor can a customer', '42501');
update public.app_copy set ar = 'مخترق' where key = 'home.emergencyCta';
select test.assert_eq(
  (select ar from public.app_copy where key = 'home.emergencyCta'), 'اطلب مساعدة',
  'and a customer''s update changes nothing');

select test.become('33333333-0000-4000-6060-000000000003');
insert into public.app_copy (key, ar, en) values ('home.bookTitle', 'احجز صيانة', 'Book a service');
update public.app_copy set ar = 'اطلب مساعدة الآن' where key = 'home.emergencyCta';
select test.assert_eq(
  (select ar from public.app_copy where key = 'home.emergencyCta'), 'اطلب مساعدة الآن',
  'an operator can change the words');
select test.assert(
  (select created_by = '33333333-0000-4000-6060-000000000003'
      and updated_by = '33333333-0000-4000-6060-000000000003'
     from public.app_copy where key = 'home.bookTitle'),
  'and the row says who did it');
select test.assert_raises(
  $$insert into public.app_copy (key, ar) values ('not a key', 'x')$$,
  'a key must look like one of the app''s keys', '23514');
select test.assert_raises(
  $$insert into public.app_copy (key) values ('home.greetingNight')$$,
  'a row must say something in at least one language', '23514');
delete from public.app_copy where key = 'home.bookTitle';

reset role;
select test.assert(
  (select count(*) >= 3 from public.audit_log
    where target_table = 'app_copy'
      and actor_id = '33333333-0000-4000-6060-000000000003'),
  'every operator change is in the audit log');

rollback;

\echo '   more switches and app copy OK'
