-- 0028 — Predictive maintenance
--
-- Build prompt §7.2. This is what converts one-off emergency users into
-- recurring customers, and it only works because Phase 2 made mileage capture
-- a habit before there was anything to predict from.
--
-- Two product rules from the spec drive the design:
--   * rules live in a table so ops can tune them without a deploy
--   * never more than one alert per vehicle per week — "alert fatigue kills
--     this feature"

create type maintenance_confidence as enum ('generic', 'oem');

create table public.maintenance_rules (
  id           uuid primary key default gen_random_uuid(),
  service_id   uuid not null references public.services(id) on delete restrict,

  -- Null make/model = a generic rule applying to every car. A rule naming a
  -- make (and optionally a model) overrides the generic one for those cars.
  make_id      uuid references public.vehicle_makes(id) on delete cascade,
  model_id     uuid references public.vehicle_models(id) on delete cascade,

  name_ar      text not null,
  name_en      text not null,

  due_every_km     int check (due_every_km is null or due_every_km > 0),
  due_every_months int check (due_every_months is null or due_every_months > 0),
  -- First occurrence, where it differs from the interval (a timing belt at
  -- 90,000 km then every 90,000).
  first_due_km     int check (first_due_km is null or first_due_km > 0),

  -- The spec is explicit that a generic interval must not masquerade as
  -- manufacturer guidance. It changes what the alert is allowed to claim.
  confidence   maintenance_confidence not null default 'generic',

  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  -- A rule with neither a distance nor a time interval can never fire.
  constraint maintenance_rules_has_interval check (
    due_every_km is not null or due_every_months is not null
  ),
  -- A model-specific rule must name the make it belongs to.
  constraint maintenance_rules_model_needs_make check (
    model_id is null or make_id is not null
  )
);

create index maintenance_rules_lookup_idx
  on public.maintenance_rules (make_id, model_id) where is_active;

create trigger maintenance_rules_set_updated_at
  before update on public.maintenance_rules
  for each row execute function public.set_updated_at();


create type alert_status as enum ('open', 'dismissed', 'converted', 'superseded');

create table public.maintenance_alerts (
  id           uuid primary key default gen_random_uuid(),
  vehicle_id   uuid not null references public.vehicles(id) on delete cascade,
  rule_id      uuid not null references public.maintenance_rules(id) on delete cascade,
  service_id   uuid not null references public.services(id) on delete restrict,

  -- What the alert is claiming, kept so the message can be reconstructed
  -- exactly as the owner saw it.
  due_at_km    int,
  due_at_date  date,
  estimated_km int,
  confidence   maintenance_confidence not null,

  message_ar   text not null,
  message_en   text not null,

  status       alert_status not null default 'open',
  order_id     uuid references public.orders(id) on delete set null,
  dismissed_at timestamptz,
  created_at   timestamptz not null default now()
);

create index maintenance_alerts_vehicle_idx
  on public.maintenance_alerts (vehicle_id, created_at desc);
-- One open alert per rule per vehicle. Without this a daily cron re-raises the
-- same alert every morning until the owner acts.
create unique index maintenance_alerts_one_open_idx
  on public.maintenance_alerts (vehicle_id, rule_id) where status = 'open';


-- ---------------------------------------------------------------------------
-- Mileage estimation
-- ---------------------------------------------------------------------------
-- Build prompt §7.2:
--   daily_rate = (latest - previous) / days_between
--   estimated_now = latest + daily_rate * days_since
--
-- Refined in two ways the spec does not spell out but the data demands:
--   * the rate comes from the FIRST and LAST readings, not the last two. Two
--     readings a day apart produce a wild rate that then extrapolates for
--     months.
--   * the rate is clamped. A Saudi car doing more than 500 km/day sustained is
--     a data-entry error, and an unclamped rate generates alerts for services
--     that are years away.
create or replace function public.estimate_current_mileage(p_vehicle_id uuid)
returns int
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_first    record;
  v_last     record;
  v_days     numeric;
  v_rate     numeric;
  v_since    numeric;
begin
  select t.mileage, t.occurred_at into v_first
  from public.vehicle_timeline t
  where t.vehicle_id = p_vehicle_id and t.mileage is not null
  order by t.occurred_at asc
  limit 1;

  -- Anchor on the HIGHEST reading, not the chronologically last.
  --
  -- Odometers do not go backwards, but readings do arrive out of order: a
  -- technician records 62,000 from a service docket today for a car that read
  -- 84,000 last month, or an owner backfills old history. Anchoring on the
  -- latest row makes the estimate collapse to that lower number and the car
  -- silently stops being alerted about anything.
  select t.mileage, t.occurred_at into v_last
  from public.vehicle_timeline t
  where t.vehicle_id = p_vehicle_id and t.mileage is not null
  order by t.mileage desc, t.occurred_at desc, t.seq desc
  limit 1;

  if v_last is null then
    -- Nothing recorded: fall back to whatever the vehicle row says.
    return (select v.current_mileage from public.vehicles v where v.id = p_vehicle_id);
  end if;

  v_days := greatest(1, extract(epoch from (v_last.occurred_at - v_first.occurred_at)) / 86400.0);

  if v_last.mileage <= v_first.mileage or v_days < 14 then
    -- Too little history to extrapolate honestly. Guessing from a single
    -- fortnight produces alerts the owner cannot make sense of.
    return v_last.mileage;
  end if;

  v_rate := (v_last.mileage - v_first.mileage) / v_days;
  v_rate := least(v_rate, 500);   -- sanity clamp

  v_since := greatest(0, extract(epoch from (now() - v_last.occurred_at)) / 86400.0);

  return (v_last.mileage + (v_rate * v_since))::int;
end;
$$;


-- The most recent time a rule's service was actually performed.
--
-- The distance and the date come from potentially DIFFERENT rows: a service
-- can be recorded without an odometer reading, and taking both from the same
-- "latest" row then yields a null distance and no distance-based alert. Two
-- services can also share a timestamp, so `seq` breaks the tie — the same
-- insertion-order anchor the hash chain uses (ADR-0004).
create or replace function public.last_service_for_rule(p_vehicle_id uuid, p_service_id uuid)
returns table (last_km int, last_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  with performed as (
    select t.mileage, t.occurred_at, t.seq
    from public.vehicle_timeline t
    join public.orders o on o.id = t.order_id
    where t.vehicle_id = p_vehicle_id
      and o.service_id = p_service_id
      and t.event_type in ('service_completed', 'parts_replaced')
  )
  select
    (select p.mileage from performed p
     where p.mileage is not null
     order by p.occurred_at desc, p.seq desc limit 1),
    (select p.occurred_at from performed p
     order by p.occurred_at desc, p.seq desc limit 1)
  where exists (select 1 from performed);
$$;

grant execute on function public.estimate_current_mileage(uuid) to authenticated;
grant execute on function public.last_service_for_rule(uuid, uuid) to authenticated;

alter table public.maintenance_rules enable row level security;
alter table public.maintenance_alerts enable row level security;

create policy maintenance_rules_read on public.maintenance_rules
  for select to authenticated using (is_active or public.is_ops());
create policy maintenance_rules_write on public.maintenance_rules
  for all to authenticated using (public.is_ops()) with check (public.is_ops());

create policy maintenance_alerts_read on public.maintenance_alerts
  for select to authenticated
  using (public.owns_vehicle(vehicle_id) or public.is_ops());
create policy maintenance_alerts_update on public.maintenance_alerts
  for update to authenticated
  using (public.owns_vehicle(vehicle_id))
  with check (public.owns_vehicle(vehicle_id));
-- No INSERT policy: alerts come from the scan, not from clients.
