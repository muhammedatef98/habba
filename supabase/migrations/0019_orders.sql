-- 0019 — Orders: one pipeline, three fulfilment modes
-- Build prompt §6.5.

create table public.orders (
  id                  uuid primary key default gen_random_uuid(),
  order_number        text not null unique,        -- HB-2026-000123
  customer_id         uuid not null references public.profiles(id) on delete restrict,

  -- Nullable by design: a pre-purchase inspection is an order against a car
  -- the customer does not own yet (Phase 5). The completion trigger handles
  -- this explicitly rather than failing on it — see ADR-0006.
  vehicle_id          uuid references public.vehicles(id) on delete restrict,
  service_id          uuid not null references public.services(id) on delete restrict,
  fulfilment_mode     fulfilment_mode not null,
  status              order_status not null default 'draft',
  provider_id         uuid references public.providers(id) on delete restrict,

  -- location
  service_location    extensions.geography(point, 4326),
  service_address_ar  text,
  workshop_id         uuid references public.workshops(provider_id) on delete restrict,

  -- scheduling
  scheduled_for       timestamptz,
  slot_id             uuid references public.appointment_slots(id) on delete restrict,

  -- triage
  problem_description text,
  triage_media        jsonb not null default '[]'::jsonb,
  mileage_at_order    int check (mileage_at_order is null or mileage_at_order >= 0),

  -- money (numeric, never float — CLAUDE.md §2.5)
  quoted_amount       numeric(12,2),
  parts_amount        numeric(12,2) not null default 0,
  labour_amount       numeric(12,2) not null default 0,
  vat_amount          numeric(12,2) not null default 0,
  vat_rate_applied    numeric(5,4),      -- snapshot; ADR-0007
  total_amount        numeric(12,2),
  payment_intent_id   text,
  escrow_status       escrow_status not null default 'none',

  -- warranty
  warranty_days       int check (warranty_days is null or warranty_days >= 0),
  warranty_expires_at timestamptz,
  parent_order_id     uuid references public.orders(id) on delete restrict,

  -- lifecycle
  completed_at        timestamptz,
  completed_by_timeout boolean not null default false,   -- ADR-0006 fraud signal
  cancelled_at        timestamptz,
  cancellation_reason text,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by          uuid references public.profiles(id),

  constraint orders_mode_location check (
    (fulfilment_mode in ('mobile_ondemand', 'mobile_scheduled') and service_location is not null)
    or (fulfilment_mode = 'workshop' and workshop_id is not null)
  ),

  -- ADR-0007: the printed lines must add up to the printed total, or ZATCA
  -- rejects the invoice. Enforced here so a rounding change fails at write
  -- time rather than in Phase 6.
  constraint orders_totals_reconcile check (
    total_amount is null
    or total_amount = parts_amount + labour_amount + vat_amount
  ),

  constraint orders_amounts_non_negative check (
    parts_amount >= 0 and labour_amount >= 0 and vat_amount >= 0
    and (quoted_amount is null or quoted_amount >= 0)
    and (total_amount is null or total_amount >= 0)
  ),

  -- A warranty re-service must not point at itself.
  constraint orders_parent_not_self check (parent_order_id is null or parent_order_id <> id)
);

create index orders_customer_idx on public.orders (customer_id, created_at desc);
create index orders_provider_idx on public.orders (provider_id, created_at desc)
  where provider_id is not null;
create index orders_vehicle_idx on public.orders (vehicle_id) where vehicle_id is not null;
create index orders_searching_gix on public.orders using gist (service_location)
  where status = 'searching';
create index orders_status_idx on public.orders (status);

create trigger orders_set_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();


-- Order numbers -------------------------------------------------------------
-- ADR-0006: gaps are acceptable and expected — a rolled-back transaction
-- consumes a sequence value. Gapless numbering would require serialising all
-- order creation, which is the wrong trade for this table. If gapless
-- numbering is ever required it belongs on zatca_invoices, which is
-- lower-volume and issued after the fact.
create sequence if not exists public.order_number_seq;

-- SECURITY DEFINER because a trigger runs as the CALLING user, and
-- `authenticated` has no USAGE on the sequence. Granting the sequence to
-- clients instead would let anyone burn order numbers at will.
--
-- Not caught by the .sql suites (they run as the owner) nor by the Phase 3
-- integration tests (they create orders through create_emergency_order, which
-- is already SECURITY DEFINER, so the trigger inherited that). It surfaced the
-- first time a client inserted into `orders` directly.
create or replace function public.assign_order_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.order_number is null then
    new.order_number := format(
      'HB-%s-%s',
      to_char(now(), 'YYYY'),
      lpad(nextval('public.order_number_seq')::text, 6, '0')
    );
  end if;
  return new;
end;
$$;

create trigger orders_assign_number
  before insert on public.orders
  for each row execute function public.assign_order_number();

alter table public.orders alter column order_number drop not null;


create table public.order_events (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references public.orders(id) on delete cascade,
  from_status order_status,
  to_status   order_status not null,
  actor_id    uuid references public.profiles(id) on delete set null,
  note        text,
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index order_events_order_idx on public.order_events (order_id, created_at);


create table public.order_parts (
  id                   uuid primary key default gen_random_uuid(),
  order_id             uuid not null references public.orders(id) on delete cascade,
  name_ar              text not null,
  part_number          text,
  is_oem               boolean not null default false,
  quantity             int not null default 1 check (quantity > 0),
  unit_price           numeric(12,2) not null check (unit_price >= 0),
  warranty_days        int check (warranty_days is null or warranty_days >= 0),
  approved_by_customer boolean not null default false,
  approved_at          timestamptz,
  created_at           timestamptz not null default now(),

  constraint order_parts_approval_consistent check (
    (approved_by_customer and approved_at is not null)
    or (not approved_by_customer and approved_at is null)
  )
);

create index order_parts_order_idx on public.order_parts (order_id);

comment on table public.order_parts is
  'Line-itemed parts with OEM flag and price, approved per line before work — build prompt §1 differentiator 6.';


create table public.ratings (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null unique references public.orders(id) on delete cascade,
  rater_id    uuid not null references public.profiles(id) on delete restrict,
  provider_id uuid not null references public.providers(id) on delete restrict,
  stars       int not null check (stars between 1 and 5),
  tags        text[],
  comment     text,
  created_at  timestamptz not null default now()
);

create index ratings_provider_idx on public.ratings (provider_id, created_at desc);
