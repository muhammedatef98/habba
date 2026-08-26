# ADR-0001 — Record architecture decisions

- **Status:** Accepted
- **Date:** 2026-08-26

## Context

Habba's spec (`docs/HABBA_BUILD_PROMPT.md`) is issued one phase at a time. Several decisions
made in Phase 1 or 2 are effectively irreversible — most importantly anything touching
`vehicle_timeline`, which is append-only and therefore cannot be corrected by a later migration
without destroying the moat's credibility.

Decisions taken in a chat window are lost. Decisions taken in a file survive.

## Decision

Record every non-obvious, hard-to-reverse decision as a numbered ADR in `docs/adr/`.

Format is MADR-lite: **Status, Date, Context, Decision, Consequences, Open items.**

Statuses:

| Status                   | Meaning                                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------------- |
| `Proposed`               | Written by Claude with a recommendation. **Not yet approved by the product owner.** Do not build on it. |
| `Accepted`               | Approved. Binding on all subsequent code.                                                               |
| `Superseded by ADR-NNNN` | Replaced. Never delete an ADR; supersede it.                                                            |

Anything marked **`Proposed`** and flagged `⚠️ NEEDS OWNER DECISION` blocks the phase that depends
on it. Those are listed in `docs/adr/README.md`.

## Consequences

- Numbering is forward-only and gapless. Never renumber.
- An ADR that contradicts `CLAUDE.md` must say so explicitly and explain why the spec is wrong.
  Several already do — the spec contains SQL that will not run (see ADR-0002).
- Legal and financial ADRs (payments, ZATCA, data residency) are written as **options with a
  recommendation**, not as decisions. Claude is not qualified to settle them; they need a lawyer
  and an accountant.
