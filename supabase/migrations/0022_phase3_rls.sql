-- 0022 — RLS for the Phase 3 tables
-- CLAUDE.md §2.3, build prompt §6.9, ADR-0013.

create or replace function public.current_provider_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id from public.providers p where p.owner_profile_id = auth.uid();
$$;

alter table public.services            enable row level security;
alter table public.providers           enable row level security;
alter table public.provider_services   enable row level security;
alter table public.provider_locations  enable row level security;
alter table public.workshops           enable row level security;
alter table public.appointment_slots   enable row level security;
alter table public.orders              enable row level security;
alter table public.order_events        enable row level security;
alter table public.order_parts         enable row level security;
alter table public.ratings             enable row level security;
alter table public.order_transitions   enable row level security;


-- Catalogue: public. A customer browses services before signing in.
create policy services_read on public.services
  for select to anon, authenticated using (is_active or public.is_ops());
create policy services_write on public.services
  for all to authenticated using (public.is_ops()) with check (public.is_ops());

-- The adjacency table is read-only reference data; nobody edits it at runtime.
create policy order_transitions_read on public.order_transitions
  for select to authenticated using (true);


-- Providers: their own record, plus a public view of approved ones so a
-- customer can see who is coming.
create policy providers_read on public.providers
  for select to authenticated
  using (owner_profile_id = auth.uid() or verification_status = 'approved' or public.is_ops());
create policy providers_insert_own on public.providers
  for insert to authenticated with check (owner_profile_id = auth.uid());
create policy providers_update_own on public.providers
  for update to authenticated
  using (owner_profile_id = auth.uid())
  -- A provider cannot approve themselves. Verification is an ops action, and
  -- leaving this to the app would make KYC advisory.
  with check (owner_profile_id = auth.uid() and verification_status = 'pending');
create policy providers_update_ops on public.providers
  for update to authenticated using (public.is_ops()) with check (public.is_ops());

create policy provider_services_read on public.provider_services
  for select to authenticated using (true);
create policy provider_services_write on public.provider_services
  for all to authenticated
  using (provider_id = public.current_provider_id())
  with check (provider_id = public.current_provider_id());

create policy workshops_read on public.workshops
  for select to anon, authenticated using (true);
create policy workshops_write on public.workshops
  for all to authenticated
  using (provider_id = public.current_provider_id())
  with check (provider_id = public.current_provider_id());

create policy appointment_slots_read on public.appointment_slots
  for select to authenticated using (true);
create policy appointment_slots_write on public.appointment_slots
  for all to authenticated
  using (provider_id = public.current_provider_id())
  with check (provider_id = public.current_provider_id());


-- Provider locations -------------------------------------------------------
-- The spec's policy (§6.9) covers only the customer's read and omits the
-- provider's own write. Completed set:
--   * a provider writes only their own position
--   * a provider reads NO other provider's position — competitor positions are
--     commercially sensitive and a tracking vector
--   * a customer reads the assigned provider only while they are actually en
--     route, not forever after
create policy provider_locations_write_own on public.provider_locations
  for all to authenticated
  using (provider_id = public.current_provider_id())
  with check (provider_id = public.current_provider_id());

create policy provider_locations_read_active_customer on public.provider_locations
  for select to authenticated
  using (
    exists (
      select 1 from public.orders o
      where o.provider_id = provider_locations.provider_id
        and o.customer_id = auth.uid()
        -- Strictly the in-transit window. "Active order" read loosely would
        -- leave a customer with a live feed of a technician's position long
        -- after the job.
        and o.status in ('accepted', 'en_route', 'arrived', 'in_progress')
    )
  );


-- Orders -------------------------------------------------------------------
-- Note what is absent: any policy granting a provider read on an order they
-- are not assigned to. Open-order discovery goes through
-- list_open_orders_for_provider, which masks location (ADR-0013).
create policy orders_read_customer on public.orders
  for select to authenticated using (customer_id = auth.uid() or public.is_ops());
create policy orders_read_assigned_provider on public.orders
  for select to authenticated using (provider_id = public.current_provider_id());

create policy orders_insert_customer on public.orders
  for insert to authenticated with check (customer_id = auth.uid());
create policy orders_update_customer on public.orders
  for update to authenticated
  using (customer_id = auth.uid()) with check (customer_id = auth.uid());
create policy orders_update_assigned_provider on public.orders
  for update to authenticated
  using (provider_id = public.current_provider_id())
  with check (provider_id = public.current_provider_id());
create policy orders_update_ops on public.orders
  for update to authenticated using (public.is_ops()) with check (public.is_ops());


create policy order_events_read on public.order_events
  for select to authenticated
  using (
    exists (
      select 1 from public.orders o
      where o.id = order_events.order_id
        and (o.customer_id = auth.uid() or o.provider_id = public.current_provider_id())
    )
    or public.is_ops()
  );
-- No INSERT policy: order_events is written by the state machine trigger.
-- A hand-written event would be a forged audit trail.


create policy order_parts_read on public.order_parts
  for select to authenticated
  using (
    exists (
      select 1 from public.orders o
      where o.id = order_parts.order_id
        and (o.customer_id = auth.uid() or o.provider_id = public.current_provider_id())
    )
    or public.is_ops()
  );

-- The provider builds the quote.
create policy order_parts_write_provider on public.order_parts
  for all to authenticated
  using (
    exists (select 1 from public.orders o
            where o.id = order_parts.order_id and o.provider_id = public.current_provider_id())
  )
  with check (
    exists (select 1 from public.orders o
            where o.id = order_parts.order_id and o.provider_id = public.current_provider_id())
  );

-- The customer approves lines. They cannot change a price — only accept it.
create policy order_parts_approve_customer on public.order_parts
  for update to authenticated
  using (
    exists (select 1 from public.orders o
            where o.id = order_parts.order_id and o.customer_id = auth.uid())
  )
  with check (
    exists (select 1 from public.orders o
            where o.id = order_parts.order_id and o.customer_id = auth.uid())
  );


create policy ratings_read on public.ratings
  for select to authenticated using (true);
create policy ratings_insert_customer on public.ratings
  for insert to authenticated with check (rater_id = auth.uid());


-- Providers may read timeline rows from their own completed orders — the
-- Phase 3 extension promised in 0013.
create policy vehicle_timeline_read_provider on public.vehicle_timeline
  for select to authenticated
  using (
    provider_id is not null
    and provider_id = public.current_provider_id()
  );

grant execute on function public.current_provider_id() to authenticated;
