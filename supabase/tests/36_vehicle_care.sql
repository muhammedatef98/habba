-- 36 — The vehicle care section (0058–0062, ADR-0022)
--
-- Five migrations, and the assertions that matter are the ones about what the
-- section is NOT allowed to do:
--
--   * a reading may never go backwards inside a series (§2), because one that
--     does poisons every prediction for the life of the car;
--   * a replacement series may, and the two reasons compute a different
--     lifetime distance (§3), which is the whole point of recording the reason;
--   * one notification per vehicle per day, whatever is due (§8);
--   * a snoozed item is silent, and an item already sent stays silent for the
--     repeat window (§9);
--   * odometer history, the schedule and the documents follow the car through a
--     handover — and neither the reminder history nor the seller's snooze does
--     (§11);
--   * `vehicles.current_mileage` is the series head and nothing else, for every
--     vehicle in the database (§13).

\echo '── vehicle care'

begin;

select public.test_seed_auth_user('cc111111-0000-4000-c000-000000000001', '+966505300001');
select public.test_seed_auth_user('cc111111-0000-4000-c000-000000000002', '+966505300002');
select public.test_seed_auth_user('cc111111-0000-4000-c000-000000000003', '+966505300003');
select public.test_seed_auth_user('cc111111-0000-4000-c000-000000000004', '+966505300004');

insert into public.profiles (id, full_name, phone) values
  ('cc111111-0000-4000-c000-000000000001', 'المالك', '+966505300001'),
  ('cc111111-0000-4000-c000-000000000002', 'المشتري', '+966505300002'),
  ('cc111111-0000-4000-c000-000000000003', 'صاحب الورشة', '+966505300003'),
  ('cc111111-0000-4000-c000-000000000004', 'غريب', '+966505300004');

select test.grant_role('cc111111-0000-4000-c000-000000000003', 'workshop_admin');

insert into public.cities (id, name_ar, name_en, region_ar, region_en, centroid) values
  ('cc000000-0000-4000-c000-00000000000c', 'الخبر', 'KhobarCare', 'المنطقة الشرقية',
   'Eastern Province', extensions.st_point(50.2083, 26.2794)::extensions.geography);

insert into public.vehicle_makes (id, name_ar, name_en) values
  ('cc000000-0000-4000-c000-000000000001', 'ماركة العناية', 'TestMakeCare');
insert into public.vehicle_models (id, make_id, name_ar, name_en, year_from) values
  ('cc000000-0000-4000-c000-000000000002', 'cc000000-0000-4000-c000-000000000001',
   'موديل العناية', 'TestModelCare', 2015);

-- Two cars. The second one never moves, which is the only way to prove the
-- month axis fires on its own (§6).
insert into public.vehicles (id, owner_id, make_id, model_id, year, plate_en) values
  ('cc000000-0000-4000-c000-0000000000a1', 'cc111111-0000-4000-c000-000000000001',
   'cc000000-0000-4000-c000-000000000001', 'cc000000-0000-4000-c000-000000000002',
   2020, 'ABJ 7001'),
  ('cc000000-0000-4000-c000-0000000000a2', 'cc111111-0000-4000-c000-000000000001',
   'cc000000-0000-4000-c000-000000000001', 'cc000000-0000-4000-c000-000000000002',
   2019, 'ABJ 7002');

insert into public.providers
  (id, owner_profile_id, provider_type, business_name_ar, cr_number,
   verification_status, city_id)
values
  ('cc000000-0000-4000-c000-0000000000e1', 'cc111111-0000-4000-c000-000000000003',
   'workshop', 'ورشة العناية', '3030303030', 'approved',
   'cc000000-0000-4000-c000-00000000000c');

insert into public.workshops (provider_id, address_ar, location, bay_count, opening_hours)
values ('cc000000-0000-4000-c000-0000000000e1', 'شارع الملك فهد، الخبر',
        extensions.st_point(50.2090, 26.2800)::extensions.geography, 2,
        '{"sun": [["08:00","20:00"]]}'::jsonb);

select id as svc from public.services where name_en = 'Oil and filter change' \gset


-- ---------------------------------------------------------------------------
-- 1. The cold start asks two questions and seeds both halves of the one job
-- ---------------------------------------------------------------------------
set role authenticated;
select test.become('cc111111-0000-4000-c000-000000000001');

select public.start_vehicle_care(
  'cc000000-0000-4000-c000-0000000000a1',
  p_odometer_km => 80000,
  p_last_oil_km => 76000,
  p_last_oil_at => now() - interval '2 months');

select test.assert_eq(
  (select count(*)::int from public.vehicle_maintenance_items
   where vehicle_id = 'cc000000-0000-4000-c000-0000000000a1'),
  2, 'one answer about the oil seeds both the oil and the filter');

select test.assert_eq(
  (select count(*)::int from public.vehicle_odometer_readings
   where vehicle_id = 'cc000000-0000-4000-c000-0000000000a1'),
  1, 'and the odometer answer lands in the series');

-- The same reading, in the logbook. One call wrote both, so the two cannot
-- disagree — the "no second source of truth" rule, asserted rather than
-- assumed.
select test.assert_eq(
  (select count(*)::int from public.vehicle_timeline
   where vehicle_id = 'cc000000-0000-4000-c000-0000000000a1'
     and event_type = 'mileage_recorded' and mileage = 80000),
  1, 'and in the logbook, from the same call');

select test.assert_eq(
  (select interval_km from public.vehicle_maintenance_items
   where vehicle_id = 'cc000000-0000-4000-c000-0000000000a1' and item_type = 'engine_oil'),
  7000, 'the item starts on the catalogue default');

-- 0063. `vehicles.current_mileage` is no longer a number of its own; it is the
-- head of the series, written by one trigger.
select test.assert_eq(
  (select current_mileage from public.vehicles
   where id = 'cc000000-0000-4000-c000-0000000000a1'),
  80000, 'and the vehicle row shows the series head, not a number of its own');


-- ---------------------------------------------------------------------------
-- 2. A reading never goes backwards inside a series
-- ---------------------------------------------------------------------------
select public.record_mileage('cc000000-0000-4000-c000-0000000000a1', 81500);

select test.assert_eq(
  (select r.km from public.vehicle_odometer_readings r
   where r.vehicle_id = 'cc000000-0000-4000-c000-0000000000a1'
   order by r.series desc, r.km desc, r.recorded_at desc limit 1),
  81500, 'a higher reading extends the series');

-- The whole reason the rule exists: accept this once and `last_done_km +
-- interval_km` is never reached again, so the car is never due for anything.
select test.assert_raises(
  $$select public.record_mileage('cc000000-0000-4000-c000-0000000000a1', 60000)$$,
  'a reading below the head is refused',
  '23514');

select test.assert_eq(
  (select r.km from public.vehicle_odometer_readings r
   where r.vehicle_id = 'cc000000-0000-4000-c000-0000000000a1'
   order by r.series desc, r.km desc, r.recorded_at desc limit 1),
  81500, 'and the head is unmoved by the attempt');

-- Equal is not backwards. A car that has not been driven since the last
-- reading is an ordinary thing, and refusing it would train people to invent a
-- number.
select public.record_mileage('cc000000-0000-4000-c000-0000000000a1', 81500);
select test.assert_eq(
  (select count(*)::int from public.vehicle_odometer_readings
   where vehicle_id = 'cc000000-0000-4000-c000-0000000000a1' and km = 81500),
  2, 'an identical reading is recorded, not refused');

-- Backfilling history is allowed and is NOT a series event: it goes to the
-- logbook, where it is history, and leaves the series alone.
select public.record_mileage(
  'cc000000-0000-4000-c000-0000000000a1', 40000, now() - interval '3 years');

select test.assert_eq(
  (select r.km from public.vehicle_odometer_readings r
   where r.vehicle_id = 'cc000000-0000-4000-c000-0000000000a1'
   order by r.series desc, r.km desc, r.recorded_at desc limit 1),
  81500, 'an explicitly backdated low reading does not move the head');

select test.assert_eq(
  (select count(*)::int from public.vehicle_odometer_readings
   where vehicle_id = 'cc000000-0000-4000-c000-0000000000a1' and km = 40000),
  0, 'and does not enter the series at all');

select test.assert_eq(
  (select count(*)::int from public.vehicle_timeline
   where vehicle_id = 'cc000000-0000-4000-c000-0000000000a1' and mileage = 40000),
  1, 'but is kept in the logbook, which is what it is');


-- ---------------------------------------------------------------------------
-- 3. The replacement path — the only way down, and the reason changes the sum
-- ---------------------------------------------------------------------------
-- A second car, so the first one's series stays simple for §6 onwards.
select public.start_vehicle_care(
  'cc000000-0000-4000-c000-0000000000a2', p_odometer_km => 240000);

select test.assert_eq(
  (select r.series_offset_km + r.km from public.vehicle_odometer_readings r
   where r.vehicle_id = 'cc000000-0000-4000-c000-0000000000a2'
   order by r.series desc, r.km desc, r.recorded_at desc limit 1),
  240000, 'lifetime distance starts equal to the cluster reading');

-- The cluster is swapped and the new one reads zero.
select public.replace_odometer_cluster(
  'cc000000-0000-4000-c000-0000000000a2', 0, 'cluster_replaced',
  'عدّاد جديد') as swap \gset

select test.assert_eq(
  (select r.km from public.vehicle_odometer_readings r
   where r.vehicle_id = 'cc000000-0000-4000-c000-0000000000a2'
   order by r.series desc, r.km desc, r.recorded_at desc limit 1),
  0, 'the new cluster reads what it reads');

select test.assert_eq(
  (select r.series_offset_km + r.km from public.vehicle_odometer_readings r
   where r.vehicle_id = 'cc000000-0000-4000-c000-0000000000a2'
   order by r.series desc, r.km desc, r.recorded_at desc limit 1),
  240000, 'and the distance the car actually travelled is carried across');

select test.assert_eq(
  (select r.series from public.vehicle_odometer_readings r
   where r.vehicle_id = 'cc000000-0000-4000-c000-0000000000a2'
   order by r.series desc, r.km desc, r.recorded_at desc limit 1),
  2, 'as a new series, not as an edit');

-- THE assertion 0063 exists for. Under `greatest()` this column would still
-- read 240,000 — and تقرير هبّة would print 240,000 for a car whose dashboard
-- says 0, which is the report lying in public.
select test.assert_eq(
  (select current_mileage from public.vehicles
   where id = 'cc000000-0000-4000-c000-0000000000a2'),
  0, 'and the vehicle row FALLS with it, because the odometer is no longer monotonic');

-- What the rule in §2 would otherwise have made impossible forever.
select public.record_mileage('cc000000-0000-4000-c000-0000000000a2', 300);
select test.assert_eq(
  (select r.series_offset_km + r.km from public.vehicle_odometer_readings r
   where r.vehicle_id = 'cc000000-0000-4000-c000-0000000000a2'
   order by r.series desc, r.km desc, r.recorded_at desc limit 1),
  240300, 'readings from the new cluster are accepted and add to the total');

-- §1 says the logbook records what happened to the car. A replaced cluster is
-- among the most material facts a used-car buyer can be told.
select test.assert_eq(
  (select count(*)::int from public.vehicle_timeline
   where vehicle_id = 'cc000000-0000-4000-c000-0000000000a2'
     and summary_en like 'Instrument cluster replaced%'),
  1, 'and the swap is written into the logbook, not buried in a table');

-- The other reason. A slipped digit — 2,400,000 typed for 240,000 — would lock
-- the car out of every future reading under §2. `correction` re-anchors the
-- scale WITHOUT crediting the car with distance it never travelled.
select public.replace_odometer_cluster(
  'cc000000-0000-4000-c000-0000000000a2', 500, 'correction', 'رقم خاطئ');

select test.assert_eq(
  (select r.series_offset_km + r.km from public.vehicle_odometer_readings r
   where r.vehicle_id = 'cc000000-0000-4000-c000-0000000000a2'
   order by r.series desc, r.km desc, r.recorded_at desc limit 1),
  240500, 'a correction keeps the previous offset — the bad series adds nothing');

select test.assert_eq(
  (select count(*)::int from public.vehicle_odometer_readings
   where vehicle_id = 'cc000000-0000-4000-c000-0000000000a2'),
  4, 'and nothing was deleted: every reading ever taken is still there');

select test.assert_eq(
  (select current_mileage from public.vehicles
   where id = 'cc000000-0000-4000-c000-0000000000a2'),
  500, 'a correction moves the vehicle row too — one number, one writer');

-- A car with no readings has nothing to replace, and allowing it would mint a
-- series whose offset nothing supports.
insert into public.vehicles (id, owner_id, make_id, model_id, year, plate_en) values
  ('cc000000-0000-4000-c000-0000000000a3', 'cc111111-0000-4000-c000-000000000001',
   'cc000000-0000-4000-c000-000000000001', 'cc000000-0000-4000-c000-000000000002',
   2021, 'ABJ 7003');

select test.assert_raises(
  $$select public.replace_odometer_cluster(
      'cc000000-0000-4000-c000-0000000000a3', 10, 'cluster_replaced')$$,
  'a car with no readings cannot start a second series',
  'P0002');

reset role;


-- ---------------------------------------------------------------------------
-- 4. Append-only, and closed to clients
-- ---------------------------------------------------------------------------
select test.assert_raises(
  $$update public.vehicle_odometer_readings set km = 1 where km = 81500$$,
  'a reading cannot be updated, by anyone',
  '23001');

select test.assert_raises(
  $$delete from public.vehicle_odometer_readings where km = 81500$$,
  'nor deleted',
  '23001');

set role authenticated;
select test.become('cc111111-0000-4000-c000-000000000001');

-- The series, the offset and the monotonic rule are business rules. A client
-- INSERT would let the owner pick their own lifetime distance.
select test.assert_raises(
  $$insert into public.vehicle_odometer_readings (vehicle_id, km, source)
    values ('cc000000-0000-4000-c000-0000000000a1', 999999, 'manual')$$,
  'and the owner cannot write one directly',
  '42501');

reset role;

-- service_role has no RLS at all, which is exactly why the guard is
-- ENABLE ALWAYS rather than the default.
set role service_role;
select test.assert_raises(
  $$insert into public.vehicle_odometer_readings (vehicle_id, km, source)
    values ('cc000000-0000-4000-c000-0000000000a1', 999999, 'manual')$$,
  'and neither can a leaked service key',
  '42501');
reset role;


-- ---------------------------------------------------------------------------
-- 5. Due on the distance axis
-- ---------------------------------------------------------------------------
set role authenticated;
select test.become('cc111111-0000-4000-c000-000000000001');

-- Oil last done at 76,000 with a 7,000 km interval → due at 83,000. The car is
-- at 81,500, which is inside the 500 km lead window's reach but not yet due.
select test.assert_eq(
  (select due_at_km from public.vehicle_maintenance_status(
     'cc000000-0000-4000-c000-0000000000a1') where item_type = 'engine_oil'),
  83000, 'the distance due point is last done plus the interval');

select test.assert_eq(
  (select due_by_km from public.vehicle_maintenance_status(
     'cc000000-0000-4000-c000-0000000000a1') where item_type = 'engine_oil'),
  false, 'and it is not due yet at 81,500 km');

select public.record_mileage('cc000000-0000-4000-c000-0000000000a1', 83400);

select test.assert_eq(
  (select due_by_km from public.vehicle_maintenance_status(
     'cc000000-0000-4000-c000-0000000000a1') where item_type = 'engine_oil'),
  true, 'crossing the due point makes it due on the distance axis');

-- The flag ADR-0022's copy rule is built on: the app cannot see the odometer
-- between readings, so a distance-based item is never a certainty.
select test.assert_eq(
  (select km_is_estimated from public.vehicle_maintenance_status(
     'cc000000-0000-4000-c000-0000000000a1') where item_type = 'engine_oil'),
  true, 'and the distance axis is always flagged as an estimate');

select test.assert_eq(
  (select due_by_date from public.vehicle_maintenance_status(
     'cc000000-0000-4000-c000-0000000000a1') where item_type = 'engine_oil'),
  false, 'while the date axis, two months in on a six-month interval, is not');


-- ---------------------------------------------------------------------------
-- 6. Due on the time axis alone — the car that never moves
-- ---------------------------------------------------------------------------
-- An idle car still needs its oil changed. Oil degrades on a calendar.
select public.start_vehicle_care(
  'cc000000-0000-4000-c000-0000000000a3',
  p_odometer_km => 12000,
  p_last_oil_at => now() - interval '8 months');

select test.assert_eq(
  (select due_by_km from public.vehicle_maintenance_status(
     'cc000000-0000-4000-c000-0000000000a3') where item_type = 'engine_oil'),
  false, 'a car with no distance recorded since the service is not due on distance');

select test.assert_eq(
  (select due_by_date from public.vehicle_maintenance_status(
     'cc000000-0000-4000-c000-0000000000a3') where item_type = 'engine_oil'),
  true, 'but eight months into a six-month interval it is due on time');

select test.assert_eq(
  (select is_due from public.vehicle_maintenance_status(
     'cc000000-0000-4000-c000-0000000000a3') where item_type = 'engine_oil'),
  true, 'and EITHER axis is enough');

reset role;


-- ---------------------------------------------------------------------------
-- 7. A closed job fills the section in
-- ---------------------------------------------------------------------------
insert into public.orders (
  id, customer_id, vehicle_id, service_id, fulfilment_mode, status,
  provider_id, workshop_id, problem_description, mileage_at_order,
  completion_mileage,
  completion_media,
  quoted_amount, parts_amount, labour_amount, vat_amount, total_amount,
  escrow_status, warranty_days, created_by
) values (
  'cc000000-0000-4000-c000-0000000000d1',
  'cc111111-0000-4000-c000-000000000001',
  'cc000000-0000-4000-c000-0000000000a1',
  :'svc', 'workshop', 'awaiting_approval',
  'cc000000-0000-4000-c000-0000000000e1', 'cc000000-0000-4000-c000-0000000000e1',
  'تغيير زيت', 83400,
  84000,
  '[{"url": "a", "kind": "before"}, {"url": "b", "kind": "after"}]'::jsonb,
  200, 0, 200, 30, 230,
  'captured', 90, 'cc111111-0000-4000-c000-000000000001'
);

set role authenticated;
select test.become('cc111111-0000-4000-c000-000000000001');

update public.orders set status = 'completed'
where id = 'cc000000-0000-4000-c000-0000000000d1';

select test.assert_eq(
  (select r.km from public.vehicle_odometer_readings r
   where r.vehicle_id = 'cc000000-0000-4000-c000-0000000000a1'
   order by r.series desc, r.km desc, r.recorded_at desc limit 1),
  84000, 'the technician''s reading lands in the series without anyone typing it');

select test.assert_eq(
  (select source::text from public.vehicle_odometer_readings
   where service_order_id = 'cc000000-0000-4000-c000-0000000000d1'),
  'service_order', 'labelled as coming from the job, with the job on the row');

-- Both halves of «تغيير زيت وفلتر», from one service. This is why the
-- catalogue maps item types to a service and not the other way round.
select test.assert_eq(
  (select count(*)::int from public.vehicle_maintenance_items
   where vehicle_id = 'cc000000-0000-4000-c000-0000000000a1'
     and last_done_order_id = 'cc000000-0000-4000-c000-0000000000d1'),
  2, 'and one completed job closes both items it covers');

select test.assert_eq(
  (select last_done_km from public.vehicle_maintenance_items
   where vehicle_id = 'cc000000-0000-4000-c000-0000000000a1' and item_type = 'engine_oil'),
  84000, 'recorded at the distance the work was done at');

select test.assert_eq(
  (select is_due from public.vehicle_maintenance_status(
     'cc000000-0000-4000-c000-0000000000a1') where item_type = 'engine_oil'),
  false, 'so the item that was overdue a moment ago is no longer due');

reset role;

-- A docket that reads lower than the car's head must not abort the completion.
-- A refused reading is a data-quality problem; a failed completion is a
-- technician and a customer standing at a counter.
insert into public.orders (
  id, customer_id, vehicle_id, service_id, fulfilment_mode, status,
  provider_id, workshop_id, problem_description, mileage_at_order,
  completion_mileage, completion_media,
  quoted_amount, parts_amount, labour_amount, vat_amount, total_amount,
  escrow_status, created_by
) values (
  'cc000000-0000-4000-c000-0000000000d2',
  'cc111111-0000-4000-c000-000000000001',
  'cc000000-0000-4000-c000-0000000000a1',
  :'svc', 'workshop', 'awaiting_approval',
  'cc000000-0000-4000-c000-0000000000e1', 'cc000000-0000-4000-c000-0000000000e1',
  'خطأ في القراءة', 83400,
  -- Misread: 8,400 for 84,000.
  8400, '[{"url": "a", "kind": "before"}, {"url": "b", "kind": "after"}]'::jsonb,
  200, 0, 200, 30, 230, 'captured', 'cc111111-0000-4000-c000-000000000001'
);

set role authenticated;
select test.become('cc111111-0000-4000-c000-000000000001');

update public.orders set status = 'completed'
where id = 'cc000000-0000-4000-c000-0000000000d2';

select test.assert_eq(
  (select status::text from public.orders where id = 'cc000000-0000-4000-c000-0000000000d2'),
  'completed', 'a misread docket does not fail the completion');

select test.assert_eq(
  (select r.km from public.vehicle_odometer_readings r
   where r.vehicle_id = 'cc000000-0000-4000-c000-0000000000a1'
   order by r.series desc, r.km desc, r.recorded_at desc limit 1),
  84000, 'and does not poison the series either');

reset role;


-- ---------------------------------------------------------------------------
-- 8. One notification per vehicle per day, aggregating everything
-- ---------------------------------------------------------------------------
-- Put the car back into a due state, and give it an expiring document too, so
-- the aggregate has both kinds in it.
set role authenticated;
select test.become('cc111111-0000-4000-c000-000000000001');

-- Two months into a six-month interval, so the DATE axis is comfortably not
-- due — the items below are due on distance alone, which is the case ADR-0022's
-- language rule is about.
update public.vehicle_maintenance_items
set last_done_km = 76000, last_done_at = now() - interval '2 months',
    last_done_order_id = null
where vehicle_id = 'cc000000-0000-4000-c000-0000000000a1';

insert into public.vehicle_documents (vehicle_id, doc_type, expires_at) values
  ('cc000000-0000-4000-c000-0000000000a1', 'insurance', current_date + 5),
  -- Outside the lead window: proves the sweep is selecting, not just listing.
  ('cc000000-0000-4000-c000-0000000000a1', 'registration', current_date + 200);

reset role;

select public.sweep_vehicle_care('cc000000-0000-4000-c000-0000000000a1') as reminder \gset

select test.assert(:'reminder' is not null, 'the sweep sends a reminder for a due car');

select test.assert_eq(
  (select jsonb_array_length(items) from public.vehicle_reminders where id = :'reminder'),
  3, 'ONE notification carrying both due items and the expiring document');

select test.assert_eq(
  (select count(*)::int from public.vehicle_reminders r,
     lateral jsonb_array_elements(r.items) e
   where r.id = :'reminder' and e ->> 'key' = 'registration'),
  0, 'and nothing that is not due yet');

-- The cap. Not an `if` in the loop — a unique index, because the case being
-- guarded against is the scheduler firing twice in two transactions.
select test.assert(
  public.sweep_vehicle_care('cc000000-0000-4000-c000-0000000000a1') is null,
  'a second sweep on the same day sends nothing');

select test.assert_eq(
  (select count(*)::int from public.vehicle_reminders
   where vehicle_id = 'cc000000-0000-4000-c000-0000000000a1'),
  1, 'and there is still exactly one reminder for the day');

select test.assert_raises(
  $$insert into public.vehicle_reminders
      (vehicle_id, user_id, title_ar, title_en, body_ar, body_en)
    values ('cc000000-0000-4000-c000-0000000000a1',
            'cc111111-0000-4000-c000-000000000001', 'x', 'x', 'x', 'x')$$,
  'the cap is the database''s, not the sweep''s',
  '23505');

-- ADR-0022's language rule, in the payload. The distance item hedges and asks
-- for a reading; the document does not hedge, because a date is a date.
select test.assert_eq(
  (select (e ->> 'certain')::boolean from public.vehicle_reminders r,
     lateral jsonb_array_elements(r.items) e
   where r.id = :'reminder' and e ->> 'key' = 'insurance'),
  true, 'a document expiry is stated as certain');

select test.assert(
  (select e ->> 'text_ar' like '%أكّد قراءة العداد%' from public.vehicle_reminders r,
     lateral jsonb_array_elements(r.items) e
   where r.id = :'reminder' and e ->> 'key' = 'engine_oil'
     and (e ->> 'certain')::boolean is false),
  'and a distance item asks for a reading instead of claiming a date');


-- ---------------------------------------------------------------------------
-- 9. Snooze, and the repeat window
-- ---------------------------------------------------------------------------
set role authenticated;
select test.become('cc111111-0000-4000-c000-000000000001');

select public.respond_to_reminder(:'reminder', 'snoozed');

select id as oil_item from public.vehicle_maintenance_items
where vehicle_id = 'cc000000-0000-4000-c000-0000000000a1' and item_type = 'engine_oil' \gset

select public.snooze_maintenance_item(:'oil_item', 30);

select test.assert_eq(
  (select response::text from public.vehicle_reminders where id = :'reminder'),
  'snoozed', 'what the owner did is on the reminder');

-- A client may answer a reminder. It may not rewrite what the reminder said,
-- which is what the repeat window is computed from.
select test.assert_raises(
  $$update public.vehicle_reminders set items = '[]'::jsonb where id = '$$ || :'reminder' || $$'$$,
  'but cannot rewrite what was sent',
  '42501');

reset role;

-- Move the clock: yesterday's reminder no longer blocks today's. Through the
-- privileged-write flag (0033) because the column guard is ENABLE ALWAYS and
-- refuses even a superuser — which is the assertion two lines above.
select public.begin_privileged_write();
update public.vehicle_reminders
set sent_on = current_date - 1, sent_at = now() - interval '1 day'
where id = :'reminder';
select public.end_privileged_write();

-- Something genuinely new to say: the registration is renewed for a date
-- inside the lead window. Without it the second sweep would be silent and
-- there would be no way to tell "suppressed" apart from "sent nothing".
set role authenticated;
select test.become('cc111111-0000-4000-c000-000000000001');
update public.vehicle_documents set expires_at = current_date + 5
where vehicle_id = 'cc000000-0000-4000-c000-0000000000a1' and doc_type = 'registration';
reset role;

select public.sweep_vehicle_care('cc000000-0000-4000-c000-0000000000a1') as second \gset

select test.assert((:'second') <> '', 'the next day the sweep may send again');

select test.assert_eq(
  (select count(*)::int from public.vehicle_reminders r,
     lateral jsonb_array_elements(r.items) e
   where r.id = (:'second')::uuid and e ->> 'key' = 'engine_oil'),
  0, 'but a snoozed item is not in it');

-- The oil FILTER was in yesterday's reminder and is not snoozed. The cap alone
-- would permit it every single morning; the repeat window is what does not,
-- and it is the reason vehicle_reminders exists at all.
select test.assert_eq(
  (select count(*)::int from public.vehicle_reminders r,
     lateral jsonb_array_elements(r.items) e
   where r.id = (:'second')::uuid and e ->> 'key' = 'oil_filter'),
  0, 'and neither is an item already sent inside the repeat window');

select test.assert_eq(
  (select jsonb_array_length(items) from public.vehicle_reminders
   where id = (:'second')::uuid),
  1, 'leaving only the thing the owner has not already been told');


-- ---------------------------------------------------------------------------
-- 10. RLS — a stranger sees none of it
-- ---------------------------------------------------------------------------
set role authenticated;
select test.become('cc111111-0000-4000-c000-000000000004');

select test.assert_eq(
  (select count(*)::int from public.vehicle_odometer_readings
   where vehicle_id = 'cc000000-0000-4000-c000-0000000000a1'),
  0, 'a stranger reads no odometer history');
select test.assert_eq(
  (select count(*)::int from public.vehicle_maintenance_items
   where vehicle_id = 'cc000000-0000-4000-c000-0000000000a1'),
  0, 'no maintenance schedule');
select test.assert_eq(
  (select count(*)::int from public.vehicle_documents
   where vehicle_id = 'cc000000-0000-4000-c000-0000000000a1'),
  0, 'no documents');
select test.assert_eq(
  (select count(*)::int from public.vehicle_reminders
   where vehicle_id = 'cc000000-0000-4000-c000-0000000000a1'),
  0, 'and no reminders');

select test.assert_eq(
  (select count(*)::int from public.vehicle_maintenance_status(
     'cc000000-0000-4000-c000-0000000000a1')),
  0, 'and the read functions are gated too, not just the tables');
select test.assert_eq(
  (select count(*)::int from public.vehicle_document_status(
     'cc000000-0000-4000-c000-0000000000a1')),
  0, 'both of them');

reset role;


-- ---------------------------------------------------------------------------
-- 11. The handover: three tables travel, one does not
-- ---------------------------------------------------------------------------
-- Nothing is migrated and no rows move. Every table in this slice is keyed on
-- the vehicle and gated by owns_vehicle(), so the handover is one column on one
-- row — exactly as warranties work in 0055. `vehicle_reminders` is the
-- exception BY CONSTRUCTION: it is gated on user_id, so it stays put.
set role authenticated;
select test.become('cc111111-0000-4000-c000-000000000001');

select code from public.initiate_ownership_transfer(
  'cc000000-0000-4000-c000-0000000000a1', '+966505300002', null) \gset

select id as transfer from public.ownership_transfers
where vehicle_id = 'cc000000-0000-4000-c000-0000000000a1' and status = 'pending' \gset

reset role;
set role authenticated;
select test.become('cc111111-0000-4000-c000-000000000002');

select test.assert_eq(
  public.accept_ownership_transfer(:'transfer', :'code'),
  'cc000000-0000-4000-c000-0000000000a1'::uuid,
  'the buyer accepts');

-- §1.2: what the buyer paid for. A schedule that said "the oil was done at
-- 84,000 km on the 14th" is worth more to them than any prediction about cars
-- in general.
select test.assert(
  (select count(*) from public.vehicle_odometer_readings
   where vehicle_id = 'cc000000-0000-4000-c000-0000000000a1') > 0,
  'the buyer inherits the odometer history');
select test.assert_eq(
  (select count(*)::int from public.vehicle_maintenance_items
   where vehicle_id = 'cc000000-0000-4000-c000-0000000000a1'),
  2, 'and the maintenance schedule');
select test.assert_eq(
  (select count(*)::int from public.vehicle_documents
   where vehicle_id = 'cc000000-0000-4000-c000-0000000000a1'),
  2, 'and the document expiry dates');

-- Not this. What was pushed to the seller's phone, and whether they tapped
-- «تم», is the seller's behaviour and not the car's history (ADR-0010).
select test.assert_eq(
  (select count(*)::int from public.vehicle_reminders
   where vehicle_id = 'cc000000-0000-4000-c000-0000000000a1'),
  0, 'and none of the reminder history');

-- Nor the seller's deferrals (0063). §9 snoozed the oil for thirty days; a
-- buyer who inherited that would open the section on the day they bought the
-- car and be told nothing about the one thing it is actually overdue for.
select test.assert_eq(
  (select count(*)::int from public.vehicle_maintenance_items
   where vehicle_id = 'cc000000-0000-4000-c000-0000000000a1'
     and snoozed_until is not null),
  0, 'and not the seller''s «ذكّرني لاحقاً» either');

select test.assert_eq(
  (select is_due from public.vehicle_maintenance_status(
     'cc000000-0000-4000-c000-0000000000a1') where item_type = 'engine_oil'),
  true, 'so the buyer is told on day one what the car is actually due for');

reset role;
set role authenticated;
select test.become('cc111111-0000-4000-c000-000000000001');

select test.assert_eq(
  (select count(*)::int from public.vehicle_odometer_readings
   where vehicle_id = 'cc000000-0000-4000-c000-0000000000a1'),
  0, 'the seller keeps none of the car''s history');
select test.assert_eq(
  (select count(*)::int from public.vehicle_reminders
   where vehicle_id = 'cc000000-0000-4000-c000-0000000000a1'),
  2, 'but keeps their own record of what they were told about it');

reset role;

-- And the seller's window does not silence the buyer. A new owner is told what
-- their car needs on day one, rather than inheriting a suppression they never
-- saw the reason for.
-- Both of the seller's reminders shift back a day, keeping them a day apart:
-- the cap is a unique index on (vehicle_id, sent_on), so collapsing them onto
-- one date would collide rather than simulate the passage of time.
select public.begin_privileged_write();
update public.vehicle_reminders
set sent_on = sent_on - 1, sent_at = sent_at - interval '1 day'
where vehicle_id = 'cc000000-0000-4000-c000-0000000000a1';
select public.end_privileged_write();

select public.sweep_vehicle_care('cc000000-0000-4000-c000-0000000000a1') as buyers \gset

select test.assert((:'buyers') <> '',
  'the buyer is told about the car on day one');

select test.assert_eq(
  (select user_id from public.vehicle_reminders where id = (:'buyers')::uuid),
  'cc111111-0000-4000-c000-000000000002'::uuid,
  'and the reminder is addressed to them, not to the previous owner');

-- The strongest form of the assertion above: the item the SELLER silenced is
-- the one the BUYER is told about.
select test.assert_eq(
  (select count(*)::int from public.vehicle_reminders r,
     lateral jsonb_array_elements(r.items) e
   where r.id = (:'buyers')::uuid and e ->> 'key' = 'engine_oil'),
  1, 'including the item the seller had snoozed');


-- ---------------------------------------------------------------------------
-- 12. The sweep says whether it is actually scheduled
-- ---------------------------------------------------------------------------
-- 0056's assertion, and it matters more here: ownership-transfer expiry also
-- runs inline, so an unscheduled sweep there is housekeeping. This one has no
-- inline path — unscheduled means no reminders at all, and the only symptom is
-- silence. So the claim and the catalogue must agree.
select test.assert(
  (to_regclass('cron.job') is null) = (not public.vehicle_care_sweep_scheduled()),
  'the sweep is scheduled exactly when pg_cron is present to schedule it');

-- Neither the sweep nor the question of whether it runs is a client's to ask:
-- unscoped, the sweep would notify every owner in the country.
set role authenticated;
select test.assert_raises(
  $$select public.run_vehicle_care_sweep()$$,
  'the sweep is not callable by a client',
  '42501');
select test.assert_raises(
  $$select public.vehicle_care_sweep_scheduled()$$,
  'and neither is the question of whether it is scheduled',
  '42501');
reset role;


-- ---------------------------------------------------------------------------
-- 13. One number, asserted across the whole database
-- ---------------------------------------------------------------------------
-- 0063's claim is that `vehicles.current_mileage` is DERIVED — the head of the
-- series and nothing else. A claim like that is worth exactly as much as the
-- test that walks every row and checks it, because the way it fails is that
-- somebody adds a second writer and nothing complains.
--
-- Every vehicle in the database, not only this suite's: the fixtures above and
-- every other suite's cars have all been through the timeline path, which is
-- where a reintroduced `greatest()` would live.
select test.assert_eq(
  (select coalesce(string_agg(v.id::text || ' (' || v.current_mileage || ' vs '
                              || coalesce(h.km::text, 'null') || ')', ', '), '(none)')
   from public.vehicles v
   cross join lateral public.odometer_head(v.id) h
   where v.current_mileage is distinct from h.km),
  '(none)',
  'every vehicle with readings shows its series head, and nothing else');

-- And the other half of the same claim: a car that has told us a mileage has a
-- series to hold it, so the fallback in vehicle_lifetime_km is for cars that
-- have told us nothing rather than for cars that used the old screen.
select test.assert_eq(
  (select count(*)::int from public.vehicles v
   where v.current_mileage > 0
     and not exists (
       select 1 from public.vehicle_odometer_readings r where r.vehicle_id = v.id)),
  0, 'and a stated mileage always seeded a series to hold it');

rollback;

\echo '   vehicle care OK'
