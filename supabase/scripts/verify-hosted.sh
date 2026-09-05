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
#
# ⚠️ This writes to the project it is pointed at. It is for a project you are
# willing to have test rows in — a fresh one, or a staging one. It refuses to
# run against a database that already holds vehicles it did not create.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MODE="${1:-all}"

require() {
  if [ -z "${!1:-}" ]; then
    echo "error: $1 is not set. See the header of this script." >&2
    exit 2
  fi
}

# ---------------------------------------------------------------------------
# Migrations
# ---------------------------------------------------------------------------
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

  # The suite mints its own JWTs, so it needs the project's JWT secret. It
  # addresses PostgREST through the same /rest/v1 prefix supabase-js uses, so
  # no rewrite is needed against a hosted project.
  HABBA_POSTGREST_URL="$SUPABASE_URL/rest/v1" \
  HABBA_JWT_SECRET="$SUPABASE_JWT_SECRET" \
  HABBA_ANON_KEY="$SUPABASE_ANON_KEY" \
  HABBA_HOSTED=1 \
  HABBA_REQUIRE_HARNESS=1 \
    pnpm --dir "$ROOT" test:rls
fi

echo
echo "hosted verification complete"
