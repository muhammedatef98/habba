-- 08 — Scheduling, workshop check-in, and warranty
--
-- Phase 4 acceptance has two halves. The double-booking half needs genuinely
-- concurrent sessions and lives in supabase/scripts/slot-concurrency-test.sh;
-- this suite covers everything a single session can prove, plus the warranty
-- routing half in full.

\echo '── scheduling and warranty'

begin;

insert into auth.users (id, phone) values
  ('11111111-0000-4000-a000-000000000001', '+966503000001'),
  ('22222222-0000-4000-a000-000000000002', '+966503000002');

insert into public.profiles (id, full_name, phone, role) values
  ('11111111-0000-4000-a000-000000000001', 'العميل', '+966503000001', 'customer'),
  ('22222222-0000-4000-a000-000000000002', 'الورشة', '+966503000002', 'workshop_admin');

insert into public.cities (id, name_ar, name_en, region_ar, region_en, centroid) values
  ('c0000000-0000-4000-a000-000000000001', 'الرياض', 'RiyadhSched', 'منطقة الرياض',
   'Riyadh Region', extensions.st_point(46.6753, 24.7136)::extensions.geography);

insert into public.vehicle_makes (id, name_ar, name_en) values
  ('a0000000-0000-4000-a000-000000000001', 'ماركة اختبار', 'TestMakeSched');
insert into public.vehicle_models (id, make_id, name_ar, name_en, year_from) values
  ('b0000000-0000-4000-a000-000000000001', 'a0000000-0000-4000-a000-000000000001',
   'موديل اختبار', 'TestModelSched', 2015);
insert into public.vehicles (id, owner_id, make_id, model_id, year, plate_en) values
  ('d0000000-0000-4000-a000-000000000001', '11111111-0000-4000-a000-000000000001',
   'a0000000-0000-4000-a000-000000000001', 'b0000000-0000-4000-a000-000000000001',
   2020, 'ABJ 5555');

insert into public.providers
  (id, owner_profile_id, provider_type, business_name_ar, cr_number,
   verification_status, city_id)
values
  ('e0000000-0000-4000-a000-000000000001', '22222222-0000-4000-a000-000000000002',
   'workshop', 'ورشة الاختبار', '1010101010', 'approved',
   'c0000000-0000-4000-a000-000000000001');

insert into public.workshops (provider_id, address_ar, location, bay_count, opening_hours)
values ('e0000000-0000-4000-a000-000000000001', 'طريق الملك فهد، الرياض',
        extensions.st_point(46.6760, 24.7140)::extensions.geography, 3,
        '{"sun": [["08:00","20:00"]]}'::jsonb);

select id as svc_oil from public.services where name_en = 'Oil and filter change' \gset

insert into public.provider_services (provider_id, service_id)
values ('e0000000-0000-4000-a000-000000000001', :'svc_oil');

insert into public.appointment_slots (id, provider_id, starts_at, ends_at, capacity)
values ('50000000-0000-4000-a000-000000000001',
        'e0000000-0000-4000-a000-000000000001',
        now() + interval '2 days', now() + interval '2 days 1 hour', 2);


-- Booking ---------------------------------------------------------------------
select test.become('11111111-0000-4000-a000-000000000001');

select public.book_appointment(
  '50000000-0000-4000-a000-000000000001', :'svc_oil',
  'd0000000-0000-4000-a000-000000000001', 'صوت من المحرك', 90000) as order1 \gset

select test.assert_eq(
  (select booked_count from public.appointment_slots
   where id = '50000000-0000-4000-a000-000000000001'),
  1, 'booking claims one unit of the slot capacity');

select test.assert_eq(
  (select fulfilment_mode from public.orders where id = :'order1'),
  'workshop'::fulfilment_mode,
  'a provider with a fixed location books as a workshop order');

select test.assert_eq(
  (select workshop_id from public.orders where id = :'order1'),
  'e0000000-0000-4000-a000-000000000001'::uuid,
  'the workshop order is located at the workshop');


-- Capacity is respected ---------------------------------------------------------
select public.book_appointment(
  '50000000-0000-4000-a000-000000000001', :'svc_oil',
  'd0000000-0000-4000-a000-000000000001', 'حجز ثانٍ', 90000);

select test.assert_eq(
  (select booked_count from public.appointment_slots
   where id = '50000000-0000-4000-a000-000000000001'),
  2, 'the slot is now at capacity');

select test.assert_raises(
  format($$select public.book_appointment(
    '50000000-0000-4000-a000-000000000001', '%s',
    'd0000000-0000-4000-a000-000000000001', 'حجز ثالث', 90000)$$, :'svc_oil'),
  'a slot at capacity cannot be booked again',
  '55P03');


-- Blocked and past slots ---------------------------------------------------------
insert into public.appointment_slots (id, provider_id, starts_at, ends_at, capacity, is_blocked)
values ('50000000-0000-4000-a000-000000000002',
        'e0000000-0000-4000-a000-000000000001',
        now() + interval '3 days', now() + interval '3 days 1 hour', 5, true);

select test.assert_raises(
  format($$select public.book_appointment(
    '50000000-0000-4000-a000-000000000002', '%s',
    'd0000000-0000-4000-a000-000000000001', 'محجوب', 90000)$$, :'svc_oil'),
  'a blocked slot cannot be booked',
  '55P03');

insert into public.appointment_slots (id, provider_id, starts_at, ends_at, capacity)
values ('50000000-0000-4000-a000-000000000003',
        'e0000000-0000-4000-a000-000000000001',
        now() - interval '2 days', now() - interval '2 days' + interval '1 hour', 5);

select test.assert_raises(
  format($$select public.book_appointment(
    '50000000-0000-4000-a000-000000000003', '%s',
    'd0000000-0000-4000-a000-000000000001', 'ماضٍ', 90000)$$, :'svc_oil'),
  'a slot in the past cannot be booked',
  '55P03');


-- Cancelling returns the capacity -------------------------------------------------
update public.orders set status = 'cancelled', cancellation_reason = 'تغيّرت الخطة'
where id = :'order1';

select test.assert_eq(
  (select booked_count from public.appointment_slots
   where id = '50000000-0000-4000-a000-000000000001'),
  1, 'cancelling a booking returns its capacity to the slot');

-- And the freed capacity is genuinely reusable — a workshop must not silently
-- lose a bay every time a customer changes their mind.
select public.book_appointment(
  '50000000-0000-4000-a000-000000000001', :'svc_oil',
  'd0000000-0000-4000-a000-000000000001', 'حجز بديل', 90000) as order3 \gset

select test.assert_eq(
  (select booked_count from public.appointment_slots
   where id = '50000000-0000-4000-a000-000000000001'),
  2, 'the freed capacity can be rebooked');


-- Workshop flow: check-in replaces en_route/arrived ---------------------------------
update public.orders set status = 'quoted', quoted_amount = 180 where id = :'order3';
update public.orders
set status = 'accepted', escrow_status = 'authorised', payment_intent_id = 'test_sched_001'
where id = :'order3';

select test.assert_raises(
  format($$update public.orders set status = 'en_route' where id = '%s'$$, :'order3'),
  'a workshop order cannot go en_route — there is no drive',
  '23514');

select public.check_in_vehicle(:'order3');

select test.assert_eq(
  (select status from public.orders where id = :'order3'),
  'checked_in'::order_status,
  'the vehicle is checked in at the workshop');

update public.orders set status = 'in_progress' where id = :'order3';
update public.orders
set completion_mileage = 90500, completion_media = '[{"url":"https://example.test/b.jpg","kind":"before"},{"url":"https://example.test/a.jpg","kind":"after"}]'::jsonb
where id = :'order3';
update public.orders
set status = 'awaiting_approval', labour_amount = 180, vat_amount = 27, total_amount = 207
where id = :'order3';
update public.orders set status = 'completed', warranty_days = 30 where id = :'order3';

select test.assert_eq(
  (select count(*)::int from public.vehicle_timeline where order_id = :'order3'),
  1, 'a completed workshop job writes to the logbook like any other');


-- Warranty -------------------------------------------------------------------------
select test.assert_eq(
  (select count(*)::int from public.active_warranties where order_id = :'order3'),
  1, 'the completed job appears as an active warranty');

-- Expiry is checked BEFORE any claim exists. Tested the other way round, the
-- "a claim is already open" guard fires first and this branch is never
-- actually exercised — a test that passes without testing anything.
update public.orders set warranty_expires_at = now() - interval '1 day' where id = :'order3';

select test.assert_raises(
  format($$select public.claim_warranty('%s', 'متأخر')$$, :'order3'),
  'a warranty claim after the window is refused',
  '23514');

select test.assert_eq(
  (select count(*)::int from public.active_warranties where order_id = :'order3'),
  0, 'an expired warranty drops out of the active list');

update public.orders set warranty_expires_at = now() + interval '25 days' where id = :'order3';

select public.claim_warranty(:'order3', 'نفس الصوت رجع بعد أسبوع') as claim \gset

select test.assert_eq(
  (select parent_order_id from public.orders where id = :'claim'),
  (:'order3')::uuid,
  'the claim is linked to the original job');

-- The whole point of the feature.
select test.assert_eq(
  (select provider_id from public.orders where id = :'claim'),
  'e0000000-0000-4000-a000-000000000001'::uuid,
  'the claim is auto-routed back to the ORIGINAL provider');

select test.assert_eq(
  (select total_amount from public.orders where id = :'claim'),
  0::numeric, 'the re-service is free');

select test.assert_eq(
  (select escrow_status from public.orders where id = :'claim'),
  'none'::escrow_status, 'a free re-service holds no money');

-- A free order must be acceptable without an authorisation, or the whole
-- feature is unusable.
update public.orders set status = 'quoted' where id = :'claim';
update public.orders set status = 'accepted' where id = :'claim';

select test.assert_eq(
  (select status from public.orders where id = :'claim'),
  'accepted'::order_status,
  'a zero-amount warranty order is accepted without a payment authorisation');

-- One live claim per job.
select test.assert_raises(
  format($$select public.claim_warranty('%s', 'مطالبة ثانية')$$, :'order3'),
  'a second warranty claim cannot be opened while one is live',
  '23505');


-- The re-service is recorded AS a warranty re-service --------------------------------
select public.check_in_vehicle(:'claim');
update public.orders set status = 'in_progress' where id = :'claim';
-- A free warranty re-service is exempt from nothing: it is still work on the
-- car and still belongs in the logbook with evidence.
update public.orders
set completion_mileage = 90800, completion_media = '[{"url":"https://example.test/b.jpg","kind":"before"},{"url":"https://example.test/a.jpg","kind":"after"}]'::jsonb
where id = :'claim';
update public.orders set status = 'awaiting_approval' where id = :'claim';
update public.orders set status = 'completed' where id = :'claim';

select test.assert_eq(
  (select event_type from public.vehicle_timeline where order_id = :'claim'),
  'warranty_claimed'::public.timeline_event_type,
  'the logbook records it as a warranty claim, not an ordinary service');

-- A buyer reading the resale report should see that a repair had to be redone.
-- Filing it as a normal service would hide a real signal.
select test.assert(
  (select (details ->> 'is_warranty_reservice')::boolean
   from public.vehicle_timeline where order_id = :'claim'),
  'the timeline entry is flagged as a warranty re-service');

select test.assert(
  (select is_valid from public.verify_vehicle_timeline('d0000000-0000-4000-a000-000000000001')),
  'the hash chain still verifies across scheduled, workshop and warranty entries');


-- A job that carried no warranty cannot be claimed against -----------------------------
-- The re-service itself was created with no warranty_days, so it is the
-- natural fixture for this branch.
select test.assert_raises(
  format($$select public.claim_warranty('%s', 'مطالبة على إعادة الخدمة')$$, :'claim'),
  'a job that carried no warranty cannot be claimed against',
  '23514');

rollback;

\echo '   scheduling and warranty OK'
