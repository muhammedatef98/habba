# Habba (هبّة) — Session Handoff

> **Purpose:** everything a new session needs to continue the work.
> Rewritten 2026-09-24. Read `CLAUDE.md` first (the permanent spec, §0–5.1),
> then this, then `docs/ROADMAP.md` for the phase-by-phase status.

---

## 0. How to resume

Paste this at the start of a new session:

```
Read CLAUDE.md, HANDOFF.md and docs/ROADMAP.md before doing anything.
CLAUDE.md is the permanent spec. HANDOFF.md is the state of the work and the
decisions still open. Then tell me what you think the next step is and why,
before you write any code.
```

The full build prompt (spec §6–12) is in `docs/HABBA_BUILD_PROMPT.md`.

---

## 1. What Habba is

A Saudi car-care super-app, Arabic-first and RTL-first, launching in the
Eastern Province and Riyadh. **The moat is the vehicle logbook**
(دفتر السيارة): a permanent, append-only, hash-chained service history keyed
to the car. Every order writes to it, and at resale it becomes a verified
تقرير هبّة. Orders, payments and inspections are satellites of the logbook.

---

## 2. Current state — one paragraph

Both request flows work end to end through the app's own code, with two
identities, against a real database: an emergency request (search → a
technician accepts → en route → arrived → work → parts approved → hand-back
with photos and warranty → customer approves → payment captured → logbook);
and a scheduled or workshop booking (slot → confirmed → check-in → work →
hand-back); and a pre-purchase inspection (the technician files the report
in the app, the buyer reads and shares it, then adds the car they bought with
the inspection as its first logbook entry). Each step pushes a notification. The **ops console**
(`apps/admin`) reaches everything an operator is answerable for, behind
mandatory 2FA and 8-hour sessions, with every change and every file opened
recorded in an immutable audit log. What stands between this and real users
is **not code**: see §7, open decisions.

```
80 migrations · 50 SQL suites (all pass) · tests/rls.spec.ts
mobile 234 unit + integration (Vitest) + 8 render (Jest) · core 177 · ui 54 · i18n 12
admin 16 unit + 8 against the real database · request-flow integration 17
inspection-flow integration 5
pnpm verify: typecheck, lint, format, edge-shared sync, unit, bundle,
             admin secret-key check, SQL suites, integration — twice green
```

---

## 3. Repo layout

```
habba/
├─ CLAUDE.md · HANDOFF.md
├─ apps/
│  ├─ mobile/     ONE Expo app (SDK 57): (customer) and (provider) route groups;
│  │              features/customer, features/provider, features/shared —
│  │              customer/provider may not import each other (ESLint error)
│  └─ admin/      Next.js ops console (web only). README.md: setup, Vercel,
│                 what it controls and what it deliberately cannot reach
├─ packages/
│  ├─ core/       money (SarAmount), Saudi validators, job-flow mirror,
│  │              report render + QR, Expo push envelope and receipts
│  ├─ ui/         design system (tokens → both apps)
│  └─ i18n/       ar.json + en.json (a test enforces Modern Standard Arabic)
├─ supabase/
│  ├─ migrations/ 0001–0080, forward-only, each paired with a suite
│  ├─ tests/      00_helpers + 01–46
│  ├─ functions/  dispatch-tick, push-tick, send-sms-hook; _shared is
│  │              VENDORED from @habba/core by scripts/sync-edge-shared.sh
│  ├─ storage/    storage policies (applied as the storage owner)
│  ├─ seed/       cities, services, maintenance rules
│  └─ scripts/    local-db.sh, postgrest.sh, supabase_shim.sql, …
├─ tests/rls.spec.ts   RLS over real HTTP with real JWTs
└─ docs/          ROADMAP.md, supabase-setup.md (the deploy runbook), adr/
```

---

## 4. Local development

No Docker: a throwaway Postgres cluster and PostgREST stand in for Supabase.
There is **no GoTrue locally** — sign-in against the harness uses minted JWTs
in tests; a real sign-in (including the console's 2FA) needs a Supabase
project.

```bash
pnpm db:start && pnpm api:start   # Postgres :54329, PostgREST :54321
pnpm db:test                      # reset + all SQL suites
pnpm verify                       # everything; run it TWICE before a commit
pnpm --filter @habba/mobile start # the app (in-memory data if no project)
pnpm --filter @habba/admin dev    # the console on :3100 (demo data if no project)
```

Dev credentials: app OTP `123456` (see `apps/mobile/README.md`); console
`ops@habba.sa`, any password of 8+ characters, authenticator code `123456`.

Deploying is `docs/supabase-setup.md`: create the project, apply migrations
and storage policies, deploy and **schedule** the two ticks (§7a) — without
them no search widens, no order auto-closes and nobody is notified.

---

## 5. Architecture and security — the rules that hold everything up

- **Rules live in SQL.** Every state change, price, permission and payment
  step is a Postgres function or trigger, proven in a suite. Edge Functions
  are transport only; the apps are thin clients.
- **Column guards** (`<table>_a_guard_columns`, `ENABLE ALWAYS`) — RLS cannot
  say which columns; these triggers do. Suite 16 audits that every guarded
  table has one and that it fires for `service_role`.
- **Privileged writes** — `begin_privileged_write()` lets a definer function
  make a change a client cannot. Transaction-local, closed immediately, and
  since 0071 **not callable by any client role**.
- **Payment state** (`escrow_status`, `payment_intent_id`, `refunded_amount`)
  is closed to direct writes by operators too (0069). Voids and refunds are
  rows in `payment_operations` for the PSP to carry out.
- **The logbook** is append-only (ADR-0003) and hash-chained (ADR-0004).
  Corrections are new `record_annotated` entries signed by Habba. An order
  closed by timeout says so in its entry (0071).
- **Ops access** — `is_ops()` requires an unrevoked `ops`/`super_admin` role
  AND a second factor verified within 8 hours (0068). Every console function
  checks it itself (0070); every change on an ops-writable table and every
  opening of a person's file is written to `audit_log`, which nobody can alter.
- **KYC ciphertext** (national ID, IBAN) is unreadable from every client,
  the console included (0037).

---

## 6. What was built across the last sessions (0064–0080)

| Area                                | Migrations | What it gave                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Completion evidence                 | 0064       | Real camera photos into a private bucket; the server verifies they exist                                                                                                                                                                                                                                                                                                                                                                              |
| The request actually goes somewhere | 0065       | `submit_order` (funded before dispatch), the bill computed at hand-back, warranty chosen with the evidence, booking priced                                                                                                                                                                                                                                                                                                                            |
| Notifications                       | 0066, 0072 | Outbox with leased claims, per-kind TTL, push-tick; **receipts**: delivered vs sent, dead installs retired                                                                                                                                                                                                                                                                                                                                            |
| Parts                               | 0067       | Customer approves or declines each line; hand-back waits for every answer                                                                                                                                                                                                                                                                                                                                                                             |
| Ops console                         | 0068–0070  | 2FA + 8h, audit log, settings, suspension, disputes and refunds, every read and action (see `apps/admin/README.md`)                                                                                                                                                                                                                                                                                                                                   |
| Orders that end                     | 0071       | Reminder half-way, then auto-close + capture when the customer never confirms                                                                                                                                                                                                                                                                                                                                                                         |
| Inspections in the app              | 0073       | Technician's form, report on the order + PDF, bought car joins the account; hand-back waits for the report                                                                                                                                                                                                                                                                                                                                            |
| Invoices, and reading documents     | 0074       | Tax invoice issued at completion (never blocks it; ops can issue it later, audited); raw issue closed to clients; every document viewed in the app **and** shared as PDF (ADR-0019 addendum)                                                                                                                                                                                                                                                          |
| Security sweep                      | 0075       | Owners could forge Habba-verified logbook entries; `active_warranties` leaked every customer's cover; internal dispatch/matching/capture callable by anyone; functions closed to `anon` by default. Suite 48 checks the catalogue so the next view/table/function cannot reopen them. Supabase sign-in now kept in the keychain (it was memory-only).                                                                                                 |
| Live screens, motion, failures said | 0076       | Supabase Realtime refreshes tracking, the quote, home, orders and the technician's offers/job the moment a row changes (polling kept as fallback); refetch on return to foreground; a toast for any action that failed with nothing on screen to say so; press springs, staggered entry, state transitions, all off under Reduce Motion (`packages/ui/src/motion.tsx`).                                                                               |
| Ready for the real gateway and OTP  | 0077       | `payments_gateway` switch: once `moyasar`, a hold is recorded only by the `payments` Edge Function after checking it with Moyasar's secret key (exact amount, SAR, this order); capture/void/refund run from a queue it drains. The phone's card form is the one plug point (`lib/moyasar-card-form.ts`). Real phone sign-in could not complete (profile save read a user id the app had not stored yet) — fixed. `docs/GO-LIVE.md` is the checklist. |
| The bill outgrows the hold          | 0078       | Approved parts routinely took the bill past the card hold, which cannot be captured for more. `payment_holds` records every hold; the confirm screen shows `order_top_up_due()` and holds it in the same tap; the customer's own confirmation is refused without it (ops and auto-close are not — the shortfall goes on the finance page). Captures per hold; voids and refunds split across holds. Suite 50.                                         |
| Lapsed holds                        | 0080       | A card hold lives ~7 days; holds older than `payment_hold_validity_days` (6) stop counting, so a long-booked job asks for the amount again at confirmation (the 0078 top-up), and capture marks lapsed holds `expired` instead of sending them to the gateway.                                                                                                                                                                                        |
| UI/UX passes (3 rounds)             | —          | Every screen screenshotted in Arabic, English and dark; fixes listed below                                                                                                                                                                                                                                                                                                                                                                            |

Real bugs found and fixed along the way, all with tests: orders were never
submitted or funded; accept was an RLS no-op; the technician's position was
never sent; cancelling left the customer's money held; disputes had no way
out; a provider could dispute their own job; operators could mark an order
paid by editing it; the console could not sign anyone in (it read a dropped
column); the customer saw "cancelled" for an order under complaint; any
signed-in user could issue a tax invoice for any order, while nothing issued
one for a finished job; the order history showed every service with an empty
name against the real backend (a many-to-one embed read as an array); a
completed order opened again asked to be rated a second time, and the second
rating failed; an emergency with no car on file was a dead end; the add-car
screen called the plate optional while the database refuses a car with
neither plate nor VIN, so every owner who skipped it could not save the car.
`customer-surfaces.integration.test.ts` now reads the customer's remaining
screens back through `SupabaseRepository`, including the least each form
allows.

---

### UI/UX passes — what changed and what now guards it

Each screen was rendered at phone size (390px) through react-native-web in a
throwaway setup — never committed; the app is not a web target — and walked
as a user would. The fixes that matter beyond one screen:

- **Arabic plurals.** Every counted phrase has Arabic's six CLDR forms
  (`_zero … _other`) and English's two; callers pass a number as `count`.
  `packages/i18n` tests that each plural key has exactly its language's forms.
- **Every `t('…')` key exists.** `apps/mobile/src/features/shared/lib/i18n-keys.test.ts`
  reads every literal key in the app and fails on one missing in either
  language (it found `quote.partsTotal` and `common.close` shipping raw).
- **Direction on the first Arabic launch.** Besides `rowDirectionFor`, there
  is now `alignStartFor` for "at the reading start" in a column; ListRow,
  Button (compact), badges, pills, ChipRow and the logos use them. Both tab
  bars are `shared/components/HabbaTabBar`.
- **Numbers and dates.** Latin digits throughout (§8); phone numbers are
  grouped inside an LTR isolate (`format-phone.ts`); booking days and times
  are Riyadh's (`slot-days.ts`), matching the confirmation.
- **Register.** The dialect test also catches spoken negation and future
  («ما عندك», «ما فيه», «بيظهر», «تسوي شي», «يشتغل»…).

## 7. Open decisions — these block launch, and none is a coding task

| #   | Decision                                                        | Blocks                                                                                                                                                                                                              |
| --- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **ADR-0008 — payments, merchant of record, SAMA**               | Real money. Authorise/capture/void/refund are interfaces over a dev provider; `payment_operations` is the queue a Moyasar worker would drain (today an operator carries them out by hand and records the reference) |
| 2   | **ADR-0009 — ZATCA seller of record**                           | Lawful invoices, and the credit note a refund needs                                                                                                                                                                 |
| 3   | **ADR-0010 — PDPL** (region: Frankfurt)                         | KYC sealing (so provider mode stays off), and counsel's sign-off on erasure-by-anonymisation (0070)                                                                                                                 |
| 4   | **SMS provider** (Unifonic / Taqnyat / Twilio) + CITC sender ID | Phone OTP, so any launch                                                                                                                                                                                            |
| 5   | **Plate letter map** checked against an official source         | ADR-0011; the logbook is keyed on plates                                                                                                                                                                            |
| 6   | **Warranty options**                                            | The technician chooses 30/90/180 days, default 30, no "none" — confirm                                                                                                                                              |

---

## 8. Known incomplete (code)

- **Inspection photos per item** — the form rates and annotates; it does not
  attach a photo to an item yet.
- **Payment provider worker** — waits on decision 1.
- **ZATCA credit notes** — waits on decision 2.
- **Real two-phone run** — every flow is proven by integration tests through
  the app's own repositories, but never by two people on two devices.
- **No E2E (Detox) and few render tests** — screens are covered by typecheck,
  lint, render smoke tests and the data layer beneath them.
- **Server-side PDF** — the report prints to PDF in-app (ADR-0019).

---

## 9. Conventions

- Every migration has a suite. Migration comments explain the failure they
  prevent, not the syntax.
- Money is `numeric(12,2)` in SQL and `SarAmount` in TypeScript; never float.
- Never `select()` on `providers` — always a column list (0037).
- All copy in `packages/i18n`, Modern Standard Arabic. Errors are explained in
  Arabic with a next step; never a raw database message.
- Status changes go through the state machine, never a hand-written status.
- The in-memory repository and the console's demo data mirror the server
  where behaviour depends on it.
- `pnpm verify` twice green, then commit and push the same turn (CLAUDE.md §6).

---

## 10. Anti-goals (spec §11)

No bidding or chat-first flow; providers cannot price emergency services; the
logbook is never paywalled; IDs and IBANs are never plaintext; completion
photos and mileage are never skippable; no web before mobile; no ride-hailing,
fuel subscriptions or car sales in v1.
