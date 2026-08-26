#!/usr/bin/env bash
#
# Hash-chain concurrency test (ADR-0004).
#
# Cannot live in the .sql suites: proving that concurrent appends do not fork
# the chain requires genuinely concurrent sessions, and a single psql script is
# one session.
#
# Why this matters more than the slot-booking race the build prompt asks for a
# test on: the timeline is append-only, so a forked chain can NEVER be
# repaired. That vehicle's تقرير هبّة is permanently unverifiable. A realistic
# trigger is a technician completing a job (service_completed + parts_replaced
# + mileage_recorded) while the nightly maintenance cron writes alert_raised
# for the same vehicle.

set -euo pipefail

PGPORT="${HABBA_PGPORT:-54329}"
PGDATABASE="habba_dev"
CONCURRENCY="${HABBA_CONCURRENCY:-24}"

for prefix in /opt/homebrew/opt/postgresql@17 /usr/local/opt/postgresql@17; do
  [ -x "$prefix/bin/psql" ] && export PATH="$prefix/bin:$PATH" && break
done

PSQL=(psql -h localhost -p "$PGPORT" -d "$PGDATABASE" -v ON_ERROR_STOP=1 --quiet -t -A)

OWNER='11111111-aaaa-4aaa-8aaa-111111111111'
VEHICLE='dddddddd-aaaa-4aaa-8aaa-dddddddddddd'

echo "── hash chain under concurrency (${CONCURRENCY} parallel appends)"

cleanup() {
  "${PSQL[@]}" >/dev/null 2>&1 <<SQL || true
    alter table public.vehicle_timeline disable trigger vehicle_timeline_no_update_delete;
    delete from public.vehicle_timeline where vehicle_id = '${VEHICLE}';
    alter table public.vehicle_timeline enable always trigger vehicle_timeline_no_update_delete;
    delete from public.vehicles where id = '${VEHICLE}';
    delete from public.profiles where id = '${OWNER}';
    delete from auth.users where id = '${OWNER}';
SQL
}
trap cleanup EXIT

cleanup

"${PSQL[@]}" >/dev/null <<SQL
  insert into auth.users (id, phone) values ('${OWNER}', '+966509999999');
  insert into public.profiles (id, full_name, phone)
    values ('${OWNER}', 'اختبار التزامن', '+966509999999');
  insert into public.vehicle_makes (id, name_ar, name_en)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'ماركة اختبار', 'TestMake')
    on conflict do nothing;
  insert into public.vehicle_models (id, make_id, name_ar, name_en, year_from)
    values ('bbbbbbbb-aaaa-4aaa-8aaa-bbbbbbbbbbbb',
            'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'موديل اختبار', 'TestModel', 2015)
    on conflict do nothing;
  insert into public.vehicles (id, owner_id, make_id, model_id, year, plate_en)
    values ('${VEHICLE}', '${OWNER}', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            'bbbbbbbb-aaaa-4aaa-8aaa-bbbbbbbbbbbb', 2020, 'RSX 9999');
SQL

# Fire N independent connections at the same vehicle simultaneously.
pids=()
for i in $(seq 1 "$CONCURRENCY"); do
  psql -h localhost -p "$PGPORT" -d "$PGDATABASE" -q -t -A -c "
    select set_config('request.jwt.claim.sub', '${OWNER}', false);
    select public.append_vehicle_timeline_event(
      '${VEHICLE}', 'mileage_recorded',
      'قراءة متزامنة ${i}', 'Concurrent reading ${i}',
      now(), $((10000 + i)));
  " >/dev/null 2>&1 &
  pids+=($!)
done

succeeded=0
for pid in "${pids[@]}"; do
  if wait "$pid"; then succeeded=$((succeeded + 1)); fi
done

rows=$("${PSQL[@]}" -c "select count(*) from public.vehicle_timeline where vehicle_id = '${VEHICLE}'")
distinct_prev=$("${PSQL[@]}" -c "select count(distinct prev_hash) from public.vehicle_timeline where vehicle_id = '${VEHICLE}'")
valid=$("${PSQL[@]}" -c "select is_valid from public.verify_vehicle_timeline('${VEHICLE}')")
checked=$("${PSQL[@]}" -c "select checked_count from public.verify_vehicle_timeline('${VEHICLE}')")

echo "  appends succeeded : ${succeeded}/${CONCURRENCY}"
echo "  rows written      : ${rows}"
echo "  distinct prev_hash: ${distinct_prev}"
echo "  chain valid       : ${valid} (${checked} rows walked)"

fail() { echo "  FAIL: $1" >&2; exit 1; }

# Every append must land: the advisory lock serialises them rather than losing
# any. If this drops below CONCURRENCY the lock is not doing its job and the
# unique constraint is absorbing the difference.
[ "$succeeded" -eq "$CONCURRENCY" ] || fail "only ${succeeded}/${CONCURRENCY} appends succeeded"
[ "$rows" -eq "$CONCURRENCY" ] || fail "expected ${CONCURRENCY} rows, found ${rows}"

# A fork would mean two rows sharing a predecessor.
[ "$distinct_prev" -eq "$rows" ] || fail "chain forked — ${distinct_prev} distinct prev_hash for ${rows} rows"

[ "$valid" = "t" ] || fail "chain did not verify"
[ "$checked" -eq "$rows" ] || fail "verification walked ${checked} of ${rows} rows"

echo "  ok   concurrent appends produce a single linear, verifiable chain"
echo "   concurrency OK"
