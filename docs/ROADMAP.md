# Habba — Roadmap

Where the build is, phase by phase, with each phase's acceptance criteria and
what is actually true today.

The phase definitions come from `docs/HABBA_BUILD_PROMPT.md` §10; this file is
the status view over them. Where the two disagree, the build prompt is the
specification and this is the mistake.

**Last updated:** 2026-09-21 · **Amendments applied:** A (one mobile app,
`user_roles`) and B (admin stays a separate web app) — see CLAUDE.md §5.1.

| Phase                         | Status                               |
| ----------------------------- | ------------------------------------ |
| 1 — Foundation                | ✅ **Done**                          |
| 2 — The logbook (the moat)    | ✅ **Done**                          |
| 3 — On-demand emergency       | 🟡 Built, not launched               |
| 4 — Scheduled & workshop      | 🟡 Built, not launched               |
| 5 — Inspections               | 🟡 Built, not launched               |
| 6 — Intelligence & compliance | 🟡 Backend partial, admin is partial |

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

**What it needs:** a payment provider (open decision 1) — `authorise_order_payment`
and `capture_order_payment` are interfaces with a dev implementation behind
them, so nothing has moved real money; real Nafath for KYC; the ops console
that approves providers (Phase 6); and the two-device run itself, which has
never been done.

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

**Where the screens stand.** The booking flow is three steps — what and for
which car, which provider, which window — and `book_appointment` is called
from the third. A service that supports one fulfilment mode has it selected
rather than offered, because a step whose only content is a disabled option is
not a step.

**What it needs:** the same two things Phase 3 needs — a payment provider
(open decision 1) and the two-device run, which has never been done.

---

## Phase 5 — Inspections 🟡

Templates, structured capture with photos, scoring, PDF, public share,
pre-purchase flow with no owned vehicle, buyer → owner conversion.

**Acceptance:** a pre-purchase inspection produces a shareable report; if the
buyer purchases, the report converts into a new `vehicles` row with the
inspection as its first timeline event.

**Where it stands.** Migrations 0026–0027, covered by `09_inspections.sql`
and by `inspection.integration.test.ts`, which executes the acceptance above
over real HTTP as three identities: the buyer, the inspector, and an anonymous
reader holding nothing but the link.

**The screens exist.** The inspector fills `pre_purchase_v1` — forty-three
items across eleven collapsed sections — with a provisional score that moves
as they answer and the missing required items named before the button is
reachable. The buyer reads findings first and the score second, in the order
`renderInspectionReport` puts them on the public page, and ends on
«هذه سيارتي الآن», which is `convert_inspection_to_vehicle` and the whole
zero-CAC loop.

Two client mirrors of server logic, each checked against the database rather
than trusted, in the manner of `orders/job-flow.ts`:

- `scoreInspection` / `recommendationFor` / `missingRequiredItems` duplicate
  `score_inspection`, `score_to_recommendation` and the completeness check.
  The parity test scores the filed report both ways and asserts one number.
- `dev-inspection-template.ts` copies the seeded template so the form can be
  built without a database. The parity test compares them item for item — and
  caught a real difference the first time it ran.

**What it needs:** draft persistence on the capture form. Forty-three items is
a long time to hold in volatile state, and a backgrounded app today loses
them. Photographs per item are captured by the schema (`results[].photos`) and
not yet by the screen, for the same reason evidence capture stubs the camera.

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

**`apps/admin` exists**, and covers the screen that unblocks everything else:
the provider verification queue, which is what grants the provider role.
`set_provider_verification` (0052) writes the status and the reason in one
transaction and refuses a rejection with no reason; the form asks for it
before submitting. The live order board (0053) is there too.

**What it needs:** dispute resolution, payout runs, pricing tuning, 2FA and
8-hour sessions, `apps/admin/README.md`, and the CI check that fails on a
client-reachable service-role key. The `audit_log` table is specified (build
prompt §6.10) but still not migrated, so admin actions are not yet auditable —
which Amendment B requires before any of this is operated for real. ZATCA
delivery is blocked on open decision 2.

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
| **No ops console** (Amendment B, Phase 6)   | Provider approval has no home but the local harness shim, so nobody can be approved in production.                             |

---

## What would come next

In the order that buys the most, given the above:

1. **Decisions 3 and 4** — a hosted project and an SMS provider. Phase 2 is
   finished code that cannot reach a user without them, and every phase below
   is waiting behind the same two.
2. **`audit_log`** (build prompt §6.10). `apps/admin` now performs the action
   that grants a role, and does so unaudited. Amendment B says every admin
   action writes an immutable row; today none does.
3. **Decision 1**, then the Phase 3 two-device run. Nothing has moved real
   money, and no order has been run end to end on two devices.
4. **Component and E2E coverage.** Every screen is covered by typecheck, lint
   and the data layer beneath it, and by nothing that renders it. The
   inspection capture form — forty-three items, a live score, a submit that
   must agree with a Postgres function — is the strongest argument yet for
   changing that.
