-- 0040 — Handover verification and live job progress
--
-- Two gaps the emergency-flow design surfaced, both of which have to be solved
-- server-side or not at all.
--
-- 1. HANDOVER CODE (design screen 08a). The customer is shown a four-digit
--    code and reads it out to the technician before work starts. Its only
--    purpose is to stop a vehicle being released to, or worked on by, someone
--    who is not the dispatched technician.
--
--    ⚠️ It cannot be a column on `orders`. 0022's `orders_read_assigned_provider`
--    gives the provider SELECT on the whole order row, and RLS is row-granular,
--    not column-granular — the same blind spot 0037 documents. A code the
--    verifying party can read verifies nothing. Column-level grants cannot
--    separate them either: customer and provider are both `authenticated`, so
--    a grant that hides the column from one hides it from both.
--
--    Hence a separate table whose only read policy is the customer's, and a
--    security-definer function as the provider's sole way to test a guess.
--
--    ⚠️ Stored in plaintext, unlike `ownership_transfers.otp_code_hash`. That
--    code is typed IN by the recipient, so a hash suffices. This one is
--    DISPLAYED to the customer, so the plaintext has to be recoverable. The
--    compensating control is the attempt limit below, not the storage form.
--
-- 2. LIVE PROGRESS (design screens 06 and 07: "1.6 كم", "يوصلك خلال 6 دقائق").
--    `provider_locations` already carries the position, and 0022's
--    `provider_locations_read_active_customer` already lets the customer read
--    their assigned provider's point during the in-transit window — so this
--    function is NOT a privacy boundary and must not be described as one.
--
--    What it is: the ETA arithmetic, kept in Postgres where §2.2 says business
--    logic belongs, plus a freshness rule. A client computing its own ETA
--    would be a second, drifting implementation of a number the customer
--    treats as a promise, and it would happily compute one from a
--    half-hour-old fix. This returns no row in that case instead.


-- ---------------------------------------------------------------------------
-- Handover codes
-- ---------------------------------------------------------------------------

create table public.order_handovers (
  order_id    uuid primary key references public.orders(id) on delete cascade,
  code        text not null check (code ~ '^[0-9]{4}$'),
  -- Four digits is 10,000 combinations, which is only safe against an
  -- attacker who cannot iterate. This is what stops them iterating.
  attempts    int not null default 0 check (attempts >= 0),
  verified_at timestamptz,
  created_at  timestamptz not null default now()
);

comment on table public.order_handovers is
  'Customer-visible handover code. Never readable by the provider being verified — see 0040.';

/** Attempts allowed before the code is locked and ops must intervene. */
create or replace function public.handover_max_attempts()
returns int language sql immutable parallel safe as $$ select 5 $$;

alter table public.order_handovers enable row level security;

-- The customer, and only the customer. There is deliberately no provider
-- policy and no ops policy: ops reading the code would be able to authorise a
-- handover without the customer present, which is the same hole as the
-- provider reading it.
create policy order_handovers_read_customer on public.order_handovers
  for select to authenticated
  using (
    exists (
      select 1 from public.orders o
      where o.id = order_handovers.order_id and o.customer_id = (select auth.uid())
    )
  );

-- No client writes at all. Generation is a trigger, verification is a
-- function; both run as definer.
revoke all on public.order_handovers from anon, authenticated;
grant select (order_id, verified_at, code) on public.order_handovers to authenticated;


-- Generated when the job is accepted rather than on arrival: the customer
-- should have the code in hand before the technician is at the window, not be
-- waiting on a round-trip while a stranger stands next to their car.
create or replace function public.issue_handover_code()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'accepted' and (old.status is distinct from 'accepted') then
    insert into public.order_handovers (order_id, code)
    values (
      new.id,
      -- lpad, not a 1000–9999 range: excluding codes with a leading zero
      -- would quietly discard a tenth of the keyspace.
      lpad((floor(random() * 10000))::int::text, 4, '0')
    )
    on conflict (order_id) do nothing;
  end if;

  return new;
end;
$$;

create trigger orders_issue_handover
  after update of status on public.orders
  for each row execute function public.issue_handover_code();

alter table public.orders enable always trigger orders_issue_handover;


-- The provider's only way to test a guess. Returns whether the code matched;
-- it never echoes the expected value, and it counts every attempt including
-- the ones that fail.
create or replace function public.verify_handover_code(p_order_id uuid, p_code text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row     record;
  v_caller  uuid := (select auth.uid());
  v_matched boolean;
begin
  -- Only the assigned provider may attempt. Without this, anyone holding an
  -- order id could burn through the attempt budget and lock the customer's
  -- handover out of spite.
  -- ⚠️ owner_profile_id, not id. `providers.id` is the business, auth.uid() is
  -- the person who owns it; comparing them directly matches nothing and locks
  -- out the very party this function exists to serve.
  if not exists (
    select 1
      from public.orders o
      join public.providers pr on pr.id = o.provider_id
     where o.id = p_order_id
       and pr.owner_profile_id = v_caller
  ) then
    raise exception 'Only the assigned provider may verify a handover code'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_row from public.order_handovers h where h.order_id = p_order_id
  for update;

  if v_row is null then
    raise exception 'No handover code has been issued for order %', p_order_id
      using errcode = 'no_data_found';
  end if;

  if v_row.verified_at is not null then
    return true;
  end if;

  if v_row.attempts >= public.handover_max_attempts() then
    raise exception 'Too many handover attempts on order %', p_order_id
      using errcode = 'check_violation',
            hint = 'Ask the customer to contact support to re-issue the code.';
  end if;

  v_matched := (v_row.code = p_code);

  update public.order_handovers
     set attempts = attempts + 1,
         verified_at = case when v_matched then now() else verified_at end
   where order_id = p_order_id;

  return v_matched;
end;
$$;

grant execute on function public.verify_handover_code(uuid, text) to authenticated;
grant execute on function public.handover_max_attempts() to authenticated;


-- ---------------------------------------------------------------------------
-- Live progress
-- ---------------------------------------------------------------------------

/**
 * Straight-line metres inflated to approximate road distance.
 *
 * There is no routing provider wired up, so this is an approximation and is
 * named like one. 1.35 is a conventional urban detour factor — the ratio of
 * driven distance to crow-flight distance on a gridded road network.
 */
create or replace function public.route_detour_factor()
returns numeric language sql immutable parallel safe as $$ select 1.35::numeric $$;

/** Average urban speed in km/h, deliberately pessimistic so the ETA under-promises. */
create or replace function public.urban_speed_kmh()
returns numeric language sql immutable parallel safe as $$ select 28::numeric $$;

/**
 * How stale a position may be before it stops being reported.
 *
 * A confident ETA computed from a ten-minute-old fix is worse than no ETA:
 * the customer plans around a number the system has no basis for. Past this
 * age the function returns nulls and the screens render their reduced state.
 */
create or replace function public.location_freshness_limit()
returns interval language sql immutable parallel safe as $$ select interval '3 minutes' $$;


create or replace function public.order_live_progress(p_order_id uuid)
returns table (
  distance_m  double precision,
  eta_minutes int,
  measured_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_order record;
begin
  select o.id, o.customer_id, o.provider_id, o.status, o.service_location
    into v_order
    from public.orders o
   where o.id = p_order_id;

  if v_order is null then
    raise exception 'Order % not found', p_order_id using errcode = 'no_data_found';
  end if;

  -- Customer only, matching the row policy on provider_locations rather than
  -- widening it: a definer function bypasses RLS, so the check the policy
  -- would have made has to be made here explicitly.
  if v_order.customer_id <> (select auth.uid()) then
    raise exception 'Only the customer may read live progress for order %', p_order_id
      using errcode = 'insufficient_privilege';
  end if;

  -- Only while someone is actually on the way. Outside those statuses there is
  -- no journey to report, and continuing to expose the provider's distance
  -- after the job closes would leak their movements indefinitely.
  if v_order.status not in ('accepted', 'en_route', 'arrived')
     or v_order.provider_id is null
     or v_order.service_location is null then
    return;
  end if;

  return query
  select
    extensions.st_distance(pl.location, v_order.service_location) as distance_m,
    greatest(
      1,
      ceil(
        (extensions.st_distance(pl.location, v_order.service_location) / 1000.0)
        * public.route_detour_factor()
        / public.urban_speed_kmh()
        * 60
      )::int
    ) as eta_minutes,
    pl.updated_at as measured_at
  from public.provider_locations pl
  where pl.provider_id = v_order.provider_id
    and pl.updated_at > now() - public.location_freshness_limit();
end;
$$;

grant execute on function public.order_live_progress(uuid) to authenticated;
grant execute on function public.route_detour_factor() to authenticated;
grant execute on function public.urban_speed_kmh() to authenticated;
grant execute on function public.location_freshness_limit() to authenticated;
