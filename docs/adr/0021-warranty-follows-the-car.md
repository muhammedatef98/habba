# ADR-0021 — A warranty follows the car, not the payer

**Status:** accepted
**Date:** 2026-09-10
**Supersedes in part:** the authorisation rule in ADR-0006's `claim_warranty` (0025)

## Context

`claim_warranty` (0025) authorises on `orders.customer_id`:

```sql
if v_parent.customer_id <> v_actor then
  raise exception 'Only the customer on the order may claim its warranty';
```

That is the person who **paid** for the job. It is not the owner of the car,
and after an ownership transfer (0011, completed in 0054) the two are different
people.

At the same time, `generate_habba_report` (0014, extended in 0046) reads
`orders` as `SECURITY DEFINER` and prints every live warranty on the car —
`status: 'active'`, `days_remaining` — with no reference to who paid. So after
a handover:

- the **buyer** reads «ساري» on تقرير هبّة for cover they cannot claim;
- the **seller** keeps the right to claim a free re-service on a car they no
  longer own, at an address they no longer live at;
- and neither of them can see the mismatch, because `active_warranties`
  inherits the `orders` RLS that hides the row from the buyer entirely.

§1 puts the report's trustworthiness at the centre of the product. A report
that overstates cover is not a smaller version of a good report — it is the one
failure that makes every other line on the page suspect, and it fails in front
of the buyer, at the counter, holding the document as proof.

Habba's warranty is also a promise about **the work**, not about the invoice.
§1.5: "If it fails within the window, re-service is free and auto-routed back
to the same provider." A brake job that fails three weeks later has failed on
the same car, at the same pads, regardless of who owns it now.

## Decision

**The right to claim a warranty belongs to the current owner of the vehicle the
work was done on.**

1. `claim_warranty` authorises on `vehicles.owner_id`, not `orders.customer_id`.
   For an order with no vehicle — services where `requires_vehicle` is false —
   there is no car to follow, so authorisation stays with `customer_id`.

2. The claim order is created **in the claimant's name**: `customer_id` and
   `created_by` are the caller, not the original payer. It has to be. The child
   order is dispatched to the claimant's location and read back through
   `orders_read_customer` (0022), so a child owned by the seller would be
   invisible to the buyer who booked it and visible to the seller who did not.

3. The claim order **does not inherit the parent's location**. The parent
   carries `service_address_ar` and `service_location` — the seller's home. A
   claimant who is not the original payer supplies their own; for a workshop
   order there is nothing to supply, because the address is the workshop's.

4. The buyer gets a read surface: `vehicle_warranties(vehicle_id)`,
   `SECURITY DEFINER`, owner-only. It returns the service, the provider's
   business name, the dates and whether a claim is open — and nothing about
   money, the address, or who paid. It exists **instead of** an RLS policy
   letting the new owner read the seller's `orders` rows, which would have
   handed them `total_amount`, `problem_description` and the seller's address.

5. `active_warranties` (0025) is left as it is and re-documented. It is the
   payer's view of their own orders and is still correct as that; it is no
   longer the answer to "what is covered on this car".

### What happens to an in-flight claim

**A transfer is refused while a warranty claim is open on the vehicle.**

An open claim is a real appointment: a free order already routed to the
original provider, possibly with a technician en route. There were three
options and only one is honest:

- *Let it ride with the seller.* The work happens on a car the seller no longer
  owns, at a location the buyer has to be at. Nobody agreed to this.
- *Reassign it to the buyer.* The buyer inherits an appointment they never
  made, at a time they did not pick, described by a problem they did not write.
- *Refuse the transfer until it resolves.* The seller sees exactly why and has
  two remedies they already have screens for: let the re-service finish, or
  cancel it.

The refusal is enforced twice — at `initiate_ownership_transfer` where it is
actionable, and again inside `accept_ownership_transfer`, because a claim can
be opened during the seven days a transfer is pending. The second check runs
**after** the OTP check, so it cannot be used to probe whether a transfer
exists.

### What the seller keeps, and what they lose

Stated plainly because the handover screen states it to the seller in Arabic:

**Kept.** Their `orders` rows, forever: what they paid, the invoice, the ZATCA
record, the provider they used, the ratings they left. Those are financial
history and belong to whoever paid. `orders_read_customer` is untouched.

**Lost.** The car and its logbook — the whole point of the transfer. Access to
`vehicle_timeline` for it, the ability to generate تقرير هبّة for it, and the
right to claim warranty on the work they paid for, from the moment the buyer
accepts.

That last one is a genuine loss and is not softened. A seller who wants the
re-service takes it *before* the handover — which the transfer now refuses to
proceed around, so the choice is put in front of them rather than discovered
afterwards.

## Consequences

- `claim_warranty(uuid, text)` is **dropped and recreated** with a wider
  signature. Adding defaulted parameters would have created an overload and
  made every existing two-argument call ambiguous.
- A vehicle transferred mid-warranty carries its cover to the buyer, which is
  the sentence تقرير هبّة was already printing. The report stops lying by the
  database catching up to it, not by the report saying less.
- A provider can be sent back to a car by someone they have never met. That is
  the correct outcome — §1.5's promise is about the work — but it is a real
  change to what a provider signs up for, and belongs in provider onboarding
  copy before launch.
- Nothing migrates. There are no accepted transfers in any project, so no
  existing warranty changes hands on deploy.
