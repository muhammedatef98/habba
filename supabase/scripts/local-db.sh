#!/usr/bin/env bash
#
# Local Postgres harness for verifying migrations and RLS without Docker.
#
# `supabase start` requires Docker. Where that is unavailable, this runs a
# throwaway PostgreSQL cluster under supabase/.data and applies the shim plus
# every migration in order. It exists so migrations are VERIFIED rather than
# merely written — the build prompt itself shipped SQL that does not run
# (ADR-0002), and unverified SQL is how that happens.
#
# Usage:
#   ./local-db.sh start     boot the cluster
#   ./local-db.sh stop      shut it down
#   ./local-db.sh migrate   apply shim + migrations to a fresh database
#   ./local-db.sh reset     drop, recreate, migrate
#   ./local-db.sh test      reset, then run supabase/tests/*.sql
#   ./local-db.sh psql      interactive shell

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PGDATA="$ROOT/supabase/.data"
PGPORT="${HABBA_PGPORT:-54329}"
PGDATABASE="habba_dev"
LOGFILE="$ROOT/supabase/.data/postgres.log"

# Prefer a Homebrew PostgreSQL 17 if present, else whatever is on PATH.
for prefix in /opt/homebrew/opt/postgresql@17 /usr/local/opt/postgresql@17; do
  if [ -x "$prefix/bin/pg_ctl" ]; then
    export PATH="$prefix/bin:$PATH"
    break
  fi
done

if ! command -v pg_ctl >/dev/null 2>&1; then
  echo "error: PostgreSQL not found on PATH." >&2
  echo "  macOS:  brew install postgresql@17 postgis" >&2
  echo "  Linux:  apt-get install postgresql-17 postgresql-17-postgis-3" >&2
  exit 1
fi

export PGPORT PGDATABASE
PSQL=(psql -h localhost -p "$PGPORT" -v ON_ERROR_STOP=1 --quiet)

is_running() { pg_ctl -D "$PGDATA" status >/dev/null 2>&1; }

cmd_start() {
  if is_running; then echo "already running on port $PGPORT"; return 0; fi

  if [ ! -d "$PGDATA/base" ]; then
    echo "initialising cluster at $PGDATA"
    mkdir -p "$PGDATA"
    initdb -D "$PGDATA" --username="$(whoami)" --auth=trust --encoding=UTF8 \
      --locale=C >/dev/null
  fi

  echo "starting postgres on port $PGPORT"
  pg_ctl -D "$PGDATA" -l "$LOGFILE" -o "-p $PGPORT -k $PGDATA" -w start
}

cmd_stop() {
  if is_running; then pg_ctl -D "$PGDATA" -w stop; else echo "not running"; fi
}

cmd_create() {
  # PostgREST (or a stray psql) holds a connection, and DROP DATABASE fails
  # while anyone is attached. Evict them first so `reset` is reliable rather
  # than dependent on what happens to be running.
  psql -h localhost -p "$PGPORT" -d postgres -v ON_ERROR_STOP=1 --quiet -c \
    "select pg_terminate_backend(pid) from pg_stat_activity
     where datname = '$PGDATABASE' and pid <> pg_backend_pid()" >/dev/null

  psql -h localhost -p "$PGPORT" -d postgres -v ON_ERROR_STOP=1 --quiet \
    -c "drop database if exists $PGDATABASE" \
    -c "create database $PGDATABASE"
}

cmd_migrate() {
  echo "applying supabase shim (local only — never run against hosted Supabase)"
  "${PSQL[@]}" -d "$PGDATABASE" -f "$ROOT/supabase/scripts/supabase_shim.sql" >/dev/null

  for migration in "$ROOT"/supabase/migrations/*.sql; do
    printf '  %s\n' "$(basename "$migration")"
    "${PSQL[@]}" -d "$PGDATABASE" -f "$migration" >/dev/null
  done

  if [ -f "$ROOT/supabase/seed/seed.sql" ]; then
    echo "seeding"
    "${PSQL[@]}" -d "$PGDATABASE" -f "$ROOT/supabase/seed/seed.sql" >/dev/null
  fi

  echo "migrations applied cleanly"
}

cmd_reset() { cmd_start; cmd_create; cmd_migrate; }

cmd_test() {
  cmd_reset
  echo
  local failed=0
  for suite in "$ROOT"/supabase/tests/*.sql; do
    [ -e "$suite" ] || continue
    echo "── $(basename "$suite")"
    if "${PSQL[@]}" -d "$PGDATABASE" -f "$suite"; then :; else failed=1; fi
  done
  if [ "$failed" -ne 0 ]; then echo; echo "DATABASE TESTS FAILED"; exit 1; fi

  # Needs genuinely concurrent sessions, so it cannot be a .sql suite.
  echo
  "$ROOT/supabase/scripts/concurrency-test.sh" || { echo "CONCURRENCY TEST FAILED"; exit 1; }

  echo; echo "all database tests passed"
}

cmd_psql() { exec psql -h localhost -p "$PGPORT" -d "$PGDATABASE"; }

case "${1:-}" in
  start)   cmd_start ;;
  stop)    cmd_stop ;;
  create)  cmd_create ;;
  migrate) cmd_migrate ;;
  reset)   cmd_reset ;;
  test)    cmd_test ;;
  psql)    cmd_psql ;;
  *) echo "usage: $0 {start|stop|create|migrate|reset|test|psql}" >&2; exit 1 ;;
esac
