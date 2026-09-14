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

- _Let it ride with the seller._ The work happens on a car the seller no longer
  owns, at a location the buyer has to be at. Nobody agreed to this.
- _Reassign it to the buyer._ The buyer inherits an appointment they never
  made, at a time they did not pick, described by a problem they did not write.
- _Refuse the transfer until it resolves._ The seller sees exactly why and has
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
re-service takes it _before_ the handover — which the transfer now refuses to
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

---

# Amendment — the handover's own two defects (0056)

**Status:** accepted
**Date:** 2026-09-10
**Amends:** the enforcement mechanics of the transfer this ADR depends on (0054)

The decisions above all assume a handover that only the right person can
complete, and that stops being completable when nobody completes it. 0054 built
that and left two ways it was not true. Both are fixed in 0056.

## Expiry needs a clock

`expire_ownership_transfers()` was written for a sweep that nothing ran.
Initiation called it; that was the whole of it. So a transfer nobody accepted
stayed `status = 'pending'` in the table indefinitely, and because
`ownership_transfers_one_pending_idx` is partial on `status = 'pending'`, the
stale row went on occupying the vehicle's one slot. The screens and the
repositories agreed the transfer had lapsed; the database did not, and the
database is the one that decides.

**Decision: expiry gets three chances and no single one of them is
load-bearing.**

1. **On initiation** — already the case (0054), and now proved against a row
   nothing else has touched.
2. **On acceptance** — new. A lapsed row is _retired_ by the attempt to use it
   rather than filtered out of the read that would have used it. Filtering was
   the only thing standing between a lapsed transfer and a completed handover,
   and a `where` clause is not a guard.
3. **On a schedule** — pg_cron, if the project has it. See below.

`expire_ownership_transfers` is dropped and recreated with a second parameter
(`p_transfer_id`) rather than overloaded: a second one-argument signature would
have made the existing `expire_ownership_transfers(null)` ambiguous, including
the call in `supabase/tests/32` that proves it is not client-facing.

### The cron decision, stated rather than assumed

`pg_cron` is **attempted and announced, never assumed.** 0056 ends in a `DO`
block that tries `create extension if not exists pg_cron`, then schedules two
jobs if — and only if — the extension is actually present:

| job                                    | schedule       | command                            |
| -------------------------------------- | -------------- | ---------------------------------- |
| `habba-expire-ownership-transfers`     | `*/15 * * * *` | `expire_ownership_transfers()`     |
| `habba-purge-transfer-accept-attempts` | `17 3 * * *`   | `purge_transfer_accept_attempts()` |

Every outcome is reported as a `NOTICE` naming the `SQLSTATE` and the message,
and `ownership_transfer_sweep_scheduled()` answers the question afterwards so
nobody has to read a migration log. `supabase/tests/34` asserts the two agree:
a project with `cron.job` must have the sweep scheduled, and one without must
not claim to.

The extension can be absent for reasons no migration can see or fix — it needs
`shared_preload_libraries`, a superuser, and the database named by
`cron.database_name` — and it can be present but unusable by the migration role,
which needs `usage` on the `cron` schema. Hosted Supabase grants that to
`postgres` when pg_cron is enabled from the dashboard; a bare Postgres in CI has
none of it.

**Running without cron is a supported configuration, not a broken one.** Inline
expiry on initiation and acceptance means no lapsed row can be used and no
lapsed row can block a re-issue. What is lost without the sweep is only that a
lapsed row keeps saying `pending` in the table until somebody touches that
vehicle again. That was worth saying out loud, because the failure mode of a
scheduled job is that everybody assumes it runs.

## Six digits needs an attempt limit

0054 took `otp_code_hash` off the client-readable surface, which closed the
**offline** search: a recipient holding the hash could recover six digits in
under a second. It did nothing about the **online** one. A million candidates
and unlimited attempts against the accept endpoint is a few hours of HTTP, and
the prize is a car.

**Decision: two counters, because they answer different questions.**

- **Per row.** Five wrong codes (`transfer_attempt_limit()`) lock the transfer.
  Locked is terminal — not a cooldown. The correct code stops working, and the
  seller's remedy is the one they already have a screen for: cancel, re-issue.
  A lock that the right answer opens is a delay.
- **Per caller.** Ten attempts an hour (`transfer_accept_limit()`), across all
  transfers, in a ledger modelled on 0042's. Without it, the per-row cap is
  defeated by patience: four guesses on each of a thousand cars costs nothing.

Neither counter is readable by anybody. `failed_attempts` and `locked_at` use
0037's technique — the one 0054 used for `otp_code_hash` — and
`transfer_accept_attempts` is closed entirely (RLS on, no policy, no grant).
`supabase/tests/17`'s standing audit now carries all three columns, so a future
migration cannot quietly re-grant them.

The lock is deliberately **not** a `status` value. `status` is on the
recipient's read surface — that is discovery (0037, widened in 0045), and it is
how a buyer learns a car is waiting for them. A lock expressed there would be a
lock the guessing party can read, which is a countdown they can watch. Keeping
the row `pending` while locked also has the property the remedy needs: the
vehicle's one slot stays occupied, so the seller cannot leave a locked transfer
lying around, and `cancel_ownership_transfer` still matches it.

### Why a refusal stopped being an exception

This is the one part of 0056 that changes an existing API, and it is forced
rather than chosen.

`raise exception` aborts the transaction. PostgREST runs one RPC in one
transaction. So a version of `accept_ownership_transfer` that increments a
failure counter _and then raises_ increments nothing: the counter is rolled back
by the very refusal it was counting. Postgres has no autonomous transaction, and
the ways around it — `dblink`, `pg_background` — are optional extensions this
project refuses to depend on for frozen infrastructure (ADR-0014, and 0054's
note on `gen_random_bytes`).

A counter that rolls back is not a counter, so the refusal has to commit:

- every indistinguishable refusal **returns NULL** — no such transfer, not
  pending, lapsed, locked, addressed to someone else, wrong code, or caller over
  their hourly limit;
- `SupabaseRepository.acceptTransfer` turns NULL into the same
  `Error('Incorrect code')` the server used to raise, so nothing above the data
  layer can tell which of the seven it was either;
- **an open warranty claim still raises.** It is reachable only by someone who
  has already presented the correct code, so it reveals nothing to a guesser,
  and it is the one refusal a person can act on — which is exactly the property
  the section above depends on.

An unauthenticated caller still raises too: there is no counter to preserve and
nothing about a car is revealed by it.

## Consequences

- `accept_ownership_transfer` returns NULL where it used to raise `28P01` and
  `P0002`. Suites 17, 29 and 32 assert the return value instead of the
  SQLSTATE; 34 is new and covers the lapse, the lock and both limits.
- `InMemoryRepository` mirrors all of it — the single refusal message and the
  five-attempt lock. A stub that kept the old distinctions would let a screen be
  written against a difference production does not make.
- `accept-transfer.tsx` branches on `'not found'` to show «انتهت صلاحية الطلب».
  That branch is now unreachable from acceptance, because acceptance is the
  thing that must not be distinguishable. It is left alone rather than deleted:
  it is correct and reachable through `getIncomingTransfer` returning null, and
  removing it is a screen change that belongs with the next pass over those
  screens.
- A seller cannot see that a transfer has been locked. That is the cost of not
  putting the lock on `status`, and it is accepted for now: the car is not at
  risk, and the remedy — cancel and re-issue — is the same one they take when
  the buyer says the code is not working. A seller-only read of the lock state
  is worth adding when those screens are next touched.
- Nothing migrates. `failed_attempts` defaults to 0 and `locked_at` to null, and
  there are no accepted transfers in any project.

---

# Amendment — the lock stops being invisible (0057)

**Status:** accepted
**Date:** 2026-09-11
**Amends:** the previous amendment's last consequence but one

The amendment above ends by accepting that "a seller cannot see that a transfer
has been locked" and calling a seller-only read of it worth adding later. Later
is now, because that consequence was understated. The lock was invisible to
_both_ parties, and the result was a dead end nobody could leave:

- the seller's screen said «بانتظار قبول المشتري» over a code that had stopped
  working, with no way to learn otherwise;
- the recipient got the same undifferentiated refusal a typo produces, and read
  it as a typo;
- and because a locked row stays `pending`, the partial unique index went on
  counting it, so the car could not be transferred to anyone until somebody
  cancelled by hand or the seven days ran out.

## Decision: surface the lock through the reads, never through `accept`

The indistinguishable-refusal rule is a property of the **accept response**,
and it is why that rule exists: `accept` is the surface an attacker can call
about a car they know nothing about. It is unchanged — seven reasons, one NULL,
asserted in `supabase/tests/35` against a locked transfer specifically.

The lock is surfaced through the two **read** paths instead, each of which
already decides who may see the row at all:

| who           | through                                   | gate                                                    |
| ------------- | ----------------------------------------- | ------------------------------------------------------- |
| the seller    | `outgoing_ownership_transfer(vehicle_id)` | owns the vehicle                                        |
| the recipient | `pending_ownership_transfer_for_me()`     | a verified identity the transfer is addressed to (0045) |

Both return `attempts_exhausted`, a boolean derived from `locked_at`. Neither
returns `locked_at` or `failed_attempts`: those stay off every client surface,
where `supabase/tests/17`'s standing audit keeps them. "It is shut, ask for a
new code" is something a person can act on; "you have two guesses left" is a
hint to whoever is guessing.

A caller who cannot read the row learns nothing either way, so showing the lock
to someone who could already read it adds no way to probe which vehicles have a
handover open — which is the only thing the rule was protecting.

`outgoing_ownership_transfer` replaces a direct select in the repository, and
fixes a second thing while it is there. Since 0056 a lapsed row is retired to
`expired` by the sweep or by the first attempt on it, so a query filtered on
`status = 'pending'` stopped returning it — which would have shown a seller
coming back on day eight a fresh warning screen with no account of where their
transfer went, the exact thing the expired state was written to prevent. One
window's worth of recently-expired rows is returned for that reason, and no
more: a transfer that ran out two months ago is not news.

## Decision: cancel and re-issue are one act

`reissue_ownership_transfer(transfer_id)` withdraws the handover and issues a
fresh code to the same address in one transaction. It is one call rather than
two because two calls are a worse product and a worse guarantee:

- between them the car has no transfer and the screen has no state;
- a cancel whose re-issue then fails — an open warranty claim, a dropped
  connection — leaves the seller worse off than before they tapped;
- and the address has to be carried from the row rather than re-typed, because
  re-typing it is how a buyer who is already waiting gets addressed to a typo.

It is the sender's call only. A recipient who could re-issue could mint
themselves an unlimited supply of attempts by resetting the row they are locked
out of. It composes the existing `cancel_ownership_transfer` and
`initiate_ownership_transfer` rather than reimplementing either, so every rule
that applied to a first issue — the warranty-claim refusal above all — applies
to a re-issue too, and a refused re-issue rolls the cancel back with it.

Cancelling a locked transfer plainly also works, because a locked row is still
`pending` and that is what `cancel_ownership_transfer` matches on. That was an
assumption until 0057; `supabase/tests/35` now asserts it, since the seller's
only manual remedy rested on it.

## Decision: every undifferentiated refusal is written down

One NULL for seven reasons is right for the caller and useless for the people
who support it. If `accept` ever returns NULL because of a **bug** — a profile
row missing, a verification flag that stopped syncing, an identity comparison
that quietly stopped matching — every screen in the product calls it a wrong
code, and the bug is invisible forever. The `not_addressed` path is the one
that would hide it: from the outside, a legitimate buyer whose verified flag
broke is indistinguishable from a stranger with a forwarded link.

So the reason is written server-side, as a `reason` column on the
`transfer_accept_attempts` ledger 0056 already writes one row to per attempt:
`accepted`, `rate_limited`, `not_found`, `expired`, `cancelled`,
`already_accepted`, `locked`, `not_addressed`, `wrong_code`. Same table rather
than a new one — one accept call is one row there already, it is already closed
to clients, and it already has the retention an account id plus a timestamp
needs under ADR-0010.

Closed to clients means closed to **both parties**: neither the seller nor the
recipient can read it. Support can, through `service_role`, and cannot rewrite
or delete it — the guard from 0056 is `ENABLE ALWAYS`, so the account that reads
the ledger cannot edit the record of what it did.

`supabase/tests/35` asserts that no attempt which reached a decision leaves
`reason` null. The single exception is structural and documented in the
migration: an open warranty claim still raises, and raising rolls the ledger row
back with everything else. That refusal is visible as an error anyway, which is
the whole reason it is allowed to raise.

## Consequences

- The seller's screen gains a sixth state, `exhausted`, between `pending` and
  `expired`. It reads in the same register as `expired` — state what happened,
  say what did not change, offer the one action that helps — because five
  mis-heard digits at a kerb is an ordinary thing to happen and neither party
  did anything wrong.
- The recipient's screen replaces the code field with «انتهت محاولات الرمز»
  rather than disabling it under a warning. There is nothing left to type, and a
  form that still looks typeable invites a sixth attempt refused with the same
  message as the first five.
- `OwnershipTransfer` and `IncomingTransfer` gain `attemptsExhausted`;
  `Repository` gains `reissueTransfer`. `InMemoryRepository` mirrors both,
  including that re-issue is one act and that the refusal stays
  undifferentiated.
- `accept-transfer.tsx`'s unreachable `'not found'` branch is still there,
  still deliberately. It belongs to the screens pass, not this one.
- Nothing migrates. `reason` is null for rows written before 0057, which is
  exactly what "we did not record it then" should look like.
