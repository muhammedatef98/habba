# ADR-0004 — Timeline hash chain: payload, canonicalisation, concurrency

- **Status:** Proposed — ⚠️ affects the moat; approve before Phase 2
- **Date:** 2026-08-26
- **Relates to:** build prompt §6.2, §7.3; Phase 2 acceptance criteria

## Context

The spec defines the chain as:

```
row_hash = sha256(prev_hash || vehicle_id || event_type || occurred_at || details)
```

Three problems with that formula, in increasing order of severity.

### 1. The hash does not cover the evidence

`attachments` and `mileage` are excluded. Those are the two fields a fraudulent seller would most
want to change: swap the before/after photos, or lower the recorded mileage. Under the spec's
formula both can be altered without breaking verification — and `attachments` is the *photographic
evidence* the report's credibility rests on.

### 2. `prev_hash` computation races

`prev_hash` is defined as the hash of the most recent row for that vehicle. Two concurrent inserts
both read the same tip and both write rows claiming the same predecessor. The chain forks.

Because the table is append-only (ADR-0003), **a forked chain can never be repaired.** That vehicle's
report is permanently unverifiable. This is more dangerous than the double-booking race the spec
explicitly demands a test for, and the spec does not mention it.

Realistic trigger: a technician completes a job (writes `service_completed` + `parts_replaced` +
`mileage_recorded`) while the nightly predictive-maintenance cron writes `alert_raised` for the
same vehicle. Not exotic.

### 3. `details` is `jsonb`, and text rendering is not a stable contract

Hashing `details::text` depends on how the running Postgres renders `jsonb`. `jsonb` normalises key
order deterministically *within* a version, but that is an implementation detail, not a documented
guarantee across major versions. A Postgres upgrade could invalidate every historical hash at once.

## Decision

### Hashed payload — explicit, ordered, fully specified

```
row_hash = encode(sha256(convert_to(payload, 'UTF8')), 'hex')

payload = coalesce(prev_hash, 'GENESIS')      || '\x1e' ||
          id::text                            || '\x1e' ||
          vehicle_id::text                    || '\x1e' ||
          event_type::text                    || '\x1e' ||
          to_char(occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') || '\x1e' ||
          coalesce(mileage::text, '')         || '\x1e' ||
          coalesce(order_id::text, '')        || '\x1e' ||
          coalesce(provider_id::text, '')     || '\x1e' ||
          created_by::text                    || '\x1e' ||
          provenance::text                    || '\x1e' ||
          canonical_json(details)             || '\x1e' ||
          canonical_json(attachments)
```

Decisions embedded above:

- **`\x1e` (ASCII record separator) as the field delimiter.** Naive concatenation is ambiguous:
  `('ab','c')` and `('a','bc')` hash identically. A delimiter that cannot appear in the inputs
  removes the ambiguity.
- **`GENESIS` sentinel** rather than `NULL`/empty for the first row, so the head of a chain is
  distinguishable from a row whose predecessor was stripped.
- **`id` is included**, binding the hash to the row's identity — a row cannot be relocated to
  another chain intact.
- **`created_by` and `provenance` are included** (ADR-0003, ADR-0005), so authorship and
  trust level are non-repudiable.
- **Fixed-precision UTC timestamp formatting.** `timestamptz::text` renders using the session
  `TimeZone` and `DateStyle`. Hashing that would make verification depend on the connection's
  settings — the report would verify for a Riyadh client and fail for a UTC cron.
- **`canonical_json()`**: recursive sort of object keys, no insignificant whitespace, explicit
  number formatting. Implemented as a project-owned `IMMUTABLE` SQL function, unit-tested against
  frozen fixtures, and **never changed** — a change to it retroactively invalidates every hash.

### Concurrency — serialise per vehicle

Inside `append_vehicle_timeline_event`, before reading the chain tip:

```sql
perform pg_advisory_xact_lock(hashtextextended(p_vehicle_id::text, 0));
```

Transaction-scoped, so it releases on commit or rollback with no cleanup path. Locks are per
vehicle, so throughput across the fleet is unaffected. Combined with a
`unique (vehicle_id, prev_hash)` constraint as a belt-and-braces backstop: even if the lock were
bypassed, a fork becomes a constraint violation — a loud failure — rather than silent corruption.

**Phase 2 must ship a concurrency test** that fires N simultaneous appends at one vehicle and
asserts the resulting chain is linear. The spec mandates this test for slot booking; it matters
more here.

### Verification

```sql
verify_vehicle_timeline(p_vehicle_id uuid)
  returns table (is_valid boolean, checked_count int, first_invalid_id uuid, reason text)
```

Walks rows in `recorded_at, id` order (insert order — **not** `occurred_at`, which may be
backdated; see ADR-0012), recomputes each `row_hash`, and confirms each `prev_hash` matches its
predecessor. Returns the first break rather than a bare boolean, so support can diagnose.

`generate_habba_report` calls this and **refuses to issue a report on a broken chain**. A report
that silently omits verification is worse than no report.

## Consequences

- Chain order is insert order, which may differ from real-world event order when history is
  backdated or synced from offline (ADR-0012). The verifier proves *"these rows have not been
  altered since they were written"*, not *"these events happened in this order"*. The public report
  page must state exactly that. Overclaiming here is the fastest way to lose the trust the moat
  depends on.
- `canonical_json()` becomes frozen infrastructure. It needs a comment saying so, and a test that
  fails loudly if its output for a fixed input ever changes.
- Hashing is CPU work inside the write transaction. Negligible at expected volumes; noted so it
  isn't rediscovered as a mystery later.

## Open items

- **Should the chain be externally anchored?** The current design proves internal consistency, but
  a party with database write access *and* the ability to recompute all subsequent hashes could
  rewrite history wholesale. Periodically publishing chain heads somewhere Habba does not control
  (or signing them with a key held outside the database) closes that gap. Not needed for Phase 2 —
  but if تقرير هبّة is ever marketed as *tamper-proof* rather than *tamper-evident*, it becomes
  necessary. Recommend deferring, with the language on the public page kept honest until then.
