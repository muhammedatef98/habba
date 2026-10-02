-- 0080 — A hold that has lapsed is not a hold
--
-- A card authorisation lives about seven days; the network then releases it
-- and a capture against it fails. A booking made two weeks ahead held the
-- customer's card on the day they booked — by the job, that hold was gone,
-- and the capture would fail with the work already done.
--
-- 0078's top-up already asks the customer for whatever the holds do not
-- cover when they confirm the work. So a lapsed hold simply stops counting:
--
--   * payment_hold_validity_days (default 6, a day inside the networks' 7)
--     is the age after which a hold is treated as gone.
--   * order_held_amount() counts only holds younger than that, so
--     order_top_up_due() asks for the whole bill again when the booking hold
--     has lapsed — one extra tap, at the moment the customer is looking at
--     the finished work and the final price.
--   * Capture and voids mark lapsed holds `expired` and do not send them to
--     the gateway; a capture against one could only fail.
--
-- The honest cost, recorded here: a lapsed hold protects the provider from
-- nothing. A customer who does not confirm a long-booked job is chased for
-- the whole amount (the auto-close records it uncovered), not captured.

insert into public.platform_settings
  (key, value, value_type, min_value, max_value, is_public, category, label_ar, unit_ar,
   description_ar, sort_order)
values
  ('payment_hold_validity_days', '6', 'integer', 1, 30, false, 'payments',
   'مدة صلاحية الحجز على البطاقة', 'يوم',
   'بعدها لا يُحسب الحجز، ويُطلب من العميل حجز المبلغ من جديد عند تأكيد الإنجاز. شبكات البطاقات تُسقط الحجز بعد نحو 7 أيام.',
   20)
on conflict (key) do nothing;

alter table public.payment_holds drop constraint if exists payment_holds_status_check;
alter table public.payment_holds
  add constraint payment_holds_status_check
  check (status in ('authorised', 'captured', 'voided', 'expired'));

create or replace function public.hold_validity()
returns interval
language sql
stable
security definer
set search_path = ''
as $$
  select make_interval(days => public.setting_number('payment_hold_validity_days', 6)::int);
$$;

create or replace function public.order_held_amount(p_order_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(h.amount), 0)
    from public.payment_holds h
   where h.order_id = p_order_id and h.status = 'authorised'
     and h.created_at > now() - public.hold_validity();
$$;

create or replace function public.expire_stale_holds(p_order_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.payment_holds
     set status = 'expired', updated_at = now()
   where order_id = p_order_id and status = 'authorised'
     and created_at <= now() - public.hold_validity();
$$;

create or replace function public.split_payment_operation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hold      record;
  v_remaining numeric := new.amount;
  v_share     numeric;
  v_any       boolean := false;
begin
  if new.payment_id is not null or new.kind = 'capture' then
    return new;
  end if;

  -- A hold past its validity is not voided — there is nothing left to void.
  perform public.expire_stale_holds(new.order_id);

  if new.kind = 'void' then
    for v_hold in
      select h.* from public.payment_holds h
       where h.order_id = new.order_id and h.status = 'authorised'
       order by h.created_at
    loop
      v_any := true;
      insert into public.payment_operations
        (order_id, kind, amount, reason, requested_by, payment_id)
      values (new.order_id, 'void', v_hold.amount, new.reason, new.requested_by, v_hold.payment_id);
      update public.payment_holds set status = 'voided', updated_at = now() where id = v_hold.id;
    end loop;
  else  -- refund: most recent capture first, each for no more than it took
    for v_hold in
      select h.* from public.payment_holds h
       where h.order_id = new.order_id and h.status = 'captured'
       order by h.created_at desc
    loop
      exit when v_remaining <= 0;
      v_any := true;
      v_share := least(v_hold.amount, v_remaining);
      insert into public.payment_operations
        (order_id, kind, amount, reason, requested_by, payment_id)
      values (new.order_id, 'refund', v_share, new.reason, new.requested_by, v_hold.payment_id);
      v_remaining := v_remaining - v_share;
    end loop;
  end if;

  if v_any then
    return null;
  end if;
  return new;
end;
$$;

create or replace function public.capture_order_payment(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order     record;
  v_caller    uuid := (select auth.uid());
  v_hold      record;
  v_remaining numeric;
  v_share     numeric;
begin
  select * into v_order from public.orders o where o.id = p_order_id;

  if v_order is null then
    raise exception 'Order % not found', p_order_id using errcode = 'no_data_found';
  end if;

  if v_caller is not null and v_caller <> v_order.customer_id and not public.is_ops() then
    raise exception 'Only the customer may release payment for this order'
      using errcode = 'insufficient_privilege';
  end if;

  if v_order.status <> 'completed' then
    raise exception 'Payment is captured only after the customer confirms completion'
      using errcode = 'check_violation';
  end if;

  if v_order.escrow_status <> 'authorised' then
    raise exception 'Nothing authorised to capture (escrow is %)', v_order.escrow_status
      using errcode = 'check_violation';
  end if;

  -- A hold the card network has let go is not captured, and not counted: the
  -- difference it leaves was due from the customer at confirmation, or is
  -- recorded below as uncovered.
  perform public.expire_stale_holds(p_order_id);

  if not public.payments_live() then
    update public.payment_holds set status = 'captured', updated_at = now()
     where order_id = p_order_id and status = 'authorised';
    perform public.begin_privileged_write();
    update public.orders set escrow_status = 'captured' where id = p_order_id;
    perform public.end_privileged_write();
    return;
  end if;

  -- Asked once: a second confirm must not queue a second set of captures.
  if exists (select 1 from public.payment_operations po
              where po.order_id = p_order_id and po.kind = 'capture'
                and po.status in ('pending', 'succeeded')) then
    return;
  end if;

  v_remaining := coalesce(v_order.total_amount, public.order_held_amount(p_order_id));

  for v_hold in
    select h.* from public.payment_holds h
     where h.order_id = p_order_id and h.status = 'authorised'
     order by h.created_at
  loop
    v_share := least(v_hold.amount, greatest(v_remaining, 0));
    if v_share > 0 then
      insert into public.payment_operations
        (order_id, kind, amount, reason, requested_by, payment_id)
      values (p_order_id, 'capture', v_share, 'تأكيد إنجاز الطلب', v_caller, v_hold.payment_id);
      v_remaining := v_remaining - v_share;
    else
      -- Held more than the bill came to: release what is not needed.
      insert into public.payment_operations
        (order_id, kind, amount, reason, requested_by, payment_id)
      values (p_order_id, 'void', v_hold.amount, 'مبلغ محجوز زائد عن الفاتورة', v_caller,
              v_hold.payment_id);
      update public.payment_holds set status = 'voided', updated_at = now() where id = v_hold.id;
    end if;
  end loop;

  -- Closed without the difference (an operator, or the scheduler's
  -- auto-close): recorded where an operator will see it, not dropped.
  if v_remaining > 0 then
    insert into public.payment_operations
      (order_id, kind, amount, reason, requested_by, status, last_error, processed_at)
    values (p_order_id, 'capture', v_remaining, 'فرق فاتورة غير محجوز', v_caller,
            'failed', 'لم يُحجز فرق الفاتورة على بطاقة العميل', now());
  end if;
end;
$$;

grant execute on function public.capture_order_payment(uuid) to authenticated;
