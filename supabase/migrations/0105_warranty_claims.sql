-- 0105 — A warranty you can actually claim
--
-- The tracked warranty is one of Habba's six differentiators (CLAUDE.md §1.5):
-- if the work fails inside the window, the re-service is free and goes back to
-- the same provider. claim_warranty() (0025, 0055) built that order — free,
-- same provider, claimed by whoever owns the car now — and then left it as a
-- draft nothing could move. No screen called it at all.
--
--   request_warranty_service()  the customer's one call: claim, then confirm
--                               the free re-service with the same provider
--                               ('accepted'), who is told at once. An
--                               on-demand original comes back as a scheduled
--                               visit: same technician, no broadcast.
--   notify_order_status()       a claim gets its own message to the provider
--                               («مطالبة ضمان») instead of the booking one,
--                               which would print an empty appointment time.
--   vehicle_warranties()        adds how the original was done (a workshop
--                               claim needs no location) and the open claim's
--                               id, so the logbook can lead to it.
--   ops_order_detail()          the original job's file lists its claims.

create or replace function public.request_warranty_service(
  p_order_id   uuid,
  p_problem    text,
  p_lon        double precision default null,
  p_lat        double precision default null,
  p_address_ar text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_problem text := btrim(coalesce(p_problem, ''));
  v_child   uuid;
begin
  if length(v_problem) < 5 then
    raise exception 'Describe what went wrong'
      using errcode = 'check_violation', hint = 'warranty:problem';
  end if;

  -- Every rule about who may claim, and on what, stays in claim_warranty.
  v_child := public.claim_warranty(p_order_id, v_problem, p_lon, p_lat, p_address_ar);

  -- A re-service is a planned visit by a named technician, not an emergency
  -- broadcast: an on-demand original comes back as a scheduled visit, which
  -- the state machine lets go straight to 'accepted' (a broadcast order would
  -- have to pass through 'searching' and be offered to everyone nearby).
  perform public.begin_privileged_write();
  update public.orders
     set fulfilment_mode = 'mobile_scheduled'
   where id = v_child and fulfilment_mode = 'mobile_ondemand';
  perform public.end_privileged_write();

  update public.orders set status = 'accepted' where id = v_child;
  return v_child;
end;
$$;

comment on function public.request_warranty_service(uuid, text, double precision, double precision, text) is
  'Claims a live warranty and confirms the free re-service with the original provider. 0105.';

revoke all on function public.request_warranty_service(uuid, text, double precision, double precision, text) from public, anon;
grant execute on function public.request_warranty_service(uuid, text, double precision, double precision, text) to authenticated;


create or replace function public.notify_order_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor    uuid := auth.uid();
  v_service  record;
  v_provider record;
  v_track    jsonb := jsonb_build_object('route', '/tracking', 'id', new.id);
  v_job      jsonb := jsonb_build_object('route', '/job', 'id', new.id);
  v_key      text := format('order:%s:%s', new.id, new.status);
  v_name_ar  text;
  v_name_en  text;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  select s.name_ar, s.name_en into v_service from public.services s where s.id = new.service_id;
  select pr.owner_profile_id, pr.business_name_ar, coalesce(pr.business_name_en, pr.business_name_ar) as business_name_en
    into v_provider
    from public.providers pr where pr.id = new.provider_id;

  v_name_ar := coalesce(v_provider.business_name_ar, 'الفنّي');
  v_name_en := coalesce(v_provider.business_name_en, 'Your technician');

  -- A warranty claim (0105): straight to the provider who did the original
  -- job. It has no appointment time, so the booking sentence would print an
  -- empty one; and the customer is the one who just asked.
  if new.status = 'accepted' and new.parent_order_id is not null then
    if v_provider.owner_profile_id is not null then
      perform public.enqueue_notification(
        v_provider.owner_profile_id, 'warranty_claim',
        format('مطالبة ضمان: %s', v_service.name_ar),
        format('Warranty claim: %s', v_service.name_en),
        coalesce(left(new.problem_description, 120), 'عميل يطلب إعادة الخدمة بالضمان.'),
        coalesce(left(new.problem_description, 120), 'A customer asks for the work to be redone under warranty.'),
        v_job, v_key);
    end if;
    return new;
  end if;

  -- A booking just confirmed: it is the PROVIDER who needs to know, and the
  -- customer is the one who just confirmed it.
  if new.status = 'accepted' and new.fulfilment_mode <> 'mobile_ondemand' then
    if v_provider.owner_profile_id is not null then
      perform public.enqueue_notification(
        v_provider.owner_profile_id, 'booking_confirmed',
        format('حجز جديد: %s', v_service.name_ar),
        format('New booking: %s', v_service.name_en),
        format('الموعد %s بتوقيت الرياض.',
               to_char(new.scheduled_for at time zone 'Asia/Riyadh', 'YYYY-MM-DD HH24:MI')),
        format('Appointment %s, Riyadh time.',
               to_char(new.scheduled_for at time zone 'Asia/Riyadh', 'YYYY-MM-DD HH24:MI')),
        v_job, v_key);
    end if;
    return new;
  end if;

  -- What the customer is waiting to hear. Each is something they would
  -- otherwise have had to keep the tracking screen open to find out.
  if new.status in ('accepted', 'en_route', 'arrived', 'checked_in', 'awaiting_approval')
     and v_actor is distinct from new.customer_id then
    perform public.enqueue_notification(
      new.customer_id, 'order_' || new.status::text,
      case new.status
        when 'accepted'          then 'تم قبول طلبك'
        when 'en_route'          then 'الفنّي في الطريق إليك'
        when 'arrived'           then 'وصل الفنّي'
        when 'checked_in'        then 'استلمت الورشة سيارتك'
        when 'awaiting_approval' then 'انتهى العمل — راجعه واعتمده'
      end,
      case new.status
        when 'accepted'          then 'Your request was accepted'
        when 'en_route'          then 'Your technician is on the way'
        when 'arrived'           then 'Your technician has arrived'
        when 'checked_in'        then 'The workshop has your car'
        when 'awaiting_approval' then 'The work is done — review and approve'
      end,
      case new.status
        when 'accepted'          then format('%s قبل طلبك وسيتوجّه إليك قريباً.', v_name_ar)
        when 'en_route'          then format('%s في الطريق. تابع وصوله من التطبيق.', v_name_ar)
        when 'arrived'           then format('%s عند سيارتك الآن.', v_name_ar)
        when 'checked_in'        then format('%s: سنُعلمك عند انتهاء العمل.', v_service.name_ar)
        when 'awaiting_approval' then 'راجع الصور والفاتورة، ثم اعتمد لإنهاء الطلب.'
      end,
      case new.status
        when 'accepted'          then format('%s accepted your request and will head to you shortly.', v_name_en)
        when 'en_route'          then format('%s is on the way. Follow them in the app.', v_name_en)
        when 'arrived'           then format('%s is at your car now.', v_name_en)
        when 'checked_in'        then format('%s: we will tell you when the work is done.', v_service.name_en)
        when 'awaiting_approval' then 'Review the photos and the bill, then approve to close the job.'
      end,
      v_track, v_key);
    return new;
  end if;

  -- What the provider is waiting to hear.
  if new.status = 'completed' and v_provider.owner_profile_id is not null
     and v_actor is distinct from v_provider.owner_profile_id then
    perform public.enqueue_notification(
      v_provider.owner_profile_id, 'order_completed',
      'اعتمد العميل العمل',
      'The customer approved the work',
      format('%s مكتمل. شكراً لك.', v_service.name_ar),
      format('%s is complete. Thank you.', v_service.name_en),
      v_job, v_key);
    return new;
  end if;

  -- A cancellation, to whoever did not cancel.
  if new.status = 'cancelled' then
    if v_provider.owner_profile_id is not null
       and v_actor is distinct from v_provider.owner_profile_id then
      perform public.enqueue_notification(
        v_provider.owner_profile_id, 'order_cancelled',
        'أُلغي الطلب', 'The job was cancelled',
        format('ألغى العميل طلب %s.', v_service.name_ar),
        format('The customer cancelled %s.', v_service.name_en),
        jsonb_build_object('route', '/'), v_key || ':provider');
    end if;
    if v_actor is distinct from new.customer_id then
      perform public.enqueue_notification(
        new.customer_id, 'order_cancelled',
        'أُلغي طلبك', 'Your request was cancelled',
        format('أُلغي طلب %s. لم يُخصم منك شيء.', v_service.name_ar),
        format('Your %s request was cancelled. You were not charged.', v_service.name_en),
        v_track, v_key || ':customer');
    end if;
  end if;

  return new;
end;
$$;


-- Renamed aside rather than dropped: the return type changes, and a rename
-- keeps the step non-destructive (the old body stays, callable by nobody).
alter function public.vehicle_warranties(uuid) rename to vehicle_warranties_0055;
revoke execute on function public.vehicle_warranties_0055(uuid) from public, anon, authenticated;

create function public.vehicle_warranties(p_vehicle_id uuid)
returns table (
  order_id            uuid,
  service_ar          text,
  service_en          text,
  provider_name_ar    text,
  completed_at        timestamptz,
  warranty_expires_at timestamptz,
  days_remaining      int,
  has_open_claim      boolean,
  fulfilment_mode     public.fulfilment_mode,
  open_claim_id       uuid
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    o.id,
    s.name_ar,
    s.name_en,
    pr.business_name_ar,
    o.completed_at,
    o.warranty_expires_at,
    greatest(0, (extract(epoch from (o.warranty_expires_at - now())) / 86400)::int),
    c.id is not null,
    o.fulfilment_mode,
    c.id
  from public.orders o
  join public.services s on s.id = o.service_id
  left join public.providers pr on pr.id = o.provider_id
  left join lateral (
    select c.id from public.orders c
     where c.parent_order_id = o.id and c.status <> 'cancelled'
     order by c.created_at desc limit 1
  ) c on true
  where o.vehicle_id = p_vehicle_id
    and exists (
      select 1 from public.vehicles v
      where v.id = p_vehicle_id and v.owner_id = auth.uid()
    )
    and o.status = 'completed'
    and o.parent_order_id is null
    and o.warranty_expires_at is not null
    and o.warranty_expires_at > now()
  order by o.warranty_expires_at;
$$;

revoke all on function public.vehicle_warranties(uuid) from public, anon;
grant execute on function public.vehicle_warranties(uuid) to authenticated;


alter function public.ops_order_detail(uuid) rename to ops_order_detail_0096;
revoke execute on function public.ops_order_detail_0096(uuid) from public, anon, authenticated;

create or replace function public.ops_order_detail(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- The wrapped chain asserts ops and records the read (0070).
  return public.ops_order_detail_0096(p_order_id)
    || jsonb_build_object(
         'warranty_claims', (
           select coalesce(jsonb_agg(jsonb_build_object(
                    'id', c.id, 'order_number', c.order_number, 'status', c.status,
                    'problem_description', c.problem_description, 'created_at', c.created_at)
                  order by c.created_at desc), '[]'::jsonb)
             from public.orders c where c.parent_order_id = p_order_id));
end;
$$;

revoke execute on function public.ops_order_detail(uuid) from public, anon;
grant execute on function public.ops_order_detail(uuid) to authenticated;
