-- 37 — The cluster path, as a path somebody can take (0064)
--
-- ADR-0022 shipped `replace_odometer_cluster` and no way to reach it, and
-- `record_mileage`'s refusal pointed at it by name. The failure that made that
-- worth fixing is §6 here: the refusal is PERMANENT, because every later
-- reading is also below the head, so the care section goes dead for that
-- vehicle and the message explains nothing the owner can act on.
--
-- The assertions this suite exists for:
--
--   * the owner cannot call it (§2) — and could before 0064, screen or no
--     screen, because PostgREST exposes every granted function;
--   * support can, against a car it does not own (§3);
--   * naming an operator is not decoration: a non-ops id is refused (§4);
--   * every call is written down, and the record cannot be edited by the
--     account that reads it (§5);
--   * the owner can record readings again afterwards (§6).

\echo '── cluster replacement path'

begin;

select public.test_seed_auth_user('dd111111-0000-4000-c000-000000000001', '+966505400001');
select public.test_seed_auth_user('dd111111-0000-4000-c000-000000000002', '+966505400002');
select public.test_seed_auth_user('dd111111-0000-4000-c000-000000000003', '+966505400003');

insert into public.profiles (id, full_name, phone) values
  ('dd111111-0000-4000-c000-000000000001', 'المالك', '+966505400001'),
  ('dd111111-0000-4000-c000-000000000002', 'مشغّل الدعم', '+966505400002'),
  ('dd111111-0000-4000-c000-000000000003', 'غريب', '+966505400003');

-- The operator, through grant_user_role() like every other role in this
-- project — never by writing user_roles directly (0040).
select test.grant_role('dd111111-0000-4000-c000-000000000002', 'ops');

insert into public.vehicle_makes (id, name_ar, name_en) values
  ('dd000000-0000-4000-c000-000000000001', 'ماركة العدّاد', 'TestMakeCluster');
insert into public.vehicle_models (id, make_id, name_ar, name_en, year_from) values
  ('dd000000-0000-4000-c000-000000000002', 'dd000000-0000-4000-c000-000000000001',
   'موديل العدّاد', 'TestModelCluster', 2012);

-- A high-mileage car, which is the fleet this case actually happens in.
insert into public.vehicles (id, owner_id, make_id, model_id, year, plate_en, current_mileage)
values
  ('dd000000-0000-4000-c000-0000000000a1', 'dd111111-0000-4000-c000-000000000001',
   'dd000000-0000-4000-c000-000000000001', 'dd000000-0000-4000-c000-000000000002',
   2013, 'ABJ 9001', 240000);


-- ---------------------------------------------------------------------------
-- 1. The car is stuck, exactly as an owner would find it
-- ---------------------------------------------------------------------------
set role authenticated;
select test.become('dd111111-0000-4000-c000-000000000001');

select test.assert_eq(
  (select r.km from public.vehicle_odometer_readings r
   where r.vehicle_id = 'dd000000-0000-4000-c000-0000000000a1'
   order by r.series desc, r.km desc limit 1),
  240000, 'the stated mileage seeded a series (0063)');

-- The cold start happens when the car is added — long before a cluster dies —
-- so the interval is anchored on the OLD cluster's scale. §6 comes back to it.
select public.start_vehicle_care(
  'dd000000-0000-4000-c000-0000000000a1', p_last_oil_km => 236000);

select test.assert_eq(
  (select due_at_km from public.vehicle_maintenance_status(
     'dd000000-0000-4000-c000-0000000000a1') where item_type = 'engine_oil'),
  243000, 'and the oil is due at 243,000 km');

-- The new cluster reads 12 km. Every reading from it is below the head, so
-- this refusal is not a one-off — it is every reading this car will ever have.
select test.assert_raises(
  $$select public.record_mileage('dd000000-0000-4000-c000-0000000000a1', 12)$$,
  'a reading from the new cluster is refused',
  '23514');
select test.assert_raises(
  $$select public.record_mileage('dd000000-0000-4000-c000-0000000000a1', 300)$$,
  'and so is the next one, and every one after it',
  '23514');

reset role;

-- The refusal no longer names a function the owner cannot call. The sentence
-- they actually read comes from packages/i18n; this is the server hint, which
-- PostgREST returns to the client and support reads in a log.
--
-- Defined and called with no role set: the floor check raises before
-- record_mileage touches anything that needs an identity.
create or replace function pg_temp.refusal_hint() returns text
language plpgsql as $$
declare v_hint text;
begin
  begin
    perform public.record_mileage('dd000000-0000-4000-c000-0000000000a1', 12);
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
    return v_hint;
  end;
  return '(no refusal)';
end $$;

select test.assert(
  pg_temp.refusal_hint() not like '%replace_odometer_cluster%',
  'the refusal does not name an RPC at a person who cannot call one');
select test.assert(
  pg_temp.refusal_hint() like '%support%',
  'it names support, which is a path that exists');
select test.assert(
  pg_temp.refusal_hint() like '%runbooks/odometer-cluster-replacement%',
  'and points at the runbook that says what support should do');


-- ---------------------------------------------------------------------------
-- 2. The owner cannot run it — which is new
-- ---------------------------------------------------------------------------
-- Before 0064 this was granted to `authenticated` and gated on owns_vehicle().
-- Having no screen never made it unreachable: any owner could POST to it and
-- re-anchor their own odometer downwards. The absent UI was not the control.
set role authenticated;
select test.become('dd111111-0000-4000-c000-000000000001');

select test.assert_raises(
  $$select public.replace_odometer_cluster(
      'dd000000-0000-4000-c000-0000000000a1', 12, 'cluster_replaced',
      'عدّاد جديد تم تركيبه اليوم',
      'dd111111-0000-4000-c000-000000000002')$$,
  'the owner of the car cannot start a new series',
  '42501');

-- Nor can an operator acting through a client session: holding `ops` is not the
-- same as holding the service key, and the grant is what decides.
select test.become('dd111111-0000-4000-c000-000000000002');
select test.assert_raises(
  $$select public.replace_odometer_cluster(
      'dd000000-0000-4000-c000-0000000000a1', 12, 'cluster_replaced',
      'عدّاد جديد تم تركيبه اليوم',
      'dd111111-0000-4000-c000-000000000002')$$,
  'and neither can an ops user over a normal client connection',
  '42501');

reset role;
set role anon;
select test.assert_raises(
  $$select public.replace_odometer_cluster(
      'dd000000-0000-4000-c000-0000000000a1', 12, 'cluster_replaced',
      'عدّاد جديد تم تركيبه اليوم',
      'dd111111-0000-4000-c000-000000000002')$$,
  'nor an anonymous caller',
  '42501');
reset role;


-- ---------------------------------------------------------------------------
-- 3. Support can, against a car it does not own
-- ---------------------------------------------------------------------------
set role service_role;

select public.replace_odometer_cluster(
  'dd000000-0000-4000-c000-0000000000a1', 12, 'cluster_replaced',
  'المالك أرسل صورة فاتورة تركيب عدّاد من وكالة معتمدة بتاريخ أمس',
  'dd111111-0000-4000-c000-000000000002') as swap \gset

select test.assert(:'swap' <> '', 'support starts the new series');

select test.assert_eq(
  (select r.series from public.vehicle_odometer_readings r where r.id = (:'swap')::uuid),
  2, 'as a second series');

select test.assert_eq(
  (select r.series_offset_km + r.km from public.vehicle_odometer_readings r
   where r.id = (:'swap')::uuid),
  240012, 'carrying the distance the old cluster actually travelled');

-- 0063's derived column follows, and falls, without anybody touching it.
select test.assert_eq(
  (select current_mileage from public.vehicles
   where id = 'dd000000-0000-4000-c000-0000000000a1'),
  12, 'and the vehicle row falls to what the dashboard now reads');

-- §1 of CLAUDE.md: the logbook records what happened to the car. A replaced
-- cluster is among the most material facts a used-car buyer can be told, and it
-- belongs to the owner's history whoever performed it.
select test.assert_eq(
  (select created_by from public.vehicle_timeline
   where vehicle_id = 'dd000000-0000-4000-c000-0000000000a1'
     and summary_en like 'Instrument cluster replaced%'),
  'dd111111-0000-4000-c000-000000000002'::uuid,
  'the logbook entry names the operator who did it, not the owner');

reset role;


-- ---------------------------------------------------------------------------
-- 4. Naming an operator is a check, not a field
-- ---------------------------------------------------------------------------
set role service_role;

select test.assert_raises(
  $$select public.replace_odometer_cluster(
      'dd000000-0000-4000-c000-0000000000a1', 20, 'correction',
      'محاولة بدون مشغّل معروف',
      'dd111111-0000-4000-c000-000000000003')$$,
  'a caller who is not an operator cannot be named as one',
  '42501');

select test.assert_raises(
  $$select public.replace_odometer_cluster(
      'dd000000-0000-4000-c000-0000000000a1', 20, 'correction',
      'محاولة بدون مشغّل معروف', null)$$,
  'and the operator cannot be left out',
  '42501');

-- A leaked service key is not enough on its own: it also needs the id of
-- somebody the database agrees is an operator, today.
select public.revoke_user_role('dd111111-0000-4000-c000-000000000002', 'ops') \gset x
select test.assert_raises(
  $$select public.replace_odometer_cluster(
      'dd000000-0000-4000-c000-0000000000a1', 20, 'correction',
      'المشغّل لم يعد على رأس العمل',
      'dd111111-0000-4000-c000-000000000002')$$,
  'a revoked operator stops being one immediately',
  '42501');
reset role;
select test.grant_role('dd111111-0000-4000-c000-000000000002', 'ops');
set role service_role;

-- Why, in words, and enough of them to judge later.
select test.assert_raises(
  $$select public.replace_odometer_cluster(
      'dd000000-0000-4000-c000-0000000000a1', 20, 'correction', 'خطأ',
      'dd111111-0000-4000-c000-000000000002')$$,
  'a written reason is required, and one word is not one',
  '23514');

reset role;


-- ---------------------------------------------------------------------------
-- 5. The ledger — 0057's conventions
-- ---------------------------------------------------------------------------
set role service_role;

select test.assert_eq(
  (select count(*)::int from public.odometer_series_interventions
   where vehicle_id = 'dd000000-0000-4000-c000-0000000000a1'),
  1, 'exactly one row, for the one call that succeeded');

-- Both series, as they were at the moment of the swap: what support needs to
-- answer "what was done to this car" without re-deriving the head rule.
select test.assert_eq(
  (select from_series || '@' || from_km || '/' || from_lifetime_km || ' → '
       || to_series || '@' || to_km || '/' || to_lifetime_km
   from public.odometer_series_interventions
   where vehicle_id = 'dd000000-0000-4000-c000-0000000000a1'),
  '1@240000/240000 → 2@12/240012',
  'and it records both series, on both scales');

select test.assert_eq(
  (select performed_by from public.odometer_series_interventions
   where vehicle_id = 'dd000000-0000-4000-c000-0000000000a1'),
  'dd111111-0000-4000-c000-000000000002'::uuid,
  'who ran it — the operator, because service_role is a shared key');

select test.assert(
  (select note like '%فاتورة%' from public.odometer_series_interventions
   where vehicle_id = 'dd000000-0000-4000-c000-0000000000a1'),
  'and why, in the operator''s own words');

select test.assert_eq(
  (select reading_id from public.odometer_series_interventions
   where vehicle_id = 'dd000000-0000-4000-c000-0000000000a1'),
  (:'swap')::uuid,
  'tied to the reading it minted');

-- Not rewritable by the account that reads it. The guard is ENABLE ALWAYS, for
-- 0056's reason: a leaked service key must not be able to edit the record of
-- what it did.
select test.assert_raises(
  $$update public.odometer_series_interventions set note = 'nothing to see'$$,
  'service_role cannot rewrite the ledger it reads',
  '42501');
select test.assert_raises(
  $$delete from public.odometer_series_interventions$$,
  'nor erase it',
  '42501');
select test.assert_raises(
  $$insert into public.odometer_series_interventions
      (vehicle_id, performed_by, reason, note, from_series, from_km,
       from_lifetime_km, to_series, to_series_offset_km, to_km, to_lifetime_km,
       reading_id)
    values ('dd000000-0000-4000-c000-0000000000a1',
            'dd111111-0000-4000-c000-000000000002', 'correction', 'invented row',
            1, 1, 1, 2, 0, 1, 1, gen_random_uuid())$$,
  'nor invent an intervention that never happened',
  '42501');

reset role;

-- Closed to clients entirely: it maps cars to operators and to free text about
-- somebody's vehicle.
set role authenticated;
select test.become('dd111111-0000-4000-c000-000000000001');
select test.assert_raises(
  $$select count(*) from public.odometer_series_interventions$$,
  'the owner of the car cannot read the ledger',
  '42501');
select test.become('dd111111-0000-4000-c000-000000000002');
select test.assert_raises(
  $$select count(*) from public.odometer_series_interventions$$,
  'and neither can an ops user over a client connection',
  '42501');
reset role;


-- ---------------------------------------------------------------------------
-- 6. The section comes back to life
-- ---------------------------------------------------------------------------
-- The whole point. Before 0064 this car was finished: every reading refused,
-- forever, with a message naming something the owner could not reach.
set role authenticated;
select test.become('dd111111-0000-4000-c000-000000000001');

select public.record_mileage('dd000000-0000-4000-c000-0000000000a1', 480);

select test.assert_eq(
  (select r.km from public.vehicle_odometer_readings r
   where r.vehicle_id = 'dd000000-0000-4000-c000-0000000000a1'
   order by r.series desc, r.km desc limit 1),
  480, 'the owner can record readings again');

select test.assert_eq(
  (select r.series_offset_km + r.km from public.vehicle_odometer_readings r
   where r.vehicle_id = 'dd000000-0000-4000-c000-0000000000a1'
   order by r.series desc, r.km desc limit 1),
  240480, 'and the car keeps the distance it had travelled before the swap');

-- The due point was set in §1, on the old cluster's scale. It is unchanged,
-- because intervals are measured in LIFETIME km and the swap carried that
-- across — an item anchored before a cluster died is still anchored correctly
-- after it.
select test.assert_eq(
  (select due_at_km from public.vehicle_maintenance_status(
     'dd000000-0000-4000-c000-0000000000a1') where item_type = 'engine_oil'),
  243000, 'the due point set before the swap is untouched by it');

select test.assert_eq(
  (select km_remaining from public.vehicle_maintenance_status(
     'dd000000-0000-4000-c000-0000000000a1') where item_type = 'engine_oil'),
  2520, 'and the distance still to go is measured ACROSS the swap');

-- 2,520 km later, on a cluster that reads 3,100.
select public.record_mileage('dd000000-0000-4000-c000-0000000000a1', 3100);

select test.assert_eq(
  (select due_by_km from public.vehicle_maintenance_status(
     'dd000000-0000-4000-c000-0000000000a1') where item_type = 'engine_oil'),
  true, 'and the item falls due at the right distance, rather than never');

reset role;


-- ---------------------------------------------------------------------------
-- 7. The old four-argument form is gone, not merely ungranted
-- ---------------------------------------------------------------------------
-- It was the one granted to `authenticated`. Left in the catalogue it would
-- have been the form a client still reached, and §2 would have proved nothing.
select test.assert_eq(
  (select count(*)::int from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'replace_odometer_cluster'),
  1, 'there is exactly one replace_odometer_cluster, and it is the new one');

select test.assert_eq(
  (select pg_get_function_identity_arguments(p.oid) from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'replace_odometer_cluster'),
  'p_vehicle_id uuid, p_km integer, p_reason odometer_series_reason, p_note text, p_performed_by uuid',
  'with the operator and the reason as required arguments');

-- 0001's ALTER DEFAULT PRIVILEGES grants execute on every new function to anon,
-- authenticated and service_role — so a function starts REACHABLE and has to be
-- closed. This asserts the close, for both functions 0064 adds.
select test.assert_eq(
  (select coalesce(string_agg(distinct grantee, ', ' order by grantee), '(none)')
   from information_schema.role_routine_grants
   where routine_schema = 'public'
     and routine_name in ('replace_odometer_cluster', 'append_timeline_event_as')
     and grantee in ('anon', 'authenticated')),
  '(none)',
  'neither function 0064 adds is reachable by a client role');

rollback;

\echo '   cluster replacement path OK'
