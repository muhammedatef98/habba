#!/usr/bin/env bash
#
# Runs tests/rls.spec.ts in HOSTED mode against the local harness, through a
# gateway that behaves the way Supabase's does about URLs and apikey headers.
#
# It is not a substitute for verify-hosted.sh — no real GoTrue, no real gateway,
# no real project. What it catches is the class of bug that made the first real
# hosted run useless: a request path or header that only the hosted shape
# exercises. Those cost a round trip to a live project to find, and this finds
# them in CI.
#
# Requires the harness: pnpm db:reset && pnpm api:start

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PORT="${HABBA_GATEWAY_PORT:-54331}"

# Hosted, the anon key is itself a signed JWT and PostgREST parses it as one.
# A placeholder string would fail with "Expected 3 parts in JWT" and prove
# nothing about the path handling this script is here for.
SECRET="${HABBA_JWT_SECRET:-habba-local-development-jwt-secret-do-not-use}"
ANON_KEY=$(HABBA_SECRET="$SECRET" node -e '
  const crypto = require("node:crypto");
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: "HS256", typ: "JWT" });
  const body = b64({ role: "anon", iat: now, exp: now + 3600 });
  const sig = crypto.createHmac("sha256", process.env.HABBA_SECRET)
    .update(head + "." + body).digest("base64url");
  process.stdout.write(head + "." + body + "." + sig);
')

HABBA_GATEWAY_PORT="$PORT" node "$ROOT/supabase/scripts/hosted-shape-gateway.mjs" &
GATEWAY_PID=$!
trap 'kill "$GATEWAY_PID" 2>/dev/null || true' EXIT

# Give it a moment to bind; the suite's own probe retries, but a connection
# refused before listen() would be reported as an unreachable API.
for _ in $(seq 20); do
  if curl -sS -o /dev/null "http://127.0.0.1:$PORT/rest/v1/" 2>/dev/null; then break; fi
  sleep 0.25
done

HABBA_HOSTED=1 \
HABBA_REQUIRE_HARNESS=1 \
HABBA_POSTGREST_URL="http://127.0.0.1:$PORT" \
HABBA_ANON_KEY="$ANON_KEY" \
HABBA_JWT_SECRET="$SECRET" \
  pnpm --dir "$ROOT" test:rls
