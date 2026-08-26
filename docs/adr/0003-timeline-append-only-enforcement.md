# ADR-0003 — Timeline append-only enforcement and the single write path

- **Status:** Proposed — ⚠️ affects the moat; approve before Phase 2
- **Date:** 2026-08-26
- **Relates to:** `CLAUDE.md` §1, §2.3, §2.4, §2.6; build prompt §6.2, §6.9

## Context

`CLAUDE.md` §2.4 says: _"The timeline is append-only. Enforce with **triggers and revoked
grants**, not convention."_

The spec's own SQL then does something different, and worse:

```sql
create rule timeline_no_update as on update to vehicle_timeline do instead nothing;
create rule timeline_no_delete as on delete to vehicle_timeline do instead nothing;
```

`DO INSTEAD NOTHING` **silently discards the write and reports success.** A buggy `UPDATE
vehicle_timeline SET ...` returns `UPDATE 0` and no error. Every layer above assumes it worked.
This contradicts §2.4 directly, and it contradicts the project's error-handling stance: failures
must be loud.

There is a second, subtler problem. Rules are rewritten at parse time and interact badly with
`RETURNING`, triggers, and writable CTEs. They are a legacy mechanism the Postgres community
advises against for exactly this use case.

## Decision

Three independent layers. Any one of them failing still leaves the timeline protected.

### 1. Trigger — the real backstop

```sql
create function timeline_immutable() returns trigger language plpgsql as $$
begin
  raise exception
    'vehicle_timeline is append-only (attempted % on row %)', TG_OP, old.id
    using errcode = 'restrict_violation';
end;
$$;

create trigger timeline_no_update_delete
  before update or delete on vehicle_timeline
  for each row execute function timeline_immutable();

alter table vehicle_timeline enable always trigger timeline_no_update_delete;
```

`ENABLE ALWAYS` matters: the default (`ENABLE ORIGIN`) does not fire during replication or logical
replay, which is precisely when an unnoticed mutation would be most damaging.

The trigger fires for **every role including `service_role`**, which is the point — RLS does not
apply to `service_role`, so RLS alone protects nothing against a compromised or careless server key.

### 2. Revoked grants

```sql
revoke insert, update, delete, truncate on vehicle_timeline from anon, authenticated;
```

No client role can write to the table directly, under any policy.

### 3. RLS — read only

RLS is enabled with `SELECT` policies only (owner reads all rows for their vehicles; provider reads
only rows originating from their own orders; anonymous reads nothing). Absent `INSERT`/`UPDATE`/
`DELETE` policies, those verbs are denied by default even if a grant were restored by mistake.

### The single sanctioned write path

All inserts go through one `SECURITY DEFINER` function:

```sql
append_vehicle_timeline_event(
  p_vehicle_id  uuid,
  p_event_type  timeline_event_type,
  p_occurred_at timestamptz,
  p_mileage     int,
  p_order_id    uuid,
  p_provider_id uuid,
  p_summary_ar  text,
  p_summary_en  text,
  p_details     jsonb,
  p_attachments jsonb,
  p_provenance  timeline_provenance   -- see ADR-0005
) returns uuid
```

The function owns: authorisation, hash-chain computation (ADR-0004), provenance stamping
(ADR-0005), and actor attribution. It is the _only_ object with the grant to insert.

`SECURITY DEFINER` functions must set `search_path = ''` and schema-qualify everything, or they are
a privilege-escalation vector. This is mandatory in review.

### Actor attribution — filling a gap in the spec

`CLAUDE.md` §2.6 requires `created_by` on everything. The spec's `vehicle_timeline` has no such
column. For the timeline this is not audit hygiene — **"who asserted this fact" is load-bearing
evidence** in تقرير هبّة. Add:

```sql
created_by uuid not null references profiles(id),   -- the authenticated actor
recorded_at timestamptz not null default now()      -- server insert time; see ADR-0012
```

`created_by` is part of the hashed payload (ADR-0004), so an entry's author cannot be
repudiated or swapped.

## Consequences

- A legitimate correction (wrong mileage typed by a technician) **cannot** be an `UPDATE`. It is a
  new compensating event that references the original. The timeline UI must render corrections
  clearly rather than hiding the mistake — that is a product requirement, not just a data one, and
  it is arguably a trust feature.
- `on delete restrict` on `vehicle_timeline.vehicle_id` (already in the spec) means a vehicle with
  history can never be hard-deleted. Vehicle removal is `is_active = false`. PDPL erasure requests
  therefore need an explicit answer — see ADR-0010.
- The `service_role` key cannot repair the timeline in an incident. That is deliberate. Recovery is
  restore-from-backup, and the runbook must say so.

## Open items

- Does a PDPL erasure request oblige us to delete timeline rows? If yes, the immutability guarantee
  needs a documented, logged, super-admin-only exception path — which weakens the report's claim.
  Legal question, tracked in ADR-0010.
