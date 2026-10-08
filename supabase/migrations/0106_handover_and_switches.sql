-- 0106 — The handover code means something, and ops hold the switches
--
-- The customer has been shown a four-digit code since 0047, to read out so the
-- car is worked on only by the technician Habba sent. The technician's app
-- had nowhere to type it, so nothing ever checked it. Now it does, and:
--
--   require_handover_code   when on, a mobile job cannot go from 'arrived' to
--                           'in_progress' until the code is verified. Off by
--                           default: technicians on a build without the code
--                           field would otherwise be stopped at every car.
--                           Ops turn it on once the new build is out.
--   ops_reissue_handover()  five wrong guesses lock the code (0047) and its
--                           hint says "ask support to re-issue" — which had no
--                           way to happen. Ops can, with a reason, on record.
--
-- And two switches for the features that arrived since 0093, so ops control
-- them like every other one:
--
--   feature_order_chat       send_order_message (0101) refuses when off
--   feature_warranty_claims  request_warranty_service (0105) refuses when off

insert into public.platform_settings
  (key, value, value_type, min_value, max_value, is_public, category, label_ar, unit_ar, description_ar, sort_order)
values
  ('feature_order_chat', 'true', 'boolean', null, null, true, 'features',
   'المحادثة داخل الطلب', null,
   'مراسلة العميل والفنّي من قبول الطلب حتى التسليم، دون أرقام.', 300),
  ('feature_warranty_claims', 'true', 'boolean', null, null, true, 'features',
   'المطالبة بالضمان من التطبيق', null,
   'إعادة العمل مجاناً لدى مقدّم الخدمة نفسه إن تعطّل خلال مدة الضمان.', 310),
  ('require_handover_code', 'false', 'boolean', null, null, true, 'ops',
   'اشتراط رمز التسليم قبل بدء العمل', null,
   'لا يبدأ الفنّي العمل حتى يُدخل الرمز الذي يقرؤه له العميل. فعّله بعد تحديث تطبيق الفنّيين.', 320)
on conflict (key) do nothing;


create or replace function public.send_order_message(p_order_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order     public.orders%rowtype;
  v_side      text;
  v_body      text := btrim(coalesce(p_body, ''));
  v_id        uuid;
  v_recipient uuid;
begin
  if not public.setting_bool('feature_order_chat', true) then
    raise exception 'Messages are switched off'
      using errcode = 'check_violation', hint = 'chat:disabled';
  end if;

  select * into v_order from public.orders where id = p_order_id;

  if found and v_order.customer_id = auth.uid() then
    v_side := 'customer';
  elsif found and v_order.provider_id is not null
        and v_order.provider_id = public.current_provider_id() then
    v_side := 'provider';
  else
    -- The same answer whether the order exists or not.
    raise exception 'Not a party to this order'
      using errcode = 'insufficient_privilege', hint = 'chat:not_party';
  end if;

  if v_order.status not in
       ('accepted', 'checked_in', 'en_route', 'arrived', 'in_progress', 'awaiting_approval') then
    raise exception 'Messages are open only while the job is live'
      using errcode = 'check_violation', hint = 'chat:closed';
  end if;

  if length(v_body) = 0 or length(v_body) > 1000 then
    raise exception 'A message is 1 to 1000 characters'
      using errcode = 'check_violation', hint = 'chat:length';
  end if;

  if (select count(*) from public.order_messages m
       where m.order_id = p_order_id and m.sender_id = auth.uid()
         and m.created_at > now() - interval '1 minute') >= 20 then
    raise exception 'Too many messages; wait a moment'
      using errcode = 'check_violation', hint = 'chat:rate';
  end if;

  insert into public.order_messages (order_id, sender_id, sender_side, body)
  values (p_order_id, auth.uid(), v_side, v_body)
  returning id into v_id;

  if v_side = 'customer' then
    select p.owner_profile_id into v_recipient
      from public.providers p where p.id = v_order.provider_id;
    perform public.enqueue_notification(
      v_recipient, 'order_message',
      'رسالة من العميل', 'Message from the customer',
      left(v_body, 140), left(v_body, 140),
      jsonb_build_object('route', '/chat', 'id', p_order_id, 'side', 'provider'),
      format('msg:%s', v_id));
  else
    perform public.enqueue_notification(
      v_order.customer_id, 'order_message',
      'رسالة من الفنّي', 'Message from your technician',
      left(v_body, 140), left(v_body, 140),
      jsonb_build_object('route', '/chat', 'id', p_order_id, 'side', 'customer'),
      format('msg:%s', v_id));
  end if;

  return v_id;
end;
$$;


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
  if not public.setting_bool('feature_warranty_claims', true) then
    raise exception 'Warranty claims are switched off'
      using errcode = 'check_violation', hint = 'warranty:disabled';
  end if;

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


create or replace function public.require_verified_handover()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'in_progress' and old.status = 'arrived'
     and new.fulfilment_mode in ('mobile_ondemand', 'mobile_scheduled')
     and public.setting_bool('require_handover_code', false)
     and not public.is_ops()
     and not public.is_privileged_write()
     and exists (
       select 1 from public.order_handovers h
        where h.order_id = new.id and h.verified_at is null
     ) then
    raise exception 'Enter the handover code the customer reads out before starting'
      using errcode = 'check_violation', hint = 'handover:required';
  end if;
  return new;
end;
$$;

create trigger orders_c_require_handover
  before update of status on public.orders
  for each row execute function public.require_verified_handover();
alter table public.orders enable always trigger orders_c_require_handover;


create or replace function public.ops_reissue_handover(p_order_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text;
  v_before record;
begin
  perform public.assert_ops();
  v_reason := public.assert_reason(p_reason);

  select attempts, verified_at into v_before
    from public.order_handovers where order_id = p_order_id for update;
  if not found then
    raise exception 'No handover code was issued for this order' using errcode = 'no_data_found';
  end if;
  if v_before.verified_at is not null then
    raise exception 'The handover was already verified' using errcode = 'check_violation';
  end if;

  update public.order_handovers
     set code = lpad((floor(random() * 10000))::int::text, 4, '0'),
         attempts = 0
   where order_id = p_order_id;

  -- The code itself stays out of the log: it is the customer's to read out.
  insert into public.audit_log (actor_id, action, target_table, target_id, before, after, ip)
  values (auth.uid(), 'update', 'order_handovers', p_order_id::text,
          jsonb_build_object('attempts', v_before.attempts),
          jsonb_build_object('attempts', 0, 'reissued', true, 'reason', v_reason),
          public.request_ip());
end;
$$;

comment on function public.ops_reissue_handover(uuid, text) is
  'A fresh handover code after the old one locked, with a reason, on the audit log. 0106.';

revoke all on function public.ops_reissue_handover(uuid, text) from public, anon;
grant execute on function public.ops_reissue_handover(uuid, text) to authenticated;


-- What the technician's screen needs to know about the code, without the code:
-- whether one was issued, whether it is verified, and whether it is locked.
create or replace function public.handover_status(p_order_id uuid)
returns table (issued boolean, verified boolean, locked boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.orders o
     where o.id = p_order_id
       and (o.customer_id = auth.uid() or o.provider_id = public.current_provider_id())
  ) then
    raise exception 'Not a party to this order' using errcode = 'insufficient_privilege';
  end if;

  return query
    select true, h.verified_at is not null, h.attempts >= public.handover_max_attempts()
      from public.order_handovers h where h.order_id = p_order_id
    union all
    select false, false, false
     where not exists (select 1 from public.order_handovers h where h.order_id = p_order_id);
end;
$$;

revoke all on function public.handover_status(uuid) from public, anon;
grant execute on function public.handover_status(uuid) to authenticated;
