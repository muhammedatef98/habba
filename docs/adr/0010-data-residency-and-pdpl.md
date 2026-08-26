# ADR-0010 — Data residency, Supabase region, and PDPL posture

- **Status:** Proposed — ⚠️ requires legal advice. **Blocks Phase 1** (region is chosen at project creation).
- **Date:** 2026-08-26
- **Relates to:** `CLAUDE.md` §3; build prompt §6.4, §11

## Context

This decision is made **once, at Supabase project creation, in Phase 1**, and is expensive to
reverse — a region change means a full data migration with downtime, after real customer vehicles
and an immutable timeline exist.

Three pressures:

1. **Saudi PDPL.** Personal data of Saudi residents is regulated, and cross-border transfer is
   permitted only on specified bases. Habba processes phone numbers, national IDs, Iqama numbers,
   IBANs, precise location traces, and vehicle identifiers — close to the highest-sensitivity end of
   consumer data short of health records.
2. **Latency.** Provider location updates, the matching function, and the live-tracking screen (the
   spec's _"emotional core"_) are all latency-sensitive from Saudi devices.
3. **Region availability.** Supabase does not currently offer a Saudi region. Every option is a
   cross-border transfer, which makes the PDPL basis a requirement rather than a nicety.

## Options

| Region                                    | Approx. RTT from Riyadh | Notes                                                                                         |
| ----------------------------------------- | ----------------------- | --------------------------------------------------------------------------------------------- |
| `eu-central-1` (Frankfurt)                | ~90–110 ms              | Mature, strong DP framework, common choice for MENA products                                  |
| `ap-south-1` (Mumbai)                     | ~40–60 ms               | Best latency of the available options; Indian data-protection regime is a separate assessment |
| `eu-west-*` / US                          | 120 ms+                 | No advantage                                                                                  |
| Self-hosted on a KSA/Bahrain cloud region | Best                    | Strongest residency story; abandons managed Supabase and a large amount of Phase 1 velocity   |

**Latency figures above are estimates and must be measured**, not trusted — a quick test from a
Saudi network before committing costs nothing.

## Recommendation

**Start on `eu-central-1` for the pilot**, with:

- A documented PDPL transfer basis, reviewed by counsel.
- National IDs, Iqama numbers, and IBANs encrypted at rest with Supabase Vault / pgsodium
  (already mandated by §11), so the highest-sensitivity fields are protected independently of region.
- A written exit plan: what a migration to a KSA region would involve, sized before it is needed.

Rationale: Frankfurt's ~100 ms is acceptable for everything except the tightest location updates,
and those can be tuned (batching, client-side interpolation on the tracking map) more cheaply than
a residency problem can be unwound. Mumbai's latency advantage is real but buys a second
jurisdictional analysis rather than avoiding one.

If counsel advises that KSA residency is mandatory for this data class, that finding **must** land
before Phase 1 provisioning — it changes the entire infrastructure plan, not a config value.

## Consequences

- Supabase Storage (photos, PDFs, تقرير هبّة) inherits the region. Vehicle photos and inspection
  images are personal data by association.
- Edge Functions run at the edge but read the primary database; cron jobs are unaffected by latency.
- Push notifications route through Expo → FCM/APNs, i.e. through US infrastructure regardless of
  database region. Notification **content** must therefore avoid personal data: no addresses, no
  full names, no plate numbers in a push body. This is a concrete engineering constraint from
  Phase 1 onward, not a policy footnote.

## Related: the PDPL erasure problem

`CLAUDE.md` §1 requires the timeline to be permanent and immutable; ADR-0003 enforces it with
triggers that even `service_role` cannot bypass. A PDPL erasure request runs straight into this.

Proposed reconciliation — to be confirmed by counsel:

- The timeline records **the vehicle's** history, not the person's. Vehicle service history is
  arguably not the requester's personal data once owner identifiers are severed.
- On erasure, Habba deletes/anonymises the `profiles` row and any personal data inside timeline
  `details` (addresses, names), while the service facts survive attached to the vehicle.
- `vehicle_timeline.created_by` is replaced with a tombstone profile rather than nulled, keeping the
  FK and the hash chain intact — **the hash covers `created_by` (ADR-0004), so this must be designed
  as part of the anonymisation model rather than discovered later.** If a real erasure ever requires
  rewriting hashed fields, the chain breaks and the report becomes unverifiable for that vehicle.
  This tension is unresolved and needs a decision before Phase 2 ships to real users.

## ⚠️ Owner decision required

1. Region: `eu-central-1`, `ap-south-1`, or is KSA residency mandatory?
2. Is there a PDPL assessment or a data-protection lawyer engaged?
3. How is erasure reconciled with an immutable timeline? This is the hardest unresolved question in
   the design, and it becomes urgent the moment Phase 2 has real users.
