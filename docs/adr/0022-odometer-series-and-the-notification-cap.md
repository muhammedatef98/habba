# ADR-0022 — The odometer is a series, and one car gets one notification a day

**Status:** accepted
**Date:** 2026-09-11
**Builds on:** ADR-0003 (append-only), ADR-0004 (concurrency), ADR-0010 (retention),
ADR-0012 (client-asserted time), ADR-0021 (what follows the car)

## Context

§1 sells دفتر السيارة on being worth more than the switching cost, and §7.2 rests
the recurring-revenue story on proactive maintenance: "your timing belt is due in
~1,400 km" is what turns a one-off roadside customer into a subscriber.

Both of those are arithmetic on distance, and until now the only distance the
database held was `vehicles.current_mileage` — one integer that
`append_vehicle_timeline_event` (0010) raises with
`greatest(current_mileage, p_mileage)` and that nothing ever lowers.

A high-water mark is the wrong shape twice over:

1. It cannot answer "how far since the last oil change" without walking
   `vehicle_timeline`, which is a hash-chained narrative of everything that has
   ever happened to the car and is not an index on mileage.
2. **It cannot survive a replaced instrument cluster.** A car whose cluster is
   swapped at 240,000 km reads zero the next morning. Under `greatest()` every
   reading after that is silently discarded, the car's odometer is frozen at
   240,000 for the rest of its life, and no maintenance item on it is ever due
   again. In a market with a large used fleet this is an ordinary event, not an
   edge case.

The second one is the shape of the whole problem: **one bad number permanently
destroys every future prediction for that car, and does so silently.** That is
the failure this ADR is written against, and it is why the design spends a table
on what could have been a column.

0028/0029 already predict maintenance and are NOT replaced. They answer a
different question and the distinction is load-bearing:

|                | 0028/0029 — `maintenance_rules`                                 | 0059 — `vehicle_maintenance_items`     |
| -------------- | --------------------------------------------------------------- | -------------------------------------- |
| whose opinion  | the catalogue's, about a class of car                           | **this car's**, from its own history   |
| keyed on       | make and model                                                  | vehicle                                |
| distance from  | `estimate_current_mileage`, an extrapolated drive rate          | the last actual reading                |
| what it is for | telling a car we have barely met that something is probably due | the logbook, and what a buyer inherits |

This slice deliberately contains **no drive-rate extrapolation.** 0028 keeps that
job. Brakes, tyres, battery and belts are out too, and the schema is shaped so
they arrive without a migration.

---

## Decision 1 — readings are rows, and rows belong to a series

`vehicle_odometer_readings` (0058) is append-only under the same enforcement
`vehicle_timeline` gets in 0009: a trigger that RAISES (never a `DO INSTEAD
NOTHING` rule, which discards the write and reports success), `ENABLE ALWAYS` so
a leaked service key is inside it, and no client INSERT policy at all — the
series, the offset and the monotonic rule are business rules, and a client that
could insert could choose its own lifetime distance.

**Inside a series, readings only go up.** A lower one is a typo, a misread trip
meter, or clocking, and accepting one is the silent-poisoning failure above.

**A series ends only through `replace_odometer_cluster`** — an explicit, audited
act by the owner, which also writes the swap into the logbook, because a replaced
cluster is among the most material facts a used-car buyer can be told.

The new series carries an **offset**: lifetime distance is always
`series_offset_km + km`, and lifetime distance is what maintenance intervals are
measured in. Two reasons a series starts, and they compute the offset
differently — which is the entire justification for recording the reason:

- **`cluster_replaced`** — the old cluster's distance is real, the car travelled
  it. `offset := previous offset + the previous series' highest reading`.
  Lifetime distance is continuous across the swap.
- **`correction`** — the old series' _scale_ is wrong, because somebody typed
  900000 for 90000 and every honest reading since has been refused for being
  "lower". `offset := the previous series' offset, unchanged`. The bad scale
  contributes nothing and lifetime distance is allowed to FALL, which is the
  point: it was never travelled.

Without the second reason the monotonic rule has no escape hatch for the mistake
it most commonly causes, and a single fat-fingered digit would lock a car out of
the section forever — the same permanent silent failure, arrived at from the
other direction.

Nothing is edited and nothing is deleted. A correction is a new reading that
re-anchors the scale, and the readings that were wrong stay visible as the record
of what was believed — ADR-0003's rule, which was never special to the timeline.

### What this does not fix

`vehicles.current_mileage` is still raised by `greatest()` and still ends up
holding the pre-swap high-water mark. It is left alone: the series is the
authority for everything in this slice, the column is what the home screen and
0028 already read, and rewriting it would change behaviour in three features this
slice is not about. The asymmetry is recorded here rather than in a comment
because the next person to touch mileage needs to know which of the two is the
answer.

### `record_mileage` had to be rebuilt, not merely added to

0015's version compared a new reading against `vehicles.current_mileage`. After a
cluster replacement that number is the OLD cluster's mark, so every honest
reading from the new cluster would have been refused for being lower than one
this cluster has never shown — the mileage screen would have become permanently
unusable on exactly the cars 0058 exists for.

So the comparison moves to the series head, and the same call now writes both
representations: the reading (what predictions are computed from) and the
timeline event (what the owner and a buyer read). **One call, so the two cannot
disagree.** An explicitly backdated low reading is still accepted — backfilling
history is the point of Phase 2 — and goes to the timeline only, where it is
history, never to the series, where it would break the one invariant the series
has.

---

## Decision 2 — due on EITHER axis, and the axes are never merged

An item is due when its distance interval **or** its time interval is met. A car
that sits at an airport car park for eleven months has travelled 400 km and still
needs its oil changed; oil degrades on a calendar.

The two axes are not equally knowable, and `vehicle_maintenance_status` reports
them as separate booleans rather than one `is_due` precisely so that the
difference survives to the screen. See Decision 5.

`item_type` is **text against a catalogue table**, not an enum. Brakes, tyres,
battery and belts must arrive as DATA: an enum would make every new item a schema
change, an ops deploy and a release. `maintenance_item_types` is the extension
point and the seed carries exactly two rows.

Both seeded rows point at the **same service**. «تغيير زيت وفلتر» is one job, one
invoice line and one booking in this market, and two things that wear — so one
completed order closes both items, and one cold-start answer seeds both.

---

## Decision 3 — a closed job fills the section in, and never fails because of it

This is the migration the slice depends on and the one easiest to mistake for a
convenience.

A schedule that only knows what the owner typed decays the week after they type
it: they set the interval on install day, change the oil at a workshop four
months later, tell Habba nothing, and every reminder from then on is about a
service already done. Two of those and notifications go off — which ends the
section, and with it §7.2's conversion story.

So a completed order writes the technician's reading (mandatory since 0032) into
the series, and moves `last_done_*` on any item the job covered.

**A refused reading must not abort the completion.** A docket can read lower than
the car's head — a misread digit, a trip meter, a docket entered days late — and
0058 is right to refuse it. But this trigger runs inside the transaction closing a
paid job with a customer standing next to the technician. So the append runs in
non-strict mode: it returns NULL, the completion proceeds, the order still carries
`completion_mileage` and the timeline still records it. Aborting would punish a
technician for a typo; accepting would break the car's predictions permanently.

---

## Decision 4 — one notification per vehicle per day, enforced by an index

§7.2 says it outright: "alert fatigue kills this feature." The mechanism is
entirely mechanical — an item stays due until somebody acts on it, so a sweep with
no memory re-sends the same sentence every morning until the owner turns
notifications off. After that Habba has no channel to that customer at all, and it
lost it over an oil change.

Three suppressions, doing three different jobs:

1. **One per vehicle per day.** A `unique index (vehicle_id, sent_on)`, not an
   `if` in the loop, because the case worth guarding against is the scheduler
   firing twice in two transactions — which an in-loop check does not cover. A car
   due for four things produces ONE notification listing four things.
2. **The repeat window** (7 days). The cap alone still permits a reminder every
   single morning, which is the fatigue case verbatim. An item that appeared in a
   reminder recently is not sent again. **This is what `vehicle_reminders` is
   for**: without a record of what was sent, "have we already said this" has no
   answer.
3. **The snooze**, per item, which outranks both.

Each reminder carries its items as frozen JSON with what the three actions need —
the item to mark done or snooze, the service to book — so the record says what the
owner was actually shown rather than what the schedule says today.

### Reminder history does NOT travel with the car

Every other table here is keyed on the vehicle and gated by `owns_vehicle()`, so
it follows the car through a handover with no migration and no transfer step —
exactly as warranties do in ADR-0021. `vehicle_reminders` is keyed on the vehicle
**and the person**, and the person is the gate (`user_id = auth.uid()`).

Odometer history and the schedule are facts about the car; §1.2 is the argument
for why a buyer paid for them. What was pushed to the previous owner's phone, and
whether they tapped «تم», is that person's behaviour — handing it to a stranger who
bought their car would be a privacy failure under ADR-0010 dressed up as a
feature.

It also has to work this way for the section to behave: a buyer with no reminder
history is told about their new car on day one, instead of being silenced by a
window the seller used up.

### The sweep has no inline fallback, and says so

0056 attempts pg_cron, announces the outcome, and exposes a function so nobody has
to read a migration log. 0062 does the same, and the stakes are higher: ownership
transfer expiry also runs inline on initiation and acceptance, so an unscheduled
sweep there is housekeeping. **Here there is no inline path.** Unscheduled means no
reminders are sent at all, and the only symptom is silence.
`vehicle_care_sweep_scheduled()` answers it, `supabase/tests/36` asserts the answer
and `cron.job` agree, and the migration's NOTICE says it in capitals.

---

## Decision 5 — a km-based item is never stated as a certainty

The app cannot see the odometer between readings. It knows the car was at 84,000
km on the 3rd; it knows nothing about where it is today. «موعد الزيت النهارده» over
that is a claim the data does not support, and the first time an owner opens the
bonnet on a false alarm the section has spent the credibility §1 is built on.

So:

- **Distance-based** → «متوقع أنه حان — أكّد قراءة العداد». Hedged, always, with
  the one action that would make it certain attached.
- **Date-based maintenance** → plain. Both ends are known exactly: when it was
  last done, and how many months the interval runs.
- **Documents** → plain, and this is why they are in this slice at all. An expiry
  date was read off a piece of paper; the only arithmetic is a subtraction.
  Hedging it would be vague where we can be exact — and without a certain case on
  the screen, the hedged case reads as vagueness rather than as honesty.

The rule is enforced in two places and neither is a convention:

- **Server.** `sweep_vehicle_care` composes the notification copy and stamps
  `certain` on every item in the payload, so a client rendering a push cannot
  quietly upgrade an estimate.
- **Client.** `lib/care-language.ts` is the only thing permitted to turn a
  `MaintenanceItem` into a sentence, and it returns `certain` alongside the key.
  `care-language.test.ts` asserts that no distance-derived line is ever certain
  and that every document line is.

This is also why `vehicle_maintenance_status` returns `due_by_km` and
`due_by_date` separately instead of one `is_due`. A client holding one boolean has
no way to honour the rule, and the rule would have been lost in the data layer
rather than debated in the layer that renders.

---

## Decision 6 — one screen, and حصل stays the logbook

القادم and حصل are two sections of the **existing vehicle screen**, not a new one.
حصل is the timeline that was already there, under the name the section has on the
screen. No second history surface and no second source of truth: what a car needs
next is only meaningful beside what has already been done to it — "the oil is
likely due" means something different on a car with three services in the logbook
than on one whose owner typed a number once.

The cold start asks **two questions and no more**: the current odometer, and when
the oil was last changed. Both optional, both explicitly approximate, and «لا
أتذكّر» is a real answer — the section waits and the first Habba job fills it in.
Anything longer is a form between a new user and the first useful thing the app
ever tells them, and it is answered by closing the app.

---

## Consequences

- `record_mileage` keeps its signature and its return type but changes what it
  compares against and now writes two rows. Callers are unaffected; the mileage
  screen needed no change.
- `vehicle_maintenance_items` and `vehicle_documents` are **owner-writable with no
  column guard**, unlike `orders`, `vehicles` or `providers`. Nothing on them is a
  trust surface: no money, no dispatch, no provenance, and no line on تقرير هبّة,
  which is computed from `vehicle_timeline` and cannot reach these tables. An owner
  writing a wrong interval gets their own reminders wrong and nothing else.
  `supabase/tests/16` records the classification so it stays a decision.
- `vehicle_odometer_readings.vehicle_id` is `on delete restrict`, matching
  `vehicle_timeline`. A car with readings cannot be deleted — which is what
  append-only means, and is better than a cascade the immutable trigger would
  refuse as a confusing foreign-key error.
- **A snooze transfers with the car.** `snoozed_until` is a column on
  `vehicle_maintenance_items`, which is keyed on the vehicle, so a buyer inherits a
  deferral the seller set. Accepted rather than fixed: clearing snoozes would mean
  coupling `accept_ownership_transfer` to this slice, the item is still listed on
  the screen (the snooze silences the notification, not the row), and the buyer can
  act on it. Worth revisiting if it surprises anybody.
- `file_path` on `vehicle_documents` exists and is written by nothing. Deliberate:
  when uploads arrive they are a screen and a storage policy in the shape 0048
  used, not a migration against a table that by then has rows in every project.
- Nothing migrates. Every table is new, every existing car starts with no readings
  and falls back to `vehicles.current_mileage`, and no reminder can be sent about a
  car whose owner has told us nothing.
