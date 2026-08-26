-- 0006 — Vehicle makes and models
-- Build prompt §6.2.

create table public.vehicle_makes (
  id         uuid primary key default gen_random_uuid(),
  name_ar    text not null,          -- تويوتا
  name_en    text not null,          -- Toyota
  logo_url   text,
  sort_order int  not null default 0,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index vehicle_makes_name_en_idx on public.vehicle_makes (lower(name_en));

create table public.vehicle_models (
  id         uuid primary key default gen_random_uuid(),
  make_id    uuid not null references public.vehicle_makes(id) on delete restrict,
  name_ar    text not null,          -- كامري
  name_en    text not null,          -- Camry
  year_from  int  not null,
  year_to    int,
  body_type  text,                   -- sedan | suv | pickup | van
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint vehicle_models_year_range check (year_to is null or year_to >= year_from),
  constraint vehicle_models_year_from_sane check (year_from between 1900 and 2200),
  constraint vehicle_models_body_type check (
    body_type is null or body_type in ('sedan', 'suv', 'pickup', 'van', 'coupe', 'hatchback')
  )
);

create index vehicle_models_make_idx on public.vehicle_models (make_id) where is_active;
create unique index vehicle_models_unique_idx
  on public.vehicle_models (make_id, lower(name_en), year_from);

create trigger vehicle_makes_set_updated_at
  before update on public.vehicle_makes
  for each row execute function public.set_updated_at();

create trigger vehicle_models_set_updated_at
  before update on public.vehicle_models
  for each row execute function public.set_updated_at();
