#!/usr/bin/env bash
#
# Slot double-booking test (build prompt §6.6: "Write a test for this.").
#
# Cannot live in the .sql suites for the same reason as the hash-chain test:
# proving that two clients cannot take the same slot requires two clients.
# A single psql session serialises itself and would pass trivially.
#
# It fires N genuinely simultaneous bookings at a slot with capacity C and
# asserts that exactly C succeed and the other N-C are refused cleanly.
#
# Two things were learned building it, both recorded at the assertions below:
#
#   1. Without a synchronised start, the clients are staggered by process-spawn
#      overhead and never actually collide. A deliberately broken
#      check-then-increment implementation passed until the barrier was added.
#   2. Even then, no overselling occurs with the broken version — the
#      `booked_count <= capacity` CHECK constraint is the real guarantee. What
#      the atomic UPDATE controls is whether the losers get a friendly refusal
#      or a raw constraint error, so that is what is asserted.

set -euo pipefail

PGPORT="${HABBA_PGPORT:-54329}"
PGDATABASE="habba_dev"
CONCURRENCY="${HABBA_SLOT_CONCURRENCY:-16}"
CAPACITY="${HABBA_SLOT_CAPACITY:-3}"

for prefix in /opt/homebrew/opt/postgresql@17 /usr/local/opt/postgresql@17; do
  [ -x "$prefix/bin/psql" ] && export PATH="$prefix/bin:$PATH" && break
done

PSQL=(psql -h localhost -p "$PGPORT" -d "$PGDATABASE" -v ON_ERROR_STOP=1 --quiet -t -A)

OWNER='11111111-bbbb-4bbb-8bbb-111111111111'
SHOP_OWNER='22222222-bbbb-4bbb-8bbb-222222222222'
PROVIDER='eeeeeeee-bbbb-4bbb-8bbb-eeeeeeeeeeee'
SLOT='55555555-bbbb-4bbb-8bbb-555555555555'
CITY='cccccccc-bbbb-4bbb-8bbb-cccccccccccc'
VEHICLE='dddddddd-bbbb-4bbb-8bbb-dddddddddddd'

echo "── slot booking under concurrency (${CONCURRENCY} clients, capacity ${CAPACITY})"

cleanup() {
  "${PSQL[@]}" >/dev/null 2>&1 <<SQL || true
    alter table public.vehicle_timeline disable trigger vehicle_timeline_no_update_delete;
    delete from public.vehicle_timeline where vehicle_id = '${VEHICLE}';
    alter table public.vehicle_timeline enable always trigger vehicle_timeline_no_update_delete;
    delete from public.order_events where order_id in (select id from public.orders where slot_id = '${SLOT}');
    delete from public.orders where slot_id = '${SLOT}';
    delete from public.appointment_slots where id = '${SLOT}';
    delete from public.provider_services where provider_id = '${PROVIDER}';
    delete from public.workshops where provider_id = '${PROVIDER}';
    delete from public.providers where id = '${PROVIDER}';
    delete from public.vehicles where id = '${VEHICLE}';
    delete from public.profiles where id in ('${OWNER}', '${SHOP_OWNER}');
    delete from auth.users where id in ('${OWNER}', '${SHOP_OWNER}');
    delete from public.vehicle_models where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    delete from public.vehicle_makes where id = 'aaaaaaaa-bbbb-4bbb-8bbb-aaaaaaaaaaaa';
    delete from public.cities where id = '${CITY}';
SQL
}
trap cleanup EXIT
cleanup

SERVICE_ID=$("${PSQL[@]}" -c "select id from public.services where name_en = 'Oil and filter change' limit 1")

"${PSQL[@]}" >/dev/null <<SQL
  insert into auth.users (id, phone) values
    ('${OWNER}', '+966508880001'), ('${SHOP_OWNER}', '+966508880002');
  insert into public.profiles (id, full_name, phone) values
    ('${OWNER}', 'عميل التزامن', '+966508880001'),
    ('${SHOP_OWNER}', 'ورشة التزامن', '+966508880002');
  -- The workshop role follows from the approved providers row below (0040);
  -- nothing here declares it.
  insert into public.cities (id, name_ar, name_en, region_ar, region_en, centroid)
    values ('${CITY}', 'مدينة اختبار', 'SlotCity', 'منطقة', 'Region',
            extensions.st_point(46.6753, 24.7136)::extensions.geography);
  insert into public.vehicle_makes (id, name_ar, name_en)
    values ('aaaaaaaa-bbbb-4bbb-8bbb-aaaaaaaaaaaa', 'ماركة', 'SlotMake');
  insert into public.vehicle_models (id, make_id, name_ar, name_en, year_from)
    values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            'aaaaaaaa-bbbb-4bbb-8bbb-aaaaaaaaaaaa', 'موديل', 'SlotModel', 2015);
  insert into public.vehicles (id, owner_id, make_id, model_id, year, plate_en)
    values ('${VEHICLE}', '${OWNER}', 'aaaaaaaa-bbbb-4bbb-8bbb-aaaaaaaaaaaa',
            'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 2020, 'SLT 1234');
  insert into public.providers (id, owner_profile_id, provider_type, business_name_ar,
                                cr_number, verification_status, city_id)
    values ('${PROVIDER}', '${SHOP_OWNER}', 'workshop', 'ورشة التزامن',
            '1010202020', 'approved', '${CITY}');
  insert into public.workshops (provider_id, address_ar, location, bay_count, opening_hours)
    values ('${PROVIDER}', 'عنوان', extensions.st_point(46.676, 24.714)::extensions.geography,
            ${CAPACITY}, '{"sun": [["08:00","20:00"]]}'::jsonb);
  insert into public.provider_services (provider_id, service_id)
    values ('${PROVIDER}', '${SERVICE_ID}');
  insert into public.appointment_slots (id, provider_id, starts_at, ends_at, capacity)
    values ('${SLOT}', '${PROVIDER}', now() + interval '3 days',
            now() + interval '3 days 1 hour', ${CAPACITY});
SQL

# A synchronised start is essential, and its absence is silent.
#
# Spawning psql processes in a loop staggers them by 10-30ms each — enough that
# client 4 reads state client 1 has already committed. A deliberately broken,
# non-atomic check-then-increment implementation PASSED this test until the
# barrier was added, because the clients were never actually concurrent.
#
# Each client now connects, does its setup, then sleeps until a common wall
# clock instant before touching the slot, so they collide inside the critical
# section rather than politely queueing outside it.
START_AT=$("${PSQL[@]}" -c "select (now() + interval '3 seconds')::text")

ERRDIR=$(mktemp -d)
trap 'cleanup; rm -rf "$ERRDIR"' EXIT

pids=()
for i in $(seq 1 "$CONCURRENCY"); do
  psql -h localhost -p "$PGPORT" -d "$PGDATABASE" -q -t -A -c "
    select set_config('request.jwt.claim.sub', '${OWNER}', false);
    select pg_sleep(greatest(0, extract(epoch from ('${START_AT}'::timestamptz - clock_timestamp()))));
    select public.book_appointment(
      '${SLOT}', '${SERVICE_ID}', '${VEHICLE}', 'حجز متزامن ${i}', 50000);
  " >/dev/null 2>"$ERRDIR/$i.err" &
  pids+=($!)
done

succeeded=0
for pid in "${pids[@]}"; do
  if wait "$pid"; then succeeded=$((succeeded + 1)); fi
done

# Losers must fail CLEANLY.
#
# The capacity invariant is actually guaranteed by the `booked_count <=
# capacity` CHECK constraint, not by the function — a naive check-then-increment
# implementation is equally safe, because the constraint rejects the surplus
# increment. Verified by deliberately breaking the function: no overselling
# occurred either way.
#
# What the atomic UPDATE buys is the difference between a customer seeing
# "choose another time" and a customer seeing a database constraint error. So
# the test asserts the failure MODE, which is the part the implementation
# actually controls.
# `|| true` because pipefail turns a no-match grep (exit 1) into a script
# abort — and "no constraint errors" is the PASSING case for the second grep.
clean_failures=$( { grep -l "no longer available" "$ERRDIR"/*.err 2>/dev/null || true; } | wc -l | tr -d ' ')
constraint_failures=$( { grep -l "appointment_slots_capacity_ok" "$ERRDIR"/*.err 2>/dev/null || true; } | wc -l | tr -d ' ')

booked=$("${PSQL[@]}" -c "select booked_count from public.appointment_slots where id = '${SLOT}'")
orders=$("${PSQL[@]}" -c "select count(*) from public.orders where slot_id = '${SLOT}'")

expected_losers=$((CONCURRENCY - CAPACITY))

echo "  clients            : ${CONCURRENCY}"
echo "  capacity           : ${CAPACITY}"
echo "  bookings succeeded : ${succeeded}"
echo "  slot booked_count  : ${booked}"
echo "  orders created     : ${orders}"
echo "  clean refusals     : ${clean_failures}/${expected_losers}"
echo "  constraint errors  : ${constraint_failures}"

fail() { echo "  FAIL: $1" >&2; exit 1; }

# Exactly capacity, no more and no fewer. Over means the slot was oversold —
# two customers arrive for one bay. Under means contention lost bookings that
# should have succeeded, which costs the workshop real revenue.
[ "$succeeded" -eq "$CAPACITY" ] || fail "expected exactly ${CAPACITY} successes, got ${succeeded}"
[ "$booked" -eq "$CAPACITY" ] || fail "booked_count is ${booked}, expected ${CAPACITY}"

# The counter and the orders must agree: a counter incremented without an order
# leaks capacity, and an order without an increment oversells the slot.
[ "$orders" -eq "$CAPACITY" ] || fail "created ${orders} orders for ${CAPACITY} capacity"

# Every loser saw the friendly refusal, and none saw a raw constraint error.
[ "$clean_failures" -eq "$expected_losers" ] ||
  fail "only ${clean_failures}/${expected_losers} losers got a clean refusal"
[ "$constraint_failures" -eq 0 ] ||
  fail "${constraint_failures} client(s) hit a raw check-constraint error"

echo "  ok   exactly ${CAPACITY} of ${CONCURRENCY} concurrent clients got the slot"
echo "  ok   the other ${expected_losers} were refused cleanly, not by a constraint error"
echo "   slot concurrency OK"
