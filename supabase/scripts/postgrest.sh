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
    # An already-running instance is NOT simply "fine". PostgREST caches the
    # schema at startup, and `pnpm verify` re-migrates the database on every
    # run — so reusing a live instance serves a cache that predates the new
    # columns. The failure it produces is thoroughly misleading: PostgREST
    # answers "Could not find the 'is_guest' column of 'profiles' in the
    # schema cache", which reads like a migration that did not apply rather
    # than a stale reader. That cost real debugging time three separate times
    # before this branch existed.
    #
    # SIGUSR1 makes PostgREST reload the schema cache in place, which is
    # cheaper than a restart and keeps the port up for anything mid-request.
    if is_running; then
      kill -USR1 "$(cat "$PIDFILE")" 2>/dev/null || true

      for _ in $(seq 1 40); do
        if curl -fsS "http://127.0.0.1:${PGREST_PORT}/vehicle_makes?limit=1" >/dev/null 2>&1; then
          echo "postgrest already running on :$PGREST_PORT — schema cache reloaded"
          exit 0
        fi
        sleep 0.25
      done

      echo "error: postgrest is running but did not reload its schema cache." >&2
      echo "       try: $0 stop && $0 start" >&2
      exit 1
    fi

    if ! command -v postgrest >/dev/null 2>&1; then
      echo "error: postgrest not found (brew install postgrest)" >&2
      exit 1
    fi

    # Not tracked by the pidfile, but holding the port: an orphan from an
    # earlier stop, or a hand-started instance. Starting on top of it means
    # the new process fails to bind while the readiness probe below happily
    # answers from the OLD one — success reported, stale schema served. Refuse
    # instead, and say what to do about it.
    if lsof -nP -iTCP:"${PGREST_PORT}" -sTCP:LISTEN >/dev/null 2>&1; then
      echo "error: port ${PGREST_PORT} is already held, but not by a tracked instance:" >&2
      lsof -nP -iTCP:"${PGREST_PORT}" -sTCP:LISTEN >&2
      echo "       run '$0 stop' first, or kill the process above." >&2
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
    # ⚠️ `kill` only REQUESTS termination; it returns immediately. The previous
    # version paired it with `rm -f $PIDFILE` unconditionally, which produced a
    # silent, long-lived failure:
    #
    #   1. stop printed "postgrest stopped" while the process was still alive
    #   2. the pidfile was gone, so is_running() then reported false
    #   3. start launched a NEW postgrest, which could not bind the taken port
    #   4. the readiness probe hit the OLD process, got 200, printed "ready"
    #
    # The result was a server that announced success while serving a schema
    # cache from before the migrations under test — surfacing as
    # "Could not find the 'is_guest' column of 'profiles' in the schema cache",
    # which reads like a broken migration rather than a stale reader. One
    # instance survived 13 hours and three verify runs this way.
    #
    # So: wait for the process to actually go, escalate if it will not, and
    # only then drop the pidfile.
    if is_running; then
      pid="$(cat "$PIDFILE")"
      kill "$pid" 2>/dev/null || true

      for _ in $(seq 1 40); do
        kill -0 "$pid" 2>/dev/null || break
        sleep 0.25
      done

      if kill -0 "$pid" 2>/dev/null; then
        echo "postgrest ignored SIGTERM; sending SIGKILL" >&2
        kill -9 "$pid" 2>/dev/null || true
        sleep 0.5
      fi

      rm -f "$PIDFILE"
      echo "postgrest stopped"
    else
      rm -f "$PIDFILE"
      echo "postgrest not running"
    fi

    # The port is the thing that actually matters to the next `start`. An
    # untracked instance (orphaned by an earlier buggy stop, or started by
    # hand) holds it just as effectively as a tracked one, and would be
    # invisible to the pidfile check.
    if lsof -nP -iTCP:"${PGREST_PORT}" -sTCP:LISTEN >/dev/null 2>&1; then
      echo "warning: port ${PGREST_PORT} is still held by an untracked process:" >&2
      lsof -nP -iTCP:"${PGREST_PORT}" -sTCP:LISTEN >&2
      echo "         kill it before starting, or the next start will serve a stale schema." >&2
      exit 1
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
