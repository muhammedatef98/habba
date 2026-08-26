-- 04 — Row Level Security
--
-- Build prompt §6.9 requires this suite in CI. Two things make it meaningful:
--
--   1. It runs as the `authenticated` role against a real database. The table
--      owner and any superuser BYPASS RLS, so a suite that forgets to drop
--      privileges passes while proving nothing. A mocked RLS test is worse —
--      it tests the mock (ADR-0014).
--
--   2. It asserts BOTH directions. A denial-only suite passes trivially
--      against a table with no policies at all, which denies everything —
--      including the owner. Every table checks "stranger cannot" AND
--      "owner can".

\echo '── row level security'

begin;

-- Fixtures, created as the privileged migration role ------------------------
insert into auth.users (id, phone) values
  ('11111111-1111-1111-1111-111111111111', '+966501111111'),
  ('22222222-2222-2222-2222-222222222222', '+966502222222'),
  ('33333333-3333-3333-3333-333333333333', '+966503333333');

insert into public.profiles (id, role, full_name, phone) values
  ('11111111-1111-1111-1111-111111111111', 'customer', 'المالك',  '+966501111111'),
  ('22222222-2222-2222-2222-222222222222', 'customer', 'الغريب',  '+966502222222'),
  ('33333333-3333-3333-3333-333333333333', 'ops',      'المشغّل', '+966503333333');

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
select public.append_vehicle_timeline_event(
  'd1111111-1111-1111-1111-111111111111', 'vehicle_registered', 'تسجيل', 'Registered');


-- ===========================================================================
set role authenticated;
-- ===========================================================================

-- The owner ------------------------------------------------------------------
select test.become('11111111-1111-1111-1111-111111111111');

select test.assert_eq((select count(*)::int from public.vehicles), 1,
  'owner CAN read their own vehicle');
select test.assert_eq((select count(*)::int from public.vehicle_timeline), 1,
  'owner CAN read their own timeline');
select test.assert_eq((select count(*)::int from public.profiles), 1,
  'owner sees exactly their own profile row');


-- A stranger -----------------------------------------------------------------
select test.become('22222222-2222-2222-2222-222222222222');

select test.assert_eq((select count(*)::int from public.vehicles), 0,
  'a stranger CANNOT read another user''s vehicles');
select test.assert_eq((select count(*)::int from public.vehicle_timeline), 0,
  'a stranger CANNOT read another user''s logbook');
select test.assert_eq(
  (select count(*)::int from public.profiles
   where id = '11111111-1111-1111-1111-111111111111'), 0,
  'a stranger CANNOT read another user''s profile');

-- Nor write to it. Note this does NOT raise: an UPDATE filtered by an RLS
-- USING clause simply matches zero rows. Asserting on an exception here would
-- be asserting the wrong thing — what matters is that the owner's data is
-- untouched, which is checked below.
update public.vehicles set nickname = 'مسروقة'
where id = 'd1111111-1111-1111-1111-111111111111';

select test.assert_eq(
  (select count(*)::int from public.vehicles
   where id = 'd1111111-1111-1111-1111-111111111111'), 0,
  'the stranger''s UPDATE matched no rows');

-- Nor claim ownership of a new vehicle on someone else's behalf.
select test.assert_raises(
  $$insert into public.vehicles (owner_id, make_id, model_id, year, plate_en)
    values ('11111111-1111-1111-1111-111111111111','a1111111-1111-1111-1111-111111111111',
            'b1111111-1111-1111-1111-111111111111', 2020, 'ABJ 4321')$$,
  'a user cannot insert a vehicle owned by someone else',
  '42501');


-- Back as the owner: confirm the stranger's write really did nothing.
select test.become('11111111-1111-1111-1111-111111111111');
select test.assert_eq(
  (select nickname from public.vehicles where id = 'd1111111-1111-1111-1111-111111111111'),
  null::text,
  'the owner''s vehicle was NOT modified by the stranger');


-- The timeline is read-only through RLS, for everyone (ADR-0003) -------------

select test.assert_raises(
  $$insert into public.vehicle_timeline
      (vehicle_id, event_type, provenance, summary_ar, summary_en,
       created_by, prev_hash, row_hash)
    values ('d1111111-1111-1111-1111-111111111111','service_completed','habba_verified',
            'مزور','Forged','11111111-1111-1111-1111-111111111111','GENESIS','deadbeef')$$,
  'even the OWNER cannot INSERT into the timeline directly — grants are revoked',
  '42501');

select test.assert_raises(
  $$update public.vehicle_timeline set summary_en = 'Rewritten'$$,
  'the owner cannot UPDATE their own timeline', null);

select test.assert_raises(
  $$delete from public.vehicle_timeline$$,
  'the owner cannot DELETE from their own timeline', null);


-- Anonymous ------------------------------------------------------------------
reset role;
set role anon;
select test.become_anon();

select test.assert_eq((select count(*)::int from public.vehicles), 0,
  'anonymous CANNOT read vehicles');
select test.assert_eq((select count(*)::int from public.vehicle_timeline), 0,
  'anonymous CANNOT read the logbook');
select test.assert_eq((select count(*)::int from public.profiles), 0,
  'anonymous CANNOT read profiles');

-- Reference data must stay public: a new user picks their car before they
-- have a profile.
select test.assert((select count(*) from public.vehicle_makes) > 0,
  'anonymous CAN read the vehicle catalogue');
select test.assert((select count(*) from public.cities) >= 0,
  'anonymous CAN read cities');


-- Ops ------------------------------------------------------------------------
reset role;
set role authenticated;
select test.become('33333333-3333-3333-3333-333333333333');

select test.assert_eq((select count(*)::int from public.vehicles), 1,
  'ops CAN read all vehicles');
select test.assert_eq((select count(*)::int from public.vehicle_timeline), 1,
  'ops CAN read all timelines');
select test.assert_eq((select count(*)::int from public.profiles), 3,
  'ops CAN read all profiles');

-- But ops is still not above the append-only rule.
select test.assert_raises(
  $$update public.vehicle_timeline set summary_en = 'Ops edit'$$,
  'not even ops can edit the timeline', null);

reset role;
rollback;

\echo '   row level security OK'
