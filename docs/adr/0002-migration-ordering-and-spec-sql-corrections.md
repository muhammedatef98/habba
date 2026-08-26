# ADR-0002 — Migration ordering and corrections to the spec's SQL

- **Status:** Proposed — ⚠️ low-risk, mechanical; approve to unblock Phase 1
- **Date:** 2026-08-26
- **Relates to:** `CLAUDE.md` §2.5, build prompt §6

## Context

The build prompt presents the schema in a readable narrative order, not a valid execution order.
Applied as written, the migrations fail. Three separate problems:

1. **Non-immutable function in a CHECK constraint.**

   ```sql
   year int not null check (year between 1970 and extract(year from now())::int + 2)
   ```

   Postgres rejects this: `CHECK` constraints must be `IMMUTABLE`, and `now()` is `STABLE`.
   `CREATE TABLE vehicles` errors out. This is not a style issue — Phase 1 cannot run.

2. **Forward foreign-key references.** The spec's section order references tables before they
   exist:

   | In section | References | Defined in |
   |---|---|---|
   | `profiles.city_id` (§6.1) | `cities` | §6.1, *after* `profiles` |
   | `vehicle_timeline.order_id` (§6.2) | `orders` | §6.5 |
   | `vehicle_timeline.provider_id` (§6.2) | `providers` | §6.4 |
   | `orders.slot_id` (§6.5) | `appointment_slots` | §6.6 |

3. **Migrations are declared forward-only** (§4), so a bad early migration cannot be edited later
   once it has been applied to any shared environment.

## Decision

### Canonical creation order

Migrations are numbered `NNNN_description.sql` and created in dependency order, not spec order:

```
0001  extensions            postgis, pgcrypto, pg_stat_statements
0002  enums                 all CREATE TYPE, in one migration
0003  cities
0004  profiles              (city_id FK now valid)
0005  vehicle_makes, vehicle_models
0006  vehicles
0007  services
0008  providers, provider_services, provider_locations
0009  workshops
0010  appointment_slots
0011  orders, order_events, order_parts     (slot_id FK now valid)
0012  vehicle_timeline                       (order_id + provider_id FKs now valid)
0013  ownership_transfers
0014  inspection_templates, inspection_reports
0015  ratings, payouts, zatca_invoices
0016+ RLS policies, functions, triggers
```

`vehicle_timeline` moves from §6.2's position to after `orders` and `providers`. Nothing
references the timeline, so this is safe. **The timeline is still conceptually the centre of the
schema** — creation order is a mechanical constraint, not a statement about importance.

### `vehicles.year`

Replace the CHECK with an immutable lower bound plus a trigger for the upper bound:

```sql
year int not null check (year >= 1970)
-- BEFORE INSERT OR UPDATE trigger raises if year > extract(year from now())::int + 2
```

Rationale: the upper bound is genuinely time-dependent (a 2027 model year becomes valid in 2026),
so it belongs in a trigger. A hardcoded constant would silently start rejecting valid cars.

### RLS is a separate migration

Tables are created without policies, then `0016+` enables RLS and adds policies. **A table with
RLS enabled and zero policies denies everything** — which is the correct fail-closed default
(`CLAUDE.md` §2.3). The RLS test (`tests/rls.spec.ts`) must therefore assert *both* that strangers
are denied *and* that owners are allowed, or a table with no policies would pass a
denial-only test trivially.

## Consequences

- Migration numbering diverges from spec section numbering. `docs/adr/` and migration comments
  cross-reference the spec section each migration implements.
- Any future table added mid-chain gets the next free number and an `ALTER`, never an insertion
  into the existing sequence.
- One migration per logical group keeps `supabase db reset` fast and failures legible.

## Open items

- Confirm Postgres major version. The spec says 15; Supabase's current default is newer. Some
  choices below (notably `jsonb` text rendering in ADR-0004) are version-sensitive.
