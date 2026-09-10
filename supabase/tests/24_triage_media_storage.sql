-- 24 — Triage clip storage
--
-- Companion to 0048. A triage clip is video of someone's car, often their
-- driveway, sometimes them, captured at a moment of stress. The assertions
-- that matter are about who cannot see it.

\echo '── triage media storage'

begin;

insert into auth.users (id, phone) values
  ('11111111-0000-4000-b000-000000000001', '+966503000001'),  -- customer
  ('22222222-0000-4000-b000-000000000002', '+966503000002'),  -- assigned tech
  ('33333333-0000-4000-b000-000000000003', '+966503000003');  -- another tech

insert into public.profiles (id, full_name, phone) values
  ('11111111-0000-4000-b000-000000000001', 'العميل', '+966503000001'),
  ('22222222-0000-4000-b000-000000000002', 'الفنّي', '+966503000002'),
  ('33333333-0000-4000-b000-000000000003', 'فنّي آخر', '+966503000003');

insert into public.cities (id, name_ar, name_en, region_ar, region_en, centroid) values
  ('c0000000-0000-4000-b000-000000000001', 'جدة', 'JeddahTriage', 'مكة', 'Makkah',
   extensions.st_point(39.1925, 21.4858)::extensions.geography);

insert into public.providers
  (id, owner_profile_id, provider_type, business_name_ar, verification_status,
   is_online, city_id, acceptance_rate)
values
  ('e0000000-0000-4000-b000-000000000001', '22222222-0000-4000-b000-000000000002',
   'individual', 'ونش', 'approved', true, 'c0000000-0000-4000-b000-000000000001', 90),
  ('e0000000-0000-4000-b000-000000000002', '33333333-0000-4000-b000-000000000003',
   'individual', 'ونش ثاني', 'approved', true, 'c0000000-0000-4000-b000-000000000001', 90);

select id as svc_tow from public.services where name_en = 'Towing' \gset

select test.become('11111111-0000-4000-b000-000000000001');

insert into public.orders
  (id, customer_id, service_id, fulfilment_mode, service_location, quoted_amount, created_by)
values
  ('f0000000-0000-4000-b000-000000000001',
   '11111111-0000-4000-b000-000000000001', :'svc_tow', 'mobile_ondemand',
   extensions.st_point(39.1925, 21.4858)::extensions.geography, 170.00,
   '11111111-0000-4000-b000-000000000001');

select test.assert(
  exists (select 1 from storage.buckets where id = 'triage-media' and public = false),
  'the bucket exists and is private — a clip is not a public URL away from anyone');


-- Upload -------------------------------------------------------------------
set role authenticated;
select test.become('11111111-0000-4000-b000-000000000001');

insert into storage.objects (bucket_id, name, owner)
values ('triage-media', 'f0000000-0000-4000-b000-000000000001/clip.mp4',
        '11111111-0000-4000-b000-000000000001');

select test.assert_eq(
  (select count(*)::int from storage.objects where bucket_id = 'triage-media'),
  1,
  'the customer can upload against their own order');

-- ⚠️ The assertion the path convention exists for.
select test.assert_raises(
  $$insert into storage.objects (bucket_id, name)
    values ('triage-media', '99999999-0000-4000-b000-000000000009/clip.mp4')$$,
  'a customer cannot upload into an order that is not theirs',
  '42501');

reset role;


-- Who can watch it ----------------------------------------------------------
set role authenticated;

select test.become('22222222-0000-4000-b000-000000000002');
select test.assert_eq(
  (select count(*)::int from storage.objects where bucket_id = 'triage-media'),
  0,
  'an unassigned provider sees nothing, even one who was offered the job');

reset role;
update public.orders set provider_id = 'e0000000-0000-4000-b000-000000000001'
 where id = 'f0000000-0000-4000-b000-000000000001';

set role authenticated;
select test.become('22222222-0000-4000-b000-000000000002');
select test.assert_eq(
  (select count(*)::int from storage.objects where bucket_id = 'triage-media'),
  1,
  'the ASSIGNED provider can watch it — that is the whole point of the feature');

-- A different technician, on no order of this customer's.
select test.become('33333333-0000-4000-b000-000000000003');
select test.assert_eq(
  (select count(*)::int from storage.objects where bucket_id = 'triage-media'),
  0,
  'another provider cannot watch a clip from someone else''s job');

reset role;


-- The record cannot be quietly rewritten ------------------------------------
set role authenticated;
select test.become('11111111-0000-4000-b000-000000000001');

-- ⚠️ These do NOT raise. With RLS on and no permissive policy for the command,
-- Postgres matches zero rows rather than refusing — the statement "succeeds"
-- and changes nothing. Asserting on an exception here passed for the wrong
-- reason once and then failed honestly; what has to be checked is the row.
update storage.objects set name = 'f0000000-0000-4000-b000-000000000001/other.mp4'
 where bucket_id = 'triage-media';

select test.assert_eq(
  (select count(*)::int from storage.objects
    where name = 'f0000000-0000-4000-b000-000000000001/clip.mp4'),
  1,
  'a rename changes nothing — there is no update policy, by design');

delete from storage.objects where bucket_id = 'triage-media';

select test.assert_eq(
  (select count(*)::int from storage.objects where bucket_id = 'triage-media'),
  1,
  'and a delete removes nothing: no delete policy either');

reset role;


-- Uploads stop when the order closes ----------------------------------------
update public.orders set status = 'searching'
 where id = 'f0000000-0000-4000-b000-000000000001';
update public.orders set status = 'cancelled'
 where id = 'f0000000-0000-4000-b000-000000000001';

set role authenticated;
select test.become('11111111-0000-4000-b000-000000000001');

select test.assert_raises(
  $$insert into storage.objects (bucket_id, name)
    values ('triage-media', 'f0000000-0000-4000-b000-000000000001/late.mp4')$$,
  'no new clip can appear against a closed order — the record is not editable after the fact',
  '42501');

reset role;

rollback;
