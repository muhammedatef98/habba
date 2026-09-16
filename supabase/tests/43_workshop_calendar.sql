-- 43 — The workshop's own calendar
--
-- Companion to 0072, and to the screen that finally calls `generate_slots`.
--
-- Everything under test here has existed since 0024 and had never been
-- exercised from the provider's side, because no provider surface could reach
-- it. `slot-concurrency-test.sh` has proved since Phase 4 that sixteen
-- customers cannot overbook a capacity-3 slot; nobody had checked that a
-- workshop could create that slot in the first place, or that it was told the
-- truth about how many it had made.
--
-- The four properties that matter to the person holding the phone:
--
--   1. The count is the count. Publishing over a published week creates
--      nothing and says nothing.
--   2. A slot somebody has booked cannot be deleted, quietly or otherwise.
--   3. Blocking is not cancelling — the booking that already exists survives,
--      and the count it holds survives with it.
--   4. Another workshop's calendar is not yours to edit, even though you can
--      read it.

\echo '── workshop calendar'

begin;

select public.test_seed_auth_user('11111111-0000-4000-b000-000000000001', '+966504000001');
select public.test_seed_auth_user('22222222-0000-4000-b000-000000000002', '+966504000002');
select public.test_seed_auth_user('33333333-0000-4000-b000-000000000003', '+966504000003');

insert into public.profiles (id, full_name, phone) values
  ('11111111-0000-4000-b000-000000000001', 'العميل', '+966504000001'),
  ('22222222-0000-4000-b000-000000000002', 'الورشة الأولى', '+966504000002'),
  ('33333333-0000-4000-b000-000000000003', 'الورشة الثانية', '+966504000003');

select test.grant_role('22222222-0000-4000-b000-000000000002', 'workshop_admin');
select test.grant_role('33333333-0000-4000-b000-000000000003', 'workshop_admin');

insert into public.cities (id, name_ar, name_en, region_ar, region_en, centroid) values
  ('c0000000-0000-4000-b000-000000000001', 'الدمام', 'DammamCal', 'الشرقية', 'Eastern',
   extensions.st_point(50.1033, 26.4207)::extensions.geography);

insert into public.vehicle_makes (id, name_ar, name_en) values
  ('a0000000-0000-4000-b000-000000000001', 'ماركة تقويم', 'TestMakeCal');
insert into public.vehicle_models (id, make_id, name_ar, name_en, year_from) values
  ('b0000000-0000-4000-b000-000000000001', 'a0000000-0000-4000-b000-000000000001',
   'موديل تقويم', 'TestModelCal', 2015);
insert into public.vehicles (id, owner_id, make_id, model_id, year, plate_en) values
  ('d0000000-0000-4000-b000-000000000001', '11111111-0000-4000-b000-000000000001',
   'a0000000-0000-4000-b000-000000000001', 'b0000000-0000-4000-b000-000000000001',
   2021, 'ABJ 7070');

insert into public.providers
  (id, owner_profile_id, provider_type, business_name_ar, cr_number,
   verification_status, city_id)
values
  ('e0000000-0000-4000-b000-000000000001', '22222222-0000-4000-b000-000000000002',
   'workshop', 'ورشة التقويم', '1010202020', 'approved',
   'c0000000-0000-4000-b000-000000000001'),
  ('e0000000-0000-4000-b000-000000000002', '33333333-0000-4000-b000-000000000003',
   'workshop', 'ورشة الجيران', '1010303030', 'approved',
   'c0000000-0000-4000-b000-000000000001');

insert into public.workshops (provider_id, address_ar, location, bay_count, opening_hours)
values ('e0000000-0000-4000-b000-000000000001', 'شارع الأمير محمد، الدمام',
        extensions.st_point(50.1040, 26.4210)::extensions.geography, 4,
        '{"sun": [["08:00","20:00"]]}'::jsonb);

select id as svc_oil from public.services where name_en = 'Oil and filter change' \gset

insert into public.provider_services (provider_id, service_id)
values ('e0000000-0000-4000-b000-000000000001', :'svc_oil');


-- 1. The count is the count -----------------------------------------------------
set role authenticated;
select test.become('22222222-0000-4000-b000-000000000002');

-- Tomorrow in Riyadh, so the run never straddles the "not in the past" guard
-- however late in the UTC day CI happens to run.
select ((now() at time zone 'Asia/Riyadh')::date + 1) as tomorrow \gset

-- One day, 08:00–12:00, hourly: four slots.
select public.generate_slots(:'tomorrow', 1, 8, 12, 60, 2) as first_run \gset

select test.assert_eq(:'first_run'::int, 4,
  'a four-hour day at one hour a slot publishes four appointments');

select test.assert_eq(
  (select count(*)::int from public.appointment_slots
    where provider_id = 'e0000000-0000-4000-b000-000000000001'),
  4, 'and four is what is actually in the table');

-- ⚠️ The bug 0072 fixes. Before it, this returned 4 again — the loop counted
-- iterations rather than rows, while `on conflict do nothing` discarded every
-- one of them. A workshop pressing the button twice was told it had eight.
select public.generate_slots(:'tomorrow', 1, 8, 12, 60, 2) as second_run \gset

select test.assert_eq(:'second_run'::int, 0,
  'publishing over a week that is already published creates nothing, and says so');

select test.assert_eq(
  (select count(*)::int from public.appointment_slots
    where provider_id = 'e0000000-0000-4000-b000-000000000001'),
  4, 'the table agrees — no duplicate slot was written');

-- Extending the day adds only the new hours.
select public.generate_slots(:'tomorrow', 1, 8, 14, 60, 2) as extended \gset

select test.assert_eq(:'extended'::int, 2,
  'extending the working day by two hours publishes exactly the two new slots');

-- A slot that would run past closing is not published at all.
-- 08:00–12:00 at 50 minutes fits four (08:00, 08:50, 09:40, 10:30) and the
-- fifth would end at 12:10, after the shutter comes down.
select public.generate_slots(:'tomorrow', 1, 15, 19, 50, 1) as ragged \gset

select test.assert_eq(:'ragged'::int, 4,
  'a slot that would end after closing time is not published');

reset role;


-- The guards on the arguments ---------------------------------------------------
set role authenticated;
select test.become('22222222-0000-4000-b000-000000000002');

select test.assert_raises(
  format($$select public.generate_slots('%s'::date, 1, 8, 12, 60, 1)$$,
         (now() at time zone 'Asia/Riyadh')::date - 1),
  'appointments cannot be published into the past',
  '23514');

select test.assert_raises(
  format($$select public.generate_slots('%s'::date, 1, 18, 9, 60, 1)$$, :'tomorrow'),
  'a working day cannot end before it starts',
  '23514');

select test.assert_raises(
  format($$select public.generate_slots('%s'::date, 1, 8, 12, 0, 1)$$, :'tomorrow'),
  'a zero-minute slot is refused rather than looped over',
  '23514');

select test.assert_raises(
  format($$select public.generate_slots('%s'::date, 1, 8, 12, 60, 0)$$, :'tomorrow'),
  'a slot must hold at least one car',
  '23514');

-- ⚠️ 0024 looped on the extracted hour, which never terminates at hour 24: the
-- slot walks past midnight, the hour wraps to 0, and 0 < 24 forever. 0072
-- compares timestamps instead, so a round-the-clock workshop terminates.
-- A clear day, so nothing already published can absorb one of the eight and
-- turn a termination test into an arithmetic one.
select ((now() at time zone 'Asia/Riyadh')::date + 9) as clear_day \gset

select public.generate_slots(:'clear_day', 1, 0, 24, 180, 1) as all_day \gset

select test.assert_eq(:'all_day'::int, 8,
  'a workshop open around the clock gets eight three-hour slots, and returns');

-- Publishing a day that is already under way -------------------------------------
-- `book_appointment` requires `starts_at > now()`, so this morning's slots are
-- unbookable the moment they are written. Asserted as a property rather than a
-- count, because the count depends on what time CI happens to run.
select ((now() at time zone 'Asia/Riyadh')::date) as today \gset

select public.generate_slots(:'today', 1, 0, 24, 15, 1);

select test.assert_eq(
  (select count(*)::int from public.appointment_slots
    where provider_id = 'e0000000-0000-4000-b000-000000000001'
      and starts_at <= now()),
  0, 'publishing a day already under way skips the hours that have gone');

reset role;


-- A customer cannot publish a workshop's availability ----------------------------
set role authenticated;
select test.become('11111111-0000-4000-b000-000000000001');

select test.assert_raises(
  format($$select public.generate_slots('%s'::date, 1, 8, 12, 60, 1)$$, :'tomorrow'),
  'a customer is not a provider and publishes nothing',
  '42501');

reset role;


-- 2 and 3. A booked slot survives both the delete and the block -------------------
set role authenticated;
select test.become('11111111-0000-4000-b000-000000000001');

select id as booked_slot from public.appointment_slots
 where provider_id = 'e0000000-0000-4000-b000-000000000001'
 order by starts_at limit 1 \gset

select public.book_appointment(
  :'booked_slot', :'svc_oil',
  'd0000000-0000-4000-b000-000000000001', 'تغيير زيت', 60000) as booking \gset

select test.assert_eq(
  (select booked_count from public.appointment_slots where id = :'booked_slot'),
  1, 'the customer holds one place in the slot');

-- The workshop now tries to tidy its calendar.
select test.become('22222222-0000-4000-b000-000000000002');

select test.assert_raises(
  format($$delete from public.appointment_slots where id = '%s'$$, :'booked_slot'),
  'a slot somebody is driving to cannot be deleted',
  '23503');

select test.assert_eq(
  (select count(*)::int from public.appointment_slots where id = :'booked_slot'),
  1, 'and it is still there afterwards');

-- Blocking is the supported way to stop taking NEW bookings. It must not
-- disturb the one already taken — the screen promises exactly this, and a
-- workshop closing early would otherwise silently cancel on somebody.
update public.appointment_slots set is_blocked = true where id = :'booked_slot';

select test.assert_eq(
  (select booked_count from public.appointment_slots where id = :'booked_slot'),
  1, 'blocking a slot leaves the existing booking, and its place, standing');

select test.assert(
  (select status from public.orders where id = :'booking') <> 'cancelled',
  'the customer''s appointment is untouched by the block');

reset role;

-- And a blocked slot takes no further bookings.
set role authenticated;
select test.become('11111111-0000-4000-b000-000000000001');

select test.assert_raises(
  format($$select public.book_appointment('%s', '%s',
            'd0000000-0000-4000-b000-000000000001', 'محاولة ثانية', 60100)$$,
         :'booked_slot', :'svc_oil'),
  'a blocked slot is closed to new bookings',
  '55P03');

reset role;


-- An empty slot deletes cleanly ---------------------------------------------------
set role authenticated;
select test.become('22222222-0000-4000-b000-000000000002');

select id as free_slot from public.appointment_slots
 where provider_id = 'e0000000-0000-4000-b000-000000000001'
   and booked_count = 0
 order by starts_at desc limit 1 \gset

delete from public.appointment_slots where id = :'free_slot';

select test.assert_eq(
  (select count(*)::int from public.appointment_slots where id = :'free_slot'),
  0, 'a slot nobody booked is the workshop''s to remove');

reset role;


-- 4. The neighbour's calendar is readable, not writable ----------------------------
-- `appointment_slots_read` is `using (true)` on purpose: a customer comparing
-- workshops has to see everybody's availability. The write policy is what keeps
-- that from being an invitation.
set role authenticated;
select test.become('33333333-0000-4000-b000-000000000003');

select test.assert(
  (select count(*) from public.appointment_slots
    where provider_id = 'e0000000-0000-4000-b000-000000000001') > 0,
  'a workshop can see a competitor''s published availability');

update public.appointment_slots set is_blocked = true
 where provider_id = 'e0000000-0000-4000-b000-000000000001';

select test.assert_eq(
  (select count(*)::int from public.appointment_slots
    where provider_id = 'e0000000-0000-4000-b000-000000000001'
      and is_blocked and booked_count = 0),
  0, 'but blocking a competitor out of its own diary writes nothing');

delete from public.appointment_slots
 where provider_id = 'e0000000-0000-4000-b000-000000000001';

select test.assert(
  (select count(*) from public.appointment_slots
    where provider_id = 'e0000000-0000-4000-b000-000000000001') > 0,
  'and neither does deleting it');

-- `generate_slots` uses current_provider_id() rather than an argument, so
-- there is no provider to pass and nothing to spoof: the neighbour publishing
-- fills its OWN calendar.
select public.generate_slots(:'tomorrow', 1, 8, 9, 60, 1) as neighbour_run \gset

select test.assert_eq(
  (select count(*)::int from public.appointment_slots
    where provider_id = 'e0000000-0000-4000-b000-000000000002'),
  1, 'a workshop publishing fills its own calendar and only its own');

reset role;

rollback;
