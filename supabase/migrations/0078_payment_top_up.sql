-- 0078 — When the bill outgrows the hold: the customer tops it up
--
-- A card hold is for the price the customer was shown before the job — the
-- service, with VAT. Parts approved during the job raise the bill, routinely
-- well past it (a battery call: 138 held, 506 billed), and a card
-- authorisation cannot be captured for more than it holds. Every job with
-- parts would have failed to capture once the gateway went live (0077).
--
-- The fix is the one the customer can see: when they confirm the work, the
-- bill is final, and if it is more than what is held they authorise the
-- difference — a second hold — before the confirmation goes through. Each
-- hold is then captured for its own share.
--
--   * payment_holds records every hold on an order: the first, from booking,
--     and any top-up. Written only by the payment paths below and by a
--     trigger on the order, never by a client.
--   * order_top_up_due() is the difference, the one figure the app shows.
--   * The customer's own confirmation is refused while a difference is due.
--     An operator's, and the scheduler's auto-close (0071), are not — a job
--     that is done is done — and the uncovered part is recorded as a failed
--     capture for an operator to chase, not silently dropped.
--   * Captures are queued per hold (live), voids and refunds are split across
--     holds, so every call to the gateway is for an amount that payment can
--     carry.

-- ---------------------------------------------------------------------------
-- The holds
-- ---------------------------------------------------------------------------
create table public.payment_holds (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references public.orders (id) on delete restrict,
  payment_id  text not null unique,
  amount      numeric(12,2) not null check (amount > 0),
  kind        text not null check (kind in ('initial', 'top_up')),
  status      text not null default 'authorised'
                check (status in ('authorised', 'captured', 'voided')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index payment_holds_order_idx on public.payment_holds (order_id);

alter table public.payment_holds enable row level security;

create policy payment_holds_read on public.payment_holds
  for select to authenticated using (
    public.is_ops()
    or exists (select 1 from public.orders o
                where o.id = payment_holds.order_id and o.customer_id = (select auth.uid())));

revoke insert, update, delete on public.payment_holds from anon, authenticated;
grant select on public.payment_holds to authenticated;

create trigger payment_holds_z_audit_ops
  after insert or update or delete on public.payment_holds
  for each row execute function public.audit_ops_change();

-- The first hold, whichever path authorised it (0033's client path in dev,
-- 0077's payment service when live): recorded when the order becomes
-- authorised, so neither function needs to change to keep this true.
create or replace function public.record_initial_hold()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.escrow_status = 'authorised' and old.escrow_status = 'none'
     and new.payment_intent_id is not null
     and not exists (select 1 from public.payment_holds h where h.order_id = new.id) then
    insert into public.payment_holds (order_id, payment_id, amount, kind)
    values (new.id, new.payment_intent_id,
            greatest(coalesce(public.order_hold_amount(new.id), 0), 0.01), 'initial');
  end if;
  return null;
end;
$$;

create trigger orders_record_initial_hold
  after update of escrow_status on public.orders
  for each row execute function public.record_initial_hold();

alter table public.orders enable always trigger orders_record_initial_hold;

-- Orders authorised before this migration.
insert into public.payment_holds (order_id, payment_id, amount, kind, status)
select o.id, o.payment_intent_id,
       greatest(coalesce(public.order_hold_amount(o.id), 0), 0.01), 'initial',
       case o.escrow_status when 'captured' then 'captured'
                            when 'released' then 'voided'
                            else 'authorised' end
  from public.orders o
 where o.payment_intent_id is not null
   and o.escrow_status in ('authorised', 'captured', 'released')
on conflict (payment_id) do nothing;


-- ---------------------------------------------------------------------------
-- The difference
-- ---------------------------------------------------------------------------
create or replace function public.order_held_amount(p_order_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(h.amount), 0)
    from public.payment_holds h
   where h.order_id = p_order_id and h.status = 'authorised';
$$;

-- What the customer still has to authorise for the bill in front of them.
-- Zero until there is a final bill, and for anyone but the customer, an
-- operator or the payment service.
create or replace function public.order_top_up_due(p_order_id uuid)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_order  record;
  v_caller uuid := (select auth.uid());
begin
  select o.customer_id, o.status, o.total_amount into v_order
    from public.orders o where o.id = p_order_id;

  if v_order is null
     or (v_caller is not null and v_caller <> v_order.customer_id and not public.is_ops()) then
    return 0;
  end if;

  if v_order.status <> 'awaiting_approval' or v_order.total_amount is null then
    return 0;
  end if;

  return greatest(0, v_order.total_amount - public.order_held_amount(p_order_id));
end;
$$;

-- Recording a top-up. Shared by the development path and the payment
-- service; both have established that p_payment_id is a real hold for
-- p_amount by then.
create or replace function public.record_top_up_hold(
  p_order_id   uuid,
  p_payment_id text,
  p_amount     numeric
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_due numeric;
begin
  perform 1 from public.orders o where o.id = p_order_id for update;

  if (select o.status from public.orders o where o.id = p_order_id) <> 'awaiting_approval' then
    raise exception 'A top-up is taken only for a job awaiting the customer''s approval'
      using errcode = 'check_violation';
  end if;

  v_due := greatest(0, (select o.total_amount from public.orders o where o.id = p_order_id)
                       - public.order_held_amount(p_order_id));

  if v_due = 0 then
    raise exception 'Nothing is due on this order' using errcode = 'check_violation';
  end if;

  if p_amount is distinct from v_due then
    raise exception 'The top-up must be exactly the difference (% SAR)', v_due
      using errcode = 'check_violation';
  end if;

  if length(trim(coalesce(p_payment_id, ''))) = 0 then
    raise exception 'A payment reference is required' using errcode = 'check_violation';
  end if;

  insert into public.payment_holds (order_id, payment_id, amount, kind)
  values (p_order_id, p_payment_id, p_amount, 'top_up');

  -- A free job that became a paid one (parts on a no-charge call) had no
  -- hold at all until now.
  perform public.begin_privileged_write();
  update public.orders
     set escrow_status = 'authorised',
         payment_intent_id = coalesce(payment_intent_id, p_payment_id)
   where id = p_order_id and escrow_status = 'none';
  perform public.end_privileged_write();
end;
$$;

-- Development: the customer's word, as authorise_order_payment takes it —
-- and refused the same way once the gateway is live.
create or replace function public.authorise_order_top_up(
  p_order_id   uuid,
  p_payment_id text,
  p_amount     numeric
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.payments_live() then
    raise exception 'Payments are recorded by the payment service'
      using errcode = 'insufficient_privilege';
  end if;

  if (select o.customer_id from public.orders o where o.id = p_order_id)
     is distinct from (select auth.uid()) then
    raise exception 'Only the customer may pay for this order'
      using errcode = 'insufficient_privilege';
  end if;

  perform public.record_top_up_hold(p_order_id, p_payment_id, p_amount);
end;
$$;

-- Live: the payment service, after checking the payment with Moyasar.
create or replace function public.record_payment_top_up(
  p_order_id    uuid,
  p_customer_id uuid,
  p_payment_id  text,
  p_amount      numeric
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select o.customer_id from public.orders o where o.id = p_order_id)
     is distinct from p_customer_id then
    raise exception 'Order % not found for this customer', p_order_id
      using errcode = 'no_data_found';
  end if;

  perform public.record_top_up_hold(p_order_id, p_payment_id, p_amount);
end;
$$;


-- ---------------------------------------------------------------------------
-- The customer's confirmation waits for the difference
-- ---------------------------------------------------------------------------
create or replace function public.require_top_up_before_confirm()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'completed' and old.status = 'awaiting_approval'
     and (select auth.uid()) = new.customer_id
     and not public.is_ops()
     -- Money already taken is not a hold to top up.
     and new.escrow_status in ('none', 'authorised')
     and coalesce(new.total_amount, 0) > public.order_held_amount(new.id) then
    raise exception 'The final bill is more than the amount held — authorise the difference first'
      using errcode = 'check_violation',
            hint = 'top_up_required';
  end if;
  return new;
end;
$$;

create trigger orders_c_require_top_up
  before update of status on public.orders
  for each row execute function public.require_top_up_before_confirm();

alter table public.orders enable always trigger orders_c_require_top_up;


-- ---------------------------------------------------------------------------
-- Gateway calls, one per hold
-- ---------------------------------------------------------------------------
alter table public.payment_operations add column if not exists payment_id text;

-- A void or refund queued for the order (0069's cancellation trigger, 0070's
-- dispute resolution) is split across the holds it applies to, so each call
-- names a payment that can carry it. With no holds recorded — an order from
-- before this migration — it is left as written, against the order's payment.
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

create trigger payment_operations_a_split
  before insert on public.payment_operations
  for each row execute function public.split_payment_operation();

alter table public.payment_operations enable always trigger payment_operations_a_split;

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

create or replace function public.claim_payment_operations(p_limit int default 20)
returns table (
  operation_id uuid,
  order_id     uuid,
  kind         text,
  amount       numeric,
  payment_id   text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  with claimed as (
    select po.id
      from public.payment_operations po
      join public.orders o on o.id = po.order_id
     where po.status = 'pending'
       and coalesce(po.payment_id, o.payment_intent_id) is not null
       and (po.attempted_at is null or po.attempted_at < now() - interval '2 minutes')
     order by po.created_at
     limit greatest(1, least(p_limit, 100))
     for update of po skip locked
  )
  update public.payment_operations po
     set attempted_at = now(), attempts = po.attempts + 1
    from claimed c, public.orders o
   where po.id = c.id and o.id = po.order_id
  returning po.id, po.order_id, po.kind, po.amount, coalesce(po.payment_id, o.payment_intent_id);
end;
$$;

create or replace function public.settle_payment_operation(
  p_operation_id uuid,
  p_ok           boolean,
  p_reference    text,
  p_error        text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_op record;
begin
  select * into v_op from public.payment_operations where id = p_operation_id for update;
  if v_op is null then
    raise exception 'Payment operation % not found', p_operation_id using errcode = 'no_data_found';
  end if;
  if v_op.status <> 'pending' then
    return;
  end if;

  update public.payment_operations
     set status = case when p_ok then 'succeeded' else 'failed' end,
         psp_reference = case when p_ok then nullif(trim(coalesce(p_reference, '')), '') end,
         last_error = case when p_ok then null else p_error end,
         processed_at = now()
   where id = p_operation_id;

  if p_ok and v_op.kind = 'capture' then
    update public.payment_holds set status = 'captured', updated_at = now()
     where payment_id = v_op.payment_id and status = 'authorised';

    -- The order is captured when nothing it holds is still waiting to be.
    if not exists (select 1 from public.payment_operations po
                    where po.order_id = v_op.order_id and po.kind = 'capture'
                      and po.status = 'pending') then
      perform public.begin_privileged_write();
      update public.orders set escrow_status = 'captured'
       where id = v_op.order_id and escrow_status = 'authorised';
      perform public.end_privileged_write();
    end if;
  end if;
end;
$$;


-- ---------------------------------------------------------------------------
-- Who may call what
-- ---------------------------------------------------------------------------
grant execute on function public.order_top_up_due(uuid) to authenticated, service_role;
grant execute on function public.authorise_order_top_up(uuid, text, numeric) to authenticated;
grant execute on function public.record_payment_top_up(uuid, uuid, text, numeric) to service_role;
grant execute on function public.order_held_amount(uuid) to service_role;
grant execute on function public.capture_order_payment(uuid) to authenticated;
grant execute on function public.claim_payment_operations(int) to service_role;
grant execute on function public.settle_payment_operation(uuid, boolean, text, text) to service_role;
