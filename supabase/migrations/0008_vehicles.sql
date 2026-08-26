-- 0008 — Vehicles: THE CENTRE OF THE SCHEMA
-- Build prompt §6.2, CLAUDE.md §1.

create table public.vehicles (
  id                 uuid primary key default gen_random_uuid(),
  owner_id           uuid not null references public.profiles(id) on delete cascade,
  make_id            uuid not null references public.vehicle_makes(id) on delete restrict,
  model_id           uuid not null references public.vehicle_models(id) on delete restrict,

  -- The spec writes this as
  --   check (year between 1970 and extract(year from now())::int + 2)
  -- which Postgres rejects: CHECK constraints must be IMMUTABLE and now() is
  -- STABLE. The upper bound is genuinely time-dependent (a 2027 model year
  -- becomes valid during 2026), so it lives in a trigger instead. Hardcoding a
  -- constant would silently start rejecting valid cars. See ADR-0002.
  year               int not null check (year >= 1970),

  vin                text unique,     -- 17 chars; nullable, not every owner knows it
  plate_ar           text,            -- ا ب ح ١٢٣٤
  plate_en           text,            -- A B J 1234
  -- Server-computed search key. Never accepted from the client (CLAUDE.md §2.2).
  plate_normalised   text generated always as (
                       public.normalise_plate(coalesce(plate_en, plate_ar))
                     ) stored,

  colour             text,
  current_mileage    int not null default 0 check (current_mileage >= 0),
  mileage_updated_at timestamptz,
  nickname           text,            -- "سيارة الشغل"
  photo_url          text,
  is_active          boolean not null default true,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  created_by         uuid references public.profiles(id),   -- CLAUDE.md §2.6

  constraint vehicles_plate_or_vin check (vin is not null or plate_en is not null or plate_ar is not null),
  constraint vehicles_vin_format check (vin is null or vin ~ '^[A-HJ-NPR-Z0-9]{17}$')
);

-- VIN excludes I, O and Q by international standard, to avoid confusion with
-- 1 and 0. The regex above encodes that.

create index vehicles_owner_idx on public.vehicles (owner_id) where is_active;
create index vehicles_vin_idx on public.vehicles (vin) where vin is not null;
create index vehicles_plate_idx on public.vehicles (plate_normalised) where plate_normalised is not null;

create trigger vehicles_set_updated_at
  before update on public.vehicles
  for each row execute function public.set_updated_at();

-- Time-dependent upper bound on model year (see the note on `year` above).
create or replace function public.check_vehicle_year()
returns trigger
language plpgsql
as $$
declare
  max_year int := extract(year from now())::int + 2;
begin
  if new.year > max_year then
    raise exception 'Vehicle year % is beyond the maximum of %', new.year, max_year
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger vehicles_check_year
  before insert or update of year on public.vehicles
  for each row execute function public.check_vehicle_year();

-- A plate that was supplied but could not be parsed is a data-quality problem
-- we want to know about at write time, not discover when a customer cannot
-- find their car.
create or replace function public.check_vehicle_plate()
returns trigger
language plpgsql
as $$
begin
  if coalesce(new.plate_en, new.plate_ar) is not null and new.plate_normalised is null then
    raise exception 'Plate "%" could not be parsed', coalesce(new.plate_en, new.plate_ar)
      using errcode = 'check_violation',
            hint = 'Expected 1-3 plate letters and 1-4 digits, in Arabic or Latin script';
  end if;
  return new;
end;
$$;

create trigger vehicles_check_plate
  after insert or update of plate_en, plate_ar on public.vehicles
  for each row execute function public.check_vehicle_plate();

comment on table public.vehicles is
  'The centre of the schema (CLAUDE.md §1). Orders, inspections and payments are satellites that write to vehicle_timeline.';
