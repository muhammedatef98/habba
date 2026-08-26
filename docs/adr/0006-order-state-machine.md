# ADR-0006 — Order state machine: totality, workshop check-in, auto-completion, order numbers

- **Status:** Proposed — needed before Phase 3
- **Date:** 2026-08-26
- **Relates to:** build prompt §6.5, §9; `CLAUDE.md` §1 (escrow), §2.2

## Context

The spec's state machine covers the on-demand emergency path well and leaves three gaps.

**1. `checked_in` has nowhere to live.** §6.5 says workshop mode _"skips `en_route`/`arrived`; use
`checked_in` semantics via `order_events`."_ But `order_events.to_status` is typed `order_status`,
and that enum has no `checked_in` member. The instruction is not implementable as specified.

**2. Non-emergency paths are undefined.** `searching` and the broadcast/accept cycle describe
on-demand matching. For `workshop` and `mobile_scheduled`, the customer picks a specific provider
and slot — there is no search. The transition out of `draft` for those modes is unspecified.

**3. Auto-completion contradicts the escrow promise.** §1 lists escrow as a core differentiator:
_"captured only after the customer confirms completion."_ §6.5 then says `awaiting_approval →
completed` happens _"automatically after 24h of no response"_ — which captures the customer's money
without the confirmation the feature is sold on.

## Decision

### Extend the enum

```sql
alter type order_status add value 'checked_in' after 'accepted';
```

`checked_in` is a real state with real semantics (the vehicle is physically at the workshop), it
gates the same transitions `arrived` gates for mobile, and the state machine should be total.
Encoding it as an untyped side-channel in `order_events` would mean the trigger cannot validate it.

### Per-mode transition tables

The state machine is a single trigger on `orders` that dispatches on `fulfilment_mode`. Each mode
has its own explicit adjacency list; a transition absent from the table is rejected.

```
mobile_ondemand:  draft → searching → quoted → accepted → en_route → arrived
                        → in_progress → awaiting_approval → completed

mobile_scheduled: draft → quoted → accepted → en_route → arrived
                        → in_progress → awaiting_approval → completed

workshop:         draft → quoted → accepted → checked_in
                        → in_progress → awaiting_approval → completed

all modes:        <any non-terminal> → cancelled     (rules per ADR, below)
                  completed → disputed               (within 72h of completion)
```

Scheduled and workshop orders never enter `searching` — the provider is chosen by the customer, so
the order goes straight to `quoted` (fixed-price services) or `accepted`.

### Guards, enforced in the trigger

| Transition                        | Guard                                                                                    |
| --------------------------------- | ---------------------------------------------------------------------------------------- |
| `quoted → accepted`               | a payment authorisation exists (`payment_intent_id` set, `escrow_status = 'authorised'`) |
| `in_progress → awaiting_approval` | if `parts_amount > 0`, every `order_parts` row has `approved_by_customer = true`         |
| `awaiting_approval → completed`   | actor is the **customer**, or the auto-completion job (below)                            |
| `→ completed`                     | writes a `vehicle_timeline` row **in the same transaction** (see exception below)        |
| `completed → disputed`            | `now() < completed_at + interval '72 hours'`                                             |

### The `completed` → timeline write, and its one exception

`CLAUDE.md` §1 makes this non-negotiable, and it is the mechanism the whole moat rests on. But
`orders.vehicle_id` is nullable by design — a pre-purchase inspection is an order against a car the
customer does not own (§6.5, Phase 5). The rule as written would make those orders impossible to
complete.

Decision: **the timeline write is mandatory whenever `vehicle_id is not null`.** Orders with a null
`vehicle_id` are permitted only when `services.requires_vehicle = false`, enforced by a check at
order creation. Their record lives in `inspection_reports` until the buyer purchases the car, at
which point Phase 5's conversion creates the `vehicles` row with the inspection as its first
timeline event. No history is lost; it is deferred.

### Auto-completion and escrow capture — split the two

The 24h auto-completion exists for a real reason: providers cannot be left unpaid because a
customer stopped responding. But automatic _capture_ is not the same as automatic _completion_.

Recommended resolution:

- After 24h of no customer response, the order auto-transitions to `completed` so the provider's
  work is closed out and the timeline is written.
- **Escrow capture on an auto-completed order is delayed to the end of the 72h dispute window**,
  not fired at completion.
- The customer is notified at 12h and again at 20h, in Arabic, with a one-tap confirm and a one-tap
  dispute.
- Auto-completed orders are flagged (`completed_by_timeout`) and surfaced in the admin dashboard.
  A provider with an unusual rate of them is a fraud signal worth watching.

This keeps the promise in §1 substantially intact: money moves only after the customer confirms, or
after they have had 96 hours and three notifications to object.

### Order numbers

`HB-{YYYY}-{NNNNNN}`, from a per-year Postgres sequence, assigned by trigger on insert.

**Gaps are acceptable and expected** (rolled-back transactions consume sequence values). Gapless
numbering would require serialising all order creation — the wrong trade. If an external
requirement ever demands gapless _invoice_ numbering, that belongs on `zatca_invoices`, which is
lower-volume and issued after the fact (ADR-0009), not on `orders`.

## Consequences

- `alter type ... add value` cannot run inside a transaction block in older Postgres versions; the
  enum must carry `checked_in` from its original `CREATE TYPE` in migration `0002`. Since no
  environment has been provisioned yet, this is free now and awkward later — another reason to
  settle it before Phase 1.
- Three adjacency tables means three sets of transition tests. Worth it: a single permissive table
  would let a workshop order report `en_route`.
- `completed_by_timeout` and `completed_at` are new columns not in the spec.

## ⚠️ Owner decision required

- Confirm the escrow-capture split (auto-complete at 24h, capture at 96h) versus the spec's literal
  reading (capture at 24h). This is a trust-versus-cashflow trade and the provider-side experience
  depends on it.
