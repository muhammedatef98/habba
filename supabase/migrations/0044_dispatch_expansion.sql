-- 0044 — Expanding the search when nobody answers
--
-- 0042 broadcasts round 1 the instant an order starts searching. §7.1 then
-- widens the radius — 8km, 15km, 25km — when nobody accepts within 45 seconds.
-- A trigger cannot do that: there is no event at 45 seconds, only the absence
-- of one, and absence does not fire.
--
-- So the decision lives here as a function and something outside calls it on a
-- timer. The scheduler is transport; every rule about who gets asked and when
-- stays in the database (§2.2), which is also the only way it can be tested.

-- ⚠️ The round has to live on the order, not be derived from the offers.
--
-- A broadcast that reaches nobody inserts no rows, so `max(round)` cannot tell
-- "round 1 ran and found no one within 8km" from "nothing has been broadcast
-- yet". Those need opposite responses — widen, versus start — and the empty
-- case is exactly the one where widening matters most.
alter table public.orders
  add column dispatch_round int not null default 0 check (dispatch_round >= 0);

comment on column public.orders.dispatch_round is
  'Highest broadcast round attempted. Set by broadcast_order; never by a client.';


/**
 * Redefined from 0042 to record the attempt on the order.
 *
 * Forward-only: 0042 has shipped, so this replaces the function here rather
 * than editing history. The body is otherwise unchanged.
 */
create or replace function public.broadcast_order(p_order_id uuid, p_round int default 1)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_radius int := public.match_radius_for_round(p_round);
  v_sent   int;
begin
  insert into public.order_offers (order_id, provider_id, round, radius_m)
  select p_order_id, m.provider_id, p_round, v_radius
    from public.match_providers(p_order_id, p_round, 5) m
  on conflict (order_id, provider_id) do nothing;

  get diagnostics v_sent = row_count;

  -- Recorded even when v_sent is 0. An attempt that reached nobody is still an
  -- attempt, and forgetting it is exactly what would strand a customer on
  -- round 1 forever — the empty case is the one where widening matters most.
  perform public.begin_privileged_write();
  update public.orders
     set dispatch_round = greatest(dispatch_round, p_round)
   where id = p_order_id;
  perform public.end_privileged_write();

  return v_sent;
end;
$$;

grant execute on function public.broadcast_order(uuid, int) to service_role;


/** §7.1 — how long silence has to last before the search widens. */
create or replace function public.dispatch_silence_window()
returns interval language sql immutable parallel safe as $$ select interval '45 seconds' $$;

/** The ladder has three rungs; past 25km the match is not worth making. */
create or replace function public.dispatch_max_round()
returns int language sql immutable parallel safe as $$ select 3 $$;


/**
 * Advances every search that has gone quiet.
 *
 * Returns one row per order it acted on, so the caller can log what happened
 * rather than guessing from a count.
 *
 * ⚠️ Deliberately NOT parameterised by order. A per-order endpoint invites a
 * client to drive its own dispatch — calling it in a loop to widen instantly
 * and jump the queue ahead of everyone else waiting. This takes the whole
 * backlog or nothing, which makes it useless as a lever.
 */
create or replace function public.expand_stale_searches()
returns table (order_id uuid, round int, offers_sent int)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order   record;
  v_round   int;
  v_sent    int;
begin
  for v_order in
    select
      o.id,
      o.dispatch_round as current_round,
      -- Silence is measured from the last thing that actually happened: the
      -- most recent broadcast, or the moment the order entered `searching` if
      -- nobody was ever in range. That second case matters most — an order
      -- with no offers at all is a customer staring at zero.
      --
      -- ⚠️ NOT `orders.updated_at`. That column is reset by a trigger on every
      -- write to the row, so authorising the escrow or attaching a triage clip
      -- would silently restart the silence clock and delay the expansion for a
      -- customer who is already waiting. `order_events` records the transition
      -- itself and nothing else touches it.
      coalesce(max(off.sent_at), max(ev.created_at)) as last_activity
    from public.orders o
    left join public.order_offers off on off.order_id = o.id
    left join public.order_events ev
           on ev.order_id = o.id and ev.to_status = 'searching'
    where o.status = 'searching'
    group by o.id, o.dispatch_round
    having o.dispatch_round < public.dispatch_max_round()
       and coalesce(max(off.sent_at), max(ev.created_at))
             < now() - public.dispatch_silence_window()
  loop
    v_round := v_order.current_round + 1;
    v_sent := public.broadcast_order(v_order.id, v_round);

    -- Offers from the superseded round are done. Marking them expired keeps
    -- the customer's counters honest — "3 reviewing" that has actually been
    -- nobody for two minutes is worse than showing zero — and stops the
    -- acceptance-rate statistic in match_providers penalising providers for
    -- not answering an offer the system already moved past.
    perform public.begin_privileged_write();

    update public.order_offers
       set outcome = 'expired', responded_at = now()
     where order_offers.order_id = v_order.id
       -- Qualified: `round` is also an OUT parameter of this function, and an
       -- unqualified reference resolves to that instead of the column.
       and order_offers.round < v_round
       and order_offers.outcome in ('pending', 'viewed');

    perform public.end_privileged_write();

    order_id := v_order.id;
    round := v_round;
    offers_sent := v_sent;
    return next;
  end loop;
end;
$$;

comment on function public.expand_stale_searches() is
  'Widens every quiet search one rung (§7.1). Called on a timer; never by a client.';

-- Service role only. A customer widening their own search on demand would be
-- queue-jumping, and a provider triggering it could farm offers.
--
-- ⚠️ The revoke must name PUBLIC. Postgres grants EXECUTE on a new function to
-- PUBLIC by default, so revoking from `anon` and `authenticated` alone removes
-- nothing they did not already have through PUBLIC — the function stays
-- callable and the revoke reads as protection that is not there. Same shape as
-- the table-level grant that defeated a column-level revoke in 0037; caught
-- here only because the test asserted the refusal rather than the grant.
revoke execute on function public.expand_stale_searches() from public;
revoke execute on function public.expand_stale_searches() from anon, authenticated;
grant execute on function public.expand_stale_searches() to service_role;
