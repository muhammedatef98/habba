# ADR-0009 — ZATCA e-invoicing: who is the seller of record

- **Status:** Proposed — ⚠️ requires accountant/tax advice. Shapes Phase 3, delivered in Phase 6.
- **Date:** 2026-08-26
- **Relates to:** build prompt §6.8; ADR-0007, ADR-0008

## Context

The spec's `zatca_invoices` table keys one invoice to one `order_id` and stores XML, a hash, and a
QR. It contains **no seller identity**. That silently assumes Habba is always the seller.

In a marketplace that assumption is the whole question. ZATCA's Phase 2 (Integration) requires each
**seller** to onboard with ZATCA and obtain cryptographic credentials, then clear or report invoices
against those credentials. Two very different architectures follow:

- **If Habba is the seller** (ADR-0008 model A/C): Habba onboards once. Providers invoice Habba
  separately, or Habba self-bills on their behalf.
- **If the provider is the seller** (ADR-0008 model B): **every workshop needs its own ZATCA
  onboarding**, and Habba is issuing invoices as an agent using each provider's credentials. That is
  a multi-tenant credential-management problem, and it is a far larger build.

The spec's note — _"Implement the TLV encoder in an Edge Function"_ — addresses the QR, which is
the easy part. The QR is a TLV-encoded blob carrying seller name, VAT number, timestamp, total with
VAT, and VAT amount. Encoding it is an afternoon. Deciding **whose VAT number goes in it** is the
architectural decision, and it must be made in Phase 3 when payments are built, not in Phase 6 when
invoices are generated.

## Decision (proposed)

**Habba as seller of record, with self-billing for providers** — conditional on ADR-0008 landing on
model A or C, and on tax advice confirming it.

Under this model:

- The customer receives one **Habba → customer** tax invoice for the full amount. Habba's VAT number
  appears in the QR. One ZATCA onboarding, one credential set, one integration.
- Providers are settled through `payouts`, with a **self-billed invoice** (Habba → provider,
  documenting the provider's supply to Habba) generated per payout period. Self-billing requires a
  written agreement with each provider and has specific conditions under Saudi VAT regulations —
  confirm these.
- Providers below the VAT registration threshold are handled differently and need explicit
  treatment. Many individual `technician` providers will be below it.

### Schema changes this forces

```sql
-- zatca_invoices needs seller identity from the start
seller_type        text not null,   -- 'habba' | 'provider'
seller_provider_id uuid references providers(id),   -- null when seller_type = 'habba'
vat_rate_applied   numeric(5,4) not null,           -- snapshot; see ADR-0007
invoice_type       text not null,   -- 'standard' (B2B) | 'simplified' (B2C)
```

B2B (standard) and B2C (simplified) invoices have different ZATCA requirements — simplified
invoices are reported after issuance, standard invoices are cleared before. Most Habba customer
invoices are simplified B2C; provider self-bills are standard B2B. The table must distinguish them.

`invoice_number` must be **gapless per seller per year** — unlike order numbers (ADR-0006), where
gaps are fine. Invoice numbers are issued at completion, at much lower volume, so serialised
allocation is affordable.

## Consequences

- ZATCA onboarding has a lead time and requires a live CR and VAT registration. It should be
  started well before Phase 6, or Phase 6 stalls on paperwork rather than code.
- Phase 3 must already write enough information onto the order (seller identity, VAT rate applied,
  provider VAT status) for Phase 6 to generate a correct invoice retroactively. **Orders completed
  in Phase 3 will need invoices.** Getting this wrong means unbillable historical orders.
- The TLV encoder, invoice XML (UBL 2.1), hashing, and QR generation are mechanical once the seller
  question is answered.

## ⚠️ Owner decision required

1. Confirm Habba-as-seller with provider self-billing, after tax advice.
2. Does Habba hold a CR and VAT registration today? Both are prerequisites for ZATCA onboarding.
3. How are non-VAT-registered individual technicians treated in the settlement flow? This affects a
   large share of the `technician` provider base.
