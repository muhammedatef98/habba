#!/usr/bin/env bash
#
# Applies every migration to a HOSTED Supabase project and then runs the same
# RLS assertions against it that CI runs against the local harness.
#
# Why this exists: "it passes locally" is not the claim that matters. The local
# harness is a shim — supabase_shim.sql fakes auth.users, auth.uid() and the
# anon/authenticated/service_role roles. A hosted project has the real ones,
# plus GoTrue, plus PostgREST behind a gateway, plus whatever extensions the
# platform pre-installs. Any of those can change the answer, and the answer is
# "can a stranger read this user's logbook".
#
# Usage:
#   export SUPABASE_DB_URL='postgresql://postgres.<ref>:<password>@<host>:5432/postgres'
#   export SUPABASE_URL='https://<ref>.supabase.co'
#   export SUPABASE_ANON_KEY='<anon key>'
#   export SUPABASE_JWT_SECRET='<JWT secret from Settings → API>'
#   ./supabase/scripts/verify-hosted.sh
#
#   --migrate-only   apply migrations and seed, skip the RLS suite
#   --verify-only    skip migrations, run the RLS suite against what is there
#   --reset          drop and recreate schema `public` first, then do the above
#
# --reset exists so a repeat run needs no hand-written SQL in the dashboard.
# Migrations are forward-only, so a second run against an already-migrated
# database fails on the first `create type` — and resetting by hand is how the
# first hosted attempt ended up with grants the migrations never set.
#
# ⚠️ This writes to the project it is pointed at. It is for a project you are
# willing to have test rows in — a fresh one, or a staging one. It refuses to
# run against a database that already holds vehicles it did not create.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

MODE=all
RESET=0
for arg in "$@"; do
  case "$arg" in
    --reset) RESET=1 ;;
    --migrate-only | --verify-only) MODE="$arg" ;;
    *) echo "error: unknown argument $arg. See the header of this script." >&2; exit 2 ;;
  esac
done

require() {
  if [ -z "${!1:-}" ]; then
    echo "error: $1 is not set. See the header of this script." >&2
    exit 2
  fi
}

# ---------------------------------------------------------------------------
# Migrations
# ---------------------------------------------------------------------------
if [ "$RESET" = "1" ] && [ "$MODE" = "--verify-only" ]; then
  echo "error: --reset and --verify-only contradict each other." >&2
  exit 2
fi

if [ "$MODE" != "--verify-only" ]; then
  require SUPABASE_DB_URL

  if ! command -v psql >/dev/null 2>&1; then
    echo "error: psql not found (brew install libpq / apt-get install postgresql-client)" >&2
    exit 2
  fi

  echo "── checking the project is safe to write to"

  # A project with real vehicles in it is somebody's production data. The
  # migrations are forward-only and mostly additive, but the seed is not, and
  # this script is not the place to find out.
  existing=$(psql "$SUPABASE_DB_URL" -Atc "
    select coalesce((select count(*) from public.vehicles), 0)
    where exists (select 1 from information_schema.tables
                  where table_schema='public' and table_name='vehicles')" 2>/dev/null || echo 0)

  if [ "${existing:-0}" != "0" ] && [ "${HABBA_ALLOW_NONEMPTY:-}" != "1" ]; then
    echo "error: this project already holds ${existing} vehicles." >&2
    echo "       Point at a fresh project, or set HABBA_ALLOW_NONEMPTY=1 if you are sure." >&2
    exit 2
  fi

  if [ "$RESET" = "1" ]; then
    echo "── resetting schema public"
    # Everything Habba owns lives in `public`, so this is the whole database as
    # far as the app is concerned. auth.users survives, which is why the GoTrue
    # fixtures below tolerate "already registered".
    #
    # Nothing here grants anything. Migration 0001 sets the schema grants and
    # the default privileges that Supabase would otherwise have set at project
    # creation, so a database reset this way ends up with grants that came only
    # from the migrations — which is the point.
    psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -q \
      -c 'drop schema if exists public cascade' \
      -c 'create schema public'
  fi

  # PostGIS must live in `extensions` — 0001 refuses otherwise, with a hint.
  # Enable it here so the failure mode is "enable PostGIS" rather than a type
  # error four migrations later.
  echo "── ensuring PostGIS is in the extensions schema"
  psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -q \
    -c 'create schema if not exists extensions' \
    -c 'create extension if not exists postgis with schema extensions' \
    -c 'create extension if not exists pgcrypto'

  echo "── applying migrations"
  for migration in "$ROOT"/supabase/migrations/*.sql; do
    printf '   %s\n' "$(basename "$migration")"
    psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -q -f "$migration"
  done

  echo "── seeding reference data"
  for seed in "$ROOT"/supabase/seed/*.sql; do
    printf '   %s\n' "$(basename "$seed")"
    psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -q -f "$seed"
  done

  echo "── migrations applied cleanly"
fi

# ---------------------------------------------------------------------------
# Fixtures the RLS suite cannot create for itself
# ---------------------------------------------------------------------------
# Locally these come from supabase_shim.sql. That shim is never deployed — it
# would BE the privilege escalation 0036/0040 exist to prevent — so hosted, the
# same fixtures are made here, with credentials a test file should not hold.
if [ "$MODE" != "--migrate-only" ]; then
  require SUPABASE_URL
  require SUPABASE_SERVICE_ROLE_KEY
  require SUPABASE_DB_URL

  echo
  echo "── creating auth users through GoTrue"

  # Ids and numbers must match tests/rls.spec.ts.
  create_user() {
    local id="$1" phone="$2"
    local code
    code=$(curl -sS -o /dev/null -w '%{http_code}' \
      -X POST "$SUPABASE_URL/auth/v1/admin/users" \
      -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
      -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
      -H 'content-type: application/json' \
      -d "{\"id\":\"$id\",\"phone\":\"$phone\",\"phone_confirm\":true}")

    # 422 is "already registered", which is the expected answer on a re-run.
    case "$code" in
      2*) printf '   created %s\n' "$phone" ;;
      422) printf '   exists  %s\n' "$phone" ;;
      *) echo "error: creating $phone returned HTTP $code" >&2; exit 1 ;;
    esac
  }

  create_user 'aa000000-0000-4000-8000-000000000001' '+966590000001'
  create_user 'aa000000-0000-4000-8000-000000000002' '+966590000002'
  create_user 'aa000000-0000-4000-8000-000000000003' '+966590000003'
  create_user 'aa000000-0000-4000-8000-000000000004' '+966590000004'

  echo "── seeding the fixture rows the suite expects"
  # The suite creates its own vehicles over HTTP, but the provider records have
  # to exist BEFORE approval, and approval has to happen before the suite makes
  # its assertions. Creating them here keeps the hosted run to a single pass.
  #
  # Approval is not a service-key PATCH: guard_provider_columns is ENABLE
  # ALWAYS, so even the service role cannot set verification_status without
  # declaring a privileged write. That guard holds hosted too, which is one of
  # the things this script is here to demonstrate.
  psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -q <<'SQL'
do $$
declare
  v_city uuid;
begin
  select id into v_city from public.cities where name_en = 'Dammam' limit 1;
  if v_city is null then
    raise exception 'seed data missing: run this script without --verify-only first';
  end if;

  insert into public.profiles (id, full_name, phone) values
    ('aa000000-0000-4000-8000-000000000001', 'مستخدم اختبار', '+966590000001'),
    ('aa000000-0000-4000-8000-000000000002', 'مستخدم اختبار', '+966590000002'),
    ('aa000000-0000-4000-8000-000000000003', 'مستخدم اختبار', '+966590000003'),
    ('aa000000-0000-4000-8000-000000000004', 'مستخدم اختبار', '+966590000004')
  on conflict (id) do nothing;

  insert into public.providers
    (id, owner_profile_id, provider_type, business_name_ar,
     national_id_encrypted, iban_encrypted, city_id)
  values
    ('cc000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-000000000002',
     'individual', 'متقدّم', 'enc:dev:test', 'enc:dev:test', v_city),
    ('cc000000-0000-4000-8000-000000000002', 'aa000000-0000-4000-8000-000000000003',
     'individual', 'فنّي معتمد', 'enc:dev:test', 'enc:dev:test', v_city)
  on conflict (id) do nothing;

  perform public.begin_privileged_write();
  update public.providers
  set verification_status = 'approved', nafath_verified_at = now()
  where id = 'cc000000-0000-4000-8000-000000000002';
  perform public.end_privileged_write();
end $$;
SQL

fi

# ---------------------------------------------------------------------------
# RLS, over real HTTP
# ---------------------------------------------------------------------------
if [ "$MODE" != "--migrate-only" ]; then
  require SUPABASE_URL
  require SUPABASE_JWT_SECRET
  require SUPABASE_ANON_KEY

  echo
  echo "── running tests/rls.spec.ts against $SUPABASE_URL"

  # The suite mints its own JWTs, so it needs the project's JWT secret.
  #
  # HABBA_POSTGREST_URL is the project ORIGIN, with no /rest/v1: supabase-js
  # appends that itself. The first hosted run passed the prefixed form, which
  # made the reachability probe pass and then every write fail with "Invalid
  # path specified in request URL" — /rest/v1/rest/v1/providers.
  HABBA_POSTGREST_URL="$SUPABASE_URL" \
  HABBA_JWT_SECRET="$SUPABASE_JWT_SECRET" \
  HABBA_ANON_KEY="$SUPABASE_ANON_KEY" \
  HABBA_HOSTED=1 \
  HABBA_REQUIRE_HARNESS=1 \
    pnpm --dir "$ROOT" test:rls
fi

# ---------------------------------------------------------------------------
# The PDPL erasure path (migration 0043), hosted
# ---------------------------------------------------------------------------
# 22_account_deletion.sql covers this locally, where auth.users is a shim table
# and the delete is issued by psql. Hosted it is a different act: the request
# goes to GoTrue, and the cascade runs auth.users → profiles → user_roles,
# through the ENABLE ALWAYS guard, as the platform's own role rather than ours.
# 0040 made that impossible and nothing noticed for three migrations, so the
# hosted claim is worth making directly rather than by analogy.
if [ "$MODE" != "--migrate-only" ]; then
  require SUPABASE_URL
  require SUPABASE_SERVICE_ROLE_KEY
  require SUPABASE_DB_URL

  echo
  echo "── account deletion, the way an erasure request actually arrives"

  ERASE_ID='aa000000-0000-4000-8000-000000000009'
  create_user "$ERASE_ID" '+966590000009'

  psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -q <<SQL
do \$\$
begin
  insert into public.profiles (id, full_name, phone)
  values ('$ERASE_ID', 'حساب للحذف', '+966590000009')
  on conflict (id) do nothing;

  perform public.begin_privileged_write();
  perform public.grant_user_role('$ERASE_ID'::uuid, 'technician'::public.user_role, null::uuid);
  perform public.end_privileged_write();

  if (select count(*) from public.user_roles
      where user_id = '$ERASE_ID' and revoked_at is null) <> 2 then
    raise exception 'setup failed: expected customer + technician before deletion';
  end if;
end \$\$;
SQL

  # The erasure itself: GoTrue, not SQL. Everything below hangs off this one
  # DELETE by way of two cascades.
  erase_code=$(curl -sS -o /dev/null -w '%{http_code}' \
    -X DELETE "$SUPABASE_URL/auth/v1/admin/users/$ERASE_ID" \
    -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY")
  case "$erase_code" in
    2*) printf '   deleted the auth user (HTTP %s)\n' "$erase_code" ;;
    *) echo "error: deleting the auth user returned HTTP $erase_code" >&2; exit 1 ;;
  esac

  psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -q <<SQL
do \$\$
begin
  if exists (select 1 from public.profiles where id = '$ERASE_ID') then
    raise exception 'FAIL: the profile survived the account deletion';
  end if;
  raise notice '   ok  the profile is gone';

  if exists (select 1 from public.user_roles where user_id = '$ERASE_ID') then
    raise exception 'FAIL: role rows survived the account deletion';
  end if;
  raise notice '   ok  and the cascade took its role rows with it';
end \$\$;

-- The other half of 0043: the fix is a condition, not an exemption. If it had
-- been an exemption this would now succeed and any user could strip another's
-- roles — which is the thing the guard exists to stop.
do \$\$
begin
  perform set_config('request.jwt.claims',
    '{"sub":"aa000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);

  delete from public.user_roles
  where user_id = 'aa000000-0000-4000-8000-000000000001';

  raise exception 'FAIL: a signed-in user deleted their own role rows';
exception
  when insufficient_privilege then
    raise notice '   ok  a live account still cannot delete its own role rows';
end \$\$;
SQL
fi

echo
echo "hosted verification complete"
