-- 0067 — Parts: quoted while the job is open, answered by the customer
--
-- §1 differentiator 6: parts are line-itemed with part numbers, OEM flagged,
-- priced before approval. §9.1: approve or reject per line. The schema had the
-- lines and the approval; walking the flow found three gaps:
--
--   1. A line could be INSERTED already approved. 0035 guards updates, and an
--      insert is not an update, so a provider could add
--      (approved_by_customer = true) and bill a part nobody agreed to.
--   2. Lines could be added, re-priced or removed at any time — after
--      hand-back, after the customer had paid.
--   3. There was no way to say no. A customer who disagreed could only leave
--      the line unapproved, and the hand-back check (0020/0032) fired only when
--      parts_amount was already above zero — which the provider app never set
--      — so an unanswered quote went straight through hand-back.
--
-- Declining is recorded, not deleted: what was offered and refused is part of
-- what happened on the job, and it is exactly what a dispute would turn on.


alter table public.order_parts
  add column declined_at timestamptz,
  add constraint order_parts_one_answer check (not (approved_by_customer and declined_at is not null));

comment on column public.order_parts.declined_at is
  'The customer said no to this line. Kept as a record, never billed. 0067.';


-- While a part can be quoted, changed or removed: the job is on, not yet
-- handed back.
create or replace function public.order_is_open_for_parts(p_status public.order_status)
returns boolean
language sql
immutable
as $$
  select p_status in ('accepted', 'en_route', 'arrived', 'checked_in', 'in_progress');
$$;


-- ---------------------------------------------------------------------------
-- A new line is a question to the customer, never an answer
-- ---------------------------------------------------------------------------
create or replace function public.guard_order_parts_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.order_status;
begin
  if public.is_ops() or public.is_privileged_write() then
    return new;
  end if;

  select o.status into v_status from public.orders o where o.id = new.order_id;

  if not public.order_is_open_for_parts(v_status) then
    raise exception 'Parts can only be quoted while the job is open (status is %)', v_status
      using errcode = 'check_violation';
  end if;

  if length(trim(coalesce(new.name_ar, ''))) = 0 then
    raise exception 'A part needs a name' using errcode = 'check_violation';
  end if;

  if new.warranty_days is not null and new.warranty_days > 730 then
    raise exception 'A part warranty is at most two years' using errcode = 'check_violation';
  end if;

  -- Whatever the insert said: the customer has not answered yet.
  new.approved_by_customer := false;
  new.approved_at := null;
  new.declined_at := null;
  return new;
end;
$$;

create trigger order_parts_a_guard_insert
  before insert on public.order_parts
  for each row execute function public.guard_order_parts_insert();

alter table public.order_parts enable always trigger order_parts_a_guard_insert;


-- Removing a line: only while the job is open, and never one the customer
-- declined — that refusal is the record.
create or replace function public.guard_order_parts_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.order_status;
begin
  if public.is_ops() or public.is_privileged_write() then
    return old;
  end if;

  select o.status into v_status from public.orders o where o.id = old.order_id;

  if not public.order_is_open_for_parts(v_status) then
    raise exception 'Parts cannot be removed after hand-back' using errcode = 'check_violation';
  end if;

  if old.declined_at is not null then
    raise exception 'A declined part stays on the record' using errcode = 'check_violation';
  end if;

  return old;
end;
$$;

create trigger order_parts_a_guard_delete
  before delete on public.order_parts
  for each row execute function public.guard_order_parts_delete();

alter table public.order_parts enable always trigger order_parts_a_guard_delete;


-- ---------------------------------------------------------------------------
-- 0035's line guard, with the answer widened to "approve or decline" and the
-- whole thing confined to an open job
-- ---------------------------------------------------------------------------
create or replace function public.guard_order_parts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order    record;
  v_provider uuid := public.current_provider_id();
  v_is_customer boolean;
  v_is_provider boolean;
  v_priced_change boolean;
  v_answer_change boolean;
begin
  if public.is_ops() or public.is_privileged_write() then
    return new;
  end if;

  select * into v_order from public.orders o where o.id = old.order_id;

  v_is_customer := auth.uid() is not null and auth.uid() = v_order.customer_id;
  v_is_provider := v_provider is not null and v_provider = v_order.provider_id;

  if new.order_id is distinct from old.order_id then
    raise exception 'A part line cannot be moved to another order'
      using errcode = 'insufficient_privilege';
  end if;

  v_priced_change :=
       new.unit_price is distinct from old.unit_price
    or new.quantity is distinct from old.quantity
    or new.name_ar is distinct from old.name_ar
    or new.part_number is distinct from old.part_number
    or new.is_oem is distinct from old.is_oem
    or new.warranty_days is distinct from old.warranty_days;

  v_answer_change :=
       new.approved_by_customer is distinct from old.approved_by_customer
    or new.approved_at is distinct from old.approved_at
    or new.declined_at is distinct from old.declined_at;

  if (v_priced_change or v_answer_change)
     and not public.order_is_open_for_parts(v_order.status) then
    raise exception 'Parts are settled once the job is handed back (status is %)', v_order.status
      using errcode = 'check_violation';
  end if;

  -- What the part is and what it costs is the provider's to state.
  if v_priced_change and not v_is_provider then
    raise exception 'Only the assigned provider may change a part line'
      using errcode = 'insufficient_privilege';
  end if;

  -- Whether to pay for it is the customer's to decide — yes or no.
  if v_answer_change and not v_is_customer then
    raise exception 'Only the customer may approve or decline a part line'
      using errcode = 'insufficient_privilege';
  end if;

  -- A changed line is a new question. Whatever the customer said about the
  -- old one — yes or no — no longer applies (0035's reasoning, both ways).
  if v_priced_change then
    new.approved_by_customer := false;
    new.approved_at := null;
    new.declined_at := null;
  end if;

  return new;
end;
$$;


-- ---------------------------------------------------------------------------
-- The state machine, carried forward from 0032 with the hand-back check on
-- parts rewritten: every line answered, whatever the amounts.
-- ---------------------------------------------------------------------------
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

  -- Every quoted part needs the customer's answer before hand-back — approved
  -- or declined (0067). This used to fire only when parts_amount was already
  -- above zero, which the provider app never set, so a quote the customer had
  -- not seen could sit unanswered through hand-back. On the in_progress →
  -- completed shortcut too, or that becomes the way around it.
  if new.status = 'awaiting_approval'
     or (new.status = 'completed' and old.status = 'in_progress') then
    select count(*) into v_unapproved
    from public.order_parts p
    where p.order_id = new.id and not p.approved_by_customer and p.declined_at is null;

    if v_unapproved > 0 then
      raise exception '% part line(s) are still waiting for the customer', v_unapproved
        using errcode = 'check_violation',
              hint = 'The customer approves or declines each part first; or remove the line.';
    end if;
  end if;

  if new.status = 'awaiting_approval' then

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
