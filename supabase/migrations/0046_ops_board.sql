-- 0046 — The dispatch board
--
-- §9.4 calls for a live order map. The map is the picture; this is the part
-- that decides what ops should be looking at, and it belongs in the database
-- for the usual reason (§2.2) — "which orders are in trouble" is a judgement
-- with rules, and rules in a dashboard component cannot be tested.
--
-- The board is deliberately ordered by trouble rather than by time. A shift
-- has one operator and a screen; sorting newest-first buries the customer who
-- has been waiting eleven minutes under six who have been waiting one.

/**
 * How long a search may run before it needs a human.
 *
 * Past the last rung the ladder has nothing left to try (0044), so this is
 * about the case where widening happened and still found nobody. Ops can call,
 * widen manually, or tell the customer honestly — all of which beat a spinner.
 */
create or replace function public.ops_stuck_search_after()
returns interval language sql immutable parallel safe as $$ select interval '4 minutes' $$;

/**
 * How long a completed job may sit unconfirmed.
 *
 * Escrow is captured on the customer's confirmation (ADR-0006), so an order
 * parked here is a technician who has finished and not been paid. That is the
 * complaint ops hears about, and it is invisible unless something surfaces it.
 */
create or replace function public.ops_unconfirmed_after()
returns interval language sql immutable parallel safe as $$ select interval '30 minutes' $$;


create type public.ops_attention as enum (
  'none',
  'search_stuck',      -- widened as far as it goes and still nobody
  'search_slow',       -- running long but the ladder has rungs left
  'awaiting_customer', -- work done, payment not captured
  'disputed'
);

/**
 * Every order that is still live, with the dispatch state ops needs to act.
 *
 * ⚠️ No coordinates. Ops can read `orders` including `service_location`
 * through RLS, so this is not a boundary — it is a decision about what belongs
 * on a board that sits on a screen in a room. The district and the distance
 * are what an operator uses to reason; the exact position of a stranded
 * customer is not something to leave on display all shift.
 */
create or replace function public.ops_active_orders()
returns table (
  order_id         uuid,
  order_number     text,
  status           public.order_status,
  service_name_ar  text,
  city_name_ar     text,
  provider_name_ar text,
  status_age       interval,
  dispatch_round   int,
  offers_total     int,
  offers_open      int,
  attention        public.ops_attention
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_ops() then
    raise exception 'Only ops may read the dispatch board'
      using errcode = 'insufficient_privilege';
  end if;

  return query
  with latest_event as (
    -- When the order entered its current status. `orders.updated_at` is reset
    -- by a trigger on every write to the row, so it measures the last time
    -- anything touched the order rather than how long it has been stuck.
    select ev.order_id, max(ev.created_at) as entered_at
      from public.order_events ev
      join public.orders o on o.id = ev.order_id and o.status = ev.to_status
     group by ev.order_id
  ),
  offer_counts as (
    select
      off.order_id,
      count(*)::int as total,
      count(*) filter (where off.outcome in ('pending', 'viewed'))::int as open
    from public.order_offers off
    group by off.order_id
  )
  select
    o.id,
    o.order_number,
    o.status,
    s.name_ar,
    c.name_ar,
    pr.business_name_ar,
    now() - coalesce(le.entered_at, o.created_at),
    o.dispatch_round,
    coalesce(oc.total, 0),
    coalesce(oc.open, 0),
    case
      when o.status = 'disputed' then 'disputed'::public.ops_attention
      when o.status = 'awaiting_approval'
       and now() - coalesce(le.entered_at, o.created_at) > public.ops_unconfirmed_after()
        then 'awaiting_customer'::public.ops_attention
      when o.status = 'searching'
       and o.dispatch_round >= public.dispatch_max_round()
       and coalesce(oc.open, 0) = 0
        then 'search_stuck'::public.ops_attention
      when o.status = 'searching'
       and now() - coalesce(le.entered_at, o.created_at) > public.ops_stuck_search_after()
        then 'search_slow'::public.ops_attention
      else 'none'::public.ops_attention
    end
  from public.orders o
  join public.services s on s.id = o.service_id
  left join public.providers pr on pr.id = o.provider_id
  left join public.cities c on c.id = pr.city_id
  left join latest_event le on le.order_id = o.id
  left join offer_counts oc on oc.order_id = o.id
  where o.status not in ('draft', 'completed', 'cancelled')
  order by
    -- Trouble first, then longest-waiting within it. An operator works down
    -- this list; anything below the fold should be the least urgent thing.
    case
      when o.status = 'disputed' then 0
      when o.status = 'searching' and o.dispatch_round >= public.dispatch_max_round()
           and coalesce(oc.open, 0) = 0 then 1
      when o.status = 'searching' then 2
      when o.status = 'awaiting_approval' then 3
      else 4
    end,
    coalesce(le.entered_at, o.created_at) asc;
end;
$$;

revoke execute on function public.ops_active_orders() from public;
grant execute on function public.ops_active_orders() to authenticated;
