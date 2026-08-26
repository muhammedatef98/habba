-- 0011 — Ownership transfers: the zero-CAC acquisition loop
-- Build prompt §6.2, CLAUDE.md §1 (moat reason 3).
--
-- The table lands in Phase 1 because it belongs to §6.2. The flow itself is
-- Phase 2 work.

create type ownership_transfer_status as enum ('pending', 'accepted', 'expired', 'cancelled');

create table public.ownership_transfers (
  id            uuid primary key default gen_random_uuid(),
  vehicle_id    uuid not null references public.vehicles(id) on delete restrict,
  from_owner_id uuid not null references public.profiles(id) on delete restrict,

  -- The recipient may not have a Habba account yet — that is the entire point
  -- of the loop, so this is a phone number rather than a profile reference.
  to_phone      text not null,
  to_owner_id   uuid references public.profiles(id) on delete set null,

  -- Free-text enum in the spec; typed here for consistency with the rest of
  -- the schema and so an invalid state cannot be written.
  status        ownership_transfer_status not null default 'pending',

  otp_code_hash text not null,
  expires_at    timestamptz not null,
  accepted_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references public.profiles(id),

  constraint ownership_transfers_to_phone_e164 check (to_phone ~ '^\+9665[0-9]{8}$'),
  constraint ownership_transfers_accepted_consistent check (
    (status = 'accepted' and accepted_at is not null and to_owner_id is not null)
    or (status <> 'accepted' and accepted_at is null)
  )
);

-- At most one live transfer per vehicle: two concurrent pending transfers
-- would race to reassign the same car.
create unique index ownership_transfers_one_pending_idx
  on public.ownership_transfers (vehicle_id) where status = 'pending';

create index ownership_transfers_to_phone_idx
  on public.ownership_transfers (to_phone) where status = 'pending';

create trigger ownership_transfers_set_updated_at
  before update on public.ownership_transfers
  for each row execute function public.set_updated_at();

comment on table public.ownership_transfers is
  'Vehicle handover to a new owner. The logbook travels with the car — CLAUDE.md §1.';
comment on column public.ownership_transfers.otp_code_hash is
  'Hashed OTP. The plaintext code is never stored.';
