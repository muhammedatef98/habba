-- 0061 — A closed job fills the care section in
--
-- This is the migration the whole slice depends on, and it is easy to mistake
-- for a convenience.
--
-- A maintenance schedule that only knows what the owner typed decays the week
-- after they type it. They set the oil interval on the day they install the
-- app, they change the oil four months later at a workshop, nothing tells
-- Habba, and from then on every reminder the app sends is about a service that
-- has already been done. Two of those and the owner turns notifications off,
-- which is the end of the section and — because §7.2 makes proactive alerts the
-- thing that converts one-off emergency users into recurring ones — a
-- meaningful part of the business with it.
--
-- So: when a Habba job closes, the technician's odometer reading (mandatory
-- since 0032) becomes a reading in the series, and if the job covers a tracked
-- item, that item's `last_done_*` moves. No user input, no screen, no
-- reconciliation step.
--
-- ---------------------------------------------------------------------------
-- Why the auto-fill never fails the completion
-- ---------------------------------------------------------------------------
-- A technician's docket can read LOWER than the car's last reading — a misread
-- digit, a trip meter instead of the odometer, a docket entered days late for a
-- car that was driven in between. 0058 refuses such a reading, and refusing it
-- is right: accepting it would poison every future prediction for the life of
-- the car.
--
-- But this trigger runs inside the transaction that closes a paid job, with a
-- customer standing next to the technician waiting for the app to say
-- «اكتمل». A refused reading must not abort that. So the append is called in
-- non-strict mode: it returns NULL and the completion proceeds. The order still
-- carries `completion_mileage`, the timeline still records it (0032), and the
-- series simply does not extend.
--
-- That is a deliberate asymmetry and the alternative is worse in both
-- directions: aborting punishes a technician for a typo, and accepting breaks
-- the car's predictions permanently.

-- ---------------------------------------------------------------------------
-- The trigger
-- ---------------------------------------------------------------------------
-- AFTER UPDATE, and a separate trigger rather than more lines inside
-- `enforce_order_transition` (0020, rebuilt in 0032). That function is a BEFORE
-- trigger validating and shaping the row; this writes to three other tables and
-- needs the final row, including the `completed_at` the BEFORE trigger sets.
-- Folding it in would also mean reprinting 150 lines of state machine in a
-- migration that has nothing to say about the state machine.
create or replace function public.absorb_order_into_vehicle_care()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_km        int;
  v_reading   uuid;
  v_lifetime  int;
  v_type      record;
  v_item_id   uuid;
begin
  if new.vehicle_id is null then
    return null;
  end if;

  -- The reading taken at completion, falling back to the one taken at booking
  -- — 0032's preference, for its reason: the car was driven to the workshop.
  v_km := coalesce(new.completion_mileage, new.mileage_at_order);

  if v_km is not null and v_km > 0 then
    v_reading := public.append_odometer_reading(
      p_vehicle_id  => new.vehicle_id,
      p_km          => v_km,
      p_source      => 'service_order',
      p_order_id    => new.id,
      p_recorded_at => coalesce(new.completed_at, now()),
      p_note        => null,
      -- See the header. A refused reading is not a reason to fail a job.
      p_strict      => false
    );
  end if;

  -- Lifetime distance AT THIS SERVICE. Taken from the row that was just
  -- written where there is one, so the item records the distance the work was
  -- actually done at rather than wherever the car has since got to.
  select r.series_offset_km + r.km into v_lifetime
  from public.vehicle_odometer_readings r
  where r.id = v_reading;

  -- No reading of its own — refused, or the service needed none. The car's
  -- current position is the closest honest answer.
  v_lifetime := coalesce(v_lifetime, public.vehicle_lifetime_km(new.vehicle_id));

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

comment on function public.absorb_order_into_vehicle_care() is
  'Writes a completed job into the odometer series and the vehicle''s '
  'maintenance schedule (ADR-0022). Never fails the completion.';

create trigger orders_absorb_into_vehicle_care
  after update of status on public.orders
  for each row
  when (new.status = 'completed' and old.status is distinct from 'completed')
  execute function public.absorb_order_into_vehicle_care();

-- ENABLE ALWAYS is deliberately NOT used here, unlike every guard in this
-- project. A guard exists to stop a write and must fire for service_role and
-- during replay. This one PERFORMS writes, and firing it on a logical replica
-- would duplicate them against rows the replica already received.
