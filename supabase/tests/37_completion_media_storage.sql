-- 37 — Completion photos are real, or they are not evidence
--
-- Companion to 0064 and supabase/storage/completion-media-policies.sql. The
-- assertion this suite exists for: record_completion_evidence() no longer
-- counts a string as a photo.

\echo '── completion media storage'

begin;

insert into auth.users (id, phone) values
  ('11111111-0000-4000-e700-000000000001', '+966507100001'),  -- customer
  ('22222222-0000-4000-e700-000000000002', '+966507100002'),  -- assigned tech
  ('33333333-0000-4000-e700-000000000003', '+966507100003'),  -- another tech
  ('44444444-0000-4000-e700-000000000004', '+966507100004');  -- the car's next owner

insert into public.profiles (id, full_name, phone) values
  ('11111111-0000-4000-e700-000000000001', 'العميل', '+966507100001'),
  ('22222222-0000-4000-e700-000000000002', 'الفنّي', '+966507100002'),
  ('33333333-0000-4000-e700-000000000003', 'فنّي آخر', '+966507100003'),
  ('44444444-0000-4000-e700-000000000004', 'المشتري', '+966507100004');

insert into public.cities (id, name_ar, name_en, region_ar, region_en, centroid) values
  ('c0000000-0000-4000-e700-000000000001', 'الدمام', 'DammamMedia', 'الشرقية', 'Eastern',
   extensions.st_point(50.1033, 26.4207)::extensions.geography);

insert into public.vehicle_makes (id, name_ar, name_en) values
  ('a0000000-0000-4000-e700-000000000001', 'ماركة صور', 'TestMakeMedia');
insert into public.vehicle_models (id, make_id, name_ar, name_en, year_from) values
  ('b0000000-0000-4000-e700-000000000001', 'a0000000-0000-4000-e700-000000000001',
   'موديل صور', 'TestModelMedia', 2015);
insert into public.vehicles (id, owner_id, make_id, model_id, year, plate_en, current_mileage) values
  ('d0000000-0000-4000-e700-000000000001', '11111111-0000-4000-e700-000000000001',
   'a0000000-0000-4000-e700-000000000001', 'b0000000-0000-4000-e700-000000000001',
   2021, 'ABJ 3737', 40000);

insert into public.providers
  (id, owner_profile_id, provider_type, business_name_ar, verification_status, is_online, city_id)
values
  ('e0000000-0000-4000-e700-000000000001', '22222222-0000-4000-e700-000000000002',
   'individual', 'فنّي الصور', 'approved', true, 'c0000000-0000-4000-e700-000000000001'),
  ('e0000000-0000-4000-e700-000000000002', '33333333-0000-4000-e700-000000000003',
   'individual', 'فنّي آخر', 'approved', true, 'c0000000-0000-4000-e700-000000000001');

select id as svc_battery from public.services where name_en = 'Battery jump or replacement' \gset

insert into public.provider_services (provider_id, service_id) values
  ('e0000000-0000-4000-e700-000000000001', :'svc_battery');

select test.become('11111111-0000-4000-e700-000000000001');

insert into public.orders
  (id, customer_id, vehicle_id, service_id, fulfilment_mode, service_location,
   provider_id, quoted_amount, created_by)
values
  ('f0000000-0000-4000-e700-000000000001',
   '11111111-0000-4000-e700-000000000001', 'd0000000-0000-4000-e700-000000000001',
   :'svc_battery', 'mobile_ondemand',
   extensions.st_point(50.105, 26.422)::extensions.geography,
   'e0000000-0000-4000-e700-000000000001', 120, '11111111-0000-4000-e700-000000000001');

update public.orders set status = 'searching' where id = 'f0000000-0000-4000-e700-000000000001';
update public.orders set status = 'quoted' where id = 'f0000000-0000-4000-e700-000000000001';
select public.authorise_order_payment('f0000000-0000-4000-e700-000000000001', 'media_1');
update public.orders set status = 'accepted' where id = 'f0000000-0000-4000-e700-000000000001';
select test.become('22222222-0000-4000-e700-000000000002');
update public.orders set status = 'en_route' where id = 'f0000000-0000-4000-e700-000000000001';
update public.orders set status = 'arrived' where id = 'f0000000-0000-4000-e700-000000000001';
update public.orders set status = 'in_progress' where id = 'f0000000-0000-4000-e700-000000000001';

select test.assert(
  exists (select 1 from storage.buckets where id = 'completion-media' and public = false),
  'the bucket exists and is private');


-- Upload ---------------------------------------------------------------------
set role authenticated;

select test.become('22222222-0000-4000-e700-000000000002');
insert into storage.objects (bucket_id, name, owner) values
  ('completion-media', 'f0000000-0000-4000-e700-000000000001/before.jpg',
   '22222222-0000-4000-e700-000000000002'),
  ('completion-media', 'f0000000-0000-4000-e700-000000000001/after.jpg',
   '22222222-0000-4000-e700-000000000002');

select test.assert_eq(
  (select count(*)::int from storage.objects where bucket_id = 'completion-media'),
  2, 'the assigned provider uploads while the job is open');

select test.become('33333333-0000-4000-e700-000000000003');
select test.assert_raises(
  $$insert into storage.objects (bucket_id, name)
    values ('completion-media', 'f0000000-0000-4000-e700-000000000001/fake.jpg')$$,
  'another provider cannot upload into a job that is not theirs',
  '42501');

select test.become('11111111-0000-4000-e700-000000000001');
select test.assert_raises(
  $$insert into storage.objects (bucket_id, name)
    values ('completion-media', 'f0000000-0000-4000-e700-000000000001/mine.jpg')$$,
  'the customer cannot supply the provider''s evidence',
  '42501');

reset role;


-- A string is not a photo ----------------------------------------------------
select test.become('22222222-0000-4000-e700-000000000002');

select test.assert_raises(
  $$select public.record_completion_evidence('f0000000-0000-4000-e700-000000000001', 40100,
    '[{"url":"habba://captured/before/1","kind":"before"},
      {"url":"habba://captured/after/2","kind":"after"}]'::jsonb)$$,
  'a placeholder that points at nothing is refused — the bug 0064 closes',
  '22023');

select test.assert_raises(
  $$select public.record_completion_evidence('f0000000-0000-4000-e700-000000000001', 40100,
    '[{"url":"https://example.test/stock-photo.jpg","kind":"before"},
      {"url":"https://example.test/stock-photo.jpg","kind":"after"}]'::jsonb)$$,
  'a link to a photo somewhere else is refused',
  '22023');

select test.assert_raises(
  $$select public.record_completion_evidence('f0000000-0000-4000-e700-000000000001', 40100,
    '[{"url":"storage://completion-media/f0000000-0000-4000-e700-000000000001/before.jpg","kind":"before"},
      {"url":"storage://completion-media/f0000000-0000-4000-e700-000000000001/never-uploaded.jpg","kind":"after"}]'::jsonb)$$,
  'a reference to a file that was never uploaded is refused',
  '22023');

-- A good photo from an earlier job, reused on this one.
insert into storage.objects (bucket_id, name)
values ('completion-media', '99999999-0000-4000-e700-000000000009/after.jpg');
select test.assert_raises(
  $$select public.record_completion_evidence('f0000000-0000-4000-e700-000000000001', 40100,
    '[{"url":"storage://completion-media/f0000000-0000-4000-e700-000000000001/before.jpg","kind":"before"},
      {"url":"storage://completion-media/99999999-0000-4000-e700-000000000009/after.jpg","kind":"after"}]'::jsonb)$$,
  'a photo from another order cannot be recycled onto this one',
  '22023');

select test.assert_raises(
  $$select public.record_completion_evidence('f0000000-0000-4000-e700-000000000001', 40100,
    '[{"url":"storage://completion-media/f0000000-0000-4000-e700-000000000001/before.jpg","kind":"selfie"}]'::jsonb)$$,
  'an unknown kind is refused',
  '22023');

select public.record_completion_evidence('f0000000-0000-4000-e700-000000000001', 40100,
  '[{"url":"storage://completion-media/f0000000-0000-4000-e700-000000000001/before.jpg","kind":"before"},
    {"url":"storage://completion-media/f0000000-0000-4000-e700-000000000001/after.jpg","kind":"after"}]'::jsonb);

select test.assert_eq(
  (select jsonb_array_length(completion_media) from public.orders
   where id = 'f0000000-0000-4000-e700-000000000001'),
  2, 'photos that were actually uploaded are recorded');

update public.orders set status = 'awaiting_approval'
where id = 'f0000000-0000-4000-e700-000000000001';


-- After hand-back, nothing is added -------------------------------------------
set role authenticated;
select test.become('22222222-0000-4000-e700-000000000002');
select test.assert_raises(
  $$insert into storage.objects (bucket_id, name)
    values ('completion-media', 'f0000000-0000-4000-e700-000000000001/late.jpg')$$,
  'no uploads once the customer is reviewing the job',
  '42501');

-- ...and nothing is replaced or removed. No policy means zero rows, silently.
delete from storage.objects where bucket_id = 'completion-media';
update storage.objects set name = 'f0000000-0000-4000-e700-000000000001/swapped.jpg'
where bucket_id = 'completion-media';
reset role;

select test.assert_eq(
  (select count(*)::int from storage.objects
   where bucket_id = 'completion-media'
     and name like 'f0000000-0000-4000-e700-000000000001/%'),
  2, 'the provider can neither delete nor rename a photo once it is up');


-- Who can see them -------------------------------------------------------------
set role authenticated;

select test.become('11111111-0000-4000-e700-000000000001');
select test.assert_eq(
  (select count(*)::int from storage.objects
   where name like 'f0000000-0000-4000-e700-000000000001/%'),
  2, 'the customer sees the photos of their job');

select test.become('22222222-0000-4000-e700-000000000002');
select test.assert_eq(
  (select count(*)::int from storage.objects
   where name like 'f0000000-0000-4000-e700-000000000001/%'),
  2, 'the provider who did the work sees them');

select test.become('33333333-0000-4000-e700-000000000003');
select test.assert_eq(
  (select count(*)::int from storage.objects where bucket_id = 'completion-media'),
  0, 'another provider sees nothing');

select test.become('44444444-0000-4000-e700-000000000004');
select test.assert_eq(
  (select count(*)::int from storage.objects where bucket_id = 'completion-media'),
  0, 'a stranger sees nothing');

reset role;

-- The car changes hands. The buyer inherits the logbook, so the photos its
-- verified entries point at must open for them too.
select public.begin_privileged_write();
update public.vehicles set owner_id = '44444444-0000-4000-e700-000000000004'
where id = 'd0000000-0000-4000-e700-000000000001';
select public.end_privileged_write();

set role authenticated;
select test.become('44444444-0000-4000-e700-000000000004');
select test.assert_eq(
  (select count(*)::int from storage.objects
   where name like 'f0000000-0000-4000-e700-000000000001/%'),
  2, 'the car''s new owner can open the photos in the logbook they inherited');

-- Without being able to read the seller's order (0055).
select test.assert_eq(
  (select count(*)::int from public.orders
   where id = 'f0000000-0000-4000-e700-000000000001'),
  0, 'and still cannot read the seller''s order itself');
reset role;

rollback;

\echo '   completion media storage OK'
