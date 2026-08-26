# ADR-0015 — Local verification harness without Docker

- **Status:** Accepted (implemented in Phase 1)
- **Date:** 2026-08-26
- **Relates to:** ADR-0002, ADR-0010, ADR-0014

## Context

`supabase start` requires Docker, which was not available on the development
machine. That left three options for verifying migrations and RLS:

1. Write the SQL and not run it. Rejected outright — the build prompt itself
   shipped SQL that cannot execute (ADR-0002), and unverified SQL is precisely
   how that happens.
2. Provision a hosted Supabase project. Rejected for now: the region is chosen
   once at project creation and is expensive to reverse (ADR-0010), so
   verification must not force that decision prematurely.
3. Run the pieces natively.

A second problem sat underneath: even with migrations verified in psql and the
app verified in Vitest, **the seam between them was untested**. Phase 1's
acceptance criterion is a journey — sign up, add a vehicle, see an empty
logbook — and two half-proofs do not make it.

## Decision

Run PostgreSQL, PostGIS and **PostgREST** natively, driven by scripts in
`supabase/scripts/`.

| Piece                 | Role                                                                                                                                                                             |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `local-db.sh`         | boots a throwaway cluster under `supabase/.data`, applies the shim + migrations + seed, runs the `.sql` suites                                                                   |
| `supabase_shim.sql`   | recreates the Supabase primitives the migrations depend on: `auth.users`, `auth.uid()`, `auth.role()`, and the `anon` / `authenticated` / `service_role` / `authenticator` roles |
| `postgrest.sh`        | serves the database over HTTP — the same component Supabase runs behind its API gateway                                                                                          |
| `concurrency-test.sh` | multi-session hash-chain test, which a single psql script cannot express                                                                                                         |

Tests then stack in three layers, each proving something the others cannot:

1. **`.sql` suites** — schema constraints, the hash chain, tamper detection,
   and RLS evaluated as the real `authenticated` and `anon` roles.
2. **Vitest unit tests** — pure logic: Saudi identifiers, money, i18n, tokens.
3. **Integration tests** — app code through `supabase-js`, over HTTP, with a
   real HS256 JWT, through PostgREST's role switching, into RLS.

### Why PostgREST specifically

It is not a stand-in. Supabase's data API _is_ PostgREST, so the integration
tests exercise the real request path: JWT verification, `SET LOCAL ROLE`,
`request.jwt.claims`, RLS. The only local substitutions are GoTrue (tests mint
their own JWTs) and the API gateway (a fetch shim strips the `/rest/v1` prefix
Kong would route). Both substitutions are confined to test files — the app
uses an unmodified `supabase-js` client.

### The shim is never a migration

`supabase_shim.sql` lives in `scripts/`, not `migrations/`. On a hosted
project these objects already exist and `auth.users` belongs to GoTrue.
Applying the shim there would be actively harmful, so it is structurally
impossible to include in a migration run.

## Consequences

- Contributors need `postgresql@17`, `postgis` and `postgrest` rather than
  Docker. CI uses a `postgis` service container and a downloaded PostgREST
  binary, so the same three layers run there.
- `auth.uid()` had to be written to read **both** `request.jwt.claim.sub`
  (legacy, set directly by the psql suites) and `request.jwt.claims` (JSON, set
  by PostgREST ≥ 9). Supabase's real implementation does the same. Supporting
  only one would make one of the two test layers a fiction.
- Migrating to `supabase start` later requires no test changes — only pointing
  the harness scripts at different ports.

### Skipping is a hazard, not a convenience

The integration suite skips itself when the harness is unreachable, so
`pnpm test` stays fast on a machine with no database. During development this
produced a fully green run that had verified nothing — twice, once from
`describe.skipIf` being evaluated before `beforeAll`, and once from a readiness
probe that hit `/`, which PostgREST answers before its schema cache loads.

CI therefore sets `HABBA_REQUIRE_HARNESS=1`, which converts "skipped" into a
hard failure. Any suite that can silently opt out of running needs an
equivalent guard.
