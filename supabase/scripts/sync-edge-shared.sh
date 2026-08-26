#!/usr/bin/env bash
#
# Copies the report renderer from @habba/core into supabase/functions/_shared
# for Deno, since Edge Functions cannot resolve pnpm workspace packages.
#
# The choice was duplicate-and-sync or vendor a bundler into the deploy step.
# Duplicating a pure, dependency-free module and failing CI on drift is the
# smaller cost — and it keeps the renderer unit-tested in Node, where the tests
# already run.
#
#   --check   exit non-zero if the copy is stale (used by CI)

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SRC="$ROOT/packages/core/src/report"
DEST="$ROOT/supabase/functions/_shared/report.ts"
MODE="${1:-write}"

generate() {
  printf '%s\n' \
    '// GENERATED FILE — DO NOT EDIT.' \
    '// Source: packages/core/src/report/{types,render}.ts' \
    '// Regenerate: ./supabase/scripts/sync-edge-shared.sh' \
    '//' \
    '// Edge Functions run on Deno and cannot import pnpm workspace packages, so' \
    '// the renderer is vendored here. CI runs this script with --check, so drift' \
    '// fails the build rather than quietly shipping a stale report layout.' \
    ''

  # The two modules are concatenated, so the cross-import between them goes.
  grep -v "^import .*'\./types\.js';$" "$SRC/types.ts"
  printf '\n'
  grep -v "^import .*'\./types\.js';$" "$SRC/render.ts"
}

mkdir -p "$(dirname "$DEST")"

if [ "$MODE" = "--check" ]; then
  if ! diff -q <(generate) "$DEST" >/dev/null 2>&1; then
    echo "error: $DEST is out of date. Run ./supabase/scripts/sync-edge-shared.sh" >&2
    diff <(generate) "$DEST" | head -40 >&2 || true
    exit 1
  fi
  echo "edge shared code is in sync"
else
  generate > "$DEST"
  echo "wrote $DEST"
fi
