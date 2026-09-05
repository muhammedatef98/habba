-- 0001 — Extensions
-- Build prompt §3. See ADR-0002 for why migrations are ordered by dependency
-- rather than by spec section.

-- PostGIS goes in a dedicated `extensions` schema, matching Supabase's
-- convention, and every reference to it is schema-qualified.
--
-- This is not tidiness. SECURITY DEFINER functions must run with
-- `search_path = ''` (ADR-0003), and under an empty search_path a bare
-- `extensions.st_dwithin(...)` does not resolve at all. Letting PostGIS land wherever the
-- environment happens to put it means the matching function works locally and
-- fails in production — the same trap `gen_random_bytes` sprang in 0014.
create schema if not exists extensions;
create extension if not exists postgis with schema extensions;

-- `if not exists` is a NO-OP when PostGIS is already installed SOMEWHERE ELSE,
-- and it does not warn. The schema clause is then silently ignored, and the
-- first failure is `type "extensions.geography" does not exist` three
-- migrations later in 0004 — which reads like a broken migration rather than a
-- misconfigured database.
--
-- That is not hypothetical: the CI image (postgis/postgis) pre-installs PostGIS
-- into `public`, and this is exactly how it failed. PostGIS cannot be moved
-- afterwards (`ALTER EXTENSION postgis SET SCHEMA` → "does not support SET
-- SCHEMA"), so the only honest response is to refuse here and say what to do.
do $$
declare
  v_schema text;
begin
  select n.nspname into v_schema
  from pg_extension e
  join pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'postgis';

  if v_schema is distinct from 'extensions' then
    raise exception
      'PostGIS is installed in schema "%", but Habba requires it in "extensions".', v_schema
      using hint =
        'Every geography column and every SECURITY DEFINER function schema-qualifies '
        'extensions.* (search_path is empty — ADR-0003), so the schema is load-bearing. '
        'On a fresh database: DROP EXTENSION postgis CASCADE, then re-run this migration. '
        'On Supabase, enable PostGIS from Database > Extensions, which installs it into extensions.';
  end if;
end $$;

grant usage on schema extensions to anon, authenticated, service_role;

-- gen_random_uuid() is core since Postgres 13, but Supabase enables pgcrypto
-- by default and some helpers expect it. Enabled for parity with production.
create extension if not exists pgcrypto;

-- Note on hashing: the timeline hash chain (0008) uses the built-in
-- sha256(bytea), available since Postgres 11. It deliberately does NOT depend
-- on pgcrypto's digest() — the hash function is frozen infrastructure
-- (ADR-0004) and must not be coupled to an optional extension.

-- All objects live in `public` unless stated. SECURITY DEFINER functions set
-- search_path = '' and schema-qualify everything (ADR-0003).

-- ---------------------------------------------------------------------------
-- Baseline privileges on `public`
-- ---------------------------------------------------------------------------
-- Every later migration assumes these exist. They are the ones Supabase sets on
-- a new project, and until the first hosted run that assumption was invisible:
-- `drop schema public cascade` in the dashboard takes the schema grants and the
-- default privileges with it, after which PostgREST answers 42501 on every
-- table and the migrations have no way to put it back.
--
-- Setting them here makes the migrations self-sufficient — a database can be
-- reset and re-migrated with no hand-written SQL — and is a no-op on a project
-- that still has Supabase's originals.
--
-- Two things this is NOT:
--
--   * `grant all on all tables in schema public` — that is a one-shot grant on
--     tables that exist *now*, so run after the migrations it would silently
--     undo every `revoke` in 0010, 0014, 0026, 0030, 0037 and 0040, which are a
--     defence layer in their own right (§2.4). ALTER DEFAULT PRIVILEGES applies
--     only to tables created afterwards, so the later revokes still win.
--   * a substitute for RLS. Privileges decide which verbs a role may attempt;
--     RLS decides which rows it sees. Both are load-bearing, and 0013 turns RLS
--     on with default deny.
grant usage on schema public to anon, authenticated, service_role;

alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on functions to anon, authenticated, service_role;
