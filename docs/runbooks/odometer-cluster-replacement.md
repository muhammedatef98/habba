# Restarting a car's odometer series

**For:** a customer whose odometer readings are all being refused, because the
instrument cluster in their car was replaced (or because a wildly wrong reading
was recorded and now sits above every real one).

**Runs as:** an operator holding `ops` or `super_admin`, through a `service_role`
connection. There is no screen for this and there is deliberately not going to
be one — see [ADR-0022](../adr/0022-odometer-series-and-the-notification-cap.md)
for what an odometer series is, and the header of
`supabase/migrations/0064_the_cluster_path_support_can_run.sql` for why the
button does not exist.

---

## 1. The symptom

The customer says some version of:

> «ما يقبل قراءة العداد» — it won't accept my odometer reading.

In the app they see:

> القراءة أقل من آخر قراءة مسجّلة (240,000 كم). تحقّق من الرقم — وإن كان العدّاد
> قد استُبدل، تواصل مع الدعم لإعادة ضبط القراءات.

The distinguishing feature is that it is **permanent**. A typo is refused once
and the customer corrects it. A replaced cluster is refused every time, forever,
because every reading the new cluster can produce is below the old one's last
number. Their care section — القادم — is frozen: nothing will ever fall due
again, because due dates are computed from a distance that can no longer move.

If the customer has tried once and got it right the second time, this is not
your case.

---

## 2. Verify the claim before you touch anything

You are being asked to lower a car's recorded odometer. That is the single most
valuable thing to lie about when selling a used car, and تقرير هبّة is sold on
being trustworthy to a stranger. **Do not run this on the customer's word
alone.**

### Ask for evidence

One of:

- an invoice or work order from the workshop that replaced the cluster, naming
  the car and dated;
- photographs showing the new cluster's reading together with the plate or VIN;
- for a `correction`: whatever shows the real number — a dashboard photo is
  usually enough, since you are undoing a typo rather than a physical change.

### Check it against what we already hold

```sql
-- The car, its owner, and where the series stands.
select v.id, v.plate_normalised, v.vin, v.owner_id, v.current_mileage
from public.vehicles v
where v.id = :vehicle_id;

-- The whole series. Look for the shape of the story you were told.
select r.series, r.km, r.series_offset_km, r.series_offset_km + r.km as lifetime_km,
       r.recorded_at, r.source, r.series_reason, r.note
from public.vehicle_odometer_readings r
where r.vehicle_id = :vehicle_id
order by r.series, r.km;
```

Things that should make you stop and escalate rather than proceed:

- **A series replacement already happened recently.** Check §5's ledger query. A
  car that needs this twice in a year is either a very unlucky customer or
  someone learning that support will lower their odometer on request.
- **The last reading came from a Habba job** (`source = 'service_order'`). That
  number was read off the dashboard by our own technician with the car in front
  of them. If the customer is disputing it, that is a different conversation.
- **The claimed new reading is higher than the old one.** Then nothing is stuck
  and no replacement is needed — the customer's real problem is something else.
- **A pending ownership transfer on the car.** Finish that conversation first;
  you do not want to re-anchor an odometer that a buyer is about to inherit.

### Pick the reason

| Reason             | Use when                                                                                                                      | What it does to lifetime distance                                                                                        |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `cluster_replaced` | The physical instrument was swapped. The old distance was really travelled.                                                   | **Kept.** The new series starts with the old total as its offset, so the car's lifetime km is continuous.                |
| `correction`       | The scale is wrong — somebody typed 2,400,000 for 240,000, and every honest reading since has been refused for being "lower". | **Not kept.** The bad series contributes nothing and lifetime distance falls, because that distance was never travelled. |

Getting this wrong is not cosmetic: `cluster_replaced` on a typo credits the car
with hundreds of thousands of kilometres it never did, and it is on the report.

---

## 3. What to run

```sql
select public.replace_odometer_cluster(
  p_vehicle_id   => :vehicle_id,
  p_km           => :reading_on_the_new_cluster,
  p_reason       => :reason,          -- 'cluster_replaced' | 'correction'
  p_note         => :why,             -- free text, at least 10 characters
  p_performed_by => :your_ops_user_id
);
```

Notes on the arguments, because each of them is refused rather than defaulted:

- **`p_performed_by`** is **you** — your own ops account id, not the customer's.
  `service_role` is one shared key, so the database cannot tell which person is
  behind it and asks. The id must hold `ops` or `super_admin` right now; a
  revoked operator is refused immediately.
- **`p_note`** is what you were shown and what you concluded, in your own words.
  Ten characters is the floor, not the target. "خطأ" will be refused; write the
  sentence you would want to read if you were the next person looking at this
  car. It is stored and it is not editable afterwards.
- **`p_km`** is what the dashboard reads **now**, not the old number and not the
  number you want the total to be. The arithmetic is the database's job.

The call returns the id of the reading it minted. Keep it for step 4.

### If it refuses

| Error                                                                  | Means                                                                                                    |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `permission denied for function`                                       | You are not on a `service_role` connection. This is not callable from a client session, ops role or not. |
| `An odometer series is replaced by an operator, named and holding ops` | `p_performed_by` is null, is not a real operator, or their role was revoked.                             |
| `A series replacement needs a written reason`                          | `p_note` is missing or under 10 characters.                                                              |
| `This car has no odometer readings yet`                                | There is no series to replace. The customer's first reading will simply be accepted; nothing to do here. |
| `Odometer reading … is not plausible`                                  | Outside 0–2,000,000 km. Re-read the photograph.                                                          |

---

## 4. What to check afterwards

Run all four. "It returned without an error" is not the same as "the customer
can use their car's page again", and the fourth one is the only one that
actually answers the question they called about.

```sql
-- 1. The new series exists, with the offset the reason called for.
select r.series, r.km, r.series_offset_km, r.series_offset_km + r.km as lifetime_km,
       r.series_reason, r.note
from public.vehicle_odometer_readings r
where r.vehicle_id = :vehicle_id
order by r.series desc, r.km desc
limit 1;
```

For `cluster_replaced`, `lifetime_km` should be **the old total plus the new
reading**. For `correction`, it should be **the previous offset plus the new
reading** — lower than before, which is the point.

```sql
-- 2. The vehicle row followed. This is what تقرير هبّة prints, and it is
--    derived from the series head by a trigger — nobody sets it by hand.
select current_mileage, mileage_updated_at from public.vehicles where id = :vehicle_id;
```

It should equal the new cluster reading, not the lifetime total.

```sql
-- 3. The logbook records the swap, under your name.
select occurred_at, summary_ar, summary_en, created_by, details
from public.vehicle_timeline
where vehicle_id = :vehicle_id
order by seq desc
limit 3;
```

A replaced cluster is one of the most material facts a used-car buyer can be
told, so it goes in the owner's own history. `created_by` is **you**, not the
owner — that is correct and intended.

```sql
-- 4. The care section is alive again: items have due points, and they are
--    measured across the swap rather than from zero.
select item_type, last_done_km, due_at_km, km_remaining, due_by_km, due_by_date
from public.vehicle_maintenance_status(:vehicle_id);
```

`due_at_km` is on the **lifetime** scale, so on a `cluster_replaced` it will look
much larger than the number on the customer's dashboard. That is right.
`km_remaining` is the one to sanity-check: it should be a plausible distance, not
a negative six-figure number.

### Then tell the customer

They can record readings again from the app, as normal, using whatever the
dashboard says. They do not need to do anything special, and they should not be
told to "add the old mileage" to anything.

---

## 5. What it leaves behind

Every call writes one row to `odometer_series_interventions`. It is closed to
customers entirely and readable only through `service_role`, and **nobody can
edit or delete it — not even the account that reads it.**

```sql
-- What has been done to this car?
select performed_at, performed_by, reason, note,
       from_series, from_km, from_lifetime_km,
       to_series, to_km, to_lifetime_km
from public.odometer_series_interventions
where vehicle_id = :vehicle_id
order by performed_at desc;

-- What has this operator done?
select performed_at, vehicle_id, reason, note
from public.odometer_series_interventions
where performed_by = :ops_user_id
order by performed_at desc;
```

The second query is the one to run if a pattern is suspected. This operation
lowers the number a car is sold on; the ledger exists so that someone doing it
repeatedly is visible, and so is what they said their reason was.

---

## 6. When to stop following this runbook

If you are running this more than about once a month, stop and raise it. Either
something upstream is producing bad readings, or the case is common enough that
it deserves a designed flow — an owner-facing request with evidence upload and
an approval step — rather than a support engineer with a SQL prompt.
