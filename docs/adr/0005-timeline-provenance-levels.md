# ADR-0005 — Timeline provenance: what "verified" is allowed to mean

- **Status:** Proposed — ⚠️ **highest-priority open decision.** Blocks Phase 2 schema.
- **Date:** 2026-08-26
- **Relates to:** `CLAUDE.md` §1; build prompt §7.3, Phase 2

## Context

This is the sharpest contradiction in the spec, and it sits directly on the moat.

- §1 sells the output as a **"verified Habba Report"** whose value is that a used-car buyer will
  pay more for a documented car.
- Phase 2's headline feature is **the owner manually entering their own past service history**,
  and Phase 2's acceptance criterion is *"the hash chain verifies."*

A hash chain proves **"this row has not changed since it was written."** It proves nothing about
whether the row was ever true. An owner can type *"timing belt replaced at 90,000 km"* about a
belt that was never touched, and the chain will verify perfectly, and the PDF will carry a
verification QR.

If a buyer ever discovers that a green "verified" badge covered a seller's self-typed claim, the
product's central asset is gone — and it goes in a way that is very hard to recover from, because
the damage is to the word *verified*.

The schema as specified has nowhere to record the difference. Because `vehicle_timeline` is
append-only, adding this distinction *after* rows exist means every historical row is
retroactively unclassifiable.

## Decision

Add a **non-null** provenance column to `vehicle_timeline`, present from the very first migration
that creates the table, and included in the hashed payload (ADR-0004):

```sql
create type timeline_provenance as enum (
  'self_reported',    -- owner typed it. no evidence.
  'self_documented',  -- owner typed it and attached an invoice/photo. still unverified by Habba.
  'habba_verified',   -- produced by a completed Habba order. provider identity + photos + mileage.
  'third_party'       -- imported from a dealership, insurer, or government source (future)
);
```

### Rules

1. `append_vehicle_timeline_event` derives provenance from the caller's context — **it is never a
   client-supplied parameter.** An event with an `order_id` from a completed Habba order is
   `habba_verified`; an owner-initiated entry is `self_reported` or `self_documented` depending on
   attachments. A client cannot claim a level it did not earn.
2. **The UI never uses one word for two things.** Distinct labels and distinct visual treatment in
   the timeline, e.g. `موثّق من هبّة` vs `مُدخل من المالك`. No green check on self-reported rows.
3. **تقرير هبّة separates the two sections** and states the count of each on the summary line
   (e.g. *"14 سجل موثّق من هبّة، 3 سجلات مُدخلة من المالك"*). The verification QR attests to the
   chain's integrity, and the public page says precisely that — not "this history is true."
4. The report surfaces a **Habba-verified coverage ratio**. This is the honest version of the
   value proposition, and it is a *better* one: it gives the owner a reason to route future
   service through Habba (raising the ratio raises resale value), which is exactly the recurring
   behaviour the business wants. The moat gets stronger by being honest, not weaker.

## Consequences

- Phase 2's standalone value proposition changes from *"a verified history"* to *"your car's
  complete history, with Habba-verified entries marked"*. Marketing copy must be written against
  the second claim. Weaker headline, survivable product.
- `self_reported` entries still deliver most of Phase 2's real utility — an owner who can find
  their own service history in one place is well served, and the acquisition loop through
  ownership transfer is unaffected.
- Provenance is inside the hash, so a row cannot be silently promoted from `self_reported` to
  `habba_verified` later.
- `third_party` exists in the enum from day one but is unused until an integration exists. Adding
  enum values later is easy; reclassifying immutable rows is not.

## Alternatives considered

- **Ship without the distinction, add it later.** Rejected: append-only means "later" is
  never — historical rows would be permanently ambiguous.
- **Exclude self-reported entries from the report entirely.** Rejected: it discards genuine owner
  knowledge and makes Phase 2 much less useful before any orders exist.
- **Allow self-reported, market it as verified anyway.** Rejected. This is the option that kills
  the company, and it should be named so it stays rejected.

## ⚠️ Owner decision required

1. Approve the four-level enum, or reduce to two (`self_reported` / `habba_verified`)?
2. Confirm that تقرير هبّة visibly separates self-reported from Habba-verified entries. This is a
   product-positioning call, not an engineering one — and it is the one decision here that most
   affects what the product is allowed to claim.
