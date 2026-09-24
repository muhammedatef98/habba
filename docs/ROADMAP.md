# Habba — Roadmap

Where the build is, phase by phase, with each phase's acceptance criteria and
what is actually true today.

The phase definitions come from `docs/HABBA_BUILD_PROMPT.md` §10; this file is
the status view over them. Where the two disagree, the build prompt is the
specification and this is the mistake.

**Last updated:** 2026-09-24 · **Amendments applied:** A (one mobile app,
`user_roles`) and B (admin stays a separate web app) — see CLAUDE.md §5.1.

| Phase                         | Status                                                 |
| ----------------------------- | ------------------------------------------------------ |
| 1 — Foundation                | ✅ **Done**                                            |
| 2 — The logbook (the moat)    | ✅ **Done**                                            |
| 3 — On-demand emergency       | ✅ Built end to end; launch waits on decisions 1 and 4 |
| 4 — Scheduled & workshop      | ✅ Built end to end                                    |
| 5 — Inspections               | 🟡 Backend done, no screens                            |
| 6 — Intelligence & compliance | 🟡 Console done; ZATCA waits on decision 2             |

"Backend done" means the migrations exist, run, and pass their own SQL suites.
It does **not** mean the phase is shippable — see each phase below, and §Open
decisions, which is where most of the remaining risk lives.

---

## Phase 1 — Foundation ✅

Monorepo, Supabase migrations for §6.1–6.2, phone OTP, RTL shell, design-system
primitives, i18n, RLS on every table, CI.

**Acceptance:** a user signs up with a Saudi phone number, adds a vehicle, sees
an empty logbook. RLS test passes. The app runs RTL in Arabic and LTR in
English. _(Amendment A adds: they hold exactly one role, `customer`, and the
mode switcher is not rendered.)_

**Met.** Migrations 0001–0014 plus 0040–0041 for roles; `tests/rls.spec.ts`
(17 assertions over real HTTP with a real JWT) and `supabase/tests/04_rls.sql`;
`packages/ui` ships Button, Field, Card, Screen, Text, ListRow, EmptyState,
BottomSheet, ProvenanceBadge, all in light and dark, RTL and LTR; the app
bundles for iOS. Amendment A's boundary rule (`features/customer/**` and
`features/provider/**` cannot import each other) is an ESLint error and fails
CI.

**Not covered:** real SMS credentials (the transport is built — see open decision 4), and there are
no component or E2E tests: screens are covered by typecheck, lint, and the data
layer beneath them.

---

## Phase 2 — The logbook ✅

Timeline with hash chain, `security definer` write path, `verify_vehicle_timeline`,
manual entry, mileage tracking, تقرير هبّة as a PDF-able page with a public
link.

**Acceptance:** an owner records three past services manually, generates a
report, opens the public link in a browser, and the hash chain verifies. _Ship
this to real users before building orders — it has standalone value and
validates the moat._

**Met.** Append-only enforced three ways (ADR-0003); the chain is ordered by
`seq`, not `recorded_at` (ADR-0004), and holds under 24 concurrent appends;
`supabase/tests/03_tamper.sql` proves a rewritten row fails verification.
Manual entry captures type, date, mileage, cost (as `SarAmount`), parts with
part numbers, and photos — and attaching evidence moves an entry from
`self_reported` to `self_documented`, derived server-side (ADR-0005). The
logbook groups by the year work happened, with an event detail screen and a
mileage progression. The report renders Arabic RTL with no JavaScript and no
external requests, and carries a verification QR generated in-page (ADR-0017),
round-tripped through a decoder in `qr.test.ts`.

**Blocking an actual launch:** open decisions 3 and 4 — there is no hosted
Supabase project, so the app runs on the in-memory repository, and phone OTP is
a dev stub. Neither is a code gap.

**Deliberately off:** `ENABLE_PROVIDER_MODE` (see `apps/mobile/README.md`). The
launch collects no national ID or IBAN while the KYC vault is a placeholder.

---

## Phase 3 — On-demand emergency 🟡

Service catalogue, provider onboarding + KYC, matching, order state machine,
live tracking, escrow authorise/capture, completion → timeline write, ratings.
_(Amendment A adds: the in-app upgrade, the role granted on approval, and the
mode switcher.)_

**Acceptance:** an end-to-end emergency order on two devices; the completed job
appears in the logbook automatically; payment is captured only after the
customer confirms.

**Where it stands.** Migrations 0016–0023 and 0032; matching, the state machine
(ADR-0006), masked pre-acceptance visibility (ADR-0013) and mandatory
completion evidence all pass their suites. Customer screens exist (emergency,
tracking, quote); provider screens exist (shift, jobs, evidence). The upgrade
flow and role grant are built.

**Since then (0064–0072):** the order is submitted and funded before anyone
is asked (0065); the technician's live position, accept and offers work
through the app; completion photos are real and verified (0064); parts are
approved or declined line by line (0067); every step pushes a notification
with delivery receipts (0066, 0072); an unconfirmed job closes by itself
(0071); complaints and refunds are resolved from the console (0069–0070).
`request-flow.integration.test.ts` drives the whole flow through the app's
own repositories with two identities.

**What it needs:** a payment provider (open decision 1) — authorise, capture,
void and refund are interfaces over a dev provider; real Nafath for KYC; and
a two-device run by people.

---

## Phase 4 — Scheduled & workshop 🟡

Slots with concurrency safety, workshop profiles, booking flow, check-in
semantics, warranty tracking and auto-routing.

**Acceptance:** two clients cannot book the same slot (proved by a concurrent
test). A warranty claim within the window creates a free child order routed
back to the original provider.

**Where it stands.** Migrations 0024–0025. `slot-concurrency-test.sh` runs 16
clients against a capacity-3 slot: exactly 3 succeed, 13 are refused cleanly
rather than by a constraint error. Warranty claim and routing pass
`08_scheduling.sql`.

**Since then:** the booking flow is built (service → provider with its own
price → free slot → confirm), and `booking.integration.test.ts` runs a
workshop booking with a warranty claim through the app.

---

## Phase 5 — Inspections 🟡

Templates, structured capture with photos, scoring, PDF, public share,
pre-purchase flow with no owned vehicle, buyer → owner conversion.

**Acceptance:** a pre-purchase inspection produces a shareable report; if the
buyer purchases, the report converts into a new `vehicles` row with the
inspection as its first timeline event.

**Where it stands.** Migrations 0026–0027, covered by `09_inspections.sql`
including the conversion. No customer or provider screens at all — this phase
is backend-only.

---

## Phase 6 — Intelligence & compliance 🟡

Predictive maintenance cron, alert → booking conversion, ZATCA invoicing,
payouts, the admin dashboard, analytics.

**Acceptance:** a vehicle with history receives a correctly-timed alert; a
completed order produces a ZATCA-valid invoice with a scannable QR.
_(Amendment B adds: admin runs locally and deploys to Vercel on environment
variables alone; every admin action writes `audit_log`; CI fails on a
client-reachable service-role key.)_

**Where it stands.** Migrations 0028–0031: the maintenance scan, alert
conversion, ZATCA TLV/QR and payout building all pass `10_intelligence.sql`.

**Since then:** `apps/admin` exists and meets Amendment B — mandatory 2FA,
8-hour sessions, no remember-me, an immutable `audit_log` (0068), a CI check
that fails if a secret key reaches the client bundle, and a README for local
and Vercel. It reaches every operator task: verification queue, live board,
orders, disputes and refunds, people and suspension, cars and the logbook,
reviews, finance and payouts, the catalogue, broadcasts, settings, PDPL
requests, staff (0069–0070; `apps/admin/README.md` lists it all).

**What it needs:** ZATCA delivery and refund credit notes (open decision 2).

---

## Open decisions

From HANDOFF.md §9. These block real work, and none of them is a coding task.

| #   | Decision                                                                   | Blocks                                                                                                                                                                                                                                                                            |
| --- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **ADR-0008 — payments, merchant of record, SAMA**                          | Anything that moves real money, so all of Phase 3's escrow. The authorise/capture functions are the interface; the PSP behind them is unchosen.                                                                                                                                   |
| 2   | **ADR-0009 — ZATCA seller of record**                                      | Phase 6 invoicing, and with it the legality of billing for completed work. The schema records _which_ seller so invoices stay attributable either way.                                                                                                                            |
| 3   | **ADR-0010 — PDPL transfer basis** (region decided: Frankfurt, 2026-09-05) | Scale, not the pilot. The region is settled, so the project can be created; what remains is the lawful basis for cross-border transfer, a DPA, retention, and erasure against an append-only timeline. Still blocks KYC sealing (ADR-0017), and therefore `ENABLE_PROVIDER_MODE`. |
| 4   | **SMS provider** (Unifonic / Taqnyat / Twilio)                             | Real phone OTP, and therefore any launch at all. CITC sender-ID registration is required and takes calendar time — worth starting before it is on the critical path.                                                                                                              |
| 5   | **Plate letter map verification** against an official MOI/Absher source    | ADR-0011, now load-bearing in five or more places. A wrong mapping silently corrupts stored plates, and the logbook is keyed on them.                                                                                                                                             |
| 6   | **Expo SDK 57 vs Expo Go**                                                 | Nothing structural. SDK 57 is current stable, so an up-to-date Expo Go works; the fallback is a dev build.                                                                                                                                                                        |

Two more that are decisions rather than open questions, recorded here because
they gate visible behaviour:

| Decision                                    | Effect                                                                                                                         |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **KYC sealing is a placeholder** (ADR-0017) | `ENABLE_PROVIDER_MODE` stays off; no real ID or IBAN may be accepted. Lifts when decision 3 lands and Vault/pgsodium is wired. |
| **Erasure is anonymisation** (0070)         | The account keeps its id so invoices and the logbook's hash stay valid; needs counsel's sign-off with decision 3.              |

---

## What would come next

In the order that buys the most, given the above:

1. **Decisions 3 and 4** — a hosted project and an SMS provider. Everything
   built is finished code that cannot reach a user without them.
2. **Decision 1**, then a two-phone run by people, emergency and booking.
3. **Phase 5 screens** — the inspection backend is waiting for them.
4. **Decision 2** — ZATCA delivery and credit notes.
