-- 16 — Standing audit of the client write surface
--
-- Twelve vulnerabilities were found in this project by hand-probing what a
-- client could actually write. None was found by the ~150 tests written
-- alongside the features, because those demonstrate the intended flow works —
-- they say nothing about what else is reachable.
--
-- Hand-probing does not scale and does not repeat. This suite turns the audit
-- into a build step: any NEW table that clients can update, or any NEW column
-- on one, fails here until somebody has made a decision about it.
--
-- It is a completeness check, not a proof. It cannot tell whether a guard is
-- CORRECT — the per-table suites (12–15) do that. What it guarantees is that
-- no column reaches production without the question being asked.

\echo '── client write surface'

begin;

-- Tables a non-ops client can update, and therefore where the "which columns"
-- question has to have an answer.
create temporary table expected_guarded (table_name text primary key) on commit drop;
insert into expected_guarded (table_name) values
  ('orders'),              -- 0033
  ('vehicles'),            -- 0034
  ('providers'),           -- 0034
  ('order_parts'),         -- 0035
  ('profiles'),            -- 0036  (privilege escalation)
  ('habba_reports'),       -- 0036  (report tampering)
  ('appointment_slots'),   -- 0036  (booked_count)
  ('order_offers');        -- 0042  (self-acceptance bypassing escrow)

-- Tables whose only update policy is ops-gated. RLS alone is a sufficient
-- answer there: `using (is_ops())` already restricts the whole row.
create temporary table expected_ops_only (table_name text primary key) on commit drop;
insert into expected_ops_only (table_name) values
  ('cities'), ('vehicle_makes'), ('vehicle_models'), ('services'),
  ('maintenance_rules'), ('commission_rates'), ('inspection_templates'),
  ('invoice_sellers'), ('payouts');

-- Tables where a client may write, but every column is theirs to set and the
-- row is scoped to them by RLS. Listed explicitly so the exemption is a
-- decision rather than an oversight.
create temporary table expected_self_owned (table_name text primary key) on commit drop;
insert into expected_self_owned (table_name) values
  ('provider_services'),   -- own service list; price guarded separately
  ('provider_locations'),  -- own position, overwritten every 20s
  ('workshops');           -- own address and hours


-- 1. Every table a client can update is accounted for --------------------------
-- A NEW table with a client update policy fails here until it is classified.
select test.assert_eq(
  (select coalesce(string_agg(t.relname, ', ' order by t.relname), '(none)')
   from (
     select distinct c.relname
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     join pg_policy p on p.polrelid = c.oid
     where n.nspname = 'public' and c.relkind = 'r'
       and p.polcmd in ('*', 'w')
       -- Ops-only policies carry is_ops() in their USING clause.
       and pg_get_expr(p.polqual, p.polrelid) not like '%is_ops()%'
   ) t
   where t.relname not in (select table_name from expected_guarded)
     and t.relname not in (select table_name from expected_self_owned)),
  '(none)',
  'every client-updatable table is either guarded or explicitly self-owned');


-- 2. Every table we said is guarded actually has a guard trigger ----------------
-- Catches a guard being dropped, or a table being classified without one.
select test.assert_eq(
  (select coalesce(string_agg(e.table_name, ', ' order by e.table_name), '(none)')
   from expected_guarded e
   where not exists (
     select 1 from pg_trigger tg
     join pg_class c on c.oid = tg.tgrelid
     join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = e.table_name
       and not tg.tgisinternal
       and tg.tgname like '%guard_columns'
   )),
  '(none)',
  'every table classified as guarded has a column-guard trigger');


-- 3. Guards fire for every role, including the table owner ----------------------
-- A guard registered as ENABLE ORIGIN would not fire during replication, and
-- would not fire for service_role — which is precisely the actor most worth
-- guarding, since RLS does not apply to it at all.
select test.assert_eq(
  (select coalesce(string_agg(c.relname || '.' || tg.tgname, ', '), '(none)')
   from pg_trigger tg
   join pg_class c on c.oid = tg.tgrelid
   join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and not tg.tgisinternal
     and (tg.tgname like '%guard%' or tg.tgname like '%immutable%')
     and tg.tgenabled <> 'A'),
  '(none)',
  'every guard trigger is ENABLE ALWAYS, so service_role cannot slip past it');


-- 4. The privilege columns are covered by name ----------------------------------
-- A belt-and-braces check on the specific columns whose exposure caused the
-- worst findings. If any of these is ever added to a new table, this is the
-- reminder to guard it there too.
create temporary table sensitive_columns (table_name text, column_name text) on commit drop;
insert into sensitive_columns values
  ('profiles', 'role'),                    -- escalation to ops
  ('profiles', 'phone_verified'),
  ('orders', 'escrow_status'),             -- declaring yourself paid
  ('orders', 'payment_intent_id'),
  ('orders', 'total_amount'),
  ('vehicles', 'current_mileage'),         -- odometer rollback
  ('vehicles', 'vin'),                     -- transplanting a history
  ('providers', 'verification_status'),    -- self-approval
  ('providers', 'rating_avg'),             -- self-assigned dispatch priority
  ('habba_reports', 'payload'),            -- rewriting an issued report
  ('appointment_slots', 'booked_count'),
  ('order_parts', 'unit_price');

select test.assert_eq(
  (select coalesce(string_agg(s.table_name || '.' || s.column_name, ', '), '(none)')
   from sensitive_columns s
   where not exists (
     select 1 from information_schema.columns col
     where col.table_schema = 'public'
       and col.table_name = s.table_name
       and col.column_name = s.column_name
   )),
  '(none)',
  'every column named in the audit still exists (renames must be re-audited)');

select test.assert_eq(
  (select coalesce(string_agg(distinct s.table_name, ', '), '(none)')
   from sensitive_columns s
   where s.table_name not in (select table_name from expected_guarded)),
  '(none)',
  'every table holding a sensitive column is classified as guarded');


-- 5. Append-only tables have no client write path --------------------------------
-- vehicle_timeline is the moat; zatca_invoices and inspection_reports are
-- records of fact. All three are written only by SECURITY DEFINER functions.
select test.assert_eq(
  (select coalesce(string_agg(c.relname, ', '), '(none)')
   from pg_class c
   join pg_namespace n on n.oid = c.relnamespace
   join pg_policy p on p.polrelid = c.oid
   where n.nspname = 'public'
     and c.relname in ('vehicle_timeline', 'zatca_invoices', 'inspection_reports',
                       'order_events', 'payout_orders')
     and p.polcmd in ('*', 'w', 'a')),
  '(none)',
  'append-only and system-written tables expose no client INSERT or UPDATE policy');

rollback;

\echo '   client write surface OK'
