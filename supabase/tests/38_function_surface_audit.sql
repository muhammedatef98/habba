-- 38 — Standing audit of the client EXECUTE surface
--
-- The third of these. 16 audits which columns a client may write, 17 which it
-- may read, and neither of them looks at functions — which is how
-- `begin_privileged_write()`, the switch that exempts a write from every
-- column guard those two suites protect, sat granted to `authenticated` from
-- 0033 until 0065.
--
-- The cause is structural rather than careless, which is why this has to be a
-- build step and not a memory. 0001 sets
--
--     alter default privileges in schema public
--       grant all on functions to anon, authenticated, service_role;
--
-- so a function is client-callable the moment it is created, and `revoke
-- execute ... from public` — the line everyone writes — removes a grant that
-- was never the one in force. The revoke looks right, reads right, and does
-- nothing. Exactly the shape of the column-level REVOKE in HANDOFF §6.
--
-- Like 16 and 17 this is a COMPLETENESS check, not a proof: it says the
-- question was asked about each function named here, not that every function
-- in the schema is correctly scoped.

\echo '── client execute surface'

begin;

-- Functions no client role may call, and why.
create temporary table internal_functions (
  signature text primary key,
  reason    text not null
) on commit drop;

insert into internal_functions (signature, reason) values
  ('public.begin_privileged_write()',
   'exempts a write from every column guard in 0033–0039'),
  ('public.end_privileged_write()',
   'the other half of the same switch'),
  ('public.end_privileged_write_unless(boolean)',
   'the same switch, conditionally closed (0063)'),
  ('public.record_audit(text, text, uuid, jsonb, jsonb)',
   'the only writer into audit_log; a client that could call it could record an action nobody took'),
  ('public.request_client_ip()',
   'reads request headers for the audit row; nothing a client needs to ask for');

-- Every client role, named. `service_role` is here because RLS never applies
-- to it and the admin console holds its key: it is the one actor for whom a
-- grant is the ONLY thing standing in the way.
create temporary table client_roles (role_name text primary key) on commit drop;
insert into client_roles (role_name) values ('anon'), ('authenticated'), ('service_role');

select test.assert_eq(
  (select coalesce(string_agg(f.signature || ' → ' || r.role_name, ', ' order by f.signature), '(none)')
   from internal_functions f
   cross join client_roles r
   where has_function_privilege(r.role_name, f.signature, 'execute')),
  '(none)',
  'no client role can execute an internal function');

-- The list is only worth something if the things on it exist. A signature that
-- has been renamed or re-argumented silently stops being audited — and
-- `has_function_privilege` on a missing function raises rather than returning
-- false, so this runs first in spirit even though it reads second.
select test.assert_eq(
  (select count(*)::int from internal_functions f
   where to_regprocedure(f.signature) is null),
  0,
  'and every signature named here still exists (a rename must be re-audited)');


-- The mechanism itself ----------------------------------------------------------
-- Stated as data rather than as a comment somebody may decide to tidy away: a
-- function created by the migration role arrives with a DIRECT grant to each
-- client role, which is why `revoke ... from public` is not enough.
--
-- Read from `pg_default_acl` rather than demonstrated with a throwaway
-- function, because a default ACL belongs to the role that declared it: the
-- suites run as the superuser and a probe created here would get the ordinary
-- PUBLIC grant instead, "prove" that revoking PUBLIC works, and say nothing
-- whatsoever about the functions the migrations create.
select test.assert(
  exists (
    select 1 from pg_default_acl d
    join pg_namespace n on n.oid = d.defaclnamespace
    where n.nspname = 'public' and d.defaclobjtype = 'f'
      and array_to_string(d.defaclacl, ',') like '%authenticated=X%'
  ),
  'a function created by the migration role arrives granted to authenticated — 0001 default privileges');

-- The corollary, on the function this audit is here because of. Its ACL names
-- the owner and nobody else; a `revoke ... from public` would have left three
-- role grants standing and looked identical from the outside.
select test.assert_eq(
  (select coalesce(array_to_string(p.proacl, ', '), '(default)')
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'begin_privileged_write'),
  'habba_migrator=X/habba_migrator',
  'and after 0065 the guard-exemption switch is executable by its owner alone');


-- What is deliberately NOT on the list -------------------------------------------
-- Trigger functions. Dozens of them are client-callable by the same default
-- privilege, and it does not matter: Postgres refuses to run one outside a
-- trigger context (`0A000`), so the grant conveys nothing. Proved rather than
-- assumed, because "you cannot call it anyway" is the kind of belief that is
-- worth one assertion.
select test.assert_raises(
  $$select public.timeline_immutable()$$,
  'a trigger function cannot be invoked directly, whoever holds EXECUTE on it',
  '0A000');

rollback;

\echo '   client execute surface OK'
