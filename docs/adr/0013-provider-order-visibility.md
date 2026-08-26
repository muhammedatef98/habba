# ADR-0013 — Provider order discovery: RPC with masked location, not RLS row reads

- **Status:** Proposed — needed before Phase 3
- **Date:** 2026-08-26
- **Relates to:** build prompt §6.9, §7.1, §9.2

## Context

The spec contains a direct, security-relevant contradiction.

**§6.9 (RLS):** *"`orders`: customer reads own; provider reads own assigned **+ open orders in their
city matching their services during `searching`**."*

**§7.1 (matching, anti-patterns):** *"Do not let a provider see the customer's exact address before
accepting — show approximate distance only."*

**§9.2 (provider app):** *"Never show exact address pre-acceptance."*

An RLS `SELECT` policy grants access to **whole rows**. If a provider can read an open order row,
they can read `service_location` (a precise PostGIS point), `service_address_ar`,
`problem_description`, and `triage_media`. Postgres RLS has no column-level filtering; column
privileges are a separate, coarser mechanism that cannot be conditioned on row state.

So the §6.9 policy, implemented literally, breaks §7.1 and §9.2 — and it does so invisibly, because
the *app* would only display distance while the *API* returns the address to anyone who calls it
directly. A stalking or fraud vector, dressed as a UI decision.

Worth naming plainly: this is a real privacy risk. A provider who can query the exact home address
of any customer with an open emergency order — at night, alone, roadside — is a serious problem, and
it is invisible in UI review because the UI looks correct.

## Decision

**Providers get no direct RLS read on unassigned orders at all.**

### RLS on `orders`

```
customer:  USING (customer_id = auth.uid())
provider:  USING (provider_id = <caller's provider id>)     -- assigned orders only
ops:       USING (role in ('ops','super_admin'))
```

No policy grants a provider access to orders they are not assigned to. Default deny.

### Discovery through a `SECURITY DEFINER` RPC

```sql
list_open_orders_for_provider()
  returns table (
    order_id          uuid,
    service_id        uuid,
    service_name_ar   text,
    fulfilment_mode   fulfilment_mode,
    distance_bucket   text,     -- 'أقل من ٢ كم' | '٢–٥ كم' | '٥–١٠ كم' | 'أكثر من ١٠ كم'
    district_name_ar  text,     -- district, never street or building
    problem_summary   text,     -- truncated, PII-stripped
    has_triage_video  boolean,  -- existence only; the media itself is not readable yet
    estimated_payout  numeric(12,2),
    expires_at        timestamptz
  )
```

The function computes distance server-side from the provider's own location and returns a
**bucket**, not a number. Returning exact metres to several providers over time allows
trilateration of the customer's position — the bucket closes that.

`triage_media` URLs are withheld until acceptance. Storage objects for triage media are private,
served through signed URLs issued only to the assigned provider.

### On acceptance

The state transition to `accepted` sets `provider_id`, at which point the standard RLS policy grants
the full row — exact location, address, and triage media — through the normal path. One mechanism,
one moment of disclosure, easy to audit.

### `provider_locations`

The spec's §6.9 policy (*"readable only by the customer of an active order with that provider"*)
omits the provider's own access. Complete set:

- Provider: `INSERT`/`UPDATE` own row only. No read of any other provider's location — competitor
  positions are commercially sensitive and a tracking vector.
- Customer: read the assigned provider's location only while the order is in `en_route`/`arrived`.
  **Not after completion** — the spec's "active order" wording should be read strictly, or a
  customer retains a live feed of a technician's position indefinitely.
- Matching (`match_providers`) reads all locations as `SECURITY DEFINER`, never as the caller.

Location broadcast runs only while the provider is `is_online` (§9.2), and the row is cleared on
going offline rather than left stale.

## Consequences

- `tests/rls.spec.ts` must assert the negative directly: an authenticated provider **cannot**
  `select service_location, service_address_ar` from an unassigned order. A denial test that only
  checks `select *` returns zero rows is not sufficient evidence.
- Distance buckets are a product decision as much as a privacy one — the provider needs enough
  information to accept or decline. Bucket boundaries should be reviewed with real providers.
- The RPC becomes the hot path for the provider app's home screen and needs an index supporting
  `ST_DWithin` over open orders.

## Open items

- Should `problem_description` be provider-visible pre-acceptance at all? It is free text and
  customers will put addresses and phone numbers in it. Recommend truncation plus a PII scrub, or
  withholding it entirely until acceptance.
