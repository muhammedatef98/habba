-- 02 — The timeline: hash chain, append-only enforcement, verification
--
-- This is the moat's test suite. If any of these fail, تقرير هبّة cannot be
-- trusted and Phase 2 must not ship.

\echo '── vehicle_timeline'

begin;

-- Fixtures ------------------------------------------------------------------
insert into auth.users (id, phone) values
  ('11111111-1111-1111-1111-111111111111', '+966501111111'),
  ('22222222-2222-2222-2222-222222222222', '+966502222222');

insert into public.profiles (id, full_name, phone) values
  ('11111111-1111-1111-1111-111111111111', 'مالك السيارة', '+966501111111'),
  ('22222222-2222-2222-2222-222222222222', 'شخص آخر', '+966502222222');

insert into public.vehicle_makes (id, name_ar, name_en) values
  ('a1111111-1111-1111-1111-111111111111', 'ماركة اختبار', 'TestMake');
insert into public.vehicle_models (id, make_id, name_ar, name_en, year_from) values
  ('b1111111-1111-1111-1111-111111111111', 'a1111111-1111-1111-1111-111111111111',
   'موديل اختبار', 'TestModel', 2015);
insert into public.vehicles (id, owner_id, make_id, model_id, year, plate_en) values
  ('d1111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111',
   'a1111111-1111-1111-1111-111111111111', 'b1111111-1111-1111-1111-111111111111',
   2020, 'ABJ 1234');

select test.become('11111111-1111-1111-1111-111111111111');


-- Appending ------------------------------------------------------------------
select public.append_vehicle_timeline_event(
  'd1111111-1111-1111-1111-111111111111', 'vehicle_registered',
  'تم تسجيل السيارة', 'Vehicle registered'
) as first_id \gset

select test.assert_eq(
  (select prev_hash from public.vehicle_timeline where id = :'first_id'),
  'GENESIS',
  'the first row of a chain uses the GENESIS sentinel, not NULL'
);

select public.append_vehicle_timeline_event(
  'd1111111-1111-1111-1111-111111111111', 'service_completed',
  'تغيير زيت وفلتر', 'Oil and filter change',
  now() - interval '30 days', 45000,
  null, null, '{"oil_grade":"5W-30"}'::jsonb
);

select public.append_vehicle_timeline_event(
  'd1111111-1111-1111-1111-111111111111', 'mileage_recorded',
  'تحديث العداد', 'Mileage updated', now(), 52000
);

select test.assert_eq(
  (select count(*)::int from public.vehicle_timeline
   where vehicle_id = 'd1111111-1111-1111-1111-111111111111'),
  3, 'three events appended'
);


-- Provenance is derived, never claimed (ADR-0005) ----------------------------
select test.assert_eq(
  (select provenance from public.vehicle_timeline
   where event_type = 'service_completed'),
  'self_reported'::public.timeline_provenance,
  'an owner-entered service with no attachments is self_reported, NOT verified'
);

select public.append_vehicle_timeline_event(
  'd1111111-1111-1111-1111-111111111111', 'service_completed',
  'تبديل إطارات', 'Tyre replacement', now(), 52100, null, null, '{}'::jsonb,
  '[{"url":"https://example.test/invoice.jpg","type":"image","caption":"فاتورة"}]'::jsonb
);

select test.assert_eq(
  (select provenance from public.vehicle_timeline where summary_en = 'Tyre replacement'),
  'self_documented'::public.timeline_provenance,
  'an owner entry WITH an attachment is self_documented'
);

select test.assert_eq(
  (select provenance from public.vehicle_timeline where event_type = 'vehicle_registered'),
  'habba_verified'::public.timeline_provenance,
  'a system fact is habba_verified'
);

-- The whole point: nothing an owner types can ever be habba_verified.
select test.assert_eq(
  (select count(*)::int from public.vehicle_timeline
   where provenance = 'habba_verified' and event_type = 'service_completed'),
  0,
  'no owner-entered service claim is ever marked habba_verified'
);


-- Mileage tracking -----------------------------------------------------------
select test.assert_eq(
  (select current_mileage from public.vehicles where id = 'd1111111-1111-1111-1111-111111111111'),
  52100,
  'vehicle mileage follows the highest reading'
);

-- A backdated event must not drag the odometer backwards.
select public.append_vehicle_timeline_event(
  'd1111111-1111-1111-1111-111111111111', 'mileage_recorded',
  'قراءة قديمة', 'Old reading', now() - interval '90 days', 30000
);
select test.assert_eq(
  (select current_mileage from public.vehicles where id = 'd1111111-1111-1111-1111-111111111111'),
  52100,
  'a late-synced older reading does not lower the odometer'
);


-- Verification ---------------------------------------------------------------
select test.assert(
  (select is_valid from public.verify_vehicle_timeline('d1111111-1111-1111-1111-111111111111')),
  'a well-formed chain verifies'
);
select test.assert_eq(
  (select checked_count from public.verify_vehicle_timeline('d1111111-1111-1111-1111-111111111111')),
  5, 'verification walked every row'
);


-- Append-only enforcement (ADR-0003) -----------------------------------------
-- The spec used RULES with DO INSTEAD NOTHING, which silently discard the
-- write and report success. These must raise.
select test.assert_raises(
  $$update public.vehicle_timeline set mileage = 999999
    where vehicle_id = 'd1111111-1111-1111-1111-111111111111'$$,
  'UPDATE on the timeline raises rather than silently doing nothing',
  '23001'
);

select test.assert_raises(
  $$delete from public.vehicle_timeline
    where vehicle_id = 'd1111111-1111-1111-1111-111111111111'$$,
  'DELETE on the timeline raises rather than silently doing nothing',
  '23001'
);

-- Still five rows, and still valid.
select test.assert_eq(
  (select count(*)::int from public.vehicle_timeline
   where vehicle_id = 'd1111111-1111-1111-1111-111111111111'),
  5, 'no row was removed by the attempted DELETE'
);


-- Authorisation --------------------------------------------------------------
select test.become('22222222-2222-2222-2222-222222222222');
select test.assert_raises(
  $$select public.append_vehicle_timeline_event(
      'd1111111-1111-1111-1111-111111111111', 'service_completed',
      'تدخل غير مصرح', 'Unauthorised entry')$$,
  'a stranger cannot append to someone else''s vehicle timeline',
  '42501'
);

select test.become('11111111-1111-1111-1111-111111111111');

-- Future-dated events are rejected (ADR-0012).
select test.assert_raises(
  $$select public.append_vehicle_timeline_event(
      'd1111111-1111-1111-1111-111111111111', 'mileage_recorded',
      'من المستقبل', 'From the future', now() + interval '2 days', 60000)$$,
  'occurred_at cannot be in the future',
  '23514'
);

rollback;

\echo '   vehicle_timeline OK'
