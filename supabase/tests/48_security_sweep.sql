-- 48 — Security sweep
--
-- Companion to 0075. Two halves: the holes it closed, each reproduced the way
-- it was found; and catalogue checks that fail the build if the next view,
-- table or function reopens one of them without anyone noticing.

\echo '── security sweep'

begin;

insert into auth.users (id, phone) values
  ('11111111-0000-4000-4848-000000000001', '+966509480001'),   -- owner
  ('22222222-0000-4000-4848-000000000002', '+966509480002');   -- a stranger

insert into public.profiles (id, full_name, phone) values
  ('11111111-0000-4000-4848-000000000001', 'المالك', '+966509480001'),
  ('22222222-0000-4000-4848-000000000002', 'غريب', '+966509480002');

insert into public.vehicle_makes (id, name_ar, name_en) values
  ('a0000000-0000-4000-4848-000000000001', 'م', 'MakeSweep');
insert into public.vehicle_models (id, make_id, name_ar, name_en, year_from) values
  ('b0000000-0000-4000-4848-000000000001', 'a0000000-0000-4000-4848-000000000001',
   'م', 'ModelSweep', 2015);

set role authenticated;
select test.become('11111111-0000-4000-4848-000000000001');
insert into public.vehicles (id, owner_id, make_id, model_id, year, plate_en)
values ('d0000000-0000-4000-4848-000000000001', '11111111-0000-4000-4848-000000000001',
        'a0000000-0000-4000-4848-000000000001', 'b0000000-0000-4000-4848-000000000001',
        2020, 'ABJ 4848');


-- The logbook cannot be forged ------------------------------------------------------
select test.assert_raises(
  $$select public.append_vehicle_timeline_event(
      'd0000000-0000-4000-4848-000000000001', 'record_annotated',
      'تم تغيير المحرك بالكامل في هبّة', 'Engine replaced at Habba')$$,
  'an owner cannot write a Habba-verified entry of their own wording',
  '42501');

select public.log_vehicle_registration('d0000000-0000-4000-4848-000000000001');
select public.log_vehicle_registration('d0000000-0000-4000-4848-000000000001');
select test.assert_eq(
  (select count(*)::int from public.vehicle_timeline
    where vehicle_id = 'd0000000-0000-4000-4848-000000000001'
      and event_type = 'vehicle_registered'),
  1, 'registration is written once, however often it is asked for');
select test.assert_eq(
  (select summary_ar from public.vehicle_timeline
    where vehicle_id = 'd0000000-0000-4000-4848-000000000001'
      and event_type = 'vehicle_registered'),
  'تم تسجيل السيارة في هبّة', 'in fixed wording the caller does not choose');

select public.record_past_service(
  'd0000000-0000-4000-4848-000000000001', 'تغيير زيت', now() - interval '1 day');
select test.assert_eq(
  (select provenance::text from public.vehicle_timeline
    where vehicle_id = 'd0000000-0000-4000-4848-000000000001' and summary_ar = 'تغيير زيت'),
  'self_reported', 'the owner''s own history is still theirs to write, as self-reported');

select test.become('22222222-0000-4000-4848-000000000002');
select test.assert_raises(
  $$select public.log_vehicle_registration('d0000000-0000-4000-4848-000000000001')$$,
  'a stranger cannot register someone else''s car',
  '42501');


-- Internal machinery is internal ----------------------------------------------------
select test.assert_raises(
  $$select public.broadcast_order(gen_random_uuid(), 1)$$,
  'a client cannot re-dispatch an order', '42501');
select test.assert_raises(
  $$select * from public.match_providers(gen_random_uuid(), 1, 5)$$,
  'a client cannot see who is online near an order', '42501');
select test.assert_raises(
  $$select public.run_maintenance_scan(10)$$,
  'a client cannot run the fleet-wide scan', '42501');
select test.assert_raises(
  $$select public.estimate_current_mileage('d0000000-0000-4000-4848-000000000001')$$,
  'a client cannot read another car''s estimated mileage', '42501');

reset role;


-- The warranty view obeys RLS -------------------------------------------------------
select test.assert(
  (select coalesce('security_invoker=true' = any(c.reloptions), false)
     from pg_class c where c.oid = 'public.active_warranties'::regclass),
  'active_warranties runs with the caller''s rights');


-- Catalogue checks: the next object is closed until opened --------------------------
select test.assert_eq(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'v'
      and not coalesce('security_invoker=true' = any(c.reloptions), false)),
  0, 'every view in public runs with the caller''s rights');

select test.assert_eq(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity),
  0, 'every table in public has row level security');

select test.assert_eq(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c
                       where c like 'search_path=%')),
  0, 'every definer function pins its search_path');

select test.assert_eq(
  (select string_agg(p.proname, ', ' order by p.proname)
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname not like 'test\_%'
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
      and has_function_privilege('anon', p.oid, 'execute')),
  'get_habba_report, get_inspection_report, get_public_settings, is_ops, vat_rate_on, verify_vehicle_timeline',
  'a signed-out caller can run exactly the public list');

-- 0084: the internal readers answer server functions, never a client.
select test.assert_eq(
  (select coalesce(string_agg(distinct p.proname, ', ' order by p.proname), '')
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'setting_number', 'setting_bool', 'setting_text', 'has_role', 'is_provider',
        'is_suspended', 'commission_rate_for', 'payments_live', 'feature_on',
        'auto_complete_window', 'care_default_snooze_days', 'care_lead_days', 'care_lead_km',
        'care_reminder_repeat_days', 'dispatch_max_round', 'dispatch_silence_window',
        'handover_max_attempts', 'location_freshness_limit', 'maintenance_alert_window_days',
        'maintenance_alert_window_km', 'match_radius_for_round', 'ops_stuck_search_after',
        'ops_unconfirmed_after', 'otp_send_limit', 'otp_send_window', 'ownership_transfer_window',
        'route_detour_factor', 'transfer_accept_limit', 'transfer_accept_window',
        'transfer_attempt_limit', 'urban_speed_kmh')
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
      and has_function_privilege('authenticated', p.oid, 'execute')),
  '', 'a signed-in caller cannot read internal settings, limits or anyone''s roles');

select test.assert_eq(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public' and grantee in ('anon', 'authenticated')
      and privilege_type in ('TRUNCATE', 'TRIGGER', 'REFERENCES')),
  0, 'no client role can truncate a table, which RLS would not stop');

rollback;

\echo '   security sweep OK'
