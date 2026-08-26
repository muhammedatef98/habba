# ADR-0012 — Offline capture: occurred_at vs recorded_at, and what the chain proves

- **Status:** Proposed — needed before Phase 3
- **Date:** 2026-08-26
- **Relates to:** `CLAUDE.md` §2.2, §2.7; ADR-0003, ADR-0004

## Context

Two principles in `CLAUDE.md` pull against each other:

- **§2.2** — all business logic lives in Postgres; the app is a thin client.
- **§2.7** — _"A technician in a basement parking garage must still be able to complete a job;
  queue and sync."_

Underground parking is where a flat battery or a jump-start actually happens, so this is a core
path, not an edge case. But job completion is exactly the moment that writes to the timeline, and
the timeline's hash chain (ADR-0004) is computed server-side and requires connectivity.

The unstated consequence: **the timeline's chain order is insert order, which for offline work is
not real-world order.** A job completed at 14:00 underground and synced at 16:30 is hashed after
events that happened at 15:00. If the report claims to show a verified chronology, it is
overclaiming.

## Decision

### Two timestamps, distinct meanings

| Column        | Source                   | Meaning                              |
| ------------- | ------------------------ | ------------------------------------ |
| `occurred_at` | client-asserted          | when the event happened in the world |
| `recorded_at` | server `now()`, non-null | when the row was durably written     |

- **The chain is ordered by `recorded_at, id`** — insert order. `verify_vehicle_timeline` walks that
  order (ADR-0004).
- **The timeline UI and the report display by `occurred_at`** — the order a human cares about.
- Both are in the hashed payload, so neither can be altered after the fact.
- Where they differ materially, the UI shows it: _"سُجّل لاحقًا"_ with the sync time. Visible, not hidden.

### Bounding client-asserted time

`occurred_at` is client-supplied and therefore untrusted:

- Rejected if in the future beyond a small clock-skew allowance (5 minutes).
- Rejected if it precedes the order's `created_at`.
- For owner-entered historical service (Phase 2), backdating is the entire point and is permitted
  freely — but those rows are `self_reported` (ADR-0005), and the distinction is already visible.
- For provider completions, `occurred_at` is clamped to the window between order acceptance and
  sync. A provider cannot backdate a job to before they were assigned it.

### Idempotent sync

Offline mutations queue on-device with a client-generated UUID. That id is carried to the server and
enforced unique per order, so a retried sync (poor connectivity retries are the norm, not the
exception) cannot append the same completion twice. A duplicate timeline entry on a customer's
logbook is a visible, trust-damaging bug.

### What is allowed to happen offline

Not everything can be queued. The split:

| Offline-capable                             | Requires connectivity                     |
| ------------------------------------------- | ----------------------------------------- |
| Capture: photos, mileage, parts used, notes | Payment authorisation and capture         |
| Marking work steps done locally             | Customer approval of a quote              |
| Drafting the quote                          | Timeline write and hash computation       |
| Viewing the assigned job                    | State transitions (validated server-side) |

The provider app therefore has a **local job state** that syncs into the server state machine. It
does not decide transitions — it records intent, and the server validates on sync. This preserves
§2.2 while honouring §2.7.

Conflict case: a customer cancels while the provider is offline completing the job. The server
rejects the sync and the app must present this in Arabic, plainly, with a next action
(`CLAUDE.md` §12) — and ops needs a path to compensate the provider for work genuinely performed.
That is a product decision, not just an error state.

### Honest language on the public report

The verification statement must say what is true: **these records have not been altered since they
were recorded, and here is when each was recorded.** Not: _"this history is chronologically
proven."_ See ADR-0005 — the same discipline applies to both provenance and ordering.

## Consequences

- `recorded_at` is a new non-null column not present in the spec's `vehicle_timeline`.
- The provider app needs a durable local queue from Phase 3 — bolting this on later means
  reworking every mutation path.
- The completion flow's mandatory fields (mileage, before/after photos, parts — §9.2) must all be
  capturable offline, including photo storage, with upload deferred. Photos are the largest payload
  and the most likely to fail; they need retry with backoff and visible progress.

## Open items

- Maximum offline queue age before a job is escalated to ops as stuck.
- Whether photos upload opportunistically on any connectivity, or only on Wi-Fi (data cost matters
  to providers).
