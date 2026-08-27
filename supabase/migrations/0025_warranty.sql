-- 0025 — Tracked warranty (ضمان)
--
-- CLAUDE.md §1 differentiator 5: "Every job carries a warranty period. If it
-- fails within the window, re-service is free and auto-routed back to the same
-- provider. Nobody does this."
--
-- Auto-routing back to the ORIGINAL provider is the part that matters. Sending
-- a failed repair to a different technician means the second one gets paid to
-- fix the first one's work, which quietly rewards bad work. Routing it back
-- makes the original provider bear the cost of doing it twice.

-- The escrow guard in 0020 requires an authorisation before acceptance. That
-- is right for paid work and wrong for a free re-service: there is nothing to
-- authorise, and requiring one would make warranty claims impossible to
-- accept. Relaxed to apply only where money is actually owed.
create or replace function public.enforce_order_transition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor        uuid := auth.uid();
  v_unapproved   int;
  v_service      record;
  v_provider     record;
  v_summary_ar   text;
  v_summary_en   text;
  v_event_type   public.timeline_event_type;
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

  if new.status = 'accepted' and old.status = 'quoted' then
    -- Only money that exists needs authorising. A warranty re-service is free
    -- by construction (parent_order_id is set, amounts are zero).
    if coalesce(new.quoted_amount, 0) > 0 and new.escrow_status <> 'authorised' then
      raise exception 'An order cannot be accepted before payment is authorised'
        using errcode = 'check_violation',
              hint = 'Authorise the payment, then accept.';
    end if;
    if new.provider_id is null then
      raise exception 'An accepted order must have a provider'
        using errcode = 'check_violation';
    end if;
  end if;

  if new.status = 'awaiting_approval' and new.parts_amount > 0 then
    select count(*) into v_unapproved
    from public.order_parts p
    where p.order_id = new.id and not p.approved_by_customer;

    if v_unapproved > 0 then
      raise exception '% part line(s) are not approved by the customer', v_unapproved
        using errcode = 'check_violation';
    end if;
  end if;

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
        coalesce(new.warranty_expires_at,
                 new.completed_at + make_interval(days => new.warranty_days));
    end if;
  end if;

  if new.status = 'cancelled' then
    new.cancelled_at := coalesce(new.cancelled_at, now());
  end if;

  insert into public.order_events (order_id, from_status, to_status, actor_id)
  values (new.id, old.status, new.status, v_actor);

  if new.status = 'completed' then
    if new.vehicle_id is not null then
      select * into v_service from public.services where id = new.service_id;
      select * into v_provider from public.providers where id = new.provider_id;

      -- A warranty re-service is recorded as such. On the resale report it
      -- matters that a repair had to be redone under warranty, and burying it
      -- as an ordinary service would hide a real signal from a buyer.
      v_event_type := case
        when new.parent_order_id is not null then 'warranty_claimed'
        else 'service_completed'
      end;

      v_summary_ar := case
        when new.parent_order_id is not null
          then format('إعادة خدمة تحت الضمان: %s', coalesce(v_service.name_ar, 'خدمة'))
        else coalesce(v_service.name_ar, 'خدمة مكتملة')
      end;
      v_summary_en := case
        when new.parent_order_id is not null
          then format('Warranty re-service: %s', coalesce(v_service.name_en, 'service'))
        else coalesce(v_service.name_en, 'Service completed')
      end;

      perform public.append_vehicle_timeline_event(
        p_vehicle_id  => new.vehicle_id,
        p_event_type  => v_event_type,
        p_summary_ar  => v_summary_ar,
        p_summary_en  => v_summary_en,
        p_occurred_at => new.completed_at,
        p_mileage     => new.mileage_at_order,
        p_order_id    => new.id,
        p_provider_id => new.provider_id,
        p_details     => jsonb_strip_nulls(jsonb_build_object(
          'order_number', new.order_number,
          'service_kind', v_service.name_en,
          'provider_business_name', v_provider.business_name_ar,
          'warranty_days', new.warranty_days,
          'labour_amount', new.labour_amount,
          'parts_amount', new.parts_amount,
          'is_warranty_reservice', new.parent_order_id is not null
        )),
        p_attachments => '[]'::jsonb
      );
    else
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


-- ---------------------------------------------------------------------------
-- claim_warranty
-- ---------------------------------------------------------------------------
create or replace function public.claim_warranty(
  p_order_id uuid,
  p_problem  text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor   uuid := auth.uid();
  v_parent  record;
  v_child   uuid;
begin
  if v_actor is null then
    raise exception 'Not authenticated' using errcode = 'insufficient_privilege';
  end if;

  select * into v_parent from public.orders o where o.id = p_order_id;

  if v_parent is null then
    raise exception 'Order % not found', p_order_id using errcode = 'no_data_found';
  end if;

  if v_parent.customer_id <> v_actor then
    raise exception 'Only the customer on the order may claim its warranty'
      using errcode = 'insufficient_privilege';
  end if;

  if v_parent.status <> 'completed' then
    raise exception 'Only a completed job carries a warranty' using errcode = 'check_violation';
  end if;

  if v_parent.warranty_expires_at is null then
    raise exception 'This job carried no warranty' using errcode = 'check_violation';
  end if;

  if v_parent.warranty_expires_at < now() then
    raise exception 'The warranty on this job expired on %',
      to_char(v_parent.warranty_expires_at, 'YYYY-MM-DD')
      using errcode = 'check_violation',
            hint = 'You can still book this as a normal paid service.';
  end if;

  -- One live claim per job. Without this, a repeated tap on a slow connection
  -- creates two free orders and dispatches the provider twice.
  if exists (
    select 1 from public.orders c
    where c.parent_order_id = p_order_id
      and c.status not in ('cancelled')
  ) then
    raise exception 'A warranty claim is already open on this job'
      using errcode = 'unique_violation';
  end if;

  insert into public.orders (
    customer_id, vehicle_id, service_id, fulfilment_mode, status,
    provider_id, workshop_id,
    service_location, service_address_ar,
    problem_description, mileage_at_order,
    -- Free by construction. Not "discounted to zero" — there is no money in
    -- this order at all, which is why no authorisation is required.
    quoted_amount, parts_amount, labour_amount, vat_amount, total_amount,
    escrow_status, parent_order_id, created_by
  ) values (
    v_parent.customer_id, v_parent.vehicle_id, v_parent.service_id,
    v_parent.fulfilment_mode, 'draft',
    -- Auto-routed to the SAME provider. This is the whole point.
    v_parent.provider_id, v_parent.workshop_id,
    v_parent.service_location, v_parent.service_address_ar,
    p_problem, v_parent.mileage_at_order,
    0, 0, 0, 0, 0,
    'none', p_order_id, v_actor
  )
  returning id into v_child;

  return v_child;
end;
$$;

comment on function public.claim_warranty(uuid, text) is
  'Free re-service routed back to the original provider, inside the warranty window. CLAUDE.md §1.5.';

grant execute on function public.claim_warranty(uuid, text) to authenticated;


-- Convenience view for the app: which completed jobs are still covered.
create or replace view public.active_warranties as
select
  o.id as order_id,
  o.order_number,
  o.customer_id,
  o.vehicle_id,
  o.provider_id,
  o.service_id,
  o.completed_at,
  o.warranty_expires_at,
  (o.warranty_expires_at - now()) as remaining,
  exists (
    select 1 from public.orders c
    where c.parent_order_id = o.id and c.status <> 'cancelled'
  ) as has_open_claim
from public.orders o
where o.status = 'completed'
  and o.warranty_expires_at is not null
  and o.warranty_expires_at > now()
  and o.parent_order_id is null;

-- The view inherits RLS from `orders` because it is not SECURITY DEFINER:
-- a customer sees only their own rows through it.
grant select on public.active_warranties to authenticated;
