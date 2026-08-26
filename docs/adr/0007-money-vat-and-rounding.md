# ADR-0007 — Money representation, VAT computation, and rounding

- **Status:** Proposed — needs accountant confirmation before Phase 3
- **Date:** 2026-08-26
- **Relates to:** `CLAUDE.md` §2.5, §5; build prompt §6.5, §6.8

## Context

`CLAUDE.md` §2.5 says money is `numeric(12,2)`, never float, _"All amounts in SAR (halalas stored
as decimals, not integers, for ZATCA compatibility)."_

The representation is settled. What is not settled — and what actually causes invoice rejections —
is **where rounding happens**. `numeric(12,2)` cannot hold an unrounded intermediate, so every
arithmetic step forces a rounding decision. Compute VAT per line and sum, or sum then compute VAT
once, and the two disagree by a halala or two on realistic baskets. ZATCA validates that line-level
tax totals reconcile with document-level totals; a mismatch is a rejected invoice.

The spec says "VAT: 15%" and stops there.

## Decision

### Representation

- All monetary columns: `numeric(12,2)`. No floats, no integer-halalas. Confirmed as specified.
- `numeric(12,2)` caps at 9,999,999,999.99 SAR — far beyond any plausible order. Fine.
- TypeScript **must not** carry these as `number`. The Supabase client returns `numeric` as a
  string; `packages/core` keeps it as a branded `SarAmount` string type and does arithmetic through
  a decimal helper. Any place a monetary value becomes a JS `number` is a bug, and the lint rule
  should say so.
- **All money arithmetic happens in Postgres** (`CLAUDE.md` §2.2). The client displays; it does not
  compute totals.

### VAT rate as data, not a constant

```sql
create table vat_rates (
  rate        numeric(5,4) not null,   -- 0.1500
  valid_from  date not null,
  valid_to    date
);
```

Saudi VAT moved 5% → 15% in July 2020. Hardcoding 15% guarantees a painful migration if it changes
again, and — more immediately — historical invoices must reproduce the rate in force on their issue
date, not today's rate. The rate applied is snapshotted onto the order at quote time.

### Rounding rule

- **Round half away from zero (`ROUND_HALF_UP`) to 2 decimal places.** This is Postgres `numeric`'s
  native `round()` behaviour, and it matches standard commercial practice. Banker's rounding is
  _not_ used.
- **VAT is computed and rounded per line item**, then summed to the document total:

  ```
  line_net   = round(unit_price * quantity, 2)
  line_vat   = round(line_net * rate, 2)
  line_gross = line_net + line_vat

  vat_amount   = sum(line_vat)          -- sum of already-rounded values
  total_amount = sum(line_gross)
  ```

- **A database-level assertion enforces reconciliation:** `total_amount = parts_amount +
labour_amount + vat_amount` must hold exactly, as a check constraint. If rounding ever makes it
  fail, the write fails loudly rather than producing an invoice ZATCA will reject.

Line-level rounding is chosen because the e-invoice itemises lines, and the printed line values
must add up to the printed total for a human and a validator alike.

### Prices are VAT-inclusive to the customer

Saudi consumer-facing prices are displayed inclusive of VAT. The customer sees one number; the
invoice decomposes it. Therefore `services.base_price` is stored **VAT-exclusive** and the
inclusive figure is derived for display — storing the inclusive figure would make the decomposition
lossy when the rate changes.

## Consequences

- `packages/core` needs a decimal library (`decimal.js` or equivalent) and a `SarAmount` type from
  day one. Retrofitting after floats have leaked into the codebase is a grep-and-pray exercise.
- Display formatting (Arabic locale, `ر.س` placement, Latin numerals per §8) belongs in
  `packages/i18n`, not scattered in components.
- The `vat_rates` table needs seeding in Phase 1 even though nothing charges VAT until Phase 3, so
  that the historical record starts correct.

## ⚠️ Owner decision required

Confirm with an accountant before Phase 3:

1. **Line-level vs document-level VAT rounding.** Both are defensible; ZATCA requires internal
   consistency. Getting this wrong surfaces as rejected invoices in Phase 6, long after the
   arithmetic was written.
2. **What is the taxable supply?** If Habba is merchant of record (ADR-0008), is the customer buying
   a service from Habba, or from the provider with Habba charging a separate commission? These are
   different invoices with different VAT treatment, and the answer changes the schema — not just
   the paperwork.
3. Whether providers below the VAT registration threshold change the treatment of their orders.
