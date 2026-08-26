-- 0018 — Providers, their services, live location, and workshops
-- Build prompt §6.4.

create table public.providers (
  id                  uuid primary key default gen_random_uuid(),
  owner_profile_id    uuid not null references public.profiles(id) on delete restrict,
  provider_type       provider_type not null,

  business_name_ar    text not null,
  business_name_en    text,
  cr_number           text,     -- السجل التجاري (workshops)
  vat_number          text,     -- 15 digits, starts and ends with 3

  -- ⚠️ Build prompt §11: "Do not store national IDs or IBANs in plaintext."
  -- These columns hold CIPHERTEXT ONLY, written through Supabase Vault /
  -- pgsodium. They are named _encrypted so a plaintext write is visibly wrong
  -- in review, and the check constraint makes an obvious plaintext national ID
  -- or IBAN fail loudly rather than sit in the table.
  national_id_encrypted text,
  iban_encrypted        text,

  verification_status verification_status not null default 'pending',
  nafath_verified_at  timestamptz,

  rating_avg          numeric(3,2) not null default 0 check (rating_avg between 0 and 5),
  rating_count        int not null default 0 check (rating_count >= 0),
  jobs_completed      int not null default 0 check (jobs_completed >= 0),
  acceptance_rate     numeric(5,2) check (acceptance_rate is null or acceptance_rate between 0 and 100),

  is_online           boolean not null default false,
  city_id             uuid not null references public.cities(id),

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint providers_vat_format check (vat_number is null or vat_number ~ '^3[0-9]{13}3$'),

  -- A bare 10-digit string in national_id_encrypted means someone wrote
  -- plaintext. Same for a bare SA IBAN.
  constraint providers_national_id_not_plaintext check (
    national_id_encrypted is null or national_id_encrypted !~ '^[0-9]{10}$'
  ),
  constraint providers_iban_not_plaintext check (
    iban_encrypted is null or iban_encrypted !~ '^SA[0-9A-Z]{22}$'
  ),

  -- A workshop trades under a CR; an individual technician does not.
  constraint providers_workshop_has_cr check (
    provider_type <> 'workshop' or cr_number is not null
  )
);

create index providers_city_idx on public.providers (city_id, verification_status);
create index providers_online_idx on public.providers (is_online)
  where is_online and verification_status = 'approved';

create trigger providers_set_updated_at
  before update on public.providers
  for each row execute function public.set_updated_at();


create table public.provider_services (
  provider_id  uuid not null references public.providers(id) on delete cascade,
  service_id   uuid not null references public.services(id) on delete restrict,
  custom_price numeric(12,2),
  created_at   timestamptz not null default now(),
  primary key (provider_id, service_id)
);

-- Build prompt §11 again, enforced rather than assumed. The spec's schema
-- allows custom_price on any service, which silently contradicts its own rule
-- that emergency prices are fixed centrally. A provider quoting their own
-- roadside price is precisely the race to the bottom the product is avoiding.
create or replace function public.reject_custom_price_on_fixed_service()
returns trigger
language plpgsql
as $$
declare
  v_category service_category;
  v_fixed    boolean;
begin
  if new.custom_price is null then
    return new;
  end if;

  select s.category, s.price_is_fixed into v_category, v_fixed
  from public.services s where s.id = new.service_id;

  if v_category = 'emergency' or v_fixed then
    raise exception 'Providers cannot set their own price for % services', v_category
      using errcode = 'check_violation',
            hint = 'Emergency and fixed-price services are priced centrally.';
  end if;

  return new;
end;
$$;

create trigger provider_services_price_guard
  before insert or update on public.provider_services
  for each row execute function public.reject_custom_price_on_fixed_service();


-- Live location for on-demand matching.
create table public.provider_locations (
  provider_id uuid primary key references public.providers(id) on delete cascade,
  location    extensions.geography(point, 4326) not null,
  heading     numeric(5,2) check (heading is null or heading between 0 and 360),
  updated_at  timestamptz not null default now()
);

create index provider_locations_gix on public.provider_locations using gist (location);

comment on table public.provider_locations is
  'Broadcast only while is_online. Cleared on going offline — battery and privacy (§9.2).';


create table public.workshops (
  provider_id       uuid primary key references public.providers(id) on delete cascade,
  address_ar        text not null,
  location          extensions.geography(point, 4326) not null,
  bay_count         int not null default 1 check (bay_count > 0),
  service_radius_km int check (service_radius_km is null or service_radius_km > 0),
  opening_hours     jsonb not null,   -- {"sun": [["08:00","22:00"]], ...}
  photos            jsonb not null default '[]'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index workshops_gix on public.workshops using gist (location);

create trigger workshops_set_updated_at
  before update on public.workshops
  for each row execute function public.set_updated_at();


-- Appointment slots land here because orders.slot_id references them
-- (ADR-0002: dependency order, not spec order). The booking concurrency work
-- itself is Phase 4.
create table public.appointment_slots (
  id           uuid primary key default gen_random_uuid(),
  provider_id  uuid not null references public.providers(id) on delete cascade,
  starts_at    timestamptz not null,
  ends_at      timestamptz not null,
  capacity     int not null default 1 check (capacity > 0),
  booked_count int not null default 0 check (booked_count >= 0),
  is_blocked   boolean not null default false,
  created_at   timestamptz not null default now(),

  constraint appointment_slots_capacity_ok check (booked_count <= capacity),
  constraint appointment_slots_range_ok check (ends_at > starts_at)
);

create unique index appointment_slots_unique_idx
  on public.appointment_slots (provider_id, starts_at);
