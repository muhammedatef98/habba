# Habba — Roadmap

Where the build is, phase by phase, with each phase's acceptance criteria and
what is actually true today.

The phase definitions come from `docs/HABBA_BUILD_PROMPT.md` §10; this file is
the status view over them. Where the two disagree, the build prompt is the
specification and this is the mistake.

**Last updated:** 2026-09-15 · **Amendments applied:** A (one mobile app,
`user_roles`) and B (admin stays a separate web app) — see CLAUDE.md §5.1.

| Phase                         | Status                        |
| ----------------------------- | ----------------------------- |
| 1 — Foundation                | ✅ **Done**                   |
| 2 — The logbook (the moat)    | ✅ **Done**                   |
| 3 — On-demand emergency       | 🟡 Backend done, not launched |
| 4 — Scheduled & workshop      | 🟡 Backend done, no screens   |
| 5 — Inspections               | 🟡 Backend done, no screens   |
| 6 — Intelligence & compliance | 🟡 Backend partial, no admin  |

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

**And on the provider surface specifically**, from an audit on 2026-09-15.
"Provider screens exist" was true and hid how much of the shift does not work:

- ~~`currentPosition()` threw unconditionally, so no position ever reached
  `update_provider_location` and `match_providers` could not see an online
  technician at all.~~ **Fixed** — it resolves through `shared/lib/location.ts`,
  and the screen now distinguishes a denied permission from a lost fix.
- ~~Evidence photos were fabricated `habba://captured/...` references that
  satisfied every check and pointed at nothing.~~ **Fixed** — `expo-camera`
  capture and a real upload to the `completion-media` bucket (0064); a failed
  upload leaves the gap open instead of going green.
- ~~No push notifications anywhere in the repo. A technician learns about a job
  only by polling every ten seconds with the app in the foreground.~~ **Built**
  — 0065/0066, the `push-tick` Edge Function, and `expo-notifications` on the
  device. A trigger enqueues into `notification_outbox` in the same transaction
  as the event; the function is pure transport. A job offer carries no address
  (ADR-0013 applies to a lock screen too) and expires with the offer.
- ~~No earnings surface. `commission_rates`, `payouts` and `payout_orders`
  (0031) have RLS and no screen, and `listMyJobs` filters to live statuses — so
  there is no completed-work history of any kind.~~ **Built** — 0067 and an
  الأرباح tab. The figure shown and the figure paid come from one function
  (`payable_order_lines`), which `build_payout` was rebuilt to call; suite 39
  asserts they agree to the halala. Commission is displayed rather than netted
  out quietly.
- ~~No quote or parts capture. `orders.quoted_amount` and `order_parts` exist
  and `nextJobStep` handles `quoted`, but nothing in the app creates a quote.~~
  **Parts and labour built** — 0068 and a عرض السعر screen, so differentiator 6
  is reachable. `parts_amount` is now DERIVED from the lines rather than
  asserted by the provider, which closed a bypass: the customer-approval gate
  in 0032 reads `if new.parts_amount > 0`, and that column is written by the
  same person the gate checks.
  **Still missing: the pre-dispatch quote** (differentiator 3) — a price offered
  from the triage clip before driving out. That one moves `searching → quoted`
  and belongs with the dispatch state machine rather than with parts.
- **The triage clip cannot be watched.** `OpenJobCard` shows a "has video"
  badge with no player, which is the feature's entire point.
- **No rating, verification-status, workshop-schedule or inspection screens.**

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

**What it needs:** the customer booking flow has since been built — `booking/`
is three screens (service, provider, slot), not the "coming soon" placeholder
this file described until 2026-09-15. What is still missing is the other side
of it: a workshop has no screen for its own schedule or capacity, so the slots
customers book against can only be generated by `generate_slots` out of band.

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

**What it needs:** most of the phase. `apps/admin` **does not exist** — no
provider verification queue (which is what grants the provider role), no live
order map, no dispute resolution, no payout runs. The `audit_log` table is
specified (build prompt §6.10) but not migrated. ZATCA delivery is blocked on
open decision 2.

---

### Function grants — a closed class, and how

0001 sets `alter default privileges in schema public grant all on functions to
anon, authenticated, service_role`, so **every function arrives executable by
any signed-in user**. `grant execute … to service_role` beneath a definition
reads like a restriction and is not one, and `revoke … from public` does not
help because the grant is held directly by the named roles.

Eight functions shipped that way and were closed in 0069 — five from 0065's
push work (including `claim_notification_batch`, which returned every user's
notification text and Expo push tokens), plus `broadcast_order`,
`run_maintenance_scan` and `order_parts_total`. `scan_vehicle_maintenance` and
`estimate_current_mileage` were scoped to the caller's own vehicle rather than
revoked.

`supabase/tests/41_function_surface_audit.sql` now makes this a build step: any
definer function taking an identifier, reachable by a signed-in user, must be
on an explicit list. It found `broadcast_order`, which hand-probing had missed —
a made-up order id returns `no_data_found`, which reads like a refusal.

The moat held throughout: `append_vehicle_timeline_event`, `record_past_service`,
`record_mileage`, `generate_habba_report` and `initiate_ownership_transfer` all
refuse a vehicle that is not yours.

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
   finished code that cannot reach a user without them.
2. **The booking screen** (Phase 4). The backend, including the concurrency
   guarantee, is already there.
3. **`apps/admin`** (Amendment B). Everything provider-side is gated behind an
   approval nobody can currently give.
4. **Decision 1**, then the Phase 3 two-device run.
