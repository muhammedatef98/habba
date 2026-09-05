-- 0049 — Dispatch offers, and the telemetry the customer sees
--
-- `match_providers` (0021) ranks candidates and returns them. Nothing has ever
-- recorded what was actually sent or what came back, so the broadcast left no
-- trace: after the fact there was no way to say who was asked, who looked, or
-- why a customer waited nine minutes.
--
-- That gap is also why the design's waiting screen could not be built. Screen
-- 05's whole argument is "لا دوّارة" — no spinner. It shows how many
-- technicians were reached, how many are looking, and how far the search has
-- widened, because a number that visibly changes is what convinces someone
-- their rescue is in progress. Every one of those figures needs this table.

create type public.offer_outcome as enum ('pending', 'viewed', 'accepted', 'declined', 'expired');

create table public.order_offers (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references public.orders(id) on delete cascade,
  provider_id uuid not null references public.providers(id) on delete cascade,

  -- Which expansion round sent this, and how wide the search was at the time.
  -- Kept per-offer rather than derived, so the log the customer is shown stays
  -- true even after the ladder in `match_radius_for_round` is retuned.
  round       int not null check (round > 0),
  radius_m    int not null check (radius_m > 0),

  sent_at     timestamptz not null default now(),
  viewed_at   timestamptz,
  responded_at timestamptz,
  outcome     public.offer_outcome not null default 'pending',

  -- One offer per provider per order. A provider who appears in round 2 as
  -- well as round 1 was already asked; re-sending would inflate the count the
  -- customer is watching, which is the one number that has to stay honest.
  unique (order_id, provider_id)
);

create index order_offers_order_idx on public.order_offers (order_id, sent_at desc);
create index order_offers_provider_idx on public.order_offers (provider_id, outcome);

alter table public.order_offers enable row level security;

-- The provider sees their own offers — that is their job queue.
create policy order_offers_read_own on public.order_offers
  for select to authenticated
  using (
    exists (
      select 1 from public.providers pr
      where pr.id = order_offers.provider_id
        and pr.owner_profile_id = (select auth.uid())
    )
  );

-- ⚠️ The customer deliberately gets NO row-level read.
--
-- The counts are theirs to see; the identities are not. A customer who can
-- list the offers on their own order learns which specific technicians were
-- nearby and declined them, which is commercially sensitive to the provider
-- and a grudge waiting to happen. `order_dispatch_telemetry` below returns
-- aggregates through a definer function instead — the numbers without the
-- names.

create policy order_offers_update_own on public.order_offers
  for update to authenticated
  using (
    exists (
      select 1 from public.providers pr
      where pr.id = order_offers.provider_id
        and pr.owner_profile_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.providers pr
      where pr.id = order_offers.provider_id
        and pr.owner_profile_id = (select auth.uid())
    )
  );


-- ---------------------------------------------------------------------------
-- Column guard
-- ---------------------------------------------------------------------------
-- The provider may respond to an offer. They may not rewrite what was sent to
-- them, and they may not declare themselves the winner.
--
-- ⚠️ The second half is the security-relevant one. Without it, `outcome =
-- 'accepted'` is a plain UPDATE a provider can issue directly, which walks
-- straight past `accept_order` — and past its check that the order is funded
-- (0033). A provider could mark themselves accepted on an order nobody has
-- paid for, which is the exact hole the escrow guard exists to close.

create or replace function public.guard_order_offers()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.is_privileged_write() then
    return new;
  end if;

  -- What was sent is the system's record, not the recipient's.
  if new.order_id is distinct from old.order_id
     or new.provider_id is distinct from old.provider_id
     or new.round is distinct from old.round
     or new.radius_m is distinct from old.radius_m
     or new.sent_at is distinct from old.sent_at then
    raise exception 'An offer cannot be rewritten by its recipient'
      using errcode = 'insufficient_privilege';
  end if;

  -- Acceptance is a transition with money attached and belongs to
  -- accept_order(), which checks the escrow first.
  if new.outcome = 'accepted' and old.outcome is distinct from 'accepted' then
    raise exception 'Acceptance goes through accept_order(), which checks the order is funded'
      using errcode = 'insufficient_privilege',
            hint = 'Call accept_order(order_id) rather than updating the offer.';
  end if;

  return new;
end;
$$;

-- Named `_a_guard_columns` to match every other column guard: it must sort
-- first among the table's triggers, and the audit in tests/16 finds guards by
-- that suffix.
create trigger order_offers_a_guard_columns
  before update on public.order_offers
  for each row execute function public.guard_order_offers();

alter table public.order_offers enable always trigger order_offers_a_guard_columns;


-- ---------------------------------------------------------------------------
-- Broadcasting
-- ---------------------------------------------------------------------------

/**
 * Sends one round of offers for an order.
 *
 * Idempotent per provider: the unique constraint means a provider already
 * asked in an earlier round is skipped rather than counted twice.
 *
 * §7.1 broadcasts to several simultaneously and lets the first acceptance win
 * — deliberately not assign-one-and-wait, which is the anti-pattern the spec
 * calls out.
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
  return v_sent;
end;
$$;

/**
 * Broadcasts round 1 the moment an order starts searching.
 *
 * Later rounds need a scheduler — the ladder expands after 45 seconds of
 * silence (§7.1) and nothing here can wait. That belongs in an Edge Function
 * on a timer; this trigger covers the first and most important round so the
 * waiting screen has real figures from the second it opens.
 */
create or replace function public.broadcast_on_searching()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'searching' and (old.status is distinct from 'searching') then
    perform public.broadcast_order(new.id, 1);
  end if;
  return new;
end;
$$;

create trigger orders_broadcast_on_searching
  after update of status on public.orders
  for each row execute function public.broadcast_on_searching();

alter table public.orders enable always trigger orders_broadcast_on_searching;


-- ---------------------------------------------------------------------------
-- Telemetry — the numbers without the names
-- ---------------------------------------------------------------------------

create or replace function public.order_dispatch_telemetry(p_order_id uuid)
returns table (
  contacted_count  int,
  reviewing_count  int,
  notified_count   int,
  busy_count       int,
  radius_m         int,
  area_median_seconds int
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_order record;
begin
  select o.id, o.customer_id, o.status, o.service_id into v_order
    from public.orders o where o.id = p_order_id;

  if v_order is null then
    raise exception 'Order % not found', p_order_id using errcode = 'no_data_found';
  end if;

  if v_order.customer_id <> (select auth.uid()) then
    raise exception 'Only the customer may read dispatch telemetry for order %', p_order_id
      using errcode = 'insufficient_privilege';
  end if;

  -- Only while the search is actually running. Afterwards these numbers are
  -- history the customer has no use for, and exposing them on a completed
  -- order tells them how many people turned their job down.
  if v_order.status not in ('draft', 'searching') then
    return;
  end if;

  return query
  select
    count(*)::int,
    count(*) filter (where o.outcome = 'viewed')::int,
    count(*) filter (where o.outcome = 'pending')::int,
    count(*) filter (where o.outcome in ('declined', 'expired'))::int,
    coalesce(max(o.radius_m), public.match_radius_for_round(1))::int,
    -- Real median over this service's recent accepted offers, not a guess.
    -- Null when there is not enough history, and the screen then shows nothing
    -- rather than a made-up expectation.
    (
      select percentile_cont(0.5) within group (
        order by extract(epoch from (prior.responded_at - prior.sent_at))
      )::int
      from public.order_offers prior
      join public.orders po on po.id = prior.order_id
      where prior.outcome = 'accepted'
        and prior.responded_at is not null
        and po.service_id = v_order.service_id
        and prior.sent_at > now() - interval '30 days'
      having count(*) >= 5
    )
  from public.order_offers o
  where o.order_id = p_order_id;
end;
$$;

grant execute on function public.order_dispatch_telemetry(uuid) to authenticated;
grant execute on function public.broadcast_order(uuid, int) to service_role;
