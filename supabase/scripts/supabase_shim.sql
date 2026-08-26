-- Supabase primitives, for local verification only.
--
-- `supabase start` needs Docker, which is not available on every machine. This
-- shim recreates the parts of a Supabase database that the migrations depend
-- on — the auth schema, auth.uid(), and the anon/authenticated/service_role
-- roles — so migrations and RLS policies can be verified against a real
-- Postgres.
--
-- ⚠️ NEVER applied to a hosted Supabase project. It is loaded only by
-- supabase/scripts/local-db.sh, before the migrations.
--
-- The point of this file is that the RLS suite runs against REAL Postgres RLS
-- with REAL role switching. A mocked RLS test only tests the mock (ADR-0014).

create schema if not exists auth;

create table if not exists auth.users (
  id            uuid primary key default gen_random_uuid(),
  phone         text unique,
  email         text unique,
  created_at    timestamptz not null default now()
);

-- Supabase exposes the current user id by reading a request-scoped GUC that it
-- populates from the JWT. Tests set the same GUC directly, which is what makes
-- role impersonation faithful.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon');
$$;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
grant select on auth.users to authenticated, service_role;

-- Match Supabase's default grants: tables are reachable, and RLS decides.
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public
  grant select on tables to anon;
alter default privileges in schema public
  grant all on tables to service_role;
