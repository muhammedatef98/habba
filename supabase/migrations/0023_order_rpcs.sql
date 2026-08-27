-- 0023 — Order and location RPCs
--
-- PostgREST cannot accept a PostGIS `geography` value as JSON, so a client
-- literally cannot insert `orders.service_location` or
-- `provider_locations.location` through the table API. Without these functions
-- the emergency flow is unbuildable from the app — a gap that only appears
-- when something actually tries to place an order over HTTP.
--
-- They are also the right shape regardless: taking longitude and latitude
-- keeps geometry construction server-side (CLAUDE.md §2.2), and it gives one
-- place to validate that a coordinate is plausible.

-- Rough bounding box for Saudi Arabia plus a margin. A wildly out-of-range
-- coordinate is a bug or a spoof, and dispatching a technician on one wastes
-- a real person's time.
create or replace function public.assert_plausible_coordinate(p_lon double precision, p_lat double precision)
returns void
language plpgsql
immutable
as $$
begin
  if p_lon is null or p_lat is null then
    raise exception 'A location is required' using errcode = 'check_violation';
  end if;
  if p_lon < 34 or p_lon > 56 or p_lat < 16 or p_lat > 33 then
    raise exception 'Coordinate (%, %) is outside the service area', p_lon, p_lat
      using errcode = 'check_violation';
  end if;
end;
$$;


create or replace function public.create_emergency_order(
  p_service_id  uuid,
  p_lon         double precision,
  p_lat         double precision,
  p_vehicle_id  uuid default null,
  p_address_ar  text default null,
  p_problem     text default null,
  p_mileage     int default null,
  p_triage_media jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor   uuid := auth.uid();
  v_service record;
  v_id      uuid;
begin
  if v_actor is null then
    raise exception 'Not authenticated' using errcode = 'insufficient_privilege';
  end if;

  perform public.assert_plausible_coordinate(p_lon, p_lat);

  select * into v_service from public.services s where s.id = p_service_id and s.is_active;
  if v_service is null then
    raise exception 'Service % not found', p_service_id using errcode = 'no_data_found';
  end if;

  if not ('mobile_ondemand' = any(v_service.supported_modes)) then
    raise exception '% is not available on demand', v_service.name_en
      using errcode = 'check_violation';
  end if;

  if v_service.requires_vehicle and p_vehicle_id is null then
    raise exception '% requires a vehicle', v_service.name_en using errcode = 'check_violation';
  end if;

  if p_vehicle_id is not null
     and not exists (select 1 from public.vehicles v
                     where v.id = p_vehicle_id and v.owner_id = v_actor) then
    raise exception 'Vehicle % does not belong to you', p_vehicle_id
      using errcode = 'insufficient_privilege';
  end if;

  insert into public.orders (
    customer_id, vehicle_id, service_id, fulfilment_mode, status,
    service_location, service_address_ar, problem_description,
    mileage_at_order, triage_media, quoted_amount, created_by
  ) values (
    v_actor, p_vehicle_id, p_service_id, 'mobile_ondemand', 'draft',
    extensions.st_point(p_lon, p_lat)::extensions.geography,
    p_address_ar, p_problem, p_mileage, coalesce(p_triage_media, '[]'::jsonb),
    -- Emergency prices are central (§11), so the amount comes from the
    -- catalogue and never from the client.
    v_service.base_price,
    v_actor
  )
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.create_emergency_order is
  'Creates an on-demand order from lon/lat. Price comes from the catalogue, never the client.';


-- Provider position, broadcast only while online (§9.2).
create or replace function public.update_provider_location(
  p_lon     double precision,
  p_lat     double precision,
  p_heading numeric default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_provider_id uuid;
begin
  select p.id into v_provider_id
  from public.providers p where p.owner_profile_id = auth.uid();

  if v_provider_id is null then
    raise exception 'Not a provider' using errcode = 'insufficient_privilege';
  end if;

  perform public.assert_plausible_coordinate(p_lon, p_lat);

  insert into public.provider_locations (provider_id, location, heading, updated_at)
  values (v_provider_id,
          extensions.st_point(p_lon, p_lat)::extensions.geography,
          p_heading, now())
  on conflict (provider_id) do update
    set location = excluded.location,
        heading = excluded.heading,
        updated_at = now();
end;
$$;


-- Going offline clears the position rather than leaving a stale one behind.
-- Matching already rejects fixes older than five minutes, but a lingering row
-- is both a privacy leak and a source of phantom supply on the ops map.
create or replace function public.set_provider_online(p_online boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_provider_id uuid;
begin
  select p.id into v_provider_id
  from public.providers p where p.owner_profile_id = auth.uid();

  if v_provider_id is null then
    raise exception 'Not a provider' using errcode = 'insufficient_privilege';
  end if;

  update public.providers set is_online = p_online where id = v_provider_id;

  if not p_online then
    delete from public.provider_locations where provider_id = v_provider_id;
  end if;
end;
$$;

-- A workshop registering its address hits the same wall: `location` is a
-- PostGIS point, so it cannot be written through the table API at all. Every
-- geography column in the schema needs an RPC like this one, and the absence
-- of any single one makes that part of the product unbuildable from the app.
create or replace function public.upsert_workshop(
  p_address_ar       text,
  p_lon              double precision,
  p_lat              double precision,
  p_bay_count        int default 1,
  p_opening_hours    jsonb default '{}'::jsonb,
  p_service_radius_km int default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_provider_id uuid := public.current_provider_id();
begin
  if v_provider_id is null then
    raise exception 'Not a provider' using errcode = 'insufficient_privilege';
  end if;

  perform public.assert_plausible_coordinate(p_lon, p_lat);

  insert into public.workshops (
    provider_id, address_ar, location, bay_count, opening_hours, service_radius_km
  ) values (
    v_provider_id, p_address_ar,
    extensions.st_point(p_lon, p_lat)::extensions.geography,
    p_bay_count, coalesce(p_opening_hours, '{}'::jsonb), p_service_radius_km
  )
  on conflict (provider_id) do update
    set address_ar = excluded.address_ar,
        location = excluded.location,
        bay_count = excluded.bay_count,
        opening_hours = excluded.opening_hours,
        service_radius_km = excluded.service_radius_km;

  return v_provider_id;
end;
$$;

grant execute on function public.create_emergency_order(uuid, double precision, double precision, uuid, text, text, int, jsonb) to authenticated;
grant execute on function public.upsert_workshop(text, double precision, double precision, int, jsonb, int) to authenticated;
grant execute on function public.update_provider_location(double precision, double precision, numeric) to authenticated;
grant execute on function public.set_provider_online(boolean) to authenticated;
grant execute on function public.assert_plausible_coordinate(double precision, double precision) to authenticated;
