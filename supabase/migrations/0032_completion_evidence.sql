-- 0032 — Completion evidence
--
-- Build prompt §9.2: "Completion: **Mandatory:** mileage reading + before/after
-- photos + parts used. This is what feeds the logbook — enforce it."
-- Build prompt §11: "Do not skip the completion photos/mileage. Without them
-- the moat is empty."
--
-- Until now a provider could close a job having recorded neither, which would
-- have produced a logbook full of entries saying a service happened and
-- nothing else. The whole resale proposition rests on those entries carrying
-- an odometer reading and photographs — that is the difference between "the
-- seller says the brakes were done" and "here is the reading and the parts".
--
-- The guard sits on in_progress → awaiting_approval, not on completion: the
-- provider must supply the evidence BEFORE handing the job back for the
-- customer to approve. Asking for it after the customer has confirmed means
-- asking a technician who has already driven away.

alter table public.orders
  add column completion_mileage int check (completion_mileage is null or completion_mileage >= 0),
  -- [{url, kind: 'before'|'after'|'part', caption}]
  add column completion_media jsonb not null default '[]'::jsonb;

comment on column public.orders.completion_media is
  'Before/after photos captured at completion. Flows into the timeline attachments, where the hash chain protects it.';


-- Which services require photographic evidence.
--
-- Not every job produces a meaningful before/after: a fuel delivery or a
-- lockout has nothing to photograph, and demanding a picture there trains
-- technicians to submit junk to get past the screen — which is worse than
-- asking for nothing, because junk evidence looks like evidence.
alter table public.services
  add column requires_completion_photos boolean not null default true,
  add column requires_completion_mileage boolean not null default true;

-- Which services are exempt is set in supabase/seed/02_services.sql, NOT
-- here: migrations run before seeds, so an UPDATE against `services` at
-- migration time matches zero rows and silently does nothing. The defaults
-- above are deliberately strict, so a service that is never exempted stays
-- covered rather than quietly opting out.


create or replace function public.assert_completion_evidence(p_order_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_order   record;
  v_service record;
  v_before  int;
  v_after   int;
begin
  select * into v_order from public.orders o where o.id = p_order_id;
  select * into v_service from public.services s where s.id = v_order.service_id;

  -- A free warranty re-service is exempt from nothing: it is still work done
  -- on the car and still belongs in the logbook with evidence.

  if v_service.requires_completion_mileage and v_order.completion_mileage is null then
    raise exception 'An odometer reading is required to complete this job'
      using errcode = 'check_violation',
            hint = 'Record the reading from the dashboard before handing the job back.';
  end if;

  if v_service.requires_completion_photos then
    select
      count(*) filter (where m ->> 'kind' = 'before'),
      count(*) filter (where m ->> 'kind' = 'after')
    into v_before, v_after
    from jsonb_array_elements(coalesce(v_order.completion_media, '[]'::jsonb)) as m;

    if v_before = 0 or v_after = 0 then
      raise exception 'Before and after photos are required to complete this job (have % before, % after)',
        v_before, v_after
        using errcode = 'check_violation',
              hint = 'The customer''s logbook and resale report depend on these.';
    end if;
  end if;
end;
$$;


-- Rebuilt to add the evidence guard and to carry the photos into the timeline.
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
  v_attachments  jsonb;
  v_mileage      int;
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

  if new.status = 'awaiting_approval' then
    if new.parts_amount > 0 then
      select count(*) into v_unapproved
      from public.order_parts p
      where p.order_id = new.id and not p.approved_by_customer;

      if v_unapproved > 0 then
        raise exception '% part line(s) are not approved by the customer', v_unapproved
          using errcode = 'check_violation';
      end if;
    end if;

    -- The moat's raw material. Enforced here so the technician is still
    -- standing next to the car when it is asked for.
    perform public.assert_completion_evidence(new.id);
  end if;

  -- The same evidence is required on the shortcut straight from in_progress,
  -- or that path becomes the way to skip it.
  if new.status = 'completed' and old.status = 'in_progress' then
    perform public.assert_completion_evidence(new.id);
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

      -- The photos become timeline attachments, which the hash chain covers
      -- (ADR-0004). That is what makes them evidence rather than decoration:
      -- swapping a before/after photo later breaks verification.
      v_attachments := coalesce(new.completion_media, '[]'::jsonb);

      -- Prefer the reading taken at completion over the one taken at booking:
      -- the car was driven to the workshop.
      v_mileage := coalesce(new.completion_mileage, new.mileage_at_order);

      perform public.append_vehicle_timeline_event(
        p_vehicle_id  => new.vehicle_id,
        p_event_type  => v_event_type,
        p_summary_ar  => v_summary_ar,
        p_summary_en  => v_summary_en,
        p_occurred_at => new.completed_at,
        p_mileage     => v_mileage,
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
        p_attachments => v_attachments
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


-- The provider records evidence in one call, so a half-saved completion
-- cannot exist: photos without a reading, or a reading the app then fails to
-- pair with photos.
create or replace function public.record_completion_evidence(
  p_order_id uuid,
  p_mileage  int,
  p_media    jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order record;
begin
  select * into v_order from public.orders o where o.id = p_order_id;

  if v_order is null then
    raise exception 'Order % not found', p_order_id using errcode = 'no_data_found';
  end if;

  if v_order.provider_id is distinct from public.current_provider_id() then
    raise exception 'Only the assigned provider may record completion evidence'
      using errcode = 'insufficient_privilege';
  end if;

  if v_order.status not in ('in_progress', 'arrived', 'checked_in') then
    raise exception 'Evidence is recorded while the job is in progress (status is %)',
      v_order.status
      using errcode = 'check_violation';
  end if;

  update public.orders
  set completion_mileage = p_mileage,
      completion_media = coalesce(p_media, '[]'::jsonb)
  where id = p_order_id;
end;
$$;

grant execute on function public.record_completion_evidence(uuid, int, jsonb) to authenticated;
grant execute on function public.assert_completion_evidence(uuid) to authenticated;
