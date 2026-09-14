-- 0058 — The odometer as a series, not as a number
--
-- §1 makes the logbook the product, and every prediction the logbook is
-- supposed to power — «متى موعد الزيت» — is arithmetic on distance. Until now
-- the only distance the database held was `vehicles.current_mileage`, a single
-- integer that `append_vehicle_timeline_event` (0010) raises with
-- `greatest(current_mileage, p_mileage)` and nothing ever lowers.
--
-- A high-water mark is the wrong shape for two reasons, and the second is the
-- one that matters:
--
--   1. It cannot answer "how far since the last oil change" without walking the
--      timeline, which is a hash-chained narrative of everything that ever
--      happened to the car and is not an index on mileage.
--   2. It cannot survive a replaced instrument cluster. A car whose cluster is
--      swapped at 240,000 km reads 0 the next morning. That is an ordinary
--      event in a market with a large used fleet, and under `greatest()` every
--      reading afterwards is silently discarded — the car's odometer freezes at
--      240,000 forever and no maintenance item is ever due again.
--
-- So readings become rows, and rows belong to a SERIES.
--
-- ---------------------------------------------------------------------------
-- The series model
-- ---------------------------------------------------------------------------
-- Within a series, readings only go up. That is the whole invariant, and it is
-- enforced rather than hoped for: a lower reading is a typo, a misread trip
-- meter, or clocking, and accepting one poisons every future prediction for the
-- life of the car — an item computed from `last_done_km + interval_km` against
-- a reading that went backwards is never due again.
--
-- A series ENDS only through `replace_odometer_cluster`, which is an explicit,
-- audited act by the owner. The new series carries an OFFSET: the lifetime
-- distance accumulated before it began. Lifetime distance is therefore always
-- `series_offset_km + km`, and it is lifetime distance that maintenance
-- intervals are measured in.
--
-- Two reasons a series starts, and they compute the offset differently, which
-- is the entire justification for recording the reason at all:
--
--   * `cluster_replaced` — the old cluster's distance is REAL. The car did
--     travel it. offset := previous offset + the previous series' highest
--     reading. Lifetime distance is continuous across the swap.
--   * `correction` — the old series' scale is WRONG, because somebody typed
--     900000 for 90000 and every honest reading since has been refused for
--     being "lower". offset := the previous series' offset, unchanged. The bad
--     scale contributes nothing, and lifetime distance is allowed to fall,
--     which is the point: it was never travelled.
--
-- Neither path edits or deletes anything. §2.4's rule is not special to the
-- timeline — a correction is a new reading that re-anchors the scale, and the
-- readings that were wrong stay visible as the record of what was believed.
--
-- ---------------------------------------------------------------------------
-- What this file deliberately does not do
-- ---------------------------------------------------------------------------
-- No drive-rate extrapolation. `estimate_current_mileage` (0028) exists and is
-- left alone; it serves the rule-driven alert scan. Nothing here guesses where
-- the odometer is today, because the app cannot see the odometer between
-- readings and ADR-0022 refuses to let the UI imply otherwise.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type odometer_source as enum (
  -- The owner typed it.
  'manual',
  -- Captured from a Habba job's completion evidence (0032). The technician
  -- read it off the dashboard with the car in front of them, which is why it
  -- needs no separate provenance concept — the order id is on the row.
  'service_order'
);

create type odometer_series_reason as enum ('cluster_replaced', 'correction');


-- ---------------------------------------------------------------------------
-- The ceiling, as data rather than as a literal in four places
-- ---------------------------------------------------------------------------
-- Same pattern as ownership_transfer_window() (0054). A 25-year-old taxi in
-- the Eastern Province genuinely shows 900,000 km, so the ceiling is generous
-- on purpose: it catches a slipped digit, it does not argue with anyone about
-- their own car. apps/mobile's add-vehicle screen uses the same number.
create or replace function public.odometer_ceiling_km()
returns int language sql immutable as $$ select 2000000 $$;


-- ---------------------------------------------------------------------------
-- vehicle_odometer_readings
-- ---------------------------------------------------------------------------
create table public.vehicle_odometer_readings (
  id               uuid primary key default gen_random_uuid(),
  -- `restrict`, matching vehicle_timeline (0009) and for the same reason: an
  -- append-only record cannot be tidied away by deleting the row it hangs off,
  -- and the immutable trigger below would refuse the cascade anyway — as a
  -- failed DELETE on the vehicle, which reads like a broken foreign key rather
  -- than like the rule it actually is.
  vehicle_id       uuid not null references public.vehicles(id) on delete restrict,

  km               int not null check (km >= 0),
  recorded_at      timestamptz not null default now(),

  source           odometer_source not null,
  service_order_id uuid references public.orders(id) on delete restrict,

  -- 1 for every car that has never had its cluster replaced or its scale
  -- corrected, which is almost all of them.
  series           int not null default 1 check (series >= 1),
  -- Lifetime distance accumulated before this series began. Denormalised onto
  -- every row on purpose: the table is append-only, so it cannot drift, and it
  -- makes `series_offset_km + km` a plain expression rather than a window
  -- function over every earlier series.
  series_offset_km int not null default 0 check (series_offset_km >= 0),
  -- Set on the FIRST row of a series > 1 and nowhere else. It is what makes
  -- the offset above auditable rather than asserted.
  series_reason    odometer_series_reason,

  note             text,

  created_at       timestamptz not null default now(),
  created_by       uuid references public.profiles(id),

  -- A reading that claims to come from a job must name the job, and a reading
  -- that names one must not claim to be typed by the owner.
  constraint vehicle_odometer_readings_source_order check (
    (source = 'service_order') = (service_order_id is not null)
  ),

  -- The first series is the plain case and has nothing to explain.
  constraint vehicle_odometer_readings_first_series_plain check (
    series > 1 or (series_offset_km = 0 and series_reason is null)
  ),

  constraint vehicle_odometer_readings_ceiling check (
    km <= public.odometer_ceiling_km()
  )
);

comment on table public.vehicle_odometer_readings is
  'Append-only odometer series per vehicle (ADR-0022). Lifetime distance is '
  'series_offset_km + km. Never UPDATEd, never DELETEd — a correction is a new '
  'series, not an edit.';

comment on column public.vehicle_odometer_readings.series_offset_km is
  'Lifetime km before this series started. 0 for series 1; set by '
  'replace_odometer_cluster for later ones.';

-- The head of the series is read on every append, every due computation and
-- every sweep pass, always as "highest km in the highest series".
create index vehicle_odometer_readings_head_idx
  on public.vehicle_odometer_readings (vehicle_id, series desc, km desc, recorded_at desc);

-- One series-start marker per series. Without it, two concurrent replacements
-- would both open "series 2" and the offset would depend on which row a reader
-- happened to see first.
create unique index vehicle_odometer_readings_series_start_idx
  on public.vehicle_odometer_readings (vehicle_id, series)
  where series_reason is not null;

-- One auto-filled reading per order. A completion that is replayed — a retried
-- write, a trigger firing twice — must not deposit the same reading twice.
create unique index vehicle_odometer_readings_one_per_order_idx
  on public.vehicle_odometer_readings (service_order_id)
  where service_order_id is not null;


-- ---------------------------------------------------------------------------
-- Append-only, enforced (§2.4)
-- ---------------------------------------------------------------------------
-- Same reasoning as vehicle_timeline (0009): a RULE with DO INSTEAD NOTHING
-- discards the write and reports success, which is the failure mode that hides
-- itself. This raises.
create or replace function public.odometer_reading_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'vehicle_odometer_readings is append-only (attempted % on row %)',
    tg_op, coalesce(old.id::text, '?')
    using errcode = 'restrict_violation',
          hint = 'A correction is a new reading through replace_odometer_cluster — see ADR-0022.';
end;
$$;

create trigger vehicle_odometer_readings_immutable
  before update or delete on public.vehicle_odometer_readings
  for each row execute function public.odometer_reading_immutable();

-- ENABLE ALWAYS, for 0009's reason: RLS does not apply to service_role, so a
-- leaked service key would otherwise be able to rewrite the series that every
-- prediction and every resale report is computed from.
alter table public.vehicle_odometer_readings
  enable always trigger vehicle_odometer_readings_immutable;


-- Inserts come only from the functions below. The series, the offset and the
-- monotonic rule are all business rules (§2.2), and a client INSERT policy
-- would let the client pick its own series and its own offset — which is the
-- same thing as letting it pick its own lifetime distance.
create or replace function public.guard_odometer_reading_writes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.is_privileged_write() then
    return new;
  end if;

  raise exception 'vehicle_odometer_readings is written only by its RPCs (0058)'
    using errcode = 'insufficient_privilege',
          hint = 'Use record_mileage or replace_odometer_cluster.';
end;
$$;

create trigger vehicle_odometer_readings_guard_writes
  before insert on public.vehicle_odometer_readings
  for each row execute function public.guard_odometer_reading_writes();

alter table public.vehicle_odometer_readings
  enable always trigger vehicle_odometer_readings_guard_writes;


-- ---------------------------------------------------------------------------
-- RLS — the current owner, and nobody else
-- ---------------------------------------------------------------------------
-- Keyed on vehicle_id and gated by owns_vehicle(), which reads
-- `vehicles.owner_id` as it is NOW. So the series follows the car through a
-- handover with no migration of rows and no transfer step, exactly as
-- `vehicle_warranties` does in 0055 — and it must, because a buyer reading
-- تقرير هبّة is buying the distance history as much as the service history.
alter table public.vehicle_odometer_readings enable row level security;

create policy vehicle_odometer_readings_read on public.vehicle_odometer_readings
  for select to authenticated
  using (public.owns_vehicle(vehicle_id) or public.is_ops());

-- No INSERT, UPDATE or DELETE policy. Deliberate, and asserted in
-- supabase/tests/16.


-- ---------------------------------------------------------------------------
-- odometer_head — the one definition of "where this car is"
-- ---------------------------------------------------------------------------
-- Highest reading of the highest series. Not the chronologically latest: a
-- technician's docket can be entered after a later owner reading, and ordering
-- by time would make the head walk backwards inside a series where the whole
-- invariant is that it cannot.
--
-- Not client-facing. Clients read the table directly under the policy above;
-- this exists for the RPCs, the auto-fill trigger and the sweep, all of which
-- run as SECURITY DEFINER and must not be gated by the caller's ownership.
create or replace function public.odometer_head(p_vehicle_id uuid)
returns table (
  reading_id       uuid,
  km               int,
  lifetime_km      int,
  recorded_at      timestamptz,
  series           int,
  series_offset_km int
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.km, r.series_offset_km + r.km, r.recorded_at, r.series, r.series_offset_km
  from public.vehicle_odometer_readings r
  where r.vehicle_id = p_vehicle_id
  order by r.series desc, r.km desc, r.recorded_at desc
  limit 1;
$$;

comment on function public.odometer_head(uuid) is
  'Highest reading of the highest series — the car''s current position and the '
  'value every append is checked against (ADR-0022).';

revoke all on function public.odometer_head(uuid) from public, anon, authenticated;


-- The number maintenance intervals are measured in. Falls back to
-- `vehicles.current_mileage` for a car with no readings yet, so a logbook that
-- predates 0058 is not treated as a car that has never moved.
create or replace function public.vehicle_lifetime_km(p_vehicle_id uuid)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select h.lifetime_km from public.odometer_head(p_vehicle_id) h),
    (select v.current_mileage from public.vehicles v where v.id = p_vehicle_id)
  );
$$;

comment on function public.vehicle_lifetime_km(uuid) is
  'Lifetime distance: series_offset_km + km at the head. Falls back to '
  'vehicles.current_mileage for a vehicle with no readings.';

revoke all on function public.vehicle_lifetime_km(uuid) from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- append_odometer_reading — the only insert
-- ---------------------------------------------------------------------------
-- Internal. Every caller has already decided the reading is allowed; this owns
-- the series arithmetic and the monotonic refusal, so no caller can get them
-- subtly different.
--
-- `p_strict = false` makes a refusal a NULL return rather than an exception,
-- for exactly one caller: the order-completion auto-fill. A technician's
-- docket that reads lower than the head is a data-quality problem worth
-- ignoring; it is not a reason to abort the transaction that is closing a paid
-- job with a customer standing next to it.
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

  perform public.begin_privileged_write();

  insert into public.vehicle_odometer_readings (
    vehicle_id, km, recorded_at, source, service_order_id,
    series, series_offset_km, note, created_by
  ) values (
    p_vehicle_id, p_km, p_recorded_at, p_source, p_order_id,
    coalesce(v_head.series, 1), coalesce(v_head.series_offset_km, 0),
    p_note, auth.uid()
  )
  returning id into v_id;

  perform public.end_privileged_write();

  return v_id;
end;
$$;

revoke all on function public.append_odometer_reading(
  uuid, int, odometer_source, uuid, timestamptz, text, boolean)
  from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- replace_odometer_cluster — the explicit way a reading may go down
-- ---------------------------------------------------------------------------
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
    -- Nothing to replace. A car with no readings starts its first series by
    -- having a reading recorded, not by declaring the cluster swapped — and
    -- allowing it here would mint a series 2 whose offset nothing supports.
    raise exception 'This car has no odometer readings yet'
      using errcode = 'no_data_found',
            hint = 'Record the current reading first.';
  end if;

  v_offset := case p_reason
    -- The old cluster's distance was travelled. Keep it.
    when 'cluster_replaced' then v_head.series_offset_km + v_head.km
    -- The old scale was wrong. It contributes nothing, and lifetime distance
    -- is allowed to fall — see the header.
    when 'correction'       then v_head.series_offset_km
  end;

  perform public.begin_privileged_write();

  insert into public.vehicle_odometer_readings (
    vehicle_id, km, recorded_at, source, series, series_offset_km,
    series_reason, note, created_by
  ) values (
    p_vehicle_id, p_km, now(), 'manual', v_head.series + 1, v_offset,
    p_reason, p_note, v_actor
  )
  returning id into v_id;

  perform public.end_privileged_write();

  -- §1: the logbook records what happened to the car. A replaced cluster is
  -- one of the most material facts a used-car buyer can be told, and burying
  -- it in a table nobody reads would be the dishonest version of recording it.
  -- No p_mileage: `append_vehicle_timeline_event` raises
  -- `vehicles.current_mileage` with greatest(), so passing the new low reading
  -- would do nothing, and passing anything else would be a claim about a
  -- distance this car has not travelled on this cluster.
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

comment on function public.replace_odometer_cluster(uuid, int, odometer_series_reason, text) is
  'Starts a new odometer series. The only path by which a reading may be lower '
  'than the one before it (ADR-0022). Owner only.';

grant execute on function public.replace_odometer_cluster(uuid, int, odometer_series_reason, text)
  to authenticated;


-- ---------------------------------------------------------------------------
-- record_mileage, rebuilt on the series
-- ---------------------------------------------------------------------------
-- 0015's version compared against `vehicles.current_mileage`, which
-- `append_vehicle_timeline_event` only ever raises. After a cluster
-- replacement that number is the OLD cluster's high-water mark, so every
-- honest reading from the new cluster would have been refused for being lower
-- than a reading this cluster has never shown — the screen would have become
-- permanently unusable on exactly the cars 0058 exists for.
--
-- So the comparison moves to the series head, and the same call now writes
-- both representations: the reading (what the prediction is computed from) and
-- the timeline event (what the owner and a buyer read). One call, so the two
-- cannot disagree — §1 and the "no second source of truth" rule.
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
  v_event   uuid;
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

  -- The head where there is one; the legacy high-water mark where there is
  -- not, so a car whose history predates this migration keeps its old floor.
  v_floor := coalesce(v_head.km, v_current);

  -- A reading below the floor is a typo or clocking. Rejected rather than
  -- accepted-and-hidden: an odometer that appears to go backwards on a resale
  -- report destroys the report's credibility, and silently dropping the value
  -- leaves the owner believing it saved.
  --
  -- Backdated readings stay a legitimate exception — recording that the car
  -- was at 40,000 km two years ago is normal when filling in history. Such a
  -- reading goes to the timeline, where it is history, and NOT to the series,
  -- where it would break the one invariant the series has.
  if p_mileage < v_floor and p_occurred_at > now() - interval '1 day' then
    raise exception 'Mileage % is lower than this car''s last reading of % km', p_mileage, v_floor
      using errcode = 'check_violation',
            hint = 'Check the reading. If you are recording an older reading, set its date. '
                   'If the instrument cluster was replaced, use replace_odometer_cluster.';
  end if;

  -- The timeline append FIRST, because it is what authorises this call: it
  -- refuses anyone who is neither the owner, nor ops, nor a provider holding a
  -- live order on the car (0010, widened in 0040). Writing the series before
  -- that check would be safe only by virtue of the rollback, which is a weaker
  -- thing to rely on than doing the check first.
  v_event := public.append_vehicle_timeline_event(
    p_vehicle_id  => p_vehicle_id,
    p_event_type  => 'mileage_recorded',
    p_summary_ar  => format('قراءة العداد: %s كم', p_mileage),
    p_summary_en  => format('Mileage reading: %s km', p_mileage),
    p_occurred_at => p_occurred_at,
    p_mileage     => p_mileage
  );

  -- Not strict: a backdated reading below the head is allowed above and must
  -- not abort here, it simply does not extend the series.
  perform public.append_odometer_reading(
    p_vehicle_id  => p_vehicle_id,
    p_km          => p_mileage,
    p_source      => 'manual',
    p_order_id    => null,
    p_recorded_at => p_occurred_at,
    p_note        => null,
    p_strict      => false
  );

  return v_event;
end;
$$;

comment on function public.record_mileage(uuid, int, timestamptz) is
  'Records one odometer reading: to the series (ADR-0022) and to the logbook. '
  'Rejects a reading below the series head unless it is explicitly backdated.';

grant execute on function public.record_mileage(uuid, int, timestamptz) to authenticated;
