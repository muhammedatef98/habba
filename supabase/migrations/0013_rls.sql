-- 0013 — Row Level Security: default deny on every table
-- CLAUDE.md §2.3, build prompt §6.9.
--
-- RLS is enabled here rather than alongside each CREATE TABLE so the fail-closed
-- window is explicit and reviewable in one place (ADR-0002).

-- Helper: is the caller an operator? Kept SECURITY DEFINER because policies on
-- `profiles` would otherwise recurse when a policy needs to read the role.
create or replace function public.is_ops()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('ops', 'super_admin')
  );
$$;

create or replace function public.owns_vehicle(p_vehicle_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.vehicles v
    where v.id = p_vehicle_id and v.owner_id = auth.uid()
  );
$$;


-- ---------------------------------------------------------------------------
alter table public.cities              enable row level security;
alter table public.vehicle_makes       enable row level security;
alter table public.vehicle_models      enable row level security;
alter table public.vat_rates           enable row level security;
alter table public.profiles            enable row level security;
alter table public.vehicles            enable row level security;
alter table public.vehicle_timeline    enable row level security;
alter table public.ownership_transfers enable row level security;


-- Reference data: world-readable, ops-writable. A customer picking their car
-- needs the catalogue before they have a profile.
create policy cities_read on public.cities
  for select to anon, authenticated using (true);
create policy cities_write on public.cities
  for all to authenticated using (public.is_ops()) with check (public.is_ops());

create policy vehicle_makes_read on public.vehicle_makes
  for select to anon, authenticated using (true);
create policy vehicle_makes_write on public.vehicle_makes
  for all to authenticated using (public.is_ops()) with check (public.is_ops());

create policy vehicle_models_read on public.vehicle_models
  for select to anon, authenticated using (true);
create policy vehicle_models_write on public.vehicle_models
  for all to authenticated using (public.is_ops()) with check (public.is_ops());

create policy vat_rates_read on public.vat_rates
  for select to anon, authenticated using (true);


-- Profiles: a user sees and edits only their own row; ops sees all.
create policy profiles_read_own on public.profiles
  for select to authenticated using (id = auth.uid() or public.is_ops());
create policy profiles_insert_own on public.profiles
  for insert to authenticated with check (id = auth.uid());
create policy profiles_update_own on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
-- No DELETE policy: profile removal is an erasure workflow, not a user action
-- (ADR-0010).


-- Vehicles: owner has full access; ops reads.
create policy vehicles_read_own on public.vehicles
  for select to authenticated using (owner_id = auth.uid() or public.is_ops());
create policy vehicles_insert_own on public.vehicles
  for insert to authenticated with check (owner_id = auth.uid());
create policy vehicles_update_own on public.vehicles
  for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy vehicles_delete_own on public.vehicles
  for delete to authenticated using (owner_id = auth.uid());
-- Note: `vehicle_timeline.vehicle_id` is ON DELETE RESTRICT, so a vehicle with
-- history cannot actually be deleted. Deactivation (is_active = false) is the
-- real removal path. The policy exists so the failure is a clean FK error
-- rather than a confusing permission error.


-- Timeline: READ ONLY through RLS. There is deliberately no INSERT, UPDATE or
-- DELETE policy — writes go through append_vehicle_timeline_event, and the
-- grants were revoked in 0010. Three independent layers (ADR-0003).
create policy vehicle_timeline_read_own on public.vehicle_timeline
  for select to authenticated
  using (public.owns_vehicle(vehicle_id) or public.is_ops());
-- Phase 3 adds: a provider may read rows originating from their own orders.


-- Ownership transfers: visible to the sender, and to the recipient once they
-- have an account. Matching by phone is what lets a brand-new user discover a
-- transfer waiting for them.
create policy ownership_transfers_read on public.ownership_transfers
  for select to authenticated using (
    from_owner_id = auth.uid()
    or to_owner_id = auth.uid()
    or to_phone = (select p.phone from public.profiles p where p.id = auth.uid())
    or public.is_ops()
  );
create policy ownership_transfers_insert on public.ownership_transfers
  for insert to authenticated
  with check (from_owner_id = auth.uid() and public.owns_vehicle(vehicle_id));


grant execute on function public.is_ops() to authenticated;
grant execute on function public.owns_vehicle(uuid) to authenticated;
grant execute on function public.vat_rate_on(date) to authenticated, anon;
grant execute on function public.normalise_plate(text) to authenticated;
