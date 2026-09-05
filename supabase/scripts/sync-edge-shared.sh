#!/usr/bin/env bash
#
# Copies pure modules from @habba/core into supabase/functions/_shared for
# Deno, since Edge Functions cannot resolve pnpm workspace packages.
#
# The choice was duplicate-and-sync or vendor a bundler into the deploy step.
# Duplicating pure, dependency-free modules and failing CI on drift is the
# smaller cost — and it keeps them unit-tested in Node, where the tests already
# run. The SMS transport in particular must stay testable: it is the module
# that decides whether an undelivered OTP reads as delivered.
#
#   --check   exit non-zero if any copy is stale (used by CI)

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CORE="$ROOT/packages/core/src"
SHARED="$ROOT/supabase/functions/_shared"
MODE="${1:-write}"

header() {
  printf '%s\n' \
    '// GENERATED FILE — DO NOT EDIT.' \
    "// Source: $1" \
    '// Regenerate: ./supabase/scripts/sync-edge-shared.sh' \
    '//' \
    '// Edge Functions run on Deno and cannot import pnpm workspace packages, so' \
    '// this module is vendored here. CI runs this script with --check, so drift' \
    '// fails the build rather than quietly shipping stale behaviour.' \
    ''
}

generate_report() {
  header 'packages/core/src/report/{types,qr,render}.ts'

  # The three modules are concatenated, so the cross-imports between them go.
  grep -v "^import .*'\./types\.js';$" "$CORE/report/types.ts"
  printf '\n'
  cat "$CORE/report/qr.ts"
  printf '\n'
  grep -vE "^import .*'\./(types|qr)\.js';$" "$CORE/report/render.ts"
}

generate_sms() {
  header 'packages/core/src/sms/unifonic.ts'
  cat "$CORE/sms/unifonic.ts"
}

# name → generator
MODULES=("report:generate_report" "sms:generate_sms")

mkdir -p "$SHARED"
status=0

for entry in "${MODULES[@]}"; do
  name="${entry%%:*}"
  fn="${entry##*:}"
  dest="$SHARED/$name.ts"

  if [ "$MODE" = "--check" ]; then
    if ! diff -q <("$fn") "$dest" >/dev/null 2>&1; then
      echo "error: $dest is out of date. Run ./supabase/scripts/sync-edge-shared.sh" >&2
      diff <("$fn") "$dest" | head -40 >&2 || true
      status=1
    fi
  else
    "$fn" > "$dest"
    echo "wrote $dest"
  fi
done

if [ "$MODE" = "--check" ]; then
  [ "$status" -eq 0 ] && echo "edge shared code is in sync"
  exit "$status"
fi
