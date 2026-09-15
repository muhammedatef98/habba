#!/usr/bin/env bash
#
# Fails if a server-only secret is reachable from a client bundle.
#
# Amendment B (CLAUDE.md §5.1.6) requires this by name:
#
#     `SUPABASE_SERVICE_ROLE_KEY` is server-only: route handlers and server
#     components exclusively. Never in a client component, never prefixed
#     `NEXT_PUBLIC_`. A CI check fails the build if it appears anywhere
#     reachable from the client bundle.
#
# ⚠️ Two different mistakes, and the second is the one that actually happens.
#
#   1. Reading the secret in a file that ships to a client. Caught by scanning
#      the mobile app and any Next.js file carrying `'use client'`.
#   2. Renaming it so it ships. `NEXT_PUBLIC_*` and `EXPO_PUBLIC_*` are inlined
#      into the bundle by definition, so a variable whose NAME contains
#      SERVICE_ROLE or SECRET under either prefix is exposed however carefully
#      the file that reads it was written. Nobody does this on purpose; it
#      happens when a variable is renamed to "make it work" at 6pm.
#
# Greps source, not build output, so it runs in seconds and fails on the commit
# rather than after a deploy.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

status=0
fail() { echo "❌ $*" >&2; status=1; }

# Anything a client could possibly read. `apps/admin/app/**` is included whole
# because a Next.js file without a directive is a SERVER component — but it can
# be imported by a client one, and the import graph is not something a grep can
# follow. The `'use client'` scan below is the precise half; this is the blunt
# half, and it is deliberately blunt.
CLIENT_GLOBS=(
  "apps/mobile/src" "apps/mobile/app" "apps/mobile/app.config.ts"
  "packages/ui/src" "packages/core/src" "packages/i18n/src"
)

echo "── checking for server-only secrets on client paths"

# 1. A client path that READS a server-only secret.
#
# ⚠️ Reading it, not naming it. The first version of this check grepped for the
# string and failed on `packages/core/src/supabase/api-keys.ts`, whose whole job
# is to tell the two KEY FORMATS apart and which therefore documents both names
# in its JSDoc without ever touching a value. A check that fires on a comment
# gets suppressed, and a suppressed check protects nothing.
for path in "${CLIENT_GLOBS[@]}"; do
  [ -e "$path" ] || continue
  if grep -rn --binary-files=without-match \
       -E '(process\.env[.\[]|Deno\.env\.get\()[^)]*(SERVICE_ROLE|SECRET_KEY)' "$path" \
       --include='*.ts' --include='*.tsx' --include='*.js' 2>/dev/null; then
    fail "a service-role secret is READ on a client path: $path"
  fi
done

# 2. A secret renamed under a public prefix. The prefix IS the exposure.
if grep -rn --binary-files=without-match \
     -E '(NEXT_PUBLIC|EXPO_PUBLIC)_[A-Z_]*(SERVICE_ROLE|SECRET|PRIVATE)' \
     apps packages --include='*.ts' --include='*.tsx' --include='*.js' \
     --include='*.mjs' --include='*.json' 2>/dev/null \
     | grep -v node_modules; then
  fail "a secret-looking variable carries a PUBLIC prefix — it is inlined into the bundle"
fi

# 3. Client components in the console reading any server-side env at all.
#    `'use client'` is the marker Next.js itself uses, so this is exact rather
#    than heuristic.
if [ -d apps/admin ]; then
  while IFS= read -r file; do
    if grep -qE "^\s*['\"]use client['\"]" "$file" 2>/dev/null; then
      if grep -n -E 'process\.env\.[A-Za-z_]+|process\.env\[' "$file" \
           | grep -vE 'NEXT_PUBLIC_' >/dev/null 2>&1; then
        fail "client component reads a non-public env var: $file"
        grep -n -E 'process\.env\.[A-Za-z_]+|process\.env\[' "$file" \
          | grep -vE 'NEXT_PUBLIC_' >&2 || true
      fi
    fi
  done < <(find apps/admin -name '*.ts' -o -name '*.tsx' | grep -v node_modules)
fi

# 4. A literal key pasted into a versioned file. The legacy service-role key is
#    a JWT whose payload names the role; the new one is `sb_secret_…`.
# Test files are excluded: `api-keys.test.ts` asserts on fixtures shaped like
# secret keys, which is exactly how that module gets tested. A real key pasted
# into a non-test source file still fails here.
if grep -rn --binary-files=without-match \
     -E 'sb_secret_[A-Za-z0-9_-]{8,}' apps packages supabase \
     --include='*.ts' --include='*.tsx' --include='*.json' --include='*.sql' 2>/dev/null \
     | grep -v node_modules \
     | grep -v check-secret-exposure \
     | grep -vE '\.(test|spec)\.tsx?:'; then
  fail "a literal secret key is committed"
fi

if [ "$status" -eq 0 ]; then
  echo "── no server-only secret is reachable from a client bundle"
fi

exit "$status"
