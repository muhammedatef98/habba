-- 0021 — On-demand matching and masked order discovery
-- Build prompt §7.1, ADR-0013.

-- Radius ladder: 8km, then 15km, then 25km, expanding when nobody accepts
-- within 45s (build prompt §7.1).
create or replace function public.match_radius_for_round(p_round int)
returns int
language sql
immutable
parallel safe
as $$
  select case
    when p_round <= 1 then 8000
    when p_round = 2 then 15000
    else 25000
  end;
$$;


-- ---------------------------------------------------------------------------
-- match_providers
-- ---------------------------------------------------------------------------
-- Returns a ranked candidate list. The caller broadcasts to the top 5
-- simultaneously and the first to accept wins (§7.1) — deliberately NOT
-- assign-one-and-wait, which is the anti-pattern the spec calls out.
create or replace function public.match_providers(
  p_order_id uuid,
  p_round    int default 1,
  p_limit    int default 5
)
returns table (
  provider_id    uuid,
  distance_m     double precision,
  score          numeric,
  distance_score numeric,
  rating_score   numeric,
  acceptance_score numeric,
  idle_score     numeric,
  specialisation_score numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_order  record;
  v_radius int := public.match_radius_for_round(p_round);
begin
  select * into v_order from public.orders o where o.id = p_order_id;

  if v_order is null then
    raise exception 'Order % not found', p_order_id using errcode = 'no_data_found';
  end if;

  if v_order.service_location is null then
    raise exception 'Order % has no service location to match against', p_order_id
      using errcode = 'check_violation';
  end if;

  return query
  with candidates as (
    select
      p.id,
      p.rating_avg,
      p.rating_count,
      p.acceptance_rate,
      pl.updated_at as location_updated_at,
      extensions.st_distance(pl.location, v_order.service_location) as dist,
      -- Specialisation: has this provider completed this service on this make
      -- before? Cheap proxy for "has done this exact job on this exact car".
      exists (
        select 1
        from public.orders prior
        join public.vehicles pv on pv.id = prior.vehicle_id
        where prior.provider_id = p.id
          and prior.status = 'completed'
          and prior.service_id = v_order.service_id
          and pv.make_id = (
            select v2.make_id from public.vehicles v2 where v2.id = v_order.vehicle_id
          )
      ) as has_specialisation,
      -- Idle time since their last accepted job. Longer idle ranks higher,
      -- which is what stops the top-rated provider taking everything and the
      -- rest of the supply going dormant.
      coalesce(
        extract(epoch from (now() - (
          select max(o2.created_at) from public.orders o2
          where o2.provider_id = p.id and o2.status <> 'cancelled'
        ))) / 3600.0,
        24
      ) as idle_hours
    from public.providers p
    join public.provider_locations pl on pl.provider_id = p.id
    join public.provider_services ps on ps.provider_id = p.id
    where p.is_online
      and p.verification_status = 'approved'
      and ps.service_id = v_order.service_id
      and extensions.st_dwithin(pl.location, v_order.service_location, v_radius)
      -- A stale position is worse than none: dispatching on a 20-minute-old
      -- fix produces the false ETAs that destroy trust on the tracking screen.
      and pl.updated_at > now() - interval '5 minutes'
  ),
  scored as (
    select
      c.id,
      c.dist,
      -- Linear decay to the radius edge.
      round((greatest(0, 1 - (c.dist / v_radius)) * 40)::numeric, 2) as distance_score,
      -- Providers with fewer than 5 ratings get a 3.5 baseline (§7.1), so a
      -- new provider is neither punished for having no history nor flattered
      -- by a single five-star review.
      round((
        (case when c.rating_count >= 5 then c.rating_avg else 3.5 end) / 5.0 * 25
      )::numeric, 2) as rating_score,
      round((coalesce(c.acceptance_rate, 70) / 100.0 * 15)::numeric, 2) as acceptance_score,
      round((least(c.idle_hours, 8) / 8.0 * 10)::numeric, 2) as idle_score,
      round((case when c.has_specialisation then 10 else 0 end)::numeric, 2)
        as specialisation_score
    from candidates c
  )
  select
    s.id,
    s.dist,
    (s.distance_score + s.rating_score + s.acceptance_score
      + s.idle_score + s.specialisation_score) as score,
    s.distance_score,
    s.rating_score,
    s.acceptance_score,
    s.idle_score,
    s.specialisation_score
  from scored s
  order by score desc, s.dist asc
  limit p_limit;
end;
$$;

comment on function public.match_providers(uuid, int, int) is
  'Ranked candidates for broadcast. Never rank by price alone; never assign to one and wait (§7.1).';


-- ---------------------------------------------------------------------------
-- Masked discovery — ADR-0013
-- ---------------------------------------------------------------------------
-- The build prompt contradicts itself: §6.9 grants providers RLS read on open
-- orders, while §7.1 and §9.2 forbid showing the exact address before
-- acceptance. An RLS SELECT policy grants WHOLE ROWS, so the literal reading
-- hands every online provider the precise coordinates of any customer with an
-- open emergency — at night, roadside, alone. That is a stalking vector that
-- looks correct in UI review because the app only renders a distance.
--
-- So providers get no direct read on unassigned orders at all. Discovery goes
-- through this function, which returns a bucket rather than a number:
-- repeated exact distances from several providers allow trilateration.
create or replace function public.list_open_orders_for_provider()
returns table (
  order_id         uuid,
  service_id       uuid,
  service_name_ar  text,
  fulfilment_mode  fulfilment_mode,
  distance_bucket  text,
  district_name_ar text,
  problem_summary  text,
  has_triage_video boolean,
  estimated_payout numeric(12,2),
  created_at       timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_provider record;
begin
  select p.* into v_provider
  from public.providers p
  where p.owner_profile_id = auth.uid();

  if v_provider is null then
    raise exception 'Not a provider' using errcode = 'insufficient_privilege';
  end if;

  if v_provider.verification_status <> 'approved' or not v_provider.is_online then
    -- Nothing to see: an unapproved or offline provider has no business
    -- reading live demand.
    return;
  end if;

  return query
  select
    o.id,
    o.service_id,
    s.name_ar,
    o.fulfilment_mode,
    case
      when extensions.st_distance(pl.location, o.service_location) < 2000  then 'أقل من ٢ كم'
      when extensions.st_distance(pl.location, o.service_location) < 5000  then '٢–٥ كم'
      when extensions.st_distance(pl.location, o.service_location) < 10000 then '٥–١٠ كم'
      else 'أكثر من ١٠ كم'
    end,
    -- District, never street or building.
    c.name_ar,
    -- Truncated. Customers type addresses and phone numbers into free text no
    -- matter what the field is called, so the full string is withheld until
    -- acceptance (ADR-0013 open item).
    left(coalesce(o.problem_description, ''), 60),
    jsonb_array_length(coalesce(o.triage_media, '[]'::jsonb)) > 0,
    coalesce(o.quoted_amount, s.base_price),
    o.created_at
  from public.orders o
  join public.services s on s.id = o.service_id
  join public.provider_locations pl on pl.provider_id = v_provider.id
  join public.provider_services ps
    on ps.provider_id = v_provider.id and ps.service_id = o.service_id
  left join public.cities c on c.id = v_provider.city_id
  where o.status = 'searching'
    and o.provider_id is null
    and extensions.st_dwithin(pl.location, o.service_location, 25000)
  order by o.created_at;
end;
$$;

comment on function public.list_open_orders_for_provider() is
  'Open orders with a distance BUCKET and no exact location. Never expose service_location pre-acceptance.';

grant execute on function public.list_open_orders_for_provider() to authenticated;
grant execute on function public.match_providers(uuid, int, int) to authenticated;
grant execute on function public.match_radius_for_round(int) to authenticated;
