-- 0073 — The odometer the technician cannot see
--
-- `vehicles` has exactly four policies (0013) and every one of them is
-- `owner_id = auth.uid()`. A provider cannot read the car they are working on.
-- That is correct — the owner's fleet is not a technician's business — but it
-- has a consequence nobody followed through.
--
-- `listMyJobs` embeds `vehicles(current_mileage)`. PostgREST applies the
-- embedded table's RLS, so that join comes back null on every row for every
-- provider, always. `AssignedJob.vehicleCurrentMileage` is therefore
-- permanently null, and the evidence screen's «آخر قراءة مسجّلة: … كم» and its
-- «القراءة أقل من المسجّل» warning — both written, both translated, both
-- shipped — are unreachable code. The technician types the odometer with no
-- reference at all.
--
-- ---------------------------------------------------------------------------
-- Why this is a warning and not a new rule
-- ---------------------------------------------------------------------------
-- The rule already exists, and it is better than a rule written here would be.
-- `append_odometer_reading` (0063) refuses `p_km < odometer_head().km`, and
-- 0058's series model is what makes that safe: a replaced instrument cluster
-- opens a NEW series with an offset, so a genuinely lower dashboard reading is
-- not an error — it is a new scale for the same car. A check against
-- `vehicles.current_mileage` would not know that, and would refuse the one
-- case the series model exists to permit.
--
-- The completion path appends non-strict on purpose: a technician in a
-- basement must be able to finish a job, so a below-head reading is dropped
-- from the series rather than failing the completion (`absorb_order_into_
-- vehicle_care`, 0063, falls back to the head). Silently, though — which is
-- exactly why the screen needs to say something BEFORE the reading is typed
-- wrong, and could not.
--
-- So: one number, to the one person who needs it, to make a warning that was
-- already written actually fire.

-- ⚠️ ONE integer, for ONE order the caller is assigned to.
--
-- Not a row from `vehicles`, and not a function taking a vehicle id: the
-- argument is the ORDER, so the only car reachable is the one on the job in
-- the technician's hand. Plate, VIN, owner, nickname and the rest of that
-- owner's fleet stay exactly as unreadable as they were.
--
-- It returns the head reading in the CURRENT SERIES' scale — the number on the
-- dashboard, not lifetime distance — because that is the value
-- `append_odometer_reading` compares against, and a warning that used a
-- different number would fire at the wrong times in both directions.
create or replace function public.last_known_mileage_for_order(p_order_id uuid)
returns int
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_order record;
  v_head  record;
begin
  select o.provider_id, o.vehicle_id into v_order
  from public.orders o where o.id = p_order_id;

  if v_order is null or v_order.vehicle_id is null then
    return null;
  end if;

  -- The assigned provider, or the car's owner. Anybody else gets null rather
  -- than an exception: "no reading on file" and "not your job" look the same
  -- from out here, and the difference is not something worth leaking.
  if v_order.provider_id is distinct from public.current_provider_id()
     and not exists (
       select 1 from public.vehicles v
       where v.id = v_order.vehicle_id and v.owner_id = auth.uid()
     )
  then
    return null;
  end if;

  select * into v_head from public.odometer_head(v_order.vehicle_id);
  if v_head is not null then
    return v_head.km;
  end if;

  -- No readings yet — a logbook that predates 0058, or a car added without an
  -- odometer. Same fallback `vehicle_lifetime_km` uses, so the two agree.
  return (select v.current_mileage from public.vehicles v where v.id = v_order.vehicle_id);
end;
$$;

comment on function public.last_known_mileage_for_order is
  'The dashboard reading on file for one assigned job. A definer read, because '
  'a provider has no access to vehicles (0013) and the evidence screen has to '
  'warn about a reading below the series head (0063).';

-- 0069's rule: `from public` alone leaves the named-role grants standing.
revoke all on function public.last_known_mileage_for_order(uuid) from public, anon, authenticated;
grant execute on function public.last_known_mileage_for_order(uuid) to authenticated;
