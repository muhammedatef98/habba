-- 0071 — An order the customer never confirms still ends
--
-- Hand-back puts an order in `awaiting_approval`, and until now only the
-- customer (or an operator) could move it on. A customer who never opens the
-- app again left the job open forever: the provider unpaid, the money held on
-- the card until the authorisation lapsed, and the car's logbook missing the
-- service. The state machine has anticipated this from the start
-- (`completed_by_timeout`, 0020) and the refusal message has promised it; now
-- it happens.
--
--   * Half-way through the window the customer is reminded, once.
--   * At the end the order completes by itself, the payment is captured, the
--     service is written to the logbook — marked as completed by timeout, so
--     the Habba Report never says a customer approved what they only let
--     pass — and the customer is told. They can still dispute it for the
--     usual window (0070).
--   * The window is an operator's setting.
--
-- Run by the scheduler through dispatch-tick, as the service role: nobody
-- else may call it.
--
-- Also here: the privileged-write switch (0033) was executable by every
-- client. Its flag lasts one transaction and PostgREST gives a client no way
-- to run anything after it in the same one, so it opened nothing — but the
-- guards should not rest on a property of the gateway. Only the definer
-- functions that own it call it now.

revoke execute on function public.begin_privileged_write() from public, anon, authenticated;
revoke execute on function public.end_privileged_write() from public, anon, authenticated;


insert into public.platform_settings
  (key, value, value_type, min_value, max_value, is_public, category, label_ar, unit_ar, description_ar, sort_order)
values
  ('auto_complete_after_hours', '24', 'integer', 2, 168, true, 'ops',
   'الإقفال التلقائي بعد تسليم العمل', 'ساعة',
   'إن لم يعتمد العميل العمل ولم يشتكِ خلال هذه المدة يُقفل الطلب ويُحصَّل المبلغ. يُذكَّر في منتصفها.', 30)
on conflict (key) do nothing;

create or replace function public.auto_complete_window()
returns interval
language sql
stable
as $$
  select make_interval(hours => public.setting_number('auto_complete_after_hours', 24)::int)
$$;


-- The logbook needs a person behind every entry: `created_by` is required and
-- covered by the hash (ADR-0004). An order completed by the clock has no
-- signed-in caller, so a trusted function names the entry's owner in
-- `habba.timeline_actor` — honoured only while it holds the privileged-write
-- flag, which no client can set. Carried forward from 0058 otherwise.
create or replace function public.append_vehicle_timeline_event(
  p_vehicle_id uuid,
  p_event_type public.timeline_event_type,
  p_summary_ar text,
  p_summary_en text,
  p_occurred_at timestamptz default now(),
  p_mileage integer default null,
  p_order_id uuid default null,
  p_provider_id uuid default null,
  p_details jsonb default '{}'::jsonb,
  p_attachments jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor       uuid := coalesce(
                          auth.uid(),
                          case when public.is_privileged_write()
                               then nullif(current_setting('habba.timeline_actor', true), '')::uuid end);
  v_owner_id    uuid;
  v_prev_hash   text;
  v_id          uuid := gen_random_uuid();
  v_provenance  public.timeline_provenance;
  v_payload     text;
  v_row_hash    text;
begin
  if v_actor is null then
    raise exception 'Not authenticated' using errcode = 'insufficient_privilege';
  end if;

  select v.owner_id into v_owner_id
  from public.vehicles v
  where v.id = p_vehicle_id and v.is_active;

  if v_owner_id is null then
    raise exception 'Vehicle % not found', p_vehicle_id using errcode = 'no_data_found';
  end if;

  if v_owner_id <> v_actor and not public.is_ops() and not public.is_privileged_write() then
    raise exception 'Not permitted to write to this vehicle timeline'
      using errcode = 'insufficient_privilege';
  end if;

  if p_occurred_at > now() + interval '5 minutes' then
    raise exception 'occurred_at cannot be in the future' using errcode = 'check_violation';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_vehicle_id::text, 0));

  select t.row_hash into v_prev_hash
  from public.vehicle_timeline t
  where t.vehicle_id = p_vehicle_id
  order by t.seq desc
  limit 1;

  v_prev_hash := coalesce(v_prev_hash, 'GENESIS');
  v_provenance := public.derive_timeline_provenance(p_event_type, p_order_id, p_attachments);

  v_payload := public.timeline_row_payload(
    v_prev_hash, v_id, p_vehicle_id, p_event_type, p_occurred_at, p_mileage,
    p_order_id, p_provider_id, v_actor, v_provenance, p_details, p_attachments
  );
  v_row_hash := public.timeline_row_hash(v_payload);

  insert into public.vehicle_timeline (
    id, vehicle_id, event_type, occurred_at, recorded_at, mileage,
    order_id, provider_id, provenance, summary_ar, summary_en,
    details, attachments, created_by, prev_hash, row_hash
  ) values (
    v_id, p_vehicle_id, p_event_type, p_occurred_at, now(), p_mileage,
    p_order_id, p_provider_id, v_provenance, p_summary_ar, p_summary_en,
    coalesce(p_details, '{}'::jsonb), coalesce(p_attachments, '[]'::jsonb),
    v_actor, v_prev_hash, v_row_hash
  );

  if p_mileage is not null then
    perform public.append_odometer_reading(
      p_vehicle_id  => p_vehicle_id,
      p_km          => p_mileage,
      p_source      => (case when p_order_id is not null then 'service_order' else 'manual' end)
                       ::public.odometer_source,
      p_order_id    => p_order_id,
      p_recorded_at => p_occurred_at,
      p_note        => null,
      p_strict      => false
    );
  end if;

  return v_id;
end;
$$;


-- The state machine, carried forward from 0069: the logbook entry of an order
-- completed by the clock says so.
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
    perform public.assert_completion_evidence(new.id);
  end if;

  if new.status = 'completed' and old.status = 'in_progress' then
    perform public.assert_completion_evidence(new.id);
  end if;

  if new.status = 'completed' and old.status = 'awaiting_approval' then
    if not new.completed_by_timeout
       and v_actor is distinct from new.customer_id
       and not public.is_ops() then
      raise exception 'Only the customer may confirm completion'
        using errcode = 'insufficient_privilege',
              hint = 'The order auto-completes 24h after the customer stops responding.';
    end if;
  end if;

  if new.status = 'disputed'
     and v_actor is distinct from new.customer_id
     and not public.is_ops()
     and not public.is_privileged_write() then
    raise exception 'Only the customer or Habba may open a dispute'
      using errcode = 'insufficient_privilege';
  end if;

  if old.status = 'disputed' and not public.is_ops() and not public.is_privileged_write() then
    raise exception 'Only Habba resolves a dispute'
      using errcode = 'insufficient_privilege';
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

  -- Resolving a dispute returns the order to `completed`; its logbook entry
  -- was written the first time, and the hash chain would faithfully record a
  -- second one as a second service that never happened.
  if new.status = 'completed' and old.status <> 'disputed' then
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

      v_attachments := coalesce(new.completion_media, '[]'::jsonb);
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
          'is_warranty_reservice', new.parent_order_id is not null,
          -- Said on the record when nobody confirmed it: the report should
          -- not claim a customer approved what they merely did not dispute.
          'completed_by_timeout', case when new.completed_by_timeout then true end
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


create or replace function public.notification_ttl(p_kind text)
returns interval
language sql
immutable
as $$
  select case
    when p_kind = 'job_offer' then interval '5 minutes'
    when p_kind = 'booking_confirmed' then interval '12 hours'
    when p_kind = 'care_reminder' then interval '12 hours'
    when p_kind = 'announcement' then interval '24 hours'
    when p_kind = 'job_assigned' then interval '30 minutes'
    when p_kind = 'approval_reminder' then interval '6 hours'
    when p_kind = 'order_auto_completed' then interval '24 hours'
    else interval '30 minutes'
  end;
$$;


-- One pass: remind the customers half-way through, complete the ones past
-- the window. Each order in its own sub-transaction, so one that cannot be
-- completed (a car transferred mid-job, a capture the PSP refused) is
-- reported and skipped rather than holding up everyone else's.
--
-- `p_as_of` is the clock, a parameter so the suite can run the window
-- without waiting a day; only the service role can call this at all.
create or replace function public.auto_complete_awaiting_orders(
  p_limit int default 200,
  p_as_of timestamptz default now()
)
returns table (order_id uuid, outcome text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window interval := public.auto_complete_window();
  v_order  record;
begin
  for v_order in
    select o.id, o.customer_id, o.escrow_status, o.order_number, s.name_ar, s.name_en,
           coalesce(max(ev.created_at), o.updated_at) as handed_back_at
      from public.orders o
      join public.services s on s.id = o.service_id
      left join public.order_events ev on ev.order_id = o.id and ev.to_status = 'awaiting_approval'
     where o.status = 'awaiting_approval'
     group by o.id, s.name_ar, s.name_en
    having coalesce(max(ev.created_at), o.updated_at) < p_as_of - v_window / 2
     order by 7
     limit greatest(p_limit, 1)
  loop
    if v_order.handed_back_at >= p_as_of - v_window then
      -- Half-way: remind once (the dedupe key makes a second call a no-op).
      perform public.enqueue_notification(
        v_order.customer_id, 'approval_reminder',
        'العمل بانتظار اعتمادك', 'The work is waiting for your approval',
        format('راجع العمل واعتمده، أو أبلغ عن مشكلة. يُقفل الطلب تلقائياً بعد %s ساعة من التسليم.',
               extract(epoch from v_window)::int / 3600),
        format('Review and approve it, or report a problem. The order closes by itself %s hours after hand-back.',
               extract(epoch from v_window)::int / 3600),
        jsonb_build_object('route', '/tracking', 'id', v_order.id),
        format('approval-reminder:%s', v_order.id));
      order_id := v_order.id;
      outcome := 'reminded';
      return next;
      continue;
    end if;

    begin
      perform set_config('habba.timeline_actor', v_order.customer_id::text, true);
      perform public.begin_privileged_write();

      update public.orders
         set completed_by_timeout = true,
             status = 'completed'
       where id = v_order.id and status = 'awaiting_approval';

      if v_order.escrow_status = 'authorised' then
        perform public.capture_order_payment(v_order.id);
      end if;

      perform public.end_privileged_write();
      perform set_config('habba.timeline_actor', '', true);

      perform public.enqueue_notification(
        v_order.customer_id, 'order_auto_completed',
        format('أُقفل طلب %s', v_order.name_ar), format('%s is closed', v_order.name_en),
        'لم يصلنا اعتمادك فأُقفل الطلب تلقائياً وحُفظ في دفتر سيارتك. إن كانت هناك مشكلة فأبلغنا من صفحة الطلب.',
        'We did not hear from you, so the order closed by itself and is in your car''s logbook. If something is wrong, report it from the order page.',
        jsonb_build_object('route', '/tracking', 'id', v_order.id),
        format('auto-completed:%s', v_order.id));

      order_id := v_order.id;
      outcome := 'completed';
    exception when others then
      perform public.end_privileged_write();
      perform set_config('habba.timeline_actor', '', true);
      order_id := v_order.id;
      outcome := 'failed: ' || sqlerrm;
    end;
    return next;
  end loop;
end;
$$;

revoke execute on function public.auto_complete_awaiting_orders(int, timestamptz) from public, anon, authenticated;
grant execute on function public.auto_complete_awaiting_orders(int, timestamptz) to service_role;
