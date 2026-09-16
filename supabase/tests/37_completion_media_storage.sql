-- 37 — Completion evidence storage
--
-- Companion to 0064. These photos are the moat's load-bearing artefact: they
-- become timeline attachments under the hash chain, and §1's claim that a
-- documented car sells for more rests on them being real and unalterable.
--
-- So the assertions that matter are about who cannot write them, and about the
-- fact that nobody — including the technician who took them — can go back and
-- change one afterwards.

\echo '── completion media storage'

begin;

-- Seeded through the shim's GoTrue stand-in rather than a bare INSERT: that
-- leaves `phone_confirmed_at` null, so `phone_verified` is false (0044) and
-- `accept_ownership_transfer` refuses — silently, because since 0056 it returns
-- NULL for every refusal rather than raising. A fixture that got this wrong
-- would show the transfer "succeeding" and the ownership never moving, which is
-- exactly how the first version of this suite failed.
select public.test_seed_auth_user('11111111-0000-4000-e000-000000000001', '+966507000001');  -- owner at the time
select public.test_seed_auth_user('22222222-0000-4000-e000-000000000002', '+966507000002');  -- assigned tech
select public.test_seed_auth_user('33333333-0000-4000-e000-000000000003', '+966507000003');  -- another tech
select public.test_seed_auth_user('44444444-0000-4000-e000-000000000004', '+966507000004');  -- the buyer, later

insert into public.profiles (id, full_name, phone) values
  ('11111111-0000-4000-e000-000000000001', 'المالك', '+966507000001'),
  ('22222222-0000-4000-e000-000000000002', 'الفنّي', '+966507000002'),
  ('33333333-0000-4000-e000-000000000003', 'فنّي آخر', '+966507000003'),
  ('44444444-0000-4000-e000-000000000004', 'المشتري', '+966507000004');

select test.grant_role('22222222-0000-4000-e000-000000000002', 'technician');
select test.grant_role('33333333-0000-4000-e000-000000000003', 'technician');

insert into public.cities (id, name_ar, name_en, region_ar, region_en, centroid) values
  ('c0000000-0000-4000-e000-000000000001', 'الخبر', 'KhobarMedia', 'الشرقية', 'Eastern',
   extensions.st_point(50.2083, 26.2794)::extensions.geography);

insert into public.vehicle_makes (id, name_ar, name_en) values
  ('a0000000-0000-4000-e000-000000000001', 'ماركة أدلة', 'TestMakeMedia');
insert into public.vehicle_models (id, make_id, name_ar, name_en, year_from) values
  ('b0000000-0000-4000-e000-000000000001', 'a0000000-0000-4000-e000-000000000001',
   'موديل أدلة', 'TestModelMedia', 2015);
insert into public.vehicles (id, owner_id, make_id, model_id, year, plate_en, current_mileage) values
  ('d0000000-0000-4000-e000-000000000001', '11111111-0000-4000-e000-000000000001',
   'a0000000-0000-4000-e000-000000000001', 'b0000000-0000-4000-e000-000000000001',
   2020, 'ABJ 7777', 60000);

insert into public.providers
  (id, owner_profile_id, provider_type, business_name_ar, verification_status, is_online, city_id)
values
  ('e0000000-0000-4000-e000-000000000001', '22222222-0000-4000-e000-000000000002',
   'individual', 'فنّي الأدلة', 'approved', true, 'c0000000-0000-4000-e000-000000000001'),
  ('e0000000-0000-4000-e000-000000000002', '33333333-0000-4000-e000-000000000003',
   'individual', 'فنّي آخر', 'approved', true, 'c0000000-0000-4000-e000-000000000001');

select id as svc_battery from public.services where name_en = 'Battery jump or replacement' \gset

insert into public.provider_services (provider_id, service_id) values
  ('e0000000-0000-4000-e000-000000000001', :'svc_battery');

select test.assert(
  exists (select 1 from storage.buckets where id = 'completion-media' and public = false),
  'the bucket exists and is private — evidence is not a guessable URL away from anyone');


-- Drive a job to in_progress -------------------------------------------------
select test.become('11111111-0000-4000-e000-000000000001');

insert into public.orders
  (id, customer_id, vehicle_id, service_id, fulfilment_mode, service_location,
   provider_id, quoted_amount, created_by)
values
  ('f0000000-0000-4000-e000-000000000001',
   '11111111-0000-4000-e000-000000000001', 'd0000000-0000-4000-e000-000000000001',
   :'svc_battery', 'mobile_ondemand',
   extensions.st_point(50.21, 26.28)::extensions.geography,
   'e0000000-0000-4000-e000-000000000001', 120, '11111111-0000-4000-e000-000000000001');

update public.orders set status = 'searching' where id = 'f0000000-0000-4000-e000-000000000001';
update public.orders set status = 'quoted' where id = 'f0000000-0000-4000-e000-000000000001';
select public.authorise_order_payment('f0000000-0000-4000-e000-000000000001', 'media_1');
-- 0074: the provider accepts, not the customer. Before it, this fixture
-- was modelling a transition a real workshop could not have produced.
select test.become('22222222-0000-4000-e000-000000000002');
update public.orders set status = 'accepted' where id = 'f0000000-0000-4000-e000-000000000001';
select test.become('11111111-0000-4000-e000-000000000001');
update public.orders set status = 'en_route' where id = 'f0000000-0000-4000-e000-000000000001';
update public.orders set status = 'arrived' where id = 'f0000000-0000-4000-e000-000000000001';
update public.orders set status = 'in_progress' where id = 'f0000000-0000-4000-e000-000000000001';

reset role;


-- Who may upload -------------------------------------------------------------
set role authenticated;

-- ⚠️ The customer, not the provider. 0033 already refuses them the evidence
-- COLUMNS; this is the same rule one layer down, on the bytes.
select test.become('11111111-0000-4000-e000-000000000001');
select test.assert_raises(
  $$insert into storage.objects (bucket_id, name)
    values ('completion-media', 'f0000000-0000-4000-e000-000000000001/before.jpg')$$,
  'the customer cannot upload their own before/after photos',
  '42501');

select test.become('33333333-0000-4000-e000-000000000003');
select test.assert_raises(
  $$insert into storage.objects (bucket_id, name)
    values ('completion-media', 'f0000000-0000-4000-e000-000000000001/before.jpg')$$,
  'an unassigned technician cannot upload against someone else''s job',
  '42501');

select test.become('22222222-0000-4000-e000-000000000002');

insert into storage.objects (bucket_id, name, owner)
values ('completion-media', 'f0000000-0000-4000-e000-000000000001/before.jpg',
        '22222222-0000-4000-e000-000000000002'),
       ('completion-media', 'f0000000-0000-4000-e000-000000000001/after.jpg',
        '22222222-0000-4000-e000-000000000002');

select test.assert_eq(
  (select count(*)::int from storage.objects where bucket_id = 'completion-media'),
  2,
  'the assigned provider uploads before and after');

-- The assertion the path convention exists for.
select test.assert_raises(
  $$insert into storage.objects (bucket_id, name)
    values ('completion-media', '99999999-0000-4000-e000-000000000009/before.jpg')$$,
  'a provider cannot upload into an order that does not exist',
  '42501');

reset role;


-- Who may look ---------------------------------------------------------------
set role authenticated;

select test.become('11111111-0000-4000-e000-000000000001');
select test.assert_eq(
  (select count(*)::int from storage.objects where bucket_id = 'completion-media'),
  2,
  'the owner of the car sees the evidence — it is their logbook');

select test.become('33333333-0000-4000-e000-000000000003');
select test.assert_eq(
  (select count(*)::int from storage.objects where bucket_id = 'completion-media'),
  0,
  'a technician on no order of this car''s sees nothing');

reset role;


-- The record cannot be rewritten ---------------------------------------------
-- ⚠️ These do NOT raise: with RLS on and no permissive policy for the command,
-- Postgres matches zero rows rather than refusing. The row is what to assert
-- on — the same trap 24_triage_media_storage.sql documents.
set role authenticated;
select test.become('22222222-0000-4000-e000-000000000002');

update storage.objects set name = 'f0000000-0000-4000-e000-000000000001/swapped.jpg'
 where bucket_id = 'completion-media' and name like '%/before.jpg';

select test.assert_eq(
  (select count(*)::int from storage.objects
    where name = 'f0000000-0000-4000-e000-000000000001/before.jpg'),
  1,
  'the technician who took the photo cannot swap it afterwards — the chain would still verify');

delete from storage.objects where bucket_id = 'completion-media';

select test.assert_eq(
  (select count(*)::int from storage.objects where bucket_id = 'completion-media'),
  2,
  'and nobody can delete one: no delete policy, by design');

reset role;


-- The logbook follows the car ------------------------------------------------
-- §1.3: the buyer inherits the logbook, and that is how they become a customer
-- at zero CAC. A logbook whose every photo 403s is not the thing that sells the
-- car, so the read policy authorises on owns_vehicle rather than on who placed
-- the order.
--
-- Through the real نقل الملكية flow, not an UPDATE: `guard_vehicle_columns`
-- refuses a direct `owner_id` write ("Ownership changes through a transfer, not
-- directly"), and a test that bypassed the guard would prove the photos follow
-- a transfer that cannot actually happen.
set role authenticated;
select test.become('11111111-0000-4000-e000-000000000001');
select transfer_id as tid, code as otp
from public.initiate_ownership_transfer(
  'd0000000-0000-4000-e000-000000000001', '+966507000004', null) \gset
reset role;

set role authenticated;
select test.become('44444444-0000-4000-e000-000000000004');
-- Asserted, not just called. Since 0056 every refusal returns NULL rather than
-- raising, so an unchecked call would let a transfer that never happened look
-- like one that did — and the assertions below would then be testing nothing.
select test.assert(
  public.accept_ownership_transfer((:'tid')::uuid, :'otp') is not null,
  'the buyer accepts the handover');
reset role;

set role authenticated;

select test.become('44444444-0000-4000-e000-000000000004');
select test.assert_eq(
  (select count(*)::int from storage.objects where bucket_id = 'completion-media'),
  2,
  'the new owner inherits the photos along with the car');

select test.become('11111111-0000-4000-e000-000000000001');
select test.assert_eq(
  (select count(*)::int from storage.objects where bucket_id = 'completion-media'),
  0,
  'and the seller loses them, exactly as they lose the timeline');

reset role;


-- Uploads stop when the job leaves the evidence window ------------------------
-- The status list here is the one record_completion_evidence (0032) accepts. If
-- the two drift, the bucket takes a file the row referencing it cannot be
-- written for.
-- Through the RPC, as the provider. `guard_order_columns` (0033) refuses anyone
-- else the evidence columns outright, so a direct UPDATE here would fail — and
-- the hand-back below needs real evidence on the row, because
-- `assert_completion_evidence` refuses the transition without it.
set role authenticated;
select test.become('22222222-0000-4000-e000-000000000002');

select public.record_completion_evidence(
  'f0000000-0000-4000-e000-000000000001', 61000,
  '[{"url":"x/before.jpg","kind":"before"},{"url":"x/after.jpg","kind":"after"}]'::jsonb);

update public.orders set status = 'awaiting_approval'
 where id = 'f0000000-0000-4000-e000-000000000001';

select test.assert_raises(
  $$insert into storage.objects (bucket_id, name)
    values ('completion-media', 'f0000000-0000-4000-e000-000000000001/late.jpg')$$,
  'no new photo appears once the job is with the customer — the record is closed',
  '42501');

reset role;

rollback;
