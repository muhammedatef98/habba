-- 0005 — Profiles
-- Build prompt §6.1. Extends auth.users.

create table public.profiles (
  id               uuid primary key references auth.users(id) on delete cascade,
  role             user_role not null default 'customer',
  full_name        text not null,
  -- E.164, always +9665XXXXXXXX. Normalised by @habba/core parseSaudiPhone
  -- before it ever reaches here: profiles.phone is the login identity, so two
  -- spellings of one number must never become two accounts (ADR-0011).
  phone            text not null unique,
  phone_verified   boolean not null default false,
  email            text,
  avatar_url       text,
  preferred_locale text not null default 'ar',
  city_id          uuid references public.cities(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint profiles_phone_e164 check (phone ~ '^\+9665[0-9]{8}$'),
  constraint profiles_locale_supported check (preferred_locale in ('ar', 'en'))
);

create index profiles_city_idx on public.profiles (city_id);
create index profiles_role_idx on public.profiles (role);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

comment on column public.profiles.phone is
  'E.164 (+9665XXXXXXXX). Login identity — normalise with @habba/core before writing.';
