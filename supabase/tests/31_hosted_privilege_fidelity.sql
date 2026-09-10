-- 31 — the local harness must not be more privileged than a hosted project
--
-- Migration 0048 shipped `alter table storage.objects enable row level
-- security`. It passed here and in CI and then failed on the first real
-- project with "must be owner of table objects", because locally the
-- migrations ran as the cluster superuser and `storage.objects` was created by
-- that same superuser. Every ownership check was satisfied by accident.
--
-- The harness now creates the auth and storage schemas under the roles that
-- own them on a hosted project, and applies migrations as `habba_migrator`, a
-- non-superuser standing in for the project's `postgres`. This suite is what
-- stops that being quietly undone: if someone "fixes" a future migration by
-- handing the migration role ownership, these assertions fail instead.
--
-- It is the same defect shape as the schema grants in 0001 — a shim more
-- permissive than production hides a migration that cannot apply.

\echo '── hosted privilege fidelity'

begin;

-- The roles exist and own what they own on a hosted project -------------------
select test.assert(
  exists (select 1 from pg_roles where rolname = 'supabase_storage_admin'),
  'the storage owner role exists locally, as it does on a hosted project');

select test.assert(
  exists (select 1 from pg_roles where rolname = 'supabase_auth_admin'),
  'the auth owner role exists locally, as it does on a hosted project');

select test.assert_eq(
  (select r.rolname
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     join pg_roles r on r.oid = c.relowner
    where n.nspname = 'storage' and c.relname = 'objects'),
  'supabase_storage_admin',
  'storage.objects is owned by the storage role, not by the migration role');

select test.assert_eq(
  (select r.rolname
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     join pg_roles r on r.oid = c.relowner
    where n.nspname = 'auth' and c.relname = 'users'),
  'supabase_auth_admin',
  'auth.users is owned by the auth role, not by the migration role');


-- The migration role is NOT a member of either -------------------------------
-- This is the assertion that actually bites. Membership would satisfy every
-- ownership check in Postgres, and the harness would go back to accepting
-- statements a real project refuses.
select test.assert(
  not pg_has_role('habba_migrator', 'supabase_storage_admin', 'USAGE'),
  'the migration role cannot borrow the storage owner''s rights');

select test.assert(
  not pg_has_role('habba_migrator', 'supabase_auth_admin', 'USAGE'),
  'the migration role cannot borrow the auth owner''s rights');

select test.assert(
  not (select rolsuper from pg_roles where rolname = 'habba_migrator'),
  'the migration role is not a superuser — hosted `postgres` is not one either');


-- What the migration role CAN do on those tables, and no more -----------------
-- Supabase's own documented patterns need exactly these: a foreign key from
-- `profiles.id` to `auth.users(id)` (0005), the `on_auth_user_created` trigger
-- shape, and a bucket insert (0048). All three are grants, not ownership.
select test.assert(
  has_table_privilege('habba_migrator', 'auth.users', 'select')
  and has_table_privilege('habba_migrator', 'auth.users', 'references')
  and has_table_privilege('habba_migrator', 'auth.users', 'trigger'),
  'the migration role can reference and add triggers to auth.users');

select test.assert(
  has_table_privilege('habba_migrator', 'storage.buckets', 'insert'),
  'the migration role can create a bucket, which is how 0048 got past line 17');


-- RLS on storage.objects is the platform's, not a migration's ----------------
select test.assert(
  (select c.relrowsecurity
     from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'storage' and c.relname = 'objects'),
  'storage.objects has RLS on before any migration runs');


-- The triage policies exist, wherever they were applied from -----------------
-- Locally that is local-db.sh as the storage owner; on a hosted project it is
-- the dashboard SQL editor (§7 of docs/supabase-setup.md). Either way the
-- bucket is unusable without them, so their absence must be a failure and not
-- a surprise at upload time.
select test.assert_eq(
  (select count(*)::int
     from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname like 'triage_media%'),
  3, 'all three triage-media policies are present');

select test.assert_eq(
  (select count(*)::int
     from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname like 'triage_media%'
      and cmd in ('UPDATE', 'DELETE')),
  0, 'nothing may update or delete a triage clip — the record is the point');

rollback;

\echo '   hosted privilege fidelity OK'
