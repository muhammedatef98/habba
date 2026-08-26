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
