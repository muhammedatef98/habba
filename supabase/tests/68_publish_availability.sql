-- 68 — A technician says when they are free, and only for themselves
--
-- Companion to 0104.

\echo '── publish availability'

begin;

insert into auth.users (id, phone) values
  ('11111111-0000-4000-6868-000000000001', '+966509680001'),
  ('22222222-0000-4000-6868-000000000002', '+966509680002'),
  ('44444444-0000-4000-6868-000000000004', '+966509680004');

insert into public.profiles (id, full_name, phone) values
  ('11111111-0000-4000-6868-000000000001', 'العميل', '+966509680001'),
  ('22222222-0000-4000-6868-000000000002', 'الفنّي', '+966509680002'),
  ('44444444-0000-4000-6868-000000000004', 'فنّي آخر', '+966509680004');

insert into public.cities (id, name_ar, name_en, region_ar, region_en, centroid) values
  ('c0000000-0000-4000-6868-000000000001', 'الدمام', 'DammamSlots', 'الشرقية', 'Eastern',
   extensions.st_point(50.1033, 26.4207)::extensions.geography);

insert into public.providers
  (id, owner_profile_id, provider_type, business_name_ar, verification_status, city_id)
values
  ('e0000000-0000-4000-6868-000000000001', '22222222-0000-4000-6868-000000000002',
   'individual', 'فنّي المواعيد', 'approved', 'c0000000-0000-4000-6868-000000000001'),
  ('e0000000-0000-4000-6868-000000000004', '44444444-0000-4000-6868-000000000004',
   'individual', 'فنّي آخر', 'approved', 'c0000000-0000-4000-6868-000000000001');
select test.grant_role('22222222-0000-4000-6868-000000000002', 'technician');
select test.grant_role('44444444-0000-4000-6868-000000000004', 'technician');

select ((now() at time zone 'Asia/Riyadh')::date + 1)::text as d1,
       ((now() at time zone 'Asia/Riyadh')::date + 2)::text as d2 \gset

set role authenticated;

select test.become('11111111-0000-4000-6868-000000000001');
select test.assert_raises(
  format($$select public.publish_availability(array['%s']::date[], 540, 720, 60)$$, :'d1'),
  'a customer has no calendar to publish', '42501');
select test.assert_raises($$select * from public.my_slots()$$,
  'nor one to read', '42501');

select test.become('22222222-0000-4000-6868-000000000002');
select test.assert_eq(
  public.publish_availability(array[:'d1', :'d2']::date[], 540, 720, 60), 6,
  'two days of 09:00–12:00 in hours is six slots');
select test.assert_eq(
  public.publish_availability(array[:'d1', :'d2']::date[], 540, 720, 60), 0,
  'publishing the same again adds nothing');
select test.assert_eq(
  (select min(starts_at) from public.my_slots())::timestamptz,
  ((:'d1')::date + time '09:00') at time zone 'Asia/Riyadh',
  'times are Riyadh times');
select test.assert_eq((select count(*)::int from public.my_slots()), 6,
  'the technician reads their own calendar');

select test.assert_raises(
  format($$select public.publish_availability(array['%s']::date[], 720, 750, 60)$$, :'d1'),
  'a window shorter than one appointment is refused', '23514');
select test.assert_raises(
  format($$select public.publish_availability(array['%s']::date[], 540, 720, 50)$$, :'d1'),
  'an odd appointment length is refused', '23514');
select test.assert_raises(
  $$select public.publish_availability(array[(now() at time zone 'Asia/Riyadh')::date + 90]::date[], 540, 720, 60)$$,
  'more than 60 days ahead is refused', '23514');
select test.assert_raises(
  $$select public.publish_availability(array[]::date[], 540, 720, 60)$$,
  'no days is refused', '23514');

select (select id from public.my_slots() order by starts_at limit 1) as first_slot \gset
select public.set_slot_blocked(:'first_slot', true);
select test.assert(
  (select is_blocked from public.my_slots() where id = :'first_slot'),
  'a technician closes one of their times');

select test.become('44444444-0000-4000-6868-000000000004');
select test.assert_eq((select count(*)::int from public.my_slots()), 0,
  'another technician''s calendar is not theirs');
select test.assert_raises(
  format($$select public.set_slot_blocked('%s', false)$$, :'first_slot'),
  'and they cannot reopen someone else''s time', 'P0002');

select test.become('11111111-0000-4000-6868-000000000001');
select test.assert_eq(
  (select count(*)::int from public.appointment_slots
    where provider_id = 'e0000000-0000-4000-6868-000000000001'
      and not is_blocked and starts_at > now()),
  5, 'the customer sees the open times only');

select test.become('22222222-0000-4000-6868-000000000002');
select public.set_slot_blocked(:'first_slot', false);
select test.assert(
  not (select is_blocked from public.my_slots() where id = :'first_slot'),
  'and opens it again');

reset role;

rollback;
