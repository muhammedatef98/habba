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

-- Mirrors Supabase's real auth.uid()/auth.role(), which read TWO GUC forms:
--
--   request.jwt.claim.sub    legacy per-claim GUC (PostgREST < 9)
--   request.jwt.claims       single JSON GUC (PostgREST >= 9, incl. v16)
--
-- Both matter here. The .sql suites set the legacy GUC directly because it is
-- the simplest way to impersonate a user in psql; the PostgREST integration
-- tests go through a real JWT and therefore produce the JSON form. Supporting
-- only one would make one of the two test layers a fiction.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid;
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    'anon'
  );
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

  -- PostgREST connects as `authenticator`, a near-powerless role whose only
  -- privilege is switching into the role named by the JWT. Supabase uses the
  -- same arrangement, and it is what makes the HTTP integration tests exercise
  -- genuine role-based RLS rather than a simulation of it.
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator login noinherit;
  end if;
end
$$;

grant anon, authenticated, service_role to authenticator;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
grant select on auth.users to authenticated, service_role;

-- Stands in for GoTrue's sign-up, which the local harness cannot run (it needs
-- Docker). Integration tests call this to create the auth.users row that a
-- real phone-OTP sign-up would have created.
--
-- ⚠️ LOCAL ONLY. This function is defined in the shim, never in a migration,
-- so it cannot reach a hosted Supabase project — where GoTrue owns auth.users
-- and nothing else may write to it.
create or replace function public.test_seed_auth_user(p_id uuid, p_phone text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into auth.users (id, phone) values (p_id, p_phone)
  on conflict (id) do nothing;
end;
$$;

grant execute on function public.test_seed_auth_user(uuid, text) to authenticated, anon;

-- Stands in for the ops verification queue, which is Phase 6 (build prompt
-- §9.4). Provider approval is deliberately NOT self-service — a provider that
-- could approve itself would make KYC advisory — so tests need a way to act as
-- ops without an admin console existing yet.
--
-- ⚠️ LOCAL ONLY, same as above: defined in the shim, never in a migration.
create or replace function public.test_approve_provider(p_provider_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Declares itself privileged, because 0034 makes verification_status and
  -- nafath_verified_at writable only by ops or a trusted server-side function.
  -- A provider granting themselves either would make KYC theatre — this shim
  -- stands in for the ops console that will do it for real.
  perform public.begin_privileged_write();

  update public.providers
  set verification_status = 'approved', nafath_verified_at = now()
  where id = p_provider_id;

  perform public.end_privileged_write();
end;
$$;

grant execute on function public.test_approve_provider(uuid) to authenticated;

-- Stands in for the ops console granting a role (0040). Roles are never
-- client-settable — user_roles has no write policy and grant_user_role() is
-- revoked from authenticated — so a test that needs an operator has no other
-- way to make one.
--
-- ⚠️ LOCAL ONLY, same as above. If this ever reached a migration it would BE
-- the privilege escalation that 0036 and 0040 exist to prevent.
-- p_role is text, not public.user_role: the shim is applied BEFORE the
-- migrations, so the enum does not exist yet when this signature is parsed.
-- The plpgsql body is resolved lazily, so the cast inside is fine.
create or replace function public.test_grant_role(p_user_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.grant_user_role(p_user_id, p_role::public.user_role, null);
end;
$$;

grant execute on function public.test_grant_role(uuid, text) to authenticated;

-- Match Supabase's default grants: tables are reachable, and RLS decides.
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public
  grant select on tables to anon;
alter default privileges in schema public
  grant all on tables to service_role;


-- ---------------------------------------------------------------------------
-- storage
-- ---------------------------------------------------------------------------
-- Enough of Supabase Storage for migrations that define buckets and object
-- policies to apply and be tested. The real service adds an HTTP API, resumable
-- uploads, image transformation and a worker that reaps orphans — none of which
-- a policy test needs.
--
-- What IS faithful is the shape RLS depends on: `storage.objects` keyed by
-- bucket and path, with `owner`, and `storage.foldername()` returning the path
-- segments, because every real bucket policy is written against those.

create schema if not exists storage;

create table if not exists storage.buckets (
  id          text primary key,
  name        text not null,
  public      boolean not null default false,
  created_at  timestamptz not null default now()
);

create table if not exists storage.objects (
  id          uuid primary key default gen_random_uuid(),
  bucket_id   text not null references storage.buckets(id) on delete cascade,
  name        text not null,
  owner       uuid,
  created_at  timestamptz not null default now(),
  metadata    jsonb,
  unique (bucket_id, name)
);

-- Supabase's own helper: splits an object name into its path segments, so a
-- policy can say "the first folder must be the caller's order id". Returns the
-- segments WITHOUT the filename, matching the real implementation.
create or replace function storage.foldername(name text)
returns text[]
language sql
immutable
parallel safe
as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1];
$$;

grant usage on schema storage to anon, authenticated, service_role;
grant select on storage.buckets to anon, authenticated;
grant select, insert, update, delete on storage.objects to authenticated;
