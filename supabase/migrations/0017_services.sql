-- 0017 — Service catalogue
-- Build prompt §6.3.

create table public.services (
  id               uuid primary key default gen_random_uuid(),
  category         service_category not null,
  name_ar          text not null,
  name_en          text not null,
  description_ar   text,
  icon             text not null,
  supported_modes  fulfilment_mode[] not null,

  base_price       numeric(12,2),          -- null = quote-only
  price_is_fixed   boolean not null default false,

  est_duration_min int not null check (est_duration_min > 0),
  requires_lift    boolean not null default false,   -- forces workshop mode
  requires_vehicle boolean not null default true,    -- false for pre-purchase inspection
  sort_order       int not null default 0,
  is_active        boolean not null default true,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint services_modes_not_empty check (array_length(supported_modes, 1) > 0),

  -- Build prompt §11: "Do not let providers set arbitrary prices for emergency
  -- services. Fix those prices centrally — trust at the roadside is
  -- everything." A fixed price is meaningless without a price, so the schema
  -- refuses the combination rather than trusting the seed to be careful.
  constraint services_fixed_price_has_amount check (
    not price_is_fixed or base_price is not null
  ),

  -- A service needing a lift cannot be delivered by a mobile technician.
  constraint services_lift_is_workshop check (
    not requires_lift or supported_modes = array['workshop']::fulfilment_mode[]
  )
);

create index services_category_idx on public.services (category, sort_order) where is_active;

create trigger services_set_updated_at
  before update on public.services
  for each row execute function public.set_updated_at();

-- Emergency pricing is central, not per-provider (§11). This is enforced in
-- provider_services below rather than left to application code.
comment on column public.services.price_is_fixed is
  'Fixed centrally. Emergency services must be fixed — see provider_services price guard.';
