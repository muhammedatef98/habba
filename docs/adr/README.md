# Architecture Decision Records

Format and status conventions: [ADR-0001](0001-record-architecture-decisions.md).

**Nothing here is `Accepted` yet.** Every ADR below is `Proposed` — written with a recommendation,
awaiting the product owner's decision. No application code has been written.

## Index

| #                                                           | Decision                                                             | Status   | Gates                                |
| ----------------------------------------------------------- | -------------------------------------------------------------------- | -------- | ------------------------------------ |
| [0001](0001-record-architecture-decisions.md)               | Record architecture decisions                                        | Accepted | —                                    |
| [0002](0002-migration-ordering-and-spec-sql-corrections.md) | Migration ordering; corrections to spec SQL that does not run        | Proposed | Phase 1                              |
| [0003](0003-timeline-append-only-enforcement.md)            | Append-only enforcement via triggers, not rules; single write path   | Proposed | Phase 2                              |
| [0004](0004-timeline-hash-chain.md)                         | Hash-chain payload, canonicalisation, per-vehicle locking            | Proposed | Phase 2                              |
| [0005](0005-timeline-provenance-levels.md)                  | **What "verified" is allowed to mean**                               | Proposed | Phase 2                              |
| [0006](0006-order-state-machine.md)                         | State machine totality, `checked_in`, auto-completion, order numbers | Proposed | Phase 3                              |
| [0007](0007-money-vat-and-rounding.md)                      | Money representation, VAT rate as data, rounding rule                | Proposed | Phase 3                              |
| [0008](0008-payments-escrow-and-merchant-of-record.md)      | Escrow model and merchant of record                                  | Proposed | Phase 3                              |
| [0009](0009-zatca-seller-of-record.md)                      | ZATCA seller of record and invoice types                             | Proposed | Phase 3 (schema), Phase 6 (delivery) |
| [0010](0010-data-residency-and-pdpl.md)                     | Supabase region, PDPL posture, erasure vs immutability               | Proposed | Phase 1                              |
| [0011](0011-saudi-identifier-formats.md)                    | Plates, IBAN, national ID, VAT number                                | Proposed | Phase 1                              |
| [0012](0012-offline-capture-semantics.md)                   | `occurred_at` vs `recorded_at`; what the chain proves                | Proposed | Phase 3                              |
| [0013](0013-provider-order-visibility.md)                   | Masked order discovery via RPC, not RLS row reads                    | Proposed | Phase 3                              |
| [0014](0014-toolchain-and-versions.md)                      | Node, pnpm, Expo SDK, TypeScript strictness, CI                      | Proposed | Phase 1                              |

## Blocking Phase 1

Four decisions must land before the first migration:

1. **[ADR-0010] Supabase region.** Chosen once at project creation; reversing it later means
   migrating live customer data and an immutable timeline.
2. **[ADR-0014] Expo SDK version.** The spec says 52+; 52 is well behind current. Recommendation:
   latest stable.
3. **[ADR-0005] Timeline provenance enum.** The timeline is append-only, so this column must exist
   in the migration that creates the table. It cannot be added meaningfully later.
4. **[ADR-0006] `checked_in` in the `order_status` enum.** Free to include in the initial
   `CREATE TYPE`; awkward to add once environments exist.

Plus the operational prerequisites in the Phase 1 questions: repo remote, Supabase project, and an
SMS provider for Saudi phone OTP (which Phase 1's acceptance criterion depends on).

## Needs outside expertise

Three decisions are outside what can be settled from the spec, and two have long lead times —
starting them now costs nothing and unblocks Phase 3 later:

| Question                                                           | Who                           | ADR                                                                            |
| ------------------------------------------------------------------ | ----------------------------- | ------------------------------------------------------------------------------ |
| Can Habba hold and disburse customer funds? SAMA licensing posture | Saudi payments/fintech lawyer | [0008](0008-payments-escrow-and-merchant-of-record.md)                         |
| Who is the seller of record; VAT treatment of provider settlements | Tax accountant                | [0009](0009-zatca-seller-of-record.md), [0007](0007-money-vat-and-rounding.md) |
| PDPL transfer basis; erasure vs an immutable timeline              | Data-protection lawyer        | [0010](0010-data-residency-and-pdpl.md)                                        |

## The one worth reading first

[ADR-0005](0005-timeline-provenance-levels.md). The spec sells a _"verified Habba Report"_ while
Phase 2 populates the logbook with owner-typed claims. A hash chain proves a row has not changed
since it was written — it proves nothing about whether it was ever true. That gap sits directly on
the moat, and because the timeline is append-only, it cannot be closed retroactively.
