-- 0063 — One odometer, and a deferral that ends with the owner who set it
--
-- Two things 0058–0062 left open, both recorded in ADR-0022 as consequences and
-- neither acceptable as one.
--
-- ===========================================================================
-- 1. `vehicles.current_mileage` stops being a second answer
-- ===========================================================================
-- 0058 introduced the series and then left the old column in place, still
-- raised by `greatest(current_mileage, p_mileage)` inside
-- `append_vehicle_timeline_event` and still never lowered. Documenting that as
-- an asymmetry was the wrong response: two places holding the same number is
-- not something a comment fixes, and the stale one is the one تقرير هبّة
-- PRINTS. On a car whose cluster was replaced the report would have gone on
-- showing the old cluster's high-water mark — the report lying in public,
-- which ADR-0021 exists to prevent.
--
-- Every reader was surveyed before choosing. They all want the same thing:
--
--   * `generate_habba_report` (0014/0046)   → the number on the dashboard
--   * `estimate_current_mileage` (0028)     → a fallback when the timeline is bare
--   * `record_mileage` (0058)               → the floor a new reading must clear
--   * `vehicle_lifetime_km` (0058)          → a fallback when the series is empty
--   * the provider's job list                → the reading on the car it joined
--   * `convert_inspection_to_vehicle` (0033) → the reading the inspection took
--
-- Not one of them wants a high-water mark. Every one of them wants
-- `odometer_head().km` — what the dashboard reads NOW.
--
-- So the column is **derived**, not dropped. 0040 dropped `profiles.role` for
-- an argument that does not transfer: a stale role is a live privilege claim,
-- and there was no reader that needed it as a column. Here there is. The
-- report reads it off the `vehicles` row it has already selected, and the
-- provider's job list gets it through a nested select in the same round trip —
-- replacing those with a function call per row is a worse system, not a
-- cleaner one.
--
-- What makes "derived" true rather than asserted:
--
--   * exactly ONE writer — `sync_vehicle_odometer()` below, on insert into the
--     series, which RECOMPUTES from `odometer_head()` rather than trusting the
--     row that fired it;
--   * `append_vehicle_timeline_event` stops writing it and feeds the SERIES
--     instead, so every mileage the product has ever captured arrives by one
--     road;
--   * the client cannot write it at all (0034's guard, unchanged);
--   * a vehicle created with a stated mileage SEEDS the series, so "has
--     readings" means "has ever told us anything" rather than "used the new
--     screen";
--   * and `supabase/tests/36` asserts the invariant across every vehicle in
--     the database, so a future writer cannot reintroduce the drift quietly.
--
-- `greatest()` is gone. The column can now FALL, which is the entire defect.
--
-- ===========================================================================
-- 2. A snooze does not survive the handover
-- ===========================================================================
-- `snoozed_until` is a column on `vehicle_maintenance_items`, which is keyed on
-- the vehicle — so a buyer inherited the seller's «ذكّرني لاحقاً». ADR-0022
-- accepted that and it should not have: the schedule is a fact about the car
-- and a deferral is a fact about a person, and the consequence was that a
-- buyer's first experience of the section was a screen that says nothing.
-- §1.3 calls the handover the acquisition moment. Silence is not one.
--
-- Enforced on `vehicles.owner_id` rather than inside
-- `accept_ownership_transfer`, which would have been the narrower coupling but
-- the weaker guarantee: ownership is also moved by ops correcting a mistake,
-- and by whatever moves it next. The trigger is on the fact, so no future path
-- can move a car and leave the deferrals behind.

-- ---------------------------------------------------------------------------
-- The privileged-write flag, saved and restored
-- ---------------------------------------------------------------------------
-- ⚠️ `end_privileged_write()` is not scoped — it is one transaction-local GUC,
-- so an inner function that closes it closes it for the OUTER one too (0033's
-- warning, from the other direction). This file nests: a timeline append opens
-- the flag to write a reading, the reading's trigger opens it again to write
-- the vehicle row, and a blind `end` in the inner call would have reopened the
-- hole 0033 closed for the remainder of the outer transaction.
--
-- So every function below restores what it found instead of assuming it found
-- nothing. Where the flag was already open it stays open and the caller closes
-- it; where it was not, it is closed here, which is what 0033's test asserts.
create or replace function public.end_privileged_write_unless(p_was_open boolean)
returns void
language plpgsql
as $$
begin
  if not p_was_open then
    perform public.end_privileged_write();
  end if;
end;
$$;

comment on function public.end_privileged_write_unless(boolean) is
  'Closes the privileged-write flag only if this caller opened it. The flag is '
  'one transaction-local GUC, so a nested blind close reopens 0033''s hole.';


-- ---------------------------------------------------------------------------
-- append_odometer_reading — nest-safe, and replay-safe
-- ---------------------------------------------------------------------------
-- Rebuilt from 0058 with two changes and no new behaviour otherwise.
--
--   * the flag is saved and restored (above);
--   * a second reading for an order it has already recorded is a no-op rather
--     than a unique violation. `convert_inspection_to_vehicle` (0033) appends
--     two events for one order, and a completion that is retried appends one
--     more — none of those is a reason to abort the transaction that is
--     closing a job.
create or replace function public.append_odometer_reading(
  p_vehicle_id  uuid,
  p_km          int,
  p_source      odometer_source,
  p_order_id    uuid default null,
  p_recorded_at timestamptz default now(),
  p_note        text default null,
  p_strict      boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_head record;
  v_id   uuid;
  v_open boolean;
begin
  if p_km is null or p_km < 0 or p_km > public.odometer_ceiling_km() then
    if not p_strict then return null; end if;
    raise exception 'Odometer reading % is not plausible (0 to % km)',
      p_km, public.odometer_ceiling_km()
      using errcode = 'check_violation';
  end if;

  -- ADR-0012: a client-asserted time may be in the past — backfilling history
  -- is normal — but never in the future.
  if p_recorded_at > now() + interval '5 minutes' then
    if not p_strict then return null; end if;
    raise exception 'An odometer reading cannot be dated in the future'
      using errcode = 'check_violation';
  end if;

  -- Serialise appends per vehicle, for ADR-0004's reason applied to a
  -- different invariant: two concurrent appends would both read the same head
  -- and both pass the monotonic check against it, and one of them would be
  -- lower than the row the other just wrote.
  perform pg_advisory_xact_lock(hashtextextended('odometer:' || p_vehicle_id::text, 0));

  select * into v_head from public.odometer_head(p_vehicle_id);

  if v_head is not null and p_km < v_head.km then
    if not p_strict then return null; end if;
    raise exception 'Reading % km is below this car''s last reading of % km', p_km, v_head.km
      using errcode = 'check_violation',
            hint = 'If the instrument cluster was replaced, use replace_odometer_cluster '
                   'so the history is kept and the scale starts again.';
  end if;

  v_open := public.is_privileged_write();
  perform public.begin_privileged_write();

  insert into public.vehicle_odometer_readings (
    vehicle_id, km, recorded_at, source, service_order_id,
    series, series_offset_km, note, created_by
  ) values (
    p_vehicle_id, p_km, p_recorded_at, p_source, p_order_id,
    coalesce(v_head.series, 1), coalesce(v_head.series_offset_km, 0),
    p_note, auth.uid()
  )
  -- Infers `vehicle_odometer_readings_one_per_order_idx`. A replay returns
  -- NULL, exactly as a refused reading does, and the caller carries on.
  on conflict (service_order_id) where service_order_id is not null do nothing
  returning id into v_id;

  perform public.end_privileged_write_unless(v_open);

  return v_id;
end;
$$;

revoke all on function public.append_odometer_reading(
  uuid, int, odometer_source, uuid, timestamptz, text, boolean)
  from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- sync_vehicle_odometer — the column's ONE writer
-- ---------------------------------------------------------------------------
-- Recomputes from `odometer_head()` rather than from the row that fired it.
-- The distinction matters after `replace_odometer_cluster`: the head is
-- whichever reading is highest in the highest SERIES, and a trigger that
-- trusted NEW would be a second definition of "where the car is" — which is
-- the thing this migration exists to abolish.
create or replace function public.sync_vehicle_odometer()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_head record;
  v_open boolean;
begin
  select * into v_head from public.odometer_head(new.vehicle_id);

  if v_head is null then
    return null;
  end if;

  v_open := public.is_privileged_write();
  perform public.begin_privileged_write();

  -- No `greatest`. That is the whole point: a replaced cluster reads lower
  -- than the one before it, and so does a corrected scale, and the column has
  -- to be able to say so.
  update public.vehicles
  set current_mileage = v_head.km,
      -- When the reading was TAKEN, not when the row landed. A docket entered
      -- three days late describes a car as it was three days ago, and
      -- «آخر قراءة» is the owner's cue for how stale the estimate is.
      mileage_updated_at = v_head.recorded_at
  where id = new.vehicle_id
    and (current_mileage is distinct from v_head.km
      or mileage_updated_at is distinct from v_head.recorded_at);

  perform public.end_privileged_write_unless(v_open);

  return null;
end;
$$;

create trigger vehicle_odometer_readings_sync_vehicle
  after insert on public.vehicle_odometer_readings
  for each row execute function public.sync_vehicle_odometer();

-- NOT `ENABLE ALWAYS`. This performs a write rather than refusing one, and
-- firing it during logical replay would re-derive a column the replica has
-- already received — the same reasoning 0061 gives for its auto-fill trigger.


-- ---------------------------------------------------------------------------
-- seed_vehicle_odometer — a car states its mileage once, as a reading
-- ---------------------------------------------------------------------------
-- Without this, a car added with 80,000 km has a column and no series, and the
-- first honest backfill — «كانت على 40,000 قبل ثلاث سنوات» — becomes the head
-- and drags the column DOWN to it. The series has to start where the owner
-- says the car is, or the monotonic rule has nothing to hold.
--
-- Non-strict: an implausible number at sign-up is not a reason to refuse the
-- car. The column keeps what was typed, the series stays empty, and the
-- fallbacks in `vehicle_lifetime_km` and `maintenance_item_status` cover it —
-- which is the documented meaning of a vehicle with no readings.
create or replace function public.seed_vehicle_odometer()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(new.current_mileage, 0) > 0 then
    perform public.append_odometer_reading(
      p_vehicle_id  => new.id,
      p_km          => new.current_mileage,
      p_source      => 'manual',
      p_order_id    => null,
      p_recorded_at => coalesce(new.mileage_updated_at, now()),
      p_note        => null,
      p_strict      => false
    );
  end if;

  return null;
end;
$$;

create trigger vehicles_seed_odometer
  after insert on public.vehicles
  for each row execute function public.seed_vehicle_odometer();


-- ---------------------------------------------------------------------------
-- append_vehicle_timeline_event — feeds the series, writes no odometer
-- ---------------------------------------------------------------------------
-- 0040's function, with the `greatest()` block replaced. Everything above the
-- odometer is byte-for-byte what 0040 wrote: the same authorisation, the same
-- advisory lock, the same chain construction (ADR-0004), the same provenance
-- derivation (ADR-0005).
--
-- The mileage a timeline event carries is now OFFERED to the series, and the
-- column follows from there. That closes the last gap: a past service recorded
-- by the owner, an inspection's subject mileage and a technician's completion
-- reading all reach the series, where before only the two paths 0058 and 0061
-- wired by hand did.
--
-- Non-strict, because the reasons a reading is refused are all reasons a
-- TIMELINE event should still be written: a backdated low reading is history
-- and belongs in the logbook; it is simply not where the car is now.
create or replace function public.append_vehicle_timeline_event(
  p_vehicle_id  uuid,
  p_event_type  public.timeline_event_type,
  p_summary_ar  text,
  p_summary_en  text,
  p_occurred_at timestamptz default now(),
  p_mileage     int default null,
  p_order_id    uuid default null,
  p_provider_id uuid default null,
  p_details     jsonb default '{}'::jsonb,
  p_attachments jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor       uuid := auth.uid();
  v_owner_id    uuid;
  v_prev_hash   text;
  v_id          uuid := gen_random_uuid();
  v_provenance  public.timeline_provenance;
  v_payload     text;
  v_row_hash    text;
begin
  if v_actor is null then
    raise exception 'Not authenticated' using errcode = 'insufficient_privilege';
  end if;

  select v.owner_id into v_owner_id
  from public.vehicles v
  where v.id = p_vehicle_id and v.is_active;

  if v_owner_id is null then
    raise exception 'Vehicle % not found', p_vehicle_id using errcode = 'no_data_found';
  end if;

  if v_owner_id <> v_actor and not public.is_ops() then
    raise exception 'Not permitted to write to this vehicle timeline'
      using errcode = 'insufficient_privilege';
  end if;

  if p_occurred_at > now() + interval '5 minutes' then
    raise exception 'occurred_at cannot be in the future' using errcode = 'check_violation';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_vehicle_id::text, 0));

  select t.row_hash into v_prev_hash
  from public.vehicle_timeline t
  where t.vehicle_id = p_vehicle_id
  order by t.seq desc
  limit 1;

  v_prev_hash := coalesce(v_prev_hash, 'GENESIS');
  v_provenance := public.derive_timeline_provenance(p_event_type, p_order_id, p_attachments);

  v_payload := public.timeline_row_payload(
    v_prev_hash, v_id, p_vehicle_id, p_event_type, p_occurred_at, p_mileage,
    p_order_id, p_provider_id, v_actor, v_provenance, p_details, p_attachments
  );
  v_row_hash := public.timeline_row_hash(v_payload);

  insert into public.vehicle_timeline (
    id, vehicle_id, event_type, occurred_at, recorded_at, mileage,
    order_id, provider_id, provenance, summary_ar, summary_en,
    details, attachments, created_by, prev_hash, row_hash
  ) values (
    v_id, p_vehicle_id, p_event_type, p_occurred_at, now(), p_mileage,
    p_order_id, p_provider_id, v_provenance, p_summary_ar, p_summary_en,
    coalesce(p_details, '{}'::jsonb), coalesce(p_attachments, '[]'::jsonb),
    v_actor, v_prev_hash, v_row_hash
  );

  if p_mileage is not null then
    -- The series, and nothing else. `vehicles.current_mileage` follows from
    -- `sync_vehicle_odometer` — there is one writer and this is not it.
    --
    -- The source is derived the way provenance is (ADR-0005): an event that
    -- names an order was captured under Habba's control by a technician with
    -- the car in front of them, and the reading inherits that.
    perform public.append_odometer_reading(
      p_vehicle_id  => p_vehicle_id,
      p_km          => p_mileage,
      -- Cast explicitly: a CASE yields `text`, and `append_odometer_reading`
      -- takes `odometer_source`. Without it the call resolves to no function
      -- at all, and only at runtime.
      p_source      => (case when p_order_id is not null then 'service_order' else 'manual' end)
                       ::public.odometer_source,
      p_order_id    => p_order_id,
      p_recorded_at => p_occurred_at,
      p_note        => null,
      p_strict      => false
    );
  end if;

  return v_id;
end;
$$;

comment on function public.append_vehicle_timeline_event(
  uuid, public.timeline_event_type, text, text, timestamptz, int, uuid, uuid, jsonb, jsonb) is
  'The only way a row enters the timeline (ADR-0003), and the only way a mileage '
  'enters the odometer series (ADR-0022). It no longer writes vehicles.current_mileage.';


-- ---------------------------------------------------------------------------
-- record_mileage — one append, not two
-- ---------------------------------------------------------------------------
-- 0058 wrote the timeline event AND the reading, because the timeline did not
-- feed the series. It does now, so the second call is removed: one road in,
-- and no chance of the two disagreeing about what was recorded.
create or replace function public.record_mileage(
  p_vehicle_id  uuid,
  p_mileage     int,
  p_occurred_at timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_head    record;
  v_current int;
  v_floor   int;
begin
  if p_mileage is null or p_mileage < 0 then
    raise exception 'Mileage must be zero or more' using errcode = 'check_violation';
  end if;

  select v.current_mileage into v_current
  from public.vehicles v where v.id = p_vehicle_id;

  if v_current is null then
    raise exception 'Vehicle % not found', p_vehicle_id using errcode = 'no_data_found';
  end if;

  select * into v_head from public.odometer_head(p_vehicle_id);

  -- The head where there is one; the column where there is not, which since
  -- this migration means a car whose stated mileage was never plausible enough
  -- to seed a series.
  v_floor := coalesce(v_head.km, v_current);

  -- A reading below the floor is a typo or clocking. Rejected rather than
  -- accepted-and-hidden: an odometer that appears to go backwards on a resale
  -- report destroys the report's credibility, and silently dropping the value
  -- leaves the owner believing it saved.
  --
  -- Backdated readings stay a legitimate exception — recording that the car
  -- was at 40,000 km two years ago is normal when filling in history. Such a
  -- reading goes to the timeline, where it is history, and the series refuses
  -- it on its own terms, where it would break the one invariant it has.
  if p_mileage < v_floor and p_occurred_at > now() - interval '1 day' then
    raise exception 'Mileage % is lower than this car''s last reading of % km', p_mileage, v_floor
      using errcode = 'check_violation',
            hint = 'Check the reading. If you are recording an older reading, set its date. '
                   'If the instrument cluster was replaced, use replace_odometer_cluster.';
  end if;

  return public.append_vehicle_timeline_event(
    p_vehicle_id  => p_vehicle_id,
    p_event_type  => 'mileage_recorded',
    p_summary_ar  => format('قراءة العداد: %s كم', p_mileage),
    p_summary_en  => format('Mileage reading: %s km', p_mileage),
    p_occurred_at => p_occurred_at,
    p_mileage     => p_mileage
  );
end;
$$;

comment on function public.record_mileage(uuid, int, timestamptz) is
  'Records one odometer reading, through the timeline, which feeds the series '
  '(ADR-0022). Rejects a reading below the head unless it is explicitly backdated.';

grant execute on function public.record_mileage(uuid, int, timestamptz) to authenticated;


-- ---------------------------------------------------------------------------
-- replace_odometer_cluster — nest-safe
-- ---------------------------------------------------------------------------
-- Unchanged except for the flag, which it now restores rather than closes. It
-- still inserts directly rather than through `append_odometer_reading`,
-- because it is the one caller that must NOT be checked against the head: it
-- is the path by which a reading is allowed to be lower.
create or replace function public.replace_odometer_cluster(
  p_vehicle_id uuid,
  p_km         int,
  p_reason     odometer_series_reason,
  p_note       text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor  uuid := auth.uid();
  v_head   record;
  v_offset int;
  v_id     uuid;
  v_open   boolean;
begin
  if v_actor is null then
    raise exception 'Not authenticated' using errcode = 'insufficient_privilege';
  end if;

  if not public.owns_vehicle(p_vehicle_id) then
    -- Same message whether the car is someone else's or does not exist, for
    -- 0054's reason: otherwise this is a probe for which vehicle ids are real.
    raise exception 'Vehicle % is not yours', p_vehicle_id
      using errcode = 'insufficient_privilege';
  end if;

  if p_km is null or p_km < 0 or p_km > public.odometer_ceiling_km() then
    raise exception 'Odometer reading % is not plausible (0 to % km)',
      p_km, public.odometer_ceiling_km()
      using errcode = 'check_violation';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('odometer:' || p_vehicle_id::text, 0));

  select * into v_head from public.odometer_head(p_vehicle_id);

  if v_head is null then
    raise exception 'This car has no odometer readings yet'
      using errcode = 'no_data_found',
            hint = 'Record the current reading first.';
  end if;

  v_offset := case p_reason
    -- The old cluster's distance was travelled. Keep it.
    when 'cluster_replaced' then v_head.series_offset_km + v_head.km
    -- The old scale was wrong. It contributes nothing, and lifetime distance
    -- is allowed to fall — see ADR-0022.
    when 'correction'       then v_head.series_offset_km
  end;

  v_open := public.is_privileged_write();
  perform public.begin_privileged_write();

  insert into public.vehicle_odometer_readings (
    vehicle_id, km, recorded_at, source, series, series_offset_km,
    series_reason, note, created_by
  ) values (
    p_vehicle_id, p_km, now(), 'manual', v_head.series + 1, v_offset,
    p_reason, p_note, v_actor
  )
  returning id into v_id;

  perform public.end_privileged_write_unless(v_open);

  -- §1: the logbook records what happened to the car. A replaced cluster is
  -- one of the most material facts a used-car buyer can be told.
  --
  -- No p_mileage, and now for a second reason as well as the first: the series
  -- row above is already written, and passing a mileage here would offer the
  -- same reading to the series a second time.
  perform public.append_vehicle_timeline_event(
    p_vehicle_id  => p_vehicle_id,
    p_event_type  => 'mileage_recorded',
    p_summary_ar  => case p_reason
      when 'cluster_replaced' then format('تم تركيب عدّاد جديد — القراءة تبدأ من %s كم', p_km)
      else format('تصحيح قراءة العداد — القراءة الصحيحة %s كم', p_km)
    end,
    p_summary_en  => case p_reason
      when 'cluster_replaced' then format('Instrument cluster replaced — readings restart at %s km', p_km)
      else format('Odometer scale corrected — the true reading is %s km', p_km)
    end,
    p_details     => jsonb_strip_nulls(jsonb_build_object(
      'series', v_head.series + 1,
      'series_offset_km', v_offset,
      'notes_public', p_note
    ))
  );

  return v_id;
end;
$$;

grant execute on function public.replace_odometer_cluster(uuid, int, odometer_series_reason, text)
  to authenticated;


-- ---------------------------------------------------------------------------
-- absorb_order_into_vehicle_care — the reading is no longer its job
-- ---------------------------------------------------------------------------
-- 0061 appended the completion reading itself, because nothing else did.
-- `append_vehicle_timeline_event` does now — 0032's completion event carries
-- `completion_mileage` and names the order — so this trigger reads the series
-- instead of writing to it, and does the one thing that is still only its:
-- moving `last_done_*` on the items the job covered.
create or replace function public.absorb_order_into_vehicle_care()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lifetime  int;
  v_type      record;
  v_item_id   uuid;
begin
  if new.vehicle_id is null then
    return null;
  end if;

  -- Where the car is now, which after the completion event is the reading the
  -- technician took — or, if that reading was refused for being below the
  -- head, the head. Either way it is the series' answer and not a second one.
  v_lifetime := public.vehicle_lifetime_km(new.vehicle_id);

  -- Which tracked items this job covers. Several can map to one service, and
  -- that is the normal case rather than an edge: «تغيير زيت وفلتر» is one line
  -- on one invoice and two items on this car's schedule.
  for v_type in
    select t.item_type
    from public.maintenance_item_types t
    where t.is_active and t.service_id = new.service_id
  loop
    v_item_id := public.ensure_maintenance_item(new.vehicle_id, v_type.item_type);
    if v_item_id is null then
      continue;
    end if;

    update public.vehicle_maintenance_items
    set last_done_km       = v_lifetime,
        last_done_at       = coalesce(new.completed_at, now()),
        last_done_order_id = new.id,
        -- The item is done. A snooze was a request to be asked later about
        -- something outstanding, and nothing is outstanding now.
        snoozed_until      = null
    where id = v_item_id
      -- Never move the record backwards. A docket entered late for a job done
      -- in March must not overwrite what a job in June already recorded.
      and (last_done_at is null or last_done_at <= coalesce(new.completed_at, now()));
  end loop;

  return null;
end;
$$;


-- ---------------------------------------------------------------------------
-- A handover ends the previous owner's deferrals
-- ---------------------------------------------------------------------------
-- On `vehicles.owner_id` rather than inside `accept_ownership_transfer`. The
-- narrower coupling would have been the weaker guarantee: ownership also moves
-- when ops corrects a mistake, and will move by whatever path is written next.
-- A trigger on the fact cannot be routed around.
--
-- Only `snoozed_until`. The schedule itself, the odometer series and the
-- documents all belong to the car and travel with it (ADR-0022) — this clears
-- the one column on them that belonged to a person.
create or replace function public.clear_care_snoozes_on_transfer()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.vehicle_maintenance_items
  set snoozed_until = null
  where vehicle_id = new.id and snoozed_until is not null;

  return null;
end;
$$;

comment on function public.clear_care_snoozes_on_transfer() is
  'A deferral is the previous owner''s, not the car''s. The buyer sees what the '
  'car is due for on day one (ADR-0022).';

create trigger vehicles_clear_care_snoozes
  after update of owner_id on public.vehicles
  for each row
  when (new.owner_id is distinct from old.owner_id)
  execute function public.clear_care_snoozes_on_transfer();


-- ---------------------------------------------------------------------------
-- Backfill
-- ---------------------------------------------------------------------------
-- Every vehicle that already has readings is brought onto the derived value in
-- one statement. On a project deployed since 0058 that is the cars whose
-- owners used the new screen; on a fresh database it is none, which is why
-- this is safe to run unconditionally.
--
-- Vehicles with a stated mileage and no readings are seeded, so that after
-- this migration "has readings" means "has ever told us anything" — the
-- property `supabase/tests/36`'s standing invariant relies on.
do $backfill$
declare
  v_vehicle record;
begin
  perform public.begin_privileged_write();

  for v_vehicle in
    select v.id, v.current_mileage, v.mileage_updated_at
    from public.vehicles v
    where v.current_mileage > 0
      and not exists (
        select 1 from public.vehicle_odometer_readings r where r.vehicle_id = v.id
      )
  loop
    insert into public.vehicle_odometer_readings (
      vehicle_id, km, recorded_at, source, created_by
    ) values (
      v_vehicle.id,
      least(v_vehicle.current_mileage, public.odometer_ceiling_km()),
      coalesce(v_vehicle.mileage_updated_at, now()),
      'manual',
      null
    );
  end loop;

  -- A CTE rather than `from lateral (...)`: an UPDATE's FROM list cannot
  -- laterally reference the table being updated, so the heads are gathered
  -- first and joined back by id.
  with heads as (
    select d.vehicle_id, h.km, h.recorded_at
    from (select distinct r.vehicle_id from public.vehicle_odometer_readings r) d
    cross join lateral public.odometer_head(d.vehicle_id) h
  )
  update public.vehicles v
  set current_mileage = heads.km,
      mileage_updated_at = heads.recorded_at
  from heads
  where heads.vehicle_id = v.id
    and (v.current_mileage is distinct from heads.km
      or v.mileage_updated_at is distinct from heads.recorded_at);

  perform public.end_privileged_write();
end
$backfill$;


comment on column public.vehicles.current_mileage is
  'DERIVED from the odometer series (ADR-0022): the highest reading of the '
  'highest series, maintained only by sync_vehicle_odometer(). Falls back to '
  'the value stated when the car was added, for a car with no readings. It is '
  'no longer monotonic — a replaced cluster lowers it, and must.';
