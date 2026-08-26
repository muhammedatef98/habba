-- 0004 — Cities
-- Build prompt §6.1. Created before profiles because profiles.city_id
-- references it (ADR-0002: the spec's section order is not a valid migration
-- order).

create table public.cities (
  id         uuid primary key default gen_random_uuid(),
  name_ar    text not null,
  name_en    text not null,
  region_ar  text not null,
  region_en  text not null,
  centroid   extensions.geography(point, 4326) not null,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index cities_active_idx on public.cities (is_active) where is_active;
create index cities_centroid_idx on public.cities using gist (centroid);

create trigger cities_set_updated_at
  before update on public.cities
  for each row execute function public.set_updated_at();

comment on table public.cities is 'Saudi cities. Launch scope: Eastern Province + Riyadh (CLAUDE.md §0).';
