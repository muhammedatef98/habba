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

All six backend phases pass their acceptance criteria. `pnpm verify` is green
twice consecutively. Both Expo apps bundle and the customer app runs on the iOS
simulator. Repo is private at **github.com/muhammedatef98/habba**.

```
45 migrations · 24 SQL suites · 2 concurrency tests · 50 customer tests
90 core tests · 29 ui · 9 i18n · 4 provider · typecheck + lint green
34 integration tests against real PostgREST + RLS
```

⚠️ On macOS with PostgreSQL 17, `pg_ctl` fails with "postmaster became
multithreaded during startup" unless `LC_ALL` is set to a valid locale.
Use `LC_ALL=en_US.UTF-8 pnpm verify` — without it the integration suites
silently skip.

⚠️ **Set it to `en_US.UTF-8`, not `C`.** `LC_ALL=C` satisfies Postgres but puts
Ruby in ASCII-8BIT, and CocoaPods then dies with `Unicode Normalization not
appropriate for ASCII-8BIT`. `pod install` crashes, Pods are never regenerated,
and the iOS build fails much later and much less obviously with
`ld: framework 'React' not found` — which reads like a broken checkout rather
than a locale problem. Both tools are happy with a real UTF-8 locale.

---

## 3. Repo layout

```
habba/
├─ CLAUDE.md                 spec §0–5, permanent context — re-read every session
├─ HANDOFF.md                this file
├─ apps/
│  ├─ customer/              Expo app — vehicle owners
│  │  ├─ app/                expo-router screens
│  │  ├─ src/data/           repository interface + in-memory + Supabase impls
│  │  ├─ src/lib/            otp, email-auth, location, supabase, i18n, rtl, payments
│  │  ├─ src/state/          zustand session
│  │  └─ metro.config.js     monorepo resolution (see §8 — this was missing)
│  ├─ provider/              Expo app — technicians & workshops
│  └─ (admin/ NOT BUILT — Next.js ops dashboard, §9.4)
├─ packages/
│  ├─ core/                  saudi validators, SarAmount money, report render,
│  │                         inspection scoring, job-flow state mirror
│  ├─ ui/                    design system (tokens, Text, Button, Card, Field,
│  │                         Screen, ProvenanceBadge, StatusPill, StatCluster,
│  │                         ProgressStages, TimelineList, theme)
│  └─ i18n/                  ar.json + en.json, typed keys
├─ supabase/
│  ├─ migrations/            0001–0040, forward-only
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
cd apps/customer && npx expo start          # dev build / simulator
npx expo start --go --tunnel                # Expo Go over tunnel (firewall-proof)
xcrun simctl launch <UDID> sa.habba.customer
```

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

### Design-system port and emergency-flow rebuild (latest session)

A Claude Design handoff bundle (`Habba Emergency Flow.dc.html`, `Habba Design
System.dc.html`) became the source of truth for colour and for the emergency
flow's information architecture. Branch: `feat/emergency-flow-design-port`.

- **Palette ported wholesale.** Every ramp in `tokens.ts` changed, so every
  existing screen restyled. Warning is now an alias of sand — the design makes
  warning and accent the same amber deliberately, so a non-emergency alert can
  never borrow the emergency red, and an alias stops them drifting. New Info
  ramp; there was no informational colour before.
- **Five design values were changed on the way in**, each a colour that is fine
  as a border or a dot being used for small text below 4.5:1. Four were fixed by
  promoting the text role to a darker step the designer already chose; only
  `petrol[400]` (#34968F) is new. Every divergence is marked `WCAG:` in
  `tokens.ts`. **The fifth was caught by the existing provenance-badge test**,
  not predicted — a grey that passes on the page background fails on the darker
  sunken surface the badge actually sits on. That test earned its keep.
- **Ten screens, no new state machine.** They map one-to-one onto `OrderStatus`.
  `tracking.tsx` is now a dispatcher over six components in
  `src/components/tracking/`; `emergency.tsx` split into a route group.
- **The home screen's red emergency button is gone.** The design forbids red
  before an emergency is under way; a permanently red button is the "everything
  is urgent" failure the palette exists to prevent. Weight comes from size now.
- **Nothing is stubbed with plausible data.** Unbacked figures are optional
  fields with defined reduced states. See §10 for what is still missing and why
  inventing it would have been worse than omitting it.
- **Migration 0040** added handover codes and `order_live_progress`. The
  handover code lives in its own table because `orders_read_assigned_provider`
  would otherwise let the provider read the code they are being checked
  against — RLS is row-granular, and column grants cannot separate two parties
  who are both `authenticated`.

⚠️ One correction worth remembering: 0040's first draft justified
`order_live_progress` on privacy grounds. That was wrong — 0022 already lets a
customer read their assigned provider's position during the in-transit window.
The function's real value is keeping the ETA arithmetic in Postgres (§2.2) and
refusing to answer from a stale fix. An integration test now pins the 0022
policy so a future narrowing surfaces there rather than as a blank screen.

### Brand mark and the defects running it surfaced

- **The app had no icon** — a blank springboard tile — and the mark appeared
  nowhere inside it. `apps/customer/scripts/generate-logo-assets.py` now renders
  every size from the design's own paths; the raster output is committed.
  react-native-svg is deliberately not a dependency: it would mean a native
  rebuild for eleven static images.
- Shared marks live in `packages/ui/assets`, launcher icons in the app. The
  design system owns the brand; each app owns its own launcher.
- **Call and chat dialled `+966500000000`** — nobody. Now inert until a masked
  relay number exists, with copy explaining why. Dialling a wrong number during
  an emergency is worse than a disabled button.

### ⚠️ Two traps that cost hours, worth not rediscovering

**Controls in the home-indicator strip look broken.** The triage skip button
rendered 18dp from the bottom edge, inside the strip iOS claims for its own
swipe, and simply did not respond. It presents as a _navigation_ bug — the
button appears dead, so the router and the route tree are the obvious suspects.
Three navigation rewrites later the answer was that the press never arrived:
the same button responded when tapped 18dp higher. `Screen` now floors the
bottom inset at 34dp. Nothing in the test suite asserts layout, so a green run
says nothing about whether a control is reachable.

**`[runtime not ready]: ReferenceError: Property 'MessageQueue' doesn't exist`**
is a stale native binary, not app code. It appears when the installed build's
Expo config no longer matches what Metro serves — changing `app.json` (adding
the icon did exactly this) is enough. `npx expo run:ios` fixes it; relaunching
the existing binary against a fresh Metro does not, and neither does clearing
the Metro cache.

### Phase 3 customer surfaces (§9.1)

The backend passed Phase 3's acceptance criteria long ago, but **nothing had
ever driven it from the app**. Added:

- `app/vehicles.tsx` — home; vehicle switcher + طلب طارئ / حجز موعد
- `app/emergency/` — service → location confirm → optional video triage,
  behind a Zustand draft store and a dark-scoped ThemeProvider
- `app/tracking.tsx` — status, provider card, quote banner, completion
  confirmation, rating. §8 calls this the emotional core; motion is eased and
  directional, never bouncy (a breathing pulse, not a spinner)
- `app/quote.tsx` — line-itemed parts, OEM flag, per-line approval
- `app/booking.tsx` — honest "coming soon" (Phase 4 backend exists, screens don't)
- `src/components/RatingStars.tsx` — 48dp touch targets, no third-party widget

### Guest access + email identity (migration 0039)

**The decision that matters:** a guest is a real Supabase **anonymous auth
user**, not an unauthenticated client. Every RLS policy keys on `auth.uid()`;
a guest without one matches zero rows and could not own a logbook at all —
which would defeat §11's "the logbook is top-of-funnel and never gated."
Anonymous auth issues a genuine uid, so the guest owns real rows, and
conversion to a full account **keeps the same uid** so the logbook carries over.

Schema: `profiles.phone` became nullable, `email` gained case-insensitive
uniqueness + `email_verified`, `is_guest` added with a rule that it may only
fall (never rise) and only when an identity exists.

New screens: `app/email.tsx` (register/sign-in), `app/save-account.tsx`
(guest → account), guest banner on home.

### Read-surface hardening (0037, 0038)

First audit of what clients can _read_ — all prior passes audited writes.

### Harness fix — the most instructive bug

`postgrest.sh stop` ran `kill "$(cat $PIDFILE)" && rm -f "$PIDFILE"`. `kill`
only _requests_ termination and returns immediately, but the pidfile was
deleted regardless. So: stop printed "postgrest stopped" while the process
lived → pidfile gone → `is_running` false → `start` launched a new instance
that **could not bind the taken port** → the readiness probe hit the **old**
process, got 200, printed "ready". The harness announced success while serving
a schema cache older than the migrations under test.

It surfaced as `Could not find the 'is_guest' column of 'profiles' in the
schema cache`, which reads like a failed migration rather than a stale reader.
One orphan survived **13 hours and three verify runs**. I worked around this
symptom twice before actually reading the eight lines of shell — that was the
wrong call and cost more than the fix did.

---

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

- **Admin dashboard (§9.4, Next.js)** — not started. Provider verification
  queue, live order map, dispute resolution, pricing tuning, payout runs.
- **Booking flow (§9.1)** — placeholder screen. Backend built and tested,
  including the slot-concurrency guarantee. This is the obvious next increment.
- **Inspection screens (Phase 5)** — backend done, no customer UI.
- **GPS and camera are both real now** — expo-location behind the same
  interface (the stub remains for Expo Go, where a bare-workflow permission
  request fails in a way indistinguishable from a denial), and expo-camera with
  a 20s cap uploading to the `triage-media` bucket.
- **No masked-call relay** — `ProviderSummary` has no phone field, so call and
  chat on the tracking screens are disabled. Needs a relay number issued per
  job, not the technician's own line.
- **Guest → account conversion** uses the dev stub. Real Supabase
  `signInAnonymously` + identity linking is not wired.
- **Push notifications** — no notifications table and nothing sending them, so
  the design's header bell is deliberately absent rather than decorative.
- **Wallet** — nothing holds a balance, a card or a transaction; escrow is
  per-order and lives on the order. The tab bar ships with three tabs, not the
  design's four, until there is something to put in it.
- **The dispatch tick is not scheduled** — `supabase/functions/dispatch-tick`
  exists and `expand_stale_searches()` is tested, but nothing calls it on a
  timer yet. Needs a cron (~15s) and `HABBA_DISPATCH_TICK_SECRET` set. Until
  then searches broadcast round 1 and never widen.
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
