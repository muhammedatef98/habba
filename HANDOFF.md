# Habba (هبّة) — Session Handoff

> **Purpose:** complete context transfer for continuing this project in a new chat.
> Written 2026-08-31. Read `CLAUDE.md` first (permanent project context, spec §0–5), then this.

---

## 0. How to resume in a new chat

Paste this at the start of a new session:

```
Read CLAUDE.md and HANDOFF.md in /Users/mohamed/habba before doing anything.
CLAUDE.md is the permanent spec context. HANDOFF.md is the state of the work,
including open decisions and known-incomplete areas. Then tell me what you
think the next step is and why, before you write any code.
```

The original master spec is at:
`/Users/mohamed/.claude/uploads/75e5d45a-88df-42d7-bc65-5af4e42f1dc8/f5f35d9e-HABBA_BUILD_PROMPT.md`

`CLAUDE.md` holds spec sections 0–5 verbatim. Sections 6–12 (data model,
algorithms, design system, app surfaces, phased build, anti-goals, definition
of done) live only in that uploaded file — re-read it when working on a phase.

---

## 1. What Habba is

A Saudi car-care super-app. Arabic-first, RTL-first. Launch market: Eastern
Province + Riyadh.

**The moat is not dispatch.** It is دفتر السيارة الرقمي — a permanent,
immutable, owner-portable vehicle logbook keyed to VIN and plate. Every
interaction writes to it. At resale the owner generates a verified
تقرير هبّة (signed report + public QR link), which makes Habba valuable to
people who are not currently buying a service, and converts the buyer into a
customer at zero CAC.

**Architectural consequence:** `vehicles` and its append-only `vehicle_timeline`
are the centre of the schema. Orders, inspections and payments are satellites
that write to the timeline. The timeline is append-only and tamper-evident —
enforced by triggers and revoked grants, never by convention.

---

## 2. Current state — one line

All six backend phases pass their acceptance criteria, and Amendments A and B
(one mobile app, roles as a join table, admin stays separate) are applied to
both the spec and the code. Repo is private at **github.com/muhammedatef98/habba**.

```
41 migrations · 20 SQL suites · 2 concurrency tests · tests/rls.spec.ts (17)
apps/mobile 52 · core 99 · ui 21 · i18n 9 · typecheck + lint + boundaries green
```

**There is now ONE mobile app.** `apps/customer` and `apps/provider` are gone;
`apps/mobile` serves both through `(customer)` and `(provider)` route groups.
`profiles.role` is gone too — roles live in `user_roles` (ADR-0016).

---

## 3. Repo layout

```
habba/
├─ CLAUDE.md                 spec §0–5, permanent context — re-read every session
├─ HANDOFF.md                this file
├─ apps/
│  └─ mobile/               ONE Expo app — customers and providers
│     ├─ app/               expo-router routes; (customer)/ and (provider)/ groups
│     ├─ src/features/customer/  customer screens + components
│     ├─ src/features/provider/  provider screens + shift state
│     ├─ src/features/shared/    data layer, lib, session/mode state, shared screens
│     ├─ metro.config.js    monorepo resolution
│     └─ vitest.config.ts   the `@/` alias, for tests
│  (admin/ NOT BUILT — separate Next.js ops dashboard, §9.4 + Amendment B)
├─ packages/
│  ├─ core/                  saudi validators, SarAmount money, report render,
│  │                         inspection scoring, job-flow state mirror
│  ├─ ui/                    design system (tokens, Text, Button, Card, Field,
│  │                         Screen, ProvenanceBadge, theme)
│  └─ i18n/                  ar.json + en.json, typed keys
├─ tests/rls.spec.ts        RLS + Amendment A6, over real HTTP with a real JWT
├─ supabase/
│  ├─ migrations/            0001–0041, forward-only
│  ├─ tests/                 00_helpers + 01–19 SQL suites
│  ├─ seed/                  cities, services, maintenance rules
│  └─ scripts/               local-db.sh, postgrest.sh, supabase_shim.sql,
│                            concurrency-test.sh, slot-concurrency-test.sh
└─ docs/adr/                 ADR-0001 … ADR-0015
```

---

## 4. Local development

No Docker. A throwaway Postgres cluster + PostgREST stand in for Supabase.

```bash
pnpm db:start        # boot local Postgres (port 54329)
pnpm db:reset        # drop, recreate, migrate, seed
pnpm db:test         # reset + run all SQL suites
pnpm api:start       # PostgREST on 54321
pnpm verify          # typecheck + lint + unit + SQL suites + integration
```

**Run `pnpm verify` TWICE.** The integration suite skips itself if PostgREST is
still warming, so a single run can show `16 passed | 32 skipped` and still exit 0. Two consecutive green runs is the real check. This is also how a stale-cache
bug hid for hours (§8).

Run the app:

```bash
pnpm --filter @habba/mobile start           # Metro
cd apps/mobile && npx expo start --go --tunnel   # Expo Go over tunnel
xcrun simctl launch <UDID> sa.habba.app
```

See `apps/mobile/README.md` for the dev credentials and how to approve a
provider locally (applying grants nothing — only approval does).

Dev credentials: OTP code is **`1234`**. Email auth is an in-memory stub.
Location is a fixed Dammam coordinate.

---

## 5. Key architectural decisions

| ADR  | Decision                                                                                                                                              |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0003 | Timeline append-only via three independent layers: no INSERT policy, revoked grants, SECURITY DEFINER write path                                      |
| 0004 | Hash chain over timeline rows; ordered by `seq` (identity column), **not** `recorded_at` — `now()` is transaction-start so all rows tie               |
| 0005 | Provenance levels: `self_reported`, `self_documented`, `habba_verified`, `third_party`. Derived server-side; a client can never request a trust level |
| 0006 | Order state machine in `order_transitions` table; `checked_in` replaces en_route/arrived for workshop mode                                            |
| 0007 | `SarAmount` = branded string, integer-halala arithmetic, ROUND_HALF_UP to match Postgres                                                              |
| 0008 | **UNRESOLVED — blocks shipping payments.** Merchant of record / SAMA question                                                                         |
| 0009 | **UNRESOLVED — completed orders may be unbillable.** ZATCA seller of record                                                                           |
| 0010 | **UNRESOLVED.** Supabase region / data residency / PDPL                                                                                               |
| 0013 | Providers see masked order info before accepting; exact address only after                                                                            |
| 0015 | Local harness exists so migrations are _verified_, not merely written                                                                                 |
| 0016 | Roles are `user_roles` rows, not a column; approval grants the provider role; one app with lint-enforced feature boundaries                           |
| 0017 | The report QR is generated in-page (no external request); KYC sealing is a stub until ADR-0010 lands                                                  |

---

## 6. Security model — read this before touching RLS

**The recurring bug class:** RLS grants row-level access and _cannot express
which columns_. `WITH CHECK` sees only the new row, never the old one. Fifteen
vulnerabilities were found across four adversarial audit passes; **none** was
found by the ~150 feature tests, because those all exercise the intended flow.

**The mechanisms:**

- **Column write guards** — `BEFORE UPDATE` triggers named `<table>_a_guard_columns`.
  The `_a_` makes them sort first, before the state-machine trigger.
- **`ENABLE ALWAYS`** on every guard, so they fire for `service_role` — the one
  actor RLS never applies to. Two guards were found missing this by the audit.
- **Privileged-write flag** — `begin_privileged_write()` / `end_privileged_write()`.
  Transaction-local, so it **must** be closed immediately; leaving it open
  reopens every hole for the rest of the transaction.
- **`is_ops()` is NOT exempted in `guard_profile_columns`** — deliberately.
  Exempting it would be circular: a user who set their own role to `ops` would
  pass the guard that stops them setting their own role.
- **Column read control** is a _grant-layer_ problem, not RLS. A column-level
  `REVOKE` is a **silent no-op** against an existing table-level grant. You must
  `REVOKE SELECT ON <table>` then `GRANT SELECT (explicit, column, list)`.

**Standing audits (these are build steps, not documentation):**

- `tests/16_write_surface_audit.sql` — every client-updatable table classified,
  every guarded table has a guard, every guard is `ENABLE ALWAYS`, sensitive
  columns still exist on guarded tables, append-only tables expose no write policy.
- `tests/17_read_surface_audit.sql` — uses `has_column_privilege()` (not
  `information_schema`, which reports the same false-safe answer a naive REVOKE
  would) to keep KYC columns off the client SELECT surface.

**Vulnerabilities fixed (migrations 0033–0039):** forged escrow status, price
rewriting, odometer rollback, VIN transplant, self-granted reputation/Nafath,
self-approval, part re-pricing after approval, alert rewriting, **privilege
escalation to `ops`** (invalidated all prior guards), issued-report payload
tampering, `booked_count` editing, provider KYC columns readable by any
authenticated client, ownership-transfer OTP hash exposed via self-declared
phone, globally-readable commission rates and invoice sellers.

---

## 7. What was built in this session

### Amendments A and B, in the spec and then in the code

`docs/HABBA_BUILD_PROMPT.md` gained §5.1 (app topology), mirrored verbatim into
`CLAUDE.md`, and the amendments were threaded through §2, §4, §6.1, §6.4, §6.9,
a new §6.10 (admin `audit_log`), §9, §10, §11 and §12.

### Roles as a join table (0040, 0041 — ADR-0016)

`profiles.role` dropped; `user_roles(user_id, role, granted_at, revoked_at,
granted_by)` added, closed to clients three ways. `customer` on profile insert;
`technician`/`workshop_admin` from `providers.verification_status='approved'`,
in the same transaction, revoked on suspension.

**Two real holes closed on the way**, both found by writing `tests/rls.spec.ts`
rather than by reading the schema:

- `current_provider_id()` matched ANY providers row, so a self-registered
  applicant held provider RLS access — open orders, live locations — before
  anyone read their ID.
- `providers` had no uniqueness on `owner_profile_id`. One user could hold
  several records; `sync_provider_role()` then reasoned about the row being
  written rather than the account, so inserting a second record revoked a role
  the first had earned.

### One app (`apps/mobile`)

Route groups, a provider-group guard that fails closed while roles load, a mode
switcher visible only to approved providers, last-mode persistence in
SecureStore, and «اشتغل معنا كفنّي» → KYC → pending → approval. Boundaries are
an ESLint error, verified by deliberately writing a cross-import and watching
lint fail.

### Phase 2 surfaces

Timeline grouped by the year work HAPPENED; an event detail screen that shows
both dates, the structured record and what the provenance level does not claim;
a mileage screen with progression; manual entry extended to service type, cost
(as `SarAmount`), parts with part numbers, and photos — where attaching a photo
moves the entry from `self_reported` to `self_documented`, derived server-side.

### The report QR (ADR-0017)

A dependency-free encoder in `@habba/core`, inlined as SVG so the page still
fetches nothing. `qr.test.ts` round-trips through jsQR, and immediately caught
two defects that produce a code which photographs perfectly and scans as
nothing: a Reed–Solomon generator polynomial built leading-coefficient-last,
and a transposed format-information block. **Structural assertions would have
passed on both.**

### Design system

`ListRow`, `EmptyState` and `BottomSheet`; `self_documented` promoted to a real
token pair with the contrast test extended to all three provenance levels.

## 8. Things that were never true until this session

- **Nothing had ever bundled.** No `metro.config.js` existed anywhere, so Metro
  could not resolve the workspace packages' `.js`-suffixed TypeScript imports
  (correct for `tsc` Node resolution, not something Metro rewrites). Both apps
  now bundle for iOS. The config adds `watchFolders`, `nodeModulesPaths`, and a
  `resolveRequest` fallback that retries a failed `.js` resolution
  extensionless.
- **Nothing had ever rendered on a device.** The customer app now runs on the
  iOS simulator.

---

## 9. Open decisions — these block real work

> Also summarised, with what each one blocks per phase, in `docs/ROADMAP.md`.

| #   | Decision                                                             | Blocks                                                                                                                                                              |
| --- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **ADR-0008 — payments / merchant of record / SAMA**                  | Anything that moves real money. `authorise_order_payment` / `capture_order_payment` are the interface; the PSP behind them is unchosen                              |
| 2   | **ADR-0009 — ZATCA seller of record**                                | Completed orders may be unbillable. Schema records _which_ seller so invoices stay attributable either way                                                          |
| 3   | **ADR-0010 — Supabase region / PDPL**                                | No hosted project exists. App falls back to in-memory repository                                                                                                    |
| 4   | **SMS provider** (Unifonic / Taqnyat / Twilio)                       | Real phone OTP. CITC sender-ID registration required                                                                                                                |
| 5   | **Plate letter map verification** against official MOI/Absher source | ADR-0011, now load-bearing in 5+ places                                                                                                                             |
| 6   | **Expo SDK 57 vs Expo Go**                                           | SDK 57 _is_ the current stable release, so an up-to-date Expo Go supports it. If the user's Expo Go is outdated the fallback is a dev build, or downgrade to SDK 54 |

---

## 10. Known incomplete

- **Admin dashboard (§9.4, Next.js + Amendment B)** — not started. Provider
  verification queue (which is what grants the provider role), live order map,
  dispute resolution, pricing tuning, payout runs, `audit_log` (spec §6.10 —
  the table is specified but not yet migrated), 2FA, 8-hour sessions, and the
  CI check that fails on a client-reachable service-role key.
- **Booking flow (§9.1)** — placeholder screen. Backend built and tested,
  including the slot-concurrency guarantee. This is the obvious next increment.
- **Inspection screens (Phase 5)** — backend done, no customer UI.
- **Camera and GPS are stubs** — both behind interfaces (`location-provider.ts`
  mirrors `otp-provider.ts`); swapping in real implementations is one file each.
- **KYC sealing is a stub** (ADR-0017). Real encryption is Supabase Vault /
  pgsodium and waits on ADR-0010, so no real ID or IBAN may be accepted yet.
- **Guest → account conversion** uses the dev stub. Real Supabase
  `signInAnonymously` + identity linking is not wired.
- **Video triage (§9.1)** — the 20-second clip before dispatch is not built.
- **PDF generation** — print-to-PDF only, no server-side render.
- **Ownership transfer acceptance** — `accept_ownership_transfer()` exists
  (0037) with OTP verification, atomic claim, privileged owner reassignment and
  a timeline event. Wired in SQL and tested; no UI.

---

## 11. Conventions to follow

- **Every migration is paired with a test suite.** One fix, one test. No
  exceptions since 0033.
- **Migration comments explain the attack**, not the syntax. Several open with
  the exact SQL that used to work.
- **Money never touches float.** `@habba/core`'s `SarAmount` everywhere. A first
  draft of `quote.tsx` used floats — caught in review, not by a test.
- **Never `select()` on `providers`.** Always an explicit column list — 0037
  revoked the KYC columns, and a bare `select()` requests every column and fails
  the whole query. This broke three integration tests when introduced.
- **No hardcoded strings.** All copy in `packages/i18n`, typed keys.
- **Errors surface in Arabic, plainly, with a next action** (§12). Never a raw
  Postgres or provider code.
- **Any status change goes through the state machine**, never a direct UPDATE.
- **The in-memory dev repository mirrors real server behaviour** where that
  behaviour is load-bearing. A stub more permissive than production hides bugs
  until launch.

---

## 12. Anti-goals (spec §11) — do not violate

- No chat-first or bidding-first experience. Saudi users want a price, not an auction.
- Providers **cannot** set their own prices for `emergency` services. Enforced
  by `reject_custom_price_on_fixed_service`.
- The logbook is **never** gated behind a paywall or behind having ordered.
- National IDs and IBANs are **never** stored in plaintext. Check constraints
  make an obvious plaintext write fail loudly.
- Completion photos and mileage are **never** skippable — without them the moat
  is empty.
- No web before mobile.
- No ride-hailing, fuel subscriptions, or car sales in v1.

---

## 13. Honest assessment

**What is solid:** the schema, the hash chain, the security guards, and the
test suites behind them. Fifteen vulnerabilities were found and fixed, and the
class they belong to is now a build step rather than a memory.

**What is thin:** everything above the database. Most screens are new and have
only been clicked through by hand on a simulator — there are no component tests
and no E2E coverage. The apps bundled for the first time this session, which
means every screen from every earlier phase had never actually run.

**What I would not trust yet:** that the read-side audit is complete. It was one
pass, and each prior write-side pass found things the previous one missed —
including a hole that made the previous passes moot. The standing audits narrow
the class, but they are _completeness_ checks, not proofs: they verify every
table has been classified and guarded, not that each guard is correct.
