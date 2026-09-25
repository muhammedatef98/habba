-- 0077 — A real payment gateway, switched on by one setting
--
-- Until now the phone told the database a payment was authorised
-- (authorise_order_payment took the intent id the client sent) and told it
-- when to capture (capture_order_payment flipped a column). Neither involved
-- the payment provider, and neither can: the phone does not hold the secret
-- key, and a claim from the phone is not proof of money.
--
-- With `payments_gateway` = 'moyasar':
--
--   * Authorisation is recorded by the `payments` Edge Function only, after
--     it has fetched the payment from Moyasar with the secret key and checked
--     it is an authorised hold, in SAR, for exactly order_hold_amount(), made
--     for this order (packages/core/src/payments/moyasar.ts). The client path
--     refuses.
--   * Capture is queued, not performed: capture_order_payment adds a
--     `capture` to payment_operations and leaves the escrow `authorised`. The
--     function's tick asks Moyasar, and only a capture Moyasar confirms marks
--     the order captured — which is what payouts wait for.
--   * Voids (on cancellation) and refunds (on a dispute) were already queued
--     for an operator to carry out by hand; the tick carries them out.
--
-- With 'dev' (the default, and the harness) nothing changes.

-- ---------------------------------------------------------------------------
-- First: 0075's "closed until opened" default, at the level that works
-- ---------------------------------------------------------------------------
-- 0075 revoked EXECUTE from PUBLIC with `alter default privileges IN SCHEMA
-- public`, which cannot take away a global default — and 0001 had also granted
-- functions to anon and authenticated at the schema level. Suite 48 caught
-- this migration's own new functions arriving executable by anon. Both
-- defaults are removed here, before anything below is created, so every
-- function from now on is opened by an explicit grant or not at all.
alter default privileges revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon, authenticated;

insert into public.platform_settings
  (key, value, value_type, min_value, max_value, is_public, category, label_ar, unit_ar,
   description_ar, sort_order)
values
  ('payments_gateway', '"dev"', 'text', null, null, true, 'payments',
   'بوابة الدفع', null,
   'dev للتجربة، moyasar للتشغيل الفعلي. لا تغيّرها إلى moyasar قبل نشر دالة payments وضبط مفتاح Moyasar السري.',
   10)
on conflict (key) do nothing;

-- Anything but 'dev' is live. A typo in the setting must not fall back to the
-- path where the phone's word is enough.
create or replace function public.payments_live()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.setting_text('payments_gateway', 'dev') <> 'dev';
$$;

-- What the customer's card is asked to hold for an order: the quoted price
-- with VAT, rounded half away from zero to the halala — the same figure the
-- app shows and the dev provider authorises (order-price.ts).
create or replace function public.order_hold_amount(p_order_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select round(o.quoted_amount * (1 + public.vat_rate_on(current_date)), 2)
    from public.orders o where o.id = p_order_id;
$$;


-- ---------------------------------------------------------------------------
-- Authorisation
-- ---------------------------------------------------------------------------
create or replace function public.authorise_order_payment(
  p_order_id         uuid,
  p_payment_intent_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order record;
begin
  if public.payments_live() then
    raise exception 'Payments are recorded by the payment service'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_order from public.orders o where o.id = p_order_id;

  if v_order is null then
    raise exception 'Order % not found', p_order_id using errcode = 'no_data_found';
  end if;

  if v_order.customer_id <> auth.uid() then
    raise exception 'Only the customer may authorise payment for this order'
      using errcode = 'insufficient_privilege';
  end if;

  if v_order.escrow_status <> 'none' then
    raise exception 'Payment on this order is already %', v_order.escrow_status
      using errcode = 'check_violation';
  end if;

  perform public.begin_privileged_write();

  update public.orders
  set escrow_status = 'authorised', payment_intent_id = p_payment_intent_id
  where id = p_order_id;

  perform public.end_privileged_write();
end;
$$;

-- The Edge Function's half. It has already checked the payment with Moyasar;
-- this checks the order: the caller's, unpaid, and held for the right amount.
create or replace function public.record_payment_authorisation(
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
declare
  v_order record;
begin
  select * into v_order from public.orders o where o.id = p_order_id for update;

  if v_order is null or v_order.customer_id is distinct from p_customer_id then
    raise exception 'Order % not found for this customer', p_order_id
      using errcode = 'no_data_found';
  end if;

  if v_order.escrow_status <> 'none' then
    raise exception 'Payment on this order is already %', v_order.escrow_status
      using errcode = 'check_violation';
  end if;

  if p_amount is distinct from public.order_hold_amount(p_order_id) then
    raise exception 'The authorised amount does not match this order'
      using errcode = 'check_violation';
  end if;

  if length(trim(coalesce(p_payment_id, ''))) = 0 then
    raise exception 'A payment reference is required' using errcode = 'check_violation';
  end if;

  perform public.begin_privileged_write();
  update public.orders
     set escrow_status = 'authorised', payment_intent_id = p_payment_id
   where id = p_order_id;
  perform public.end_privileged_write();
end;
$$;


-- ---------------------------------------------------------------------------
-- Capture, void and refund: queued, carried out by the gateway
-- ---------------------------------------------------------------------------
alter table public.payment_operations
  drop constraint if exists payment_operations_kind_check;
alter table public.payment_operations
  add constraint payment_operations_kind_check check (kind in ('void', 'refund', 'capture'));

-- A lease, so two ticks never send the same operation to Moyasar twice.
alter table public.payment_operations
  add column if not exists attempted_at timestamptz,
  add column if not exists attempts int not null default 0;

create or replace function public.capture_order_payment(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order record;
  v_caller uuid := (select auth.uid());
begin
  select * into v_order from public.orders o where o.id = p_order_id;

  if v_order is null then
    raise exception 'Order % not found', p_order_id using errcode = 'no_data_found';
  end if;

  -- No end user is the scheduler (0071) or a definer function acting for an
  -- operator (0070). An end user must be the one who is paying (0075).
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

  if public.payments_live() then
    -- The money moves when Moyasar says it has; until then the order stays
    -- authorised. Asked once: a second confirm must not queue a second capture.
    if not exists (select 1 from public.payment_operations po
                    where po.order_id = p_order_id and po.kind = 'capture'
                      and po.status in ('pending', 'succeeded')) then
      insert into public.payment_operations (order_id, kind, amount, reason, requested_by)
      values (p_order_id, 'capture',
              coalesce(v_order.total_amount, public.order_hold_amount(p_order_id)),
              'تأكيد إنجاز الطلب', v_caller);
    end if;
    return;
  end if;

  perform public.begin_privileged_write();
  update public.orders set escrow_status = 'captured' where id = p_order_id;
  perform public.end_privileged_write();
end;
$$;

-- The tick's batch: pending operations nobody is working on, with the
-- payment they act on. Leased for two minutes, so a crashed tick's batch is
-- retried rather than lost, and a slow one's is not sent twice.
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
       and o.payment_intent_id is not null
       and (po.attempted_at is null or po.attempted_at < now() - interval '2 minutes')
     order by po.created_at
     limit greatest(1, least(p_limit, 100))
     for update of po skip locked
  )
  update public.payment_operations po
     set attempted_at = now(), attempts = po.attempts + 1
    from claimed c, public.orders o
   where po.id = c.id and o.id = po.order_id
  returning po.id, po.order_id, po.kind, po.amount, o.payment_intent_id;
end;
$$;

-- Moyasar's answer. A capture Moyasar confirmed is the only thing that marks
-- an order captured when the gateway is live.
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
    perform public.begin_privileged_write();
    update public.orders set escrow_status = 'captured'
     where id = v_op.order_id and escrow_status = 'authorised';
    perform public.end_privileged_write();
  end if;
end;
$$;


-- ---------------------------------------------------------------------------
-- Who may call what (0075: closed until opened)
-- ---------------------------------------------------------------------------
grant execute on function public.payments_live() to authenticated, service_role;
grant execute on function public.order_hold_amount(uuid) to service_role;
grant execute on function public.authorise_order_payment(uuid, text) to authenticated;
grant execute on function public.capture_order_payment(uuid) to authenticated;
grant execute on function public.record_payment_authorisation(uuid, uuid, text, numeric) to service_role;
grant execute on function public.claim_payment_operations(int) to service_role;
grant execute on function public.settle_payment_operation(uuid, boolean, text, text) to service_role;
