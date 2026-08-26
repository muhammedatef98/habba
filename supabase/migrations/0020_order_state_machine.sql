-- 0020 — The order state machine
--
-- CLAUDE.md §2.2: state transitions live in Postgres, never in the app.
-- ADR-0006 for the per-mode adjacency tables and the guards.
--
-- The single most important line in this file is the completion rule: a
-- completed order MUST write to vehicle_timeline in the same transaction.
-- That is the mechanism by which the moat fills itself, and it is why the
-- write is a trigger rather than something the app remembers to do.

-- Per-mode adjacency. A transition absent from this table is rejected.
-- Three tables rather than one permissive union: a single table would let a
-- workshop order report `en_route`.
create table public.order_transitions (
  fulfilment_mode fulfilment_mode not null,
  from_status     order_status not null,
  to_status       order_status not null,
  primary key (fulfilment_mode, from_status, to_status)
);

insert into public.order_transitions (fulfilment_mode, from_status, to_status) values
  -- On-demand emergency: broadcast, accept, drive, work.
  ('mobile_ondemand', 'draft',             'searching'),
  ('mobile_ondemand', 'searching',         'quoted'),
  ('mobile_ondemand', 'searching',         'accepted'),
  ('mobile_ondemand', 'quoted',            'accepted'),
  ('mobile_ondemand', 'accepted',          'en_route'),
  ('mobile_ondemand', 'en_route',          'arrived'),
  ('mobile_ondemand', 'arrived',           'in_progress'),
  ('mobile_ondemand', 'in_progress',       'awaiting_approval'),
  ('mobile_ondemand', 'awaiting_approval', 'completed'),
  ('mobile_ondemand', 'in_progress',       'completed'),

  -- Scheduled mobile: the customer picked the provider, so no search.
  ('mobile_scheduled', 'draft',             'quoted'),
  ('mobile_scheduled', 'draft',             'accepted'),
  ('mobile_scheduled', 'quoted',            'accepted'),
  ('mobile_scheduled', 'accepted',          'en_route'),
  ('mobile_scheduled', 'en_route',          'arrived'),
  ('mobile_scheduled', 'arrived',           'in_progress'),
  ('mobile_scheduled', 'in_progress',       'awaiting_approval'),
  ('mobile_scheduled', 'awaiting_approval', 'completed'),
  ('mobile_scheduled', 'in_progress',       'completed'),

  -- Workshop: no driving. `checked_in` replaces en_route/arrived.
  ('workshop', 'draft',             'quoted'),
  ('workshop', 'draft',             'accepted'),
  ('workshop', 'quoted',            'accepted'),
  ('workshop', 'accepted',          'checked_in'),
  ('workshop', 'checked_in',        'in_progress'),
  ('workshop', 'in_progress',       'awaiting_approval'),
  ('workshop', 'awaiting_approval', 'completed'),
  ('workshop', 'in_progress',       'completed');

-- Cancellation and dispute apply to every mode, so they are generated rather
-- than repeated three times.
insert into public.order_transitions (fulfilment_mode, from_status, to_status)
select m.mode, s.status, 'cancelled'::order_status
from unnest(enum_range(null::fulfilment_mode)) as m(mode)
cross join unnest(enum_range(null::order_status)) as s(status)
where s.status not in ('completed', 'cancelled', 'disputed');

insert into public.order_transitions (fulfilment_mode, from_status, to_status)
select m.mode, 'completed'::order_status, 'disputed'::order_status
from unnest(enum_range(null::fulfilment_mode)) as m(mode);


-- ---------------------------------------------------------------------------
-- The trigger
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER, and not for convenience.
--
-- A trigger function runs as the CALLING user, so RLS applies to what it
-- writes. `order_events` deliberately has no INSERT policy — an audit trail a
-- client can write by hand is not an audit trail — which means the trigger
-- itself was blocked from recording transitions. The .sql suites never saw it
-- because they run as the table owner, who bypasses RLS; the first request
-- over HTTP failed immediately.
--
-- So the function elevates, and `order_events` stays closed to clients.
create or replace function public.enforce_order_transition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor        uuid := auth.uid();
  v_unapproved   int;
  v_vehicle      record;
  v_service      record;
  v_provider     record;
  v_summary_ar   text;
  v_summary_en   text;
begin
  if new.status = old.status then
    return new;
  end if;

  if not exists (
    select 1 from public.order_transitions t
    where t.fulfilment_mode = old.fulfilment_mode
      and t.from_status = old.status
      and t.to_status = new.status
  ) then
    raise exception '% orders cannot move from % to %',
      old.fulfilment_mode, old.status, new.status
      using errcode = 'check_violation';
  end if;

  -- Guard: money is authorised before a provider is committed to the job.
  -- This is the escrow promise in §1 — nobody drives out on an unfunded order.
  if new.status = 'accepted' and old.status = 'quoted' then
    if new.escrow_status <> 'authorised' then
      raise exception 'An order cannot be accepted before payment is authorised'
        using errcode = 'check_violation',
              hint = 'Authorise the payment, then accept.';
    end if;
    if new.provider_id is null then
      raise exception 'An accepted order must have a provider'
        using errcode = 'check_violation';
    end if;
  end if;

  -- Guard: the customer approved every part before it is fitted. Build prompt
  -- §6.5 and the transparent-parts-pricing differentiator (§1.6).
  if new.status = 'awaiting_approval' and new.parts_amount > 0 then
    select count(*) into v_unapproved
    from public.order_parts p
    where p.order_id = new.id and not p.approved_by_customer;

    if v_unapproved > 0 then
      raise exception '% part line(s) are not approved by the customer', v_unapproved
        using errcode = 'check_violation';
    end if;
  end if;

  -- Guard: only the customer closes the job — or the auto-completion job,
  -- which flags itself (ADR-0006). A provider marking their own work complete
  -- would gut the escrow promise.
  if new.status = 'completed' and old.status = 'awaiting_approval' then
    if not new.completed_by_timeout and v_actor is distinct from new.customer_id then
      raise exception 'Only the customer may confirm completion'
        using errcode = 'insufficient_privilege',
              hint = 'The order auto-completes 24h after the customer stops responding.';
    end if;
  end if;

  if new.status = 'completed' then
    new.completed_at := coalesce(new.completed_at, now());

    if new.warranty_days is not null then
      new.warranty_expires_at :=
        coalesce(new.warranty_expires_at, new.completed_at + make_interval(days => new.warranty_days));
    end if;
  end if;

  if new.status = 'cancelled' then
    new.cancelled_at := coalesce(new.cancelled_at, now());
  end if;

  insert into public.order_events (order_id, from_status, to_status, actor_id)
  values (new.id, old.status, new.status, v_actor);

  -- -------------------------------------------------------------------------
  -- Completion writes the logbook. Non-negotiable (CLAUDE.md §1).
  -- -------------------------------------------------------------------------
  if new.status = 'completed' then
    if new.vehicle_id is not null then
      select * into v_service from public.services where id = new.service_id;
      select * into v_provider from public.providers where id = new.provider_id;

      v_summary_ar := coalesce(v_service.name_ar, 'خدمة مكتملة');
      v_summary_en := coalesce(v_service.name_en, 'Service completed');

      perform public.append_vehicle_timeline_event(
        p_vehicle_id  => new.vehicle_id,
        p_event_type  => 'service_completed',
        p_summary_ar  => v_summary_ar,
        p_summary_en  => v_summary_en,
        p_occurred_at => new.completed_at,
        p_mileage     => new.mileage_at_order,
        p_order_id    => new.id,
        p_provider_id => new.provider_id,
        p_details     => jsonb_strip_nulls(jsonb_build_object(
          'order_number', new.order_number,
          'service_kind', v_service.name_en,
          -- Business name only. The report redacts provider names to business
          -- names (build prompt §7.3), and there is no reason to record more.
          'provider_business_name', v_provider.business_name_ar,
          'warranty_days', new.warranty_days,
          'labour_amount', new.labour_amount,
          'parts_amount', new.parts_amount
        )),
        p_attachments => '[]'::jsonb
      );
    else
      -- Orders with no vehicle are permitted only where the service says so
      -- (pre-purchase inspection). Their record lives in inspection_reports
      -- until the buyer purchases and Phase 5 converts it. Without this branch
      -- the mandatory-timeline rule would make those orders uncompletable.
      select * into v_service from public.services where id = new.service_id;

      if v_service.requires_vehicle then
        raise exception 'Order % has no vehicle but service % requires one',
          new.order_number, v_service.name_en
          using errcode = 'check_violation';
      end if;
    end if;
  end if;

  return new;
end;
$$;

create trigger orders_enforce_transition
  before update of status on public.orders
  for each row execute function public.enforce_order_transition();

-- Fires for service_role too: a state machine only the app respects is not a
-- state machine.
alter table public.orders enable always trigger orders_enforce_transition;


-- Ratings are only meaningful on work that finished, and only from the
-- customer who received it.
-- Same reason as enforce_order_transition: reads and writes here must not be
-- filtered by the rater's own RLS view.
create or replace function public.guard_rating()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order record;
begin
  select * into v_order from public.orders o where o.id = new.order_id;

  if v_order is null then
    raise exception 'Order % not found', new.order_id using errcode = 'no_data_found';
  end if;

  if v_order.status <> 'completed' then
    raise exception 'Only a completed order can be rated (order is %)', v_order.status
      using errcode = 'check_violation';
  end if;

  if new.rater_id <> v_order.customer_id then
    raise exception 'Only the customer on the order may rate it'
      using errcode = 'insufficient_privilege';
  end if;

  new.provider_id := v_order.provider_id;
  return new;
end;
$$;

create trigger ratings_guard
  before insert on public.ratings
  for each row execute function public.guard_rating();

-- Keep the provider's aggregate in step. Recomputed rather than incremented:
-- an incremental average drifts, and this runs once per completed job.
-- A customer has no UPDATE policy on `providers` — correctly, since they must
-- not be able to edit a provider. But that also blocks this aggregate refresh
-- when it runs as the customer who just left the rating.
create or replace function public.refresh_provider_rating()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.providers p
  set rating_avg = sub.avg_stars,
      rating_count = sub.n
  from (
    select round(avg(stars)::numeric, 2) as avg_stars, count(*)::int as n
    from public.ratings where provider_id = new.provider_id
  ) as sub
  where p.id = new.provider_id;

  return null;
end;
$$;

create trigger ratings_refresh_provider
  after insert on public.ratings
  for each row execute function public.refresh_provider_rating();
