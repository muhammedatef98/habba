#!/usr/bin/env bash
#
# Runs PostgREST over the local database.
#
# Why this exists: the Phase 1 acceptance criterion is end-to-end — a user
# signs up, adds a vehicle, sees an empty logbook. Verifying the schema in psql
# and the app in vitest proves each half separately and the seam not at all.
# PostgREST is the same component Supabase runs in front of Postgres, so
# putting it here means the integration tests exercise real HTTP, a real JWT,
# real role switching and real RLS — without needing Docker or a cloud project
# (the region decision is still open, ADR-0010).
#
# Usage: ./postgrest.sh start | stop | status

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PGPORT="${HABBA_PGPORT:-54329}"
PGREST_PORT="${HABBA_PGREST_PORT:-54321}"
RUNDIR="$ROOT/supabase/.tmp"
CONF="$RUNDIR/postgrest.conf"
PIDFILE="$RUNDIR/postgrest.pid"
LOGFILE="$RUNDIR/postgrest.log"

# Development-only secret. PostgREST requires >= 32 bytes for HS256.
# Never used outside the local harness; production secrets come from the
# Supabase project and are never committed.
JWT_SECRET="${HABBA_JWT_SECRET:-habba-local-development-jwt-secret-do-not-use}"

mkdir -p "$RUNDIR"

is_running() {
  [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null
}

case "${1:-}" in
  start)
    if is_running; then echo "postgrest already running on :$PGREST_PORT"; exit 0; fi

    if ! command -v postgrest >/dev/null 2>&1; then
      echo "error: postgrest not found (brew install postgrest)" >&2
      exit 1
    fi

    cat > "$CONF" <<EOF
db-uri = "postgres://authenticator@localhost:${PGPORT}/habba_dev"
db-schemas = "public"
db-anon-role = "anon"
db-pool = 4
jwt-secret = "${JWT_SECRET}"
server-port = ${PGREST_PORT}
server-host = "127.0.0.1"
EOF

    postgrest "$CONF" > "$LOGFILE" 2>&1 &
    echo $! > "$PIDFILE"

    # Probe a real relation, not `/`. PostgREST binds the port and answers the
    # root BEFORE the schema cache finishes loading, so waiting on `/` reports
    # ready while table requests still fail — which showed up as the
    # integration suite silently skipping itself.
    for _ in $(seq 1 60); do
      if curl -fsS "http://127.0.0.1:${PGREST_PORT}/vehicle_makes?limit=1" >/dev/null 2>&1; then
        echo "postgrest ready on http://127.0.0.1:${PGREST_PORT}"
        exit 0
      fi
      sleep 0.25
    done

    echo "error: postgrest did not become ready. Log:" >&2
    tail -20 "$LOGFILE" >&2
    exit 1
    ;;

  stop)
    if is_running; then
      kill "$(cat "$PIDFILE")" && rm -f "$PIDFILE"
      echo "postgrest stopped"
    else
      echo "postgrest not running"
    fi
    ;;

  status)
    if is_running; then echo "running (pid $(cat "$PIDFILE"))"; else echo "not running"; fi
    ;;

  *)
    echo "usage: $0 {start|stop|status}" >&2
    exit 1
    ;;
esac
