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
  -- Storage runs as its own role on a hosted project, and it OWNS
  -- `storage.objects`. That ownership is not a detail: it is what makes
  -- `alter table storage.objects ...` fail for `postgres` with "must be owner
  -- of table objects". Recreating the role here is what lets a migration that
  -- would be refused hosted also be refused locally — see the storage section.
  if not exists (select 1 from pg_roles where rolname = 'supabase_storage_admin') then
    create role supabase_storage_admin nologin noinherit;
  end if;

  -- Same story for auth: GoTrue owns `auth.users` on a hosted project, and
  -- `postgres` only holds the privileges Supabase granted it — select,
  -- references and trigger. It cannot `alter table auth.users`, which is what
  -- an `ENABLE ALWAYS` trigger needs.
  if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    create role supabase_auth_admin nologin noinherit;
  end if;

  -- The role migrations RUN AS.
  --
  -- On a hosted project that role is `postgres`, and `postgres` there is NOT a
  -- superuser: it owns `public`, it can create roles and extensions, and it is
  -- a member of anon/authenticated/service_role — but it does not own the
  -- `auth` or `storage` schemas, and superuser checks do not rescue it.
  --
  -- Locally, migrations used to run as the cluster superuser, which bypasses
  -- every ownership check there is. That is why 0048's
  -- `alter table storage.objects ...` passed here and in CI and then failed on
  -- the first real project. `local-db.sh` now applies migrations with
  -- `SET ROLE habba_migrator`, so a statement that hosted Supabase would refuse
  -- is refused here first.
  if not exists (select 1 from pg_roles where rolname = 'habba_migrator') then
    create role habba_migrator nologin nosuperuser createrole createdb;
  end if;

  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    -- A password, because the CI Postgres image authenticates host connections
    -- with scram-sha-256 while the local cluster uses trust. Without one,
    -- PostgREST could not connect in CI at all — which is how the integration
    -- and RLS steps came to be "passing" without ever having run.
    --
    -- Local-only, like everything else in this shim, and deliberately named so
    -- that it cannot be mistaken for a credential worth protecting.
    create role authenticator login noinherit password 'habba-local-only';
  end if;
end
$$;

-- Idempotent for a cluster where the role already exists from an earlier run.
alter role authenticator with login password 'habba-local-only';

grant anon, authenticated, service_role to authenticator;

-- Hosted `postgres` holds these too, which is how a migration can `revoke ...
-- from anon` or write a policy naming them.
grant anon, authenticated, service_role to habba_migrator with admin option;

-- Hosted `postgres` owns `public` and everything a migration creates in it,
-- and can create new schemas in the database.
alter schema public owner to habba_migrator;
do $$
begin
  execute format('grant create, connect on database %I to habba_migrator',
                 current_database());
end
$$;

-- PostGIS in `extensions`, installed by the SUPERUSER — because that is how it
-- arrives on a hosted project too. §2 of docs/supabase-setup.md is a dashboard
-- step, not a migration: `create extension` needs privileges the project's
-- `postgres` role does not have. 0001's `if not exists` then finds it here,
-- exactly as it finds the dashboard's.
create schema if not exists extensions;
create extension if not exists postgis with schema extensions;
grant usage on schema extensions to habba_migrator, anon, authenticated, service_role;
-- `extensions` is created by the dashboard as `postgres` on a hosted project,
-- so the migration role owns it there and 0001's `grant usage on schema
-- extensions` succeeds. Without this it warns "no privileges were granted"
-- here and nowhere else — a divergence in the harmless direction, but still a
-- divergence.
alter schema extensions owner to habba_migrator;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
grant select on auth.users to authenticated, service_role;

-- Exactly what a hosted project grants `postgres` on GoTrue's table, and no
-- more. SELECT and REFERENCES so `profiles.id references auth.users(id)`
-- (0005) works — that is Supabase's own documented pattern — and TRIGGER so
-- the equally documented `on_auth_user_created` trigger can be created.
-- Notably absent: ownership, so `alter table auth.users ...` is refused here
-- as it is there.
grant usage on schema auth to habba_migrator;
grant select, references, trigger on auth.users to habba_migrator;
alter schema auth owner to supabase_auth_admin;
alter table auth.users owner to supabase_auth_admin;

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

-- The default privileges on `public` used to be set here, and they were not the
-- ones Supabase actually sets — anon had SELECT where hosted anon has ALL. That
-- is a local-vs-hosted divergence in precisely the layer this harness exists to
-- test: locally a missing RLS policy could be masked by a missing grant.
--
-- Migration 0001 now sets them, faithfully, so both environments get them from
-- the same line of SQL. Nothing to do here.


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

-- ---------------------------------------------------------------------------
-- Ownership is part of the fidelity, not an implementation detail
-- ---------------------------------------------------------------------------
-- On a hosted project the storage schema and its tables are owned by
-- `supabase_storage_admin`, NOT by `postgres`. Migrations run as `postgres`.
--
-- The first version of this shim created them as whoever ran it — `postgres` —
-- so `alter table storage.objects enable row level security` in migration 0048
-- succeeded locally and in CI, and failed on the first real project with
-- "must be owner of table objects". That is the same defect shape as the
-- schema grants in 0001: a shim more permissive than production hides a
-- migration that cannot apply, until the one run that matters.
--
-- So: everything under `storage` is created and then handed to
-- `supabase_storage_admin`, and `postgres` is deliberately NOT a member of it.
-- A migration that needs ownership of `storage.objects` now fails here first.
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

-- RLS on `storage.objects` is the platform's, already enabled before any
-- migration runs. Enabling it here rather than in a migration is the whole
-- point: a migration cannot enable it, because it does not own the table.
alter table storage.objects enable row level security;

-- Deliberately NO row-level security on `storage.buckets`. The hosted run of
-- 0048 got past `insert into storage.buckets` and failed on the next
-- statement, so whatever the platform's arrangement there, a migration can
-- insert a bucket. Modelling a stricter rule than the one production actually
-- applies is the same mistake in the other direction: it fails the build for
-- something that works.

-- What a hosted project grants `postgres` on the storage tables: DML, but not
-- ownership. The bucket insert in 0048 is fine there — it got past it, and
-- failed on the next statement — so it must be fine here.
-- Role grants are CLUSTER-wide and survive `drop database`, so a membership
-- handed out by hand in an earlier session would silently persist and hand the
-- migration role the storage owner's rights again. Revoke it every run.
revoke supabase_storage_admin from habba_migrator;
revoke supabase_auth_admin from habba_migrator;

grant usage on schema storage to habba_migrator;
grant select, insert, update, delete on storage.buckets to habba_migrator;
grant select, insert, update, delete on storage.objects to habba_migrator;

-- Hand the schema over LAST, so everything above is created by the superuser
-- running the shim and only then reassigned — mirroring how a hosted project
-- arrives, and leaving `postgres` a non-owner exactly as it is there.
alter schema storage owner to supabase_storage_admin;
alter table storage.buckets owner to supabase_storage_admin;
alter table storage.objects owner to supabase_storage_admin;
alter function storage.foldername(text) owner to supabase_storage_admin;
