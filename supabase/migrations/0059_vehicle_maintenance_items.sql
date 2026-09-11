-- 0059 — What this car is due for
--
-- 0028 already predicts maintenance, and this is not a replacement for it. The
-- two answer different questions and the distinction is worth stating once,
-- here, so the next person does not merge them:
--
--   * `maintenance_rules` + `maintenance_alerts` (0028/0029) are the
--     CATALOGUE's opinion about a class of car. Rules are keyed on make and
--     model, ops tunes them, and the scan extrapolates a drive rate to guess
--     where the odometer is today. It is a marketing surface: it tells a car we
--     have barely met that something is probably due.
--   * `vehicle_maintenance_items` is THIS CAR's schedule. One row per item per
--     vehicle, with the interval the owner is actually on and the date and
--     distance the item was last actually done — from a Habba job where there
--     was one, from what the owner told us where there was not.
--
-- The second is the one دفتر السيارة is for, and it is the one that survives a
-- handover: a buyer inherits "the oil was done at 84,300 km on 14 Feb", which
-- is a fact about the car, and not "cars like this one usually need oil", which
-- is a fact about the catalogue.
--
-- ---------------------------------------------------------------------------
-- Due on either axis
-- ---------------------------------------------------------------------------
-- An item is due when EITHER its distance interval or its time interval is
-- met. Not both. A car that sits at Riyadh airport for eleven months has
-- travelled 400 km and still needs its oil changed — oil degrades on a
-- calendar, not on an odometer.
--
-- The two axes are not equally knowable, and ADR-0022 turns that into a rule
-- about copy rather than leaving it to whoever writes the screen. The database
-- therefore reports them separately: `due_by_km` and `due_by_date` are distinct
-- booleans, and `km_is_estimated` says out loud that the distance axis rests on
-- a reading that may be weeks old.
--
-- ---------------------------------------------------------------------------
-- item_type is text against a catalogue, not an enum
-- ---------------------------------------------------------------------------
-- Brakes, tyres, battery and belts are explicitly out of this slice. They must
-- arrive as DATA, not as a migration — an enum would make every new item a
-- schema change, an ops deploy and a release. The catalogue table below is the
-- extension point: a new item is an INSERT, and everything in this file, the
-- sweep in 0061 and the screens all pick it up with no code change.
--
-- Only oil and the oil filter are seeded (supabase/seed/04_vehicle_care.sql).

-- ---------------------------------------------------------------------------
-- The catalogue
-- ---------------------------------------------------------------------------
create table public.maintenance_item_types (
  item_type      text primary key check (item_type ~ '^[a-z][a-z0-9_]{1,38}[a-z0-9]$'),

  name_ar        text not null,
  name_en        text not null,

  -- What booking this item books. Nullable because `services` is seeded and
  -- this table is created by a migration — migrations run first, so the link
  -- is made in the seed, and a project with no service catalogue still has a
  -- working schedule (it simply cannot offer «احجز الآن» for that item).
  service_id     uuid references public.services(id) on delete set null,

  -- The starting point for a vehicle's own item. The owner's row may diverge
  -- from these and is never overwritten by them.
  default_interval_km     int check (default_interval_km is null or default_interval_km > 0),
  default_interval_months int check (default_interval_months is null or default_interval_months > 0),

  sort_order     int not null default 100,
  is_active      boolean not null default true,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  -- An item with neither interval can never be due, so it is not an item.
  constraint maintenance_item_types_has_interval check (
    default_interval_km is not null or default_interval_months is not null
  )
);

comment on table public.maintenance_item_types is
  'The extension point for the care section (ADR-0022). Brakes, tyres, battery '
  'and belts arrive here as rows, never as a migration.';

create trigger maintenance_item_types_set_updated_at
  before update on public.maintenance_item_types
  for each row execute function public.set_updated_at();


-- ---------------------------------------------------------------------------
-- The vehicle's own schedule
-- ---------------------------------------------------------------------------
create table public.vehicle_maintenance_items (
  id                 uuid primary key default gen_random_uuid(),
  vehicle_id         uuid not null references public.vehicles(id) on delete cascade,
  item_type          text not null references public.maintenance_item_types(item_type)
                       on delete restrict,

  interval_km        int check (interval_km is null or interval_km > 0),
  interval_months    int check (interval_months is null or interval_months > 0),

  -- LIFETIME km (0058), not the cluster reading. The distinction is invisible
  -- on the overwhelming majority of cars, where the two are equal, and it is
  -- the whole correctness of the feature on a car whose cluster was replaced.
  last_done_km       int check (last_done_km is null or last_done_km >= 0),
  last_done_at       timestamptz,
  last_done_order_id uuid references public.orders(id) on delete set null,

  snoozed_until      timestamptz,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  created_by         uuid references public.profiles(id),

  -- One row per item per vehicle. The sentence in the spec, as a constraint.
  constraint vehicle_maintenance_items_one_per_vehicle unique (vehicle_id, item_type),

  constraint vehicle_maintenance_items_has_interval check (
    interval_km is not null or interval_months is not null
  ),

  -- An item that has been done has a date or a distance to say when. Both null
  -- is the cold-start state and is allowed; it simply is not due yet.
  constraint vehicle_maintenance_items_done_order_needs_when check (
    last_done_order_id is null or last_done_km is not null or last_done_at is not null
  )
);

comment on column public.vehicle_maintenance_items.last_done_km is
  'Lifetime km at the last service (0058: series_offset_km + km), NOT the '
  'cluster reading.';

comment on column public.vehicle_maintenance_items.snoozed_until is
  'Suppresses this item from the daily sweep (0061). Cleared when the item is '
  'actually done.';

create index vehicle_maintenance_items_vehicle_idx
  on public.vehicle_maintenance_items (vehicle_id);

create trigger vehicle_maintenance_items_set_updated_at
  before update on public.vehicle_maintenance_items
  for each row execute function public.set_updated_at();


-- ---------------------------------------------------------------------------
-- RLS — the current owner, and it travels with the car
-- ---------------------------------------------------------------------------
-- Same construction as 0058 and as `vehicle_warranties` in 0055: the gate is
-- `owns_vehicle()`, which reads `vehicles.owner_id` as it is now. A handover
-- moves one column on one row and the whole schedule moves with it.
--
-- This is not incidental. A buyer who inherits "oil last done at 84,300 km,
-- next due at 91,300" has inherited the single most useful thing the app can
-- tell them about the car they have just bought, and §1.3 rests the acquisition
-- story on precisely that.
alter table public.maintenance_item_types enable row level security;
alter table public.vehicle_maintenance_items enable row level security;

create policy maintenance_item_types_read on public.maintenance_item_types
  for select to anon, authenticated using (is_active or public.is_ops());
create policy maintenance_item_types_write on public.maintenance_item_types
  for all to authenticated using (public.is_ops()) with check (public.is_ops());

create policy vehicle_maintenance_items_read on public.vehicle_maintenance_items
  for select to authenticated
  using (public.owns_vehicle(vehicle_id) or public.is_ops());

-- The owner may write their own schedule, and every column on the row is
-- theirs to set: an interval they prefer, a date they remember, a snooze.
--
-- Nothing here is a trust surface. It drives the owner's own reminders and
-- nothing else — no money, no dispatch, no provenance, and no line on تقرير
-- هبّة, which is computed from the timeline and never from this table. That is
-- the reason there is no column guard, and it is a decision rather than an
-- omission: supabase/tests/16 records it.
create policy vehicle_maintenance_items_insert on public.vehicle_maintenance_items
  for insert to authenticated with check (public.owns_vehicle(vehicle_id));
create policy vehicle_maintenance_items_update on public.vehicle_maintenance_items
  for update to authenticated
  using (public.owns_vehicle(vehicle_id)) with check (public.owns_vehicle(vehicle_id));
create policy vehicle_maintenance_items_delete on public.vehicle_maintenance_items
  for delete to authenticated using (public.owns_vehicle(vehicle_id));


-- ---------------------------------------------------------------------------
-- The lead window
-- ---------------------------------------------------------------------------
-- A reminder that arrives the morning an item falls due is a reminder about
-- something already late. Same windows 0029 uses, as functions for the same
-- reason: the tests assert against the source the code reads.
create or replace function public.care_lead_km() returns int
language sql immutable as $$ select 500 $$;

create or replace function public.care_lead_days() returns int
language sql immutable as $$ select 14 $$;


-- ---------------------------------------------------------------------------
-- maintenance_item_status — the arithmetic, once
-- ---------------------------------------------------------------------------
-- UNGATED and internal. The daily sweep (0062) runs as a scheduled job with no
-- `auth.uid()` at all, so it cannot go through an owner-gated function — and
-- the alternative, a second copy of the due arithmetic inside the sweep, is how
-- the screen and the notification end up disagreeing about whether a car needs
-- an oil change. One definition, two callers, one of them gated.
--
-- It returns the two axes separately and refuses to collapse them. A caller
-- that wants one boolean can take `is_due`; a caller rendering copy must not,
-- because ADR-0022 forbids stating a km-based item with the certainty a
-- date-based one deserves.
-- A named composite rather than two `returns table` lists. The gated wrapper
-- below has to return exactly this shape, and a repeated column list is a
-- shape that drifts silently — the mismatch would surface as a runtime error
-- on a screen, not as a failed migration.
create type maintenance_item_view as (
  item_id          uuid,
  item_type        text,
  name_ar          text,
  name_en          text,
  service_id       uuid,

  interval_km      int,
  interval_months  int,
  last_done_km     int,
  last_done_at     timestamptz,

  due_at_km        int,
  due_at_date      date,
  km_remaining     int,
  days_remaining   int,

  due_by_km        boolean,
  due_by_date      boolean,
  is_due           boolean,
  is_approaching   boolean,
  km_is_estimated  boolean,

  snoozed_until    timestamptz,
  last_reading_at  timestamptz
);

create or replace function public.maintenance_item_status(p_vehicle_id uuid)
returns setof public.maintenance_item_view
language sql
stable
security definer
set search_path = ''
as $$
  with head as (
    select h.km, h.lifetime_km, h.recorded_at
    from public.odometer_head(p_vehicle_id) h
  ),
  now_km as (
    select coalesce(
      (select lifetime_km from head),
      (select v.current_mileage from public.vehicles v where v.id = p_vehicle_id)
    ) as lifetime_km
  ),
  computed as (
    select
      i.id,
      i.item_type,
      t.name_ar,
      t.name_en,
      t.service_id,
      i.interval_km,
      i.interval_months,
      i.last_done_km,
      i.last_done_at,
      case when i.interval_km is not null and i.last_done_km is not null
        then i.last_done_km + i.interval_km end as due_at_km,
      case when i.interval_months is not null and i.last_done_at is not null
        then (i.last_done_at + make_interval(months => i.interval_months))::date end as due_at_date,
      i.snoozed_until,
      (select recorded_at from head) as last_reading_at,
      -- True whenever the distance axis is in play at all. There is no reading
      -- between readings; the app cannot see the odometer, and every sentence
      -- it writes about distance has to be hedged accordingly (ADR-0022).
      (i.interval_km is not null) as km_is_estimated
    from public.vehicle_maintenance_items i
    join public.maintenance_item_types t on t.item_type = i.item_type
    where i.vehicle_id = p_vehicle_id
      and t.is_active
  )
  select
    c.id, c.item_type, c.name_ar, c.name_en, c.service_id,
    c.interval_km, c.interval_months, c.last_done_km, c.last_done_at,
    c.due_at_km, c.due_at_date,
    case when c.due_at_km is null then null
      else c.due_at_km - (select lifetime_km from now_km) end,
    case when c.due_at_date is null then null
      else c.due_at_date - current_date end,
    coalesce(c.due_at_km is not null
      and (select lifetime_km from now_km) >= c.due_at_km, false),
    coalesce(c.due_at_date is not null and current_date >= c.due_at_date, false),
    coalesce(
      (c.due_at_km is not null and (select lifetime_km from now_km) >= c.due_at_km)
      or (c.due_at_date is not null and current_date >= c.due_at_date), false),
    coalesce(
      (c.due_at_km is not null
        and c.due_at_km - (select lifetime_km from now_km) <= public.care_lead_km())
      or (c.due_at_date is not null
        and c.due_at_date - current_date <= public.care_lead_days()), false),
    c.km_is_estimated,
    c.snoozed_until,
    c.last_reading_at
  from computed c
  order by
    -- Overdue first, then approaching, then everything else by name. The
    -- ordering is part of the answer: the screen renders this list as it comes.
    coalesce(
      (c.due_at_km is not null and (select lifetime_km from now_km) >= c.due_at_km)
      or (c.due_at_date is not null and current_date >= c.due_at_date), false) desc,
    least(
      coalesce(c.due_at_date - current_date, 9999),
      coalesce((c.due_at_km - (select lifetime_km from now_km)) / 50, 9999)
    ),
    c.name_en;
$$;

comment on function public.maintenance_item_status(uuid) is
  'Due arithmetic for one vehicle''s tracked items, both axes reported '
  'separately (ADR-0022). Ungated — the sweep has no auth.uid(). Internal.';

revoke all on function public.maintenance_item_status(uuid)
  from public, anon, authenticated;


-- The client's door onto the same rows. The gate is here rather than inherited
-- from the policies above, because SECURITY DEFINER reaches past them.
create or replace function public.vehicle_maintenance_status(p_vehicle_id uuid)
returns setof public.maintenance_item_view
language sql
stable
security definer
set search_path = ''
as $$
  select s.*
  from public.maintenance_item_status(p_vehicle_id) s
  where public.owns_vehicle(p_vehicle_id) or public.is_ops();
$$;

comment on function public.vehicle_maintenance_status(uuid) is
  'The القادم section for a car, for its current owner (ADR-0022).';

grant execute on function public.vehicle_maintenance_status(uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- ensure_maintenance_item — the row, created on demand
-- ---------------------------------------------------------------------------
-- Internal. Both the cold start and the auto-fill need "the row for this item
-- on this car, creating it from the catalogue defaults if it is not there",
-- and neither should own that decision.
create or replace function public.ensure_maintenance_item(
  p_vehicle_id uuid,
  p_item_type  text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id   uuid;
  v_type record;
begin
  select * into v_type
  from public.maintenance_item_types t
  where t.item_type = p_item_type and t.is_active;

  if v_type is null then
    return null;
  end if;

  select i.id into v_id
  from public.vehicle_maintenance_items i
  where i.vehicle_id = p_vehicle_id and i.item_type = p_item_type;

  if v_id is not null then
    return v_id;
  end if;

  insert into public.vehicle_maintenance_items (
    vehicle_id, item_type, interval_km, interval_months, created_by
  ) values (
    p_vehicle_id, p_item_type,
    v_type.default_interval_km, v_type.default_interval_months,
    auth.uid()
  )
  -- Two completions closing in the same instant, or a cold start racing an
  -- auto-fill. The unique constraint is the arbiter; this makes the loser
  -- return the winner's row rather than fail.
  on conflict (vehicle_id, item_type) do update set updated_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.ensure_maintenance_item(uuid, text)
  from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- The three things an owner does to an item
-- ---------------------------------------------------------------------------
-- «تم» — the item was done, outside Habba or before it. Recorded from where
-- the car is now, because that is the only distance the owner can be sure of.
create or replace function public.mark_maintenance_item_done(
  p_item_id uuid,
  p_done_km int default null,
  p_done_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item record;
  v_km   int;
begin
  select * into v_item
  from public.vehicle_maintenance_items i where i.id = p_item_id;

  if v_item is null or not public.owns_vehicle(v_item.vehicle_id) then
    raise exception 'Item not found' using errcode = 'no_data_found';
  end if;

  v_km := coalesce(p_done_km, public.vehicle_lifetime_km(v_item.vehicle_id));

  update public.vehicle_maintenance_items
  set last_done_km = v_km,
      last_done_at = coalesce(p_done_at, now()),
      -- Done by hand, so it belongs to no order. Clearing this rather than
      -- leaving the previous job attached: the row would otherwise claim a
      -- Habba provider did work we have no evidence for.
      last_done_order_id = null,
      -- A snooze is a request to be asked again later about something that is
      -- due. Once it is done, there is nothing left to be asked about.
      snoozed_until = null
  where id = p_item_id;
end;
$$;

grant execute on function public.mark_maintenance_item_done(uuid, int, timestamptz) to authenticated;


-- «ذكّرني لاحقًا».
create or replace function public.snooze_maintenance_item(
  p_item_id uuid,
  p_days    int default 14
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item  record;
  v_until timestamptz;
begin
  select * into v_item
  from public.vehicle_maintenance_items i where i.id = p_item_id;

  if v_item is null or not public.owns_vehicle(v_item.vehicle_id) then
    raise exception 'Item not found' using errcode = 'no_data_found';
  end if;

  if p_days is null or p_days < 1 or p_days > 365 then
    raise exception 'A snooze is between 1 and 365 days' using errcode = 'check_violation';
  end if;

  v_until := now() + make_interval(days => p_days);

  update public.vehicle_maintenance_items
  set snoozed_until = v_until
  where id = p_item_id;

  return v_until;
end;
$$;

grant execute on function public.snooze_maintenance_item(uuid, int) to authenticated;


-- ---------------------------------------------------------------------------
-- start_vehicle_care — the cold start, in one call
-- ---------------------------------------------------------------------------
-- Two questions and no more. Anything longer is a form between a new user and
-- the first useful thing the app ever tells them, and it is answered by
-- closing the app.
--
-- The oil FILTER is seeded from the same answer as the oil, without being
-- asked about, because in this market they are one job: «تغيير زيت وفلتر» is a
-- single line on every invoice in the country. Asking twice would be asking a
-- question whose answer we already have.
create or replace function public.start_vehicle_care(
  p_vehicle_id   uuid,
  p_odometer_km  int default null,
  p_last_oil_km  int default null,
  p_last_oil_at  timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type      record;
  v_item_id   uuid;
  v_lifetime  int;
  v_offset    int;
begin
  if not public.owns_vehicle(p_vehicle_id) then
    raise exception 'Vehicle % is not yours', p_vehicle_id
      using errcode = 'insufficient_privilege';
  end if;

  -- Question 1. Goes through record_mileage so it lands in the series AND in
  -- the logbook, the same as any other reading — a baseline that existed only
  -- in one of the two would be the second source of truth this slice exists to
  -- avoid.
  if p_odometer_km is not null and p_odometer_km > 0 then
    perform public.record_mileage(p_vehicle_id, p_odometer_km);
  end if;

  -- The owner types what the dashboard said when the oil was last done: a
  -- CLUSTER reading. Items are stored in lifetime km, so it is converted
  -- through the current series' offset. On a car that has never had its
  -- cluster replaced the offset is 0 and this is a no-op.
  select coalesce(h.series_offset_km, 0) into v_offset
  from public.odometer_head(p_vehicle_id) h;
  v_offset := coalesce(v_offset, 0);

  v_lifetime := case
    when p_last_oil_km is null then null
    else v_offset + p_last_oil_km
  end;

  -- Question 2, applied to both halves of the one job.
  for v_type in
    select t.item_type from public.maintenance_item_types t
    where t.is_active and t.item_type in ('engine_oil', 'oil_filter')
  loop
    v_item_id := public.ensure_maintenance_item(p_vehicle_id, v_type.item_type);
    if v_item_id is null then
      continue;
    end if;

    -- `coalesce` rather than an overwrite: a car that already has real history
    -- — a Habba job, or a second pass through this screen — must not have it
    -- replaced by an approximation.
    update public.vehicle_maintenance_items
    set last_done_km = coalesce(last_done_km, v_lifetime),
        last_done_at = coalesce(last_done_at, p_last_oil_at)
    where id = v_item_id;
  end loop;
end;
$$;

comment on function public.start_vehicle_care(uuid, int, int, timestamptz) is
  'The two questions asked when a car is added: where the odometer is, and when '
  'the oil was last changed. Approximate answers are expected (ADR-0022).';

grant execute on function public.start_vehicle_care(uuid, int, int, timestamptz) to authenticated;
