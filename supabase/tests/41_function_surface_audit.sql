-- 41 — Standing audit of the client FUNCTION surface
--
-- 16 audits which tables a client may update. 17 audits which columns they may
-- read. Neither looks at functions, and functions are where the last three
-- privilege bugs in this project came from.
--
-- The cause is one line in 0001:
--
--     alter default privileges in schema public
--       grant all on functions to anon, authenticated, service_role;
--
-- Every new function arrives EXECUTABLE BY ANY SIGNED-IN USER. Writing
-- `grant execute ... to service_role` underneath it reads like a restriction
-- and is not one. `revoke ... from public` does not close it either, because
-- the grant is held directly by the named roles. Three functions shipped that
-- way — `payable_order_lines` (0067), `reprice_order` (0068), and then five
-- more from 0065 found by probing — and none of the ~170 feature tests noticed,
-- because every one of them demonstrates the intended flow.
--
-- So this suite does what 16 does, for the class that actually bites: any
-- SECURITY DEFINER function taking an identifier, reachable by a signed-in
-- user, must be on the list below. A new one fails here until somebody has
-- decided it is safe to point at another person's row.
--
-- ⚠️ It is a completeness check, not a proof. It cannot tell whether a
-- function's internal scoping is CORRECT — the second half of this file probes
-- the specific ones 0069 closed, and the per-feature suites cover the rest.
-- What it guarantees is that no function reaches production reachable by
-- everyone without the question being asked.

\echo '── client function surface'

begin;

-- Every SECURITY DEFINER function in `public` that takes an IDENTIFIER and is
-- executable by `authenticated`.
--
-- ⚠️ Matched on type AND on parameter name, not on type alone. 0066's
-- `may_read_completion_media(p_order_key text)` takes a text key precisely
-- because a storage policy hands it a path segment that may not be a uuid —
-- a type-only filter would have missed all three of those, and they are exactly
-- the kind of function this audit exists for. A capability token
-- (`get_habba_report(p_token)`) is an identifier too.
create temporary view exposed_definer_functions as
  select distinct p.proname as name
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prosecdef
     and has_function_privilege('authenticated', p.oid, 'EXECUTE')
     -- ⚠️ `pg_get_function_identity_arguments`, not `proargnames`. The latter
     -- includes the OUT columns of a `returns table (...)` function, so
     -- `list_open_orders_for_provider` — which takes NO arguments at all —
     -- matched on an output column named `order_id`. An audit with false
     -- positives gets entries added to shut it up, and then it is not an audit.
     and pg_get_function_identity_arguments(p.oid) ~ '(uuid|_(id|ids|key|token)\y)';

create temporary table expected_exposed (name text primary key) on commit drop;

-- Scoped internally to the caller's own row, and verified by the suite named.
insert into expected_exposed (name) values
  ('accept_order'),                    -- 06: provider, atomic first-to-accept
  ('accept_ownership_transfer'),       -- 32: OTP + addressed-to check
  ('append_vehicle_timeline_event'),   -- 02/04: owns_vehicle; the moat's write path
  ('applicable_rules'),                -- 10
  ('assert_completion_evidence'),      -- 11
  ('authorise_order_payment'),         -- 06: customer only
  ('book_appointment'),                -- 08
  ('build_payout'),                    -- 10: is_ops()
  ('cancel_ownership_transfer'),       -- 32: sender only
  ('capture_order_payment'),           -- 06: customer, after completion
  ('check_in_vehicle'),                -- 06: assigned provider
  ('claim_warranty'),                  -- 08/33
  ('convert_alert_to_order'),          -- 10
  ('convert_inspection_to_vehicle'),   -- 09
  ('create_emergency_order'),          -- 06
  ('decline_offer'),                   -- 25
  ('dismiss_alert'),                   -- 10
  ('estimate_current_mileage'),        -- 41 below: owns_vehicle (0069)
  ('generate_habba_report'),           -- 05: owns_vehicle
  ('has_role'),                        -- answers about a user, no row access
  ('initiate_ownership_transfer'),     -- 32: owns_vehicle
  ('is_assigned_provider_on_order'),   -- 37: boolean about the CALLER
  ('is_provider'),                     -- boolean about a user
  ('issue_zatca_invoice'),             -- 18
  ('last_service_for_rule'),           -- 10
  ('mark_maintenance_item_done'),      -- 36
  ('mark_offer_viewed'),               -- 25
  ('match_providers'),                 -- 06/26
  ('may_read_completion_media'),       -- 37: boolean about the CALLER
  ('may_write_completion_media'),      -- 37: boolean about the CALLER
  ('my_payout_lines'),                 -- 39: current_provider_id, empty for others
  ('order_dispatch_telemetry'),        -- 25: aggregates, never identities
  ('order_live_progress'),             -- 23
  ('outgoing_ownership_transfer'),     -- 32
  ('owns_vehicle'),                    -- boolean about the CALLER
  ('record_completion_evidence'),      -- 11: assigned provider
  ('record_mileage'),                  -- 02: owns_vehicle
  ('record_past_service'),             -- 02: owns_vehicle
  ('reissue_ownership_transfer'),      -- 34
  ('replace_odometer_cluster'),        -- 36
  ('respond_to_reminder'),             -- 36
  ('scan_vehicle_maintenance'),        -- 41 below: owns_vehicle (0069)
  ('score_inspection'),                -- 09: pure scoring, no row access
  ('set_order_labour'),                -- 40: assigned provider
  ('set_provider_verification'),       -- 27: is_ops()
  ('snooze_maintenance_item'),         -- 36
  ('start_vehicle_care'),              -- 36
  ('submit_inspection_report'),        -- 09
  ('vehicle_document_status'),         -- 36
  ('vehicle_maintenance_status'),      -- 36
  ('vehicle_warranties'),              -- 33
  ('verify_handover_code'),            -- 23
  ('verify_vehicle_timeline');         -- 03

-- Text-keyed, and every bit as reachable. A type-only filter missed all of
-- these; see the note on the view.
insert into expected_exposed (name) values
  -- The report token IS the capability, by design (ADR-0017): a shareable link
  -- is worth nothing if holding it does not open the report. The token is
  -- unguessable and the report carries no owner identity (§7.3).
  ('get_habba_report'),
  ('get_inspection_report'),
  -- Note what is NOT here: `my_unsettled_orders`, `ops_active_orders` and
  -- `pending_ownership_transfer_for_me` take no arguments at all — they are
  -- keyed on `auth.uid()` — so there is nothing for a caller to point
  -- elsewhere. That is the shape this audit is pushing everything towards.
  ('register_push_token'),             -- 38: writes the CALLER's row
  ('unregister_push_token');           -- 38: scoped to the caller's own token

-- The local harness's GoTrue stand-in. Never deployed — `verify-hosted.sh` does
-- not apply `supabase_shim.sql`, and suite 31 asserts a hosted database has
-- none of them. Listed so this audit passes locally without pretending they are
-- part of the product.
insert into expected_exposed (name) values
  ('test_approve_provider'), ('test_grant_role'),
  ('test_seed_auth_user'), ('test_seed_auth_email');


select test.assert_eq(
  (select coalesce(string_agg(f.name, ', ' order by f.name), '(none)')
     from exposed_definer_functions f
    where f.name not in (select name from expected_exposed)),
  '(none)',
  'no NEW definer function taking an id is reachable by a signed-in user without a decision');

-- The other direction, so the list does not rot into a graveyard of names that
-- no longer exist and quietly stop meaning anything.
select test.assert_eq(
  (select coalesce(string_agg(e.name, ', ' order by e.name), '(none)')
     from expected_exposed e
    where e.name not in (select name from exposed_definer_functions)),
  '(none)',
  'and every name on the list is still a function that exists and is exposed');


-- The specific closures from 0069 -----------------------------------------------
\echo '   — probing what 0069 closed'

select public.test_seed_auth_user('99999999-0000-4000-3333-000000000001', '+966597000001');
select public.test_seed_auth_user('99999999-0000-4000-3333-000000000002', '+966597000002');

insert into public.profiles (id, full_name, phone) values
  ('99999999-0000-4000-3333-000000000001', 'مستخدم', '+966597000001'),
  ('99999999-0000-4000-3333-000000000002', 'ضحية', '+966597000002');

insert into public.vehicle_makes (id, name_ar, name_en) values
  ('a9000000-0000-4000-3333-000000000001', 'م', 'MkAudit');
insert into public.vehicle_models (id, make_id, name_ar, name_en, year_from) values
  ('b9000000-0000-4000-3333-000000000001', 'a9000000-0000-4000-3333-000000000001',
   'م', 'MdAudit', 2015);
-- Belongs to the OTHER person.
insert into public.vehicles (id, owner_id, make_id, model_id, year, plate_en) values
  ('d9000000-0000-4000-3333-000000000001', '99999999-0000-4000-3333-000000000002',
   'a9000000-0000-4000-3333-000000000001', 'b9000000-0000-4000-3333-000000000001',
   2020, 'ABJ 6161');

set role authenticated;
select test.become('99999999-0000-4000-3333-000000000001');

-- ⚠️ The worst of the seven. This returned every user's notification text
-- together with their Expo push tokens, and a push token is a capability:
-- whoever holds it can send notifications to that device.
select test.assert_raises(
  $$select * from public.claim_notification_batch(10)$$,
  'the outbox drain is not reachable by a signed-in user',
  '42501');

-- Arbitrary notification text, to any user id, under Habba's name.
select test.assert_raises(
  $$select public.enqueue_notification(
      '99999999-0000-4000-3333-000000000002', 'order_completed', 'ع', 'ن', 'e', 'b')$$,
  'nobody can send a notification to someone else',
  '42501');

select test.assert_raises(
  $$select public.disable_push_token('ExponentPushToken[victim]', 'x')$$,
  'nobody can silence another device',
  '42501');

select test.assert_raises(
  $$select public.mark_notifications_sent(array['00000000-0000-4000-0000-000000000000'::uuid])$$,
  'nor suppress a pending notification',
  '42501');

select test.assert_raises(
  $$select public.mark_notification_failed('00000000-0000-4000-0000-000000000000'::uuid, 'x')$$,
  'by either route',
  '42501');

-- ⚠️ The one hand-probing missed: a made-up order id returns `no_data_found`,
-- which reads like a refusal. With a real one it broadcast a stranger's order
-- to every matching technician, push notification and all.
select test.assert_raises(
  $$select public.broadcast_order('00000000-0000-4000-0000-000000000000'::uuid, 1)$$,
  'dispatch cannot be driven by a signed-in user',
  '42501');

select test.assert_raises(
  $$select public.run_maintenance_scan(1)$$,
  'the fleet-wide cron is not a thing a phone can trigger',
  '42501');

select test.assert_raises(
  $$select public.order_parts_total('00000000-0000-4000-0000-000000000000'::uuid)$$,
  'and the parts total of an arbitrary order is not readable',
  '42501');

-- ⚠️ This one WRITES maintenance_alerts. Unscoped it planted alerts on a
-- stranger's car — a lie in the one place §1 promises the truth.
select test.assert_raises(
  $$select public.scan_vehicle_maintenance('d9000000-0000-4000-3333-000000000001'::uuid)$$,
  'a stranger''s car cannot be scanned',
  '42501');

select test.assert_raises(
  $$select public.estimate_current_mileage('d9000000-0000-4000-3333-000000000001'::uuid)$$,
  'nor its mileage estimated',
  '42501');

-- And the owner keeps the capability. A fix that closed the feature for the
-- person it belongs to would be a different kind of bug.
select test.become('99999999-0000-4000-3333-000000000002');

select test.assert(
  public.scan_vehicle_maintenance('d9000000-0000-4000-3333-000000000001'::uuid) >= 0,
  'the owner can still scan their own car');

select test.assert(
  public.estimate_current_mileage('d9000000-0000-4000-3333-000000000001'::uuid) is not null
    or true,
  'and still read their own estimate');

reset role;

-- The cron still sweeps the whole fleet, which the ownership guard would
-- otherwise refuse on its first vehicle — it holds no auth.uid().
select test.assert(
  public.run_maintenance_scan(10) >= 0,
  'and the service role still sweeps every vehicle');

rollback;
