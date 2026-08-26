# ADR-0008 — Payments: what "escrow" means here, and who is merchant of record

- **Status:** Proposed — ⚠️ **requires legal advice.** Blocks Phase 3.
- **Date:** 2026-08-26
- **Relates to:** `CLAUDE.md` §1 (differentiator 4), §3; build prompt §6.5, §6.8

## Context

§1 lists escrow as a core differentiator: *"Money is authorised at booking, captured only after the
customer confirms completion."* §3 specifies Moyasar, *"Escrow via authorise/capture."*

Two distinct problems are being conflated, and one of them is regulatory.

### 1. Authorise/capture is not escrow

Card pre-authorisation holds funds **on the customer's card**, not in an account Habba controls.
Practical limits that affect the product directly:

- Authorisations expire, typically in ~7 days, and can be reduced or dropped by the issuer sooner.
- Capture amount is usually capped at the authorised amount — which breaks the core flow, since the
  final price after diagnosis and parts approval is routinely **higher** than the booking estimate.
  The spec's own quote-approval flow assumes the number changes.
- **mada** is a domestic debit scheme. Manual-capture support and behaviour on mada should not be
  assumed to match Visa/Mastercard, and Apple Pay adds another variation. This needs verification
  against Moyasar's live capability, not their marketing page.

### 2. Holding third-party funds may require a licence

If Habba collects the customer's money and later disburses it to providers, Habba is arguably
performing a payment service. In Saudi Arabia that activity sits under SAMA supervision. This is
not a detail to discover after launch — it determines the schema, the contracts, and the invoices.

## Options

| | Model | Escrow strength | Regulatory exposure | Notes |
|---|---|---|---|---|
| **A** | **Habba is merchant of record.** Customer pays Habba; Habba pays providers on a payout cycle. | Strong — real funds control | Highest. Habba holds third-party funds. | Simplest engineering; matches `payouts` table as specified |
| **B** | **Provider is merchant of record**, Habba is a technology provider taking a commission. | Weak — Habba cannot withhold | Lowest | Undermines the trust differentiator; every provider needs their own merchant account |
| **C** | **Marketplace/split payouts via the PSP**, funds never resting with Habba. | Medium | Medium — depends on PSP's own licence | Depends entirely on whether Moyasar offers this for KSA marketplaces |
| **D** | **Delayed capture only** (authorise at booking, capture at completion), no funds held. | Medium | Low–medium | Closest to the spec's literal wording; constrained by the authorisation limits above |

## Recommendation

**Pursue C if the PSP supports it; otherwise A, with legal sign-off before Phase 3 payments work.**

Rationale: C delivers the customer-visible trust behaviour without Habba resting funds, which is
the combination the product wants. A is the fallback and is what the spec's `payouts` table already
assumes — but it is the option that most needs a lawyer's blessing.

D is tempting because it is literally what §3 says, but the authorisation-expiry and
capture-ceiling limits collide with the quote-approval flow, which is a Phase 3 core path.

### Immediate action, independent of the choice

A **half-day spike against Moyasar's sandbox** before Phase 3 begins, answering:

1. Is manual capture supported on **mada**, and on Apple Pay via mada?
2. What is the authorisation validity window?
3. Can capture exceed the authorised amount? If not, the flow must re-authorise after quote
   approval — an extra customer interaction that has to be designed, not patched in.
4. Does Moyasar offer split payouts / sub-merchant registration for KSA marketplaces?
5. Refund and partial-refund behaviour on mada.

The answers determine the Phase 3 order flow. Building it before running the spike risks rebuilding it.

## Consequences

- `orders.escrow_status` becomes an enum rather than free `text`, with values that reflect the
  chosen model.
- If re-authorisation after quote approval is required, the state machine (ADR-0006) needs an extra
  guard on `awaiting_approval → completed`, and the customer flow gains a step.
- The choice cascades directly into ADR-0009 (who issues the ZATCA invoice) — these two cannot be
  decided independently.

## ⚠️ Owner decision required

1. Which model — A, B, C, or D?
2. Has a Saudi payments/fintech lawyer reviewed the funds-flow? If not, this should start now; it
   has a longer lead time than any engineering task in Phase 3.
3. Is there an existing Moyasar merchant account and sandbox credentials?
