-- 0033 — Column-level write control on orders
--
-- ⚠️ SECURITY FIX. Found by auditing rather than by a failing test, which is
-- why it survived six phases.
--
-- `orders_update_customer` grants a customer UPDATE on their own order, and
-- RLS has no way to express "you may change these columns but not those" —
-- WITH CHECK sees only the new row, never the old one. So an authenticated
-- customer with any HTTP client could:
--
--     update orders set escrow_status = 'authorised',
--                       payment_intent_id = 'forged',
--                       quoted_amount = 1, total_amount = 0
--     where id = <their own order>;
--
-- which defeats the escrow guard in the state machine entirely: the guard
-- checks `escrow_status = 'authorised'`, and the customer could simply write
-- that. Every phase's tests passed because they all went through the flow
-- honestly. Nothing stopped anyone from not doing that.
--
-- The fix is a BEFORE UPDATE trigger that decides, per column, who may change
-- it. Money and payment state are the point; the rest is defence in depth.

-- Lets a trusted SECURITY DEFINER function make a change a client cannot.
--
-- ⚠️ It must be CLOSED again immediately. set_config(..., true) is
-- TRANSACTION-local, not statement-local — the flag stays on until the
-- transaction ends. Left open, a caller could invoke a payment function and
-- then do anything they liked for the rest of that transaction, which would
-- reopen the exact hole this file closes. Caught by the test asserting the
-- flag does not linger.
create or replace function public.begin_privileged_write()
returns void
language sql
volatile
as $$
  select set_config('habba.privileged_write', 'on', true);
$$;

create or replace function public.end_privileged_write()
returns void
language sql
volatile
as $$
  select set_config('habba.privileged_write', 'off', true);
$$;

create or replace function public.is_privileged_write()
returns boolean
language sql
stable
as $$
  select coalesce(current_setting('habba.privileged_write', true), 'off') = 'on';
$$;


create or replace function public.guard_order_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor      uuid := auth.uid();
  v_provider   uuid := public.current_provider_id();
  v_is_customer boolean;
  v_is_provider boolean;
  v_is_ops      boolean := public.is_ops();
begin
  -- Ops and trusted server-side functions are outside this guard. Everything
  -- else — every client, however authenticated — is inside it.
  if v_is_ops or public.is_privileged_write() then
    return new;
  end if;

  v_is_customer := v_actor is not null and v_actor = old.customer_id;
  v_is_provider := v_provider is not null and v_provider = old.provider_id;

  -- Identity of the order never changes. Rewriting customer_id would hand
  -- someone else's job to yourself; rewriting service_id would change what was
  -- agreed after the price was set.
  if new.id is distinct from old.id
     or new.order_number is distinct from old.order_number
     or new.customer_id is distinct from old.customer_id
     or new.service_id is distinct from old.service_id
     or new.fulfilment_mode is distinct from old.fulfilment_mode
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at
     or new.parent_order_id is distinct from old.parent_order_id
     or new.vehicle_id is distinct from old.vehicle_id
  then
    raise exception 'These order details cannot be changed'
      using errcode = 'insufficient_privilege',
            hint = 'Cancel the order and place a new one.';
  end if;

  -- THE fix. Payment state is written only by the payment functions, which
  -- talk to the PSP. A client asserting "this is paid for" is the whole
  -- vulnerability.
  if new.escrow_status is distinct from old.escrow_status
     or new.payment_intent_id is distinct from old.payment_intent_id
  then
    raise exception 'Payment state cannot be set directly'
      using errcode = 'insufficient_privilege',
            hint = 'Use the payment functions; a client cannot declare an order paid.';
  end if;

  -- Money is quoted by whoever does the work, never by whoever pays for it.
  if not v_is_provider then
    if new.quoted_amount is distinct from old.quoted_amount
       or new.parts_amount is distinct from old.parts_amount
       or new.labour_amount is distinct from old.labour_amount
       or new.vat_amount is distinct from old.vat_amount
       or new.total_amount is distinct from old.total_amount
       or new.vat_rate_applied is distinct from old.vat_rate_applied
       or new.warranty_days is distinct from old.warranty_days
    then
      raise exception 'Only the assigned provider may set the amounts on this order'
        using errcode = 'insufficient_privilege';
    end if;

    -- Evidence is what the person who did the work observed.
    if new.completion_mileage is distinct from old.completion_mileage
       or new.completion_media is distinct from old.completion_media
    then
      raise exception 'Only the assigned provider may record completion evidence'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  -- Assignment: a provider claims an unassigned order for THEMSELVES. A
  -- customer handing the job to a chosen provider would bypass matching, and
  -- a provider assigning someone else is nonsense.
  if new.provider_id is distinct from old.provider_id then
    if old.provider_id is not null then
      raise exception 'The assigned provider cannot be changed'
        using errcode = 'insufficient_privilege',
              hint = 'Cancel and re-dispatch.';
    end if;
    if v_provider is null or new.provider_id <> v_provider then
      raise exception 'A provider may only accept a job for themselves'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  -- A customer may cancel and confirm; both go through the state machine,
  -- which has its own rules. Anything else on the order is not theirs.
  if not v_is_customer and not v_is_provider then
    raise exception 'Not permitted to modify this order'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

-- Named to sort BEFORE orders_enforce_transition: Postgres fires per-row
-- triggers in name order, and the transition trigger sets completed_at and
-- warranty_expires_at. Running after it would mean comparing against values
-- the server itself had just written.
create trigger orders_a_guard_columns
  before update on public.orders
  for each row execute function public.guard_order_columns();

alter table public.orders enable always trigger orders_a_guard_columns;


-- ---------------------------------------------------------------------------
-- The payment functions
-- ---------------------------------------------------------------------------
-- These are the only path to payment state. They are thin today because the
-- PSP integration is still an open decision (ADR-0008) — but the boundary is
-- what matters: whatever the merchant-of-record decision turns out to be, it
-- gets implemented behind these two functions and nowhere else.

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

  -- ⚠️ The PSP call belongs here. Until ADR-0008 settles whether Habba may
  -- hold funds at all, this records the intent the client obtained from the
  -- PSP directly. What it does NOT do is let the client choose the status.
  perform public.begin_privileged_write();

  update public.orders
  set escrow_status = 'authorised', payment_intent_id = p_payment_intent_id
  where id = p_order_id;

  perform public.end_privileged_write();
end;
$$;


create or replace function public.capture_order_payment(p_order_id uuid)
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

  -- Capture only after the customer has confirmed. This is the escrow promise
  -- in §1, and it is enforced here rather than trusted to the caller.
  if v_order.status <> 'completed' then
    raise exception 'Payment is captured only after the customer confirms completion'
      using errcode = 'check_violation';
  end if;

  if v_order.escrow_status <> 'authorised' then
    raise exception 'Nothing authorised to capture (escrow is %)', v_order.escrow_status
      using errcode = 'check_violation';
  end if;

  perform public.begin_privileged_write();

  update public.orders set escrow_status = 'captured' where id = p_order_id;

  perform public.end_privileged_write();
end;
$$;


-- Trusted server-side writers that legitimately change guarded columns.
create or replace function public.convert_inspection_to_vehicle(
  p_report_id uuid,
  p_make_id   uuid,
  p_model_id  uuid,
  p_nickname  text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor     uuid := auth.uid();
  v_report    record;
  v_order     record;
  v_vehicle_id uuid;
  v_year      int;
begin
  if v_actor is null then
    raise exception 'Not authenticated' using errcode = 'insufficient_privilege';
  end if;

  select * into v_report from public.inspection_reports r where r.id = p_report_id;
  if v_report is null then
    raise exception 'Inspection report % not found', p_report_id using errcode = 'no_data_found';
  end if;
  if v_report.completed_at is null then
    raise exception 'That inspection is not finished' using errcode = 'check_violation';
  end if;
  if v_report.vehicle_id is not null then
    raise exception 'That inspection is already attached to a vehicle'
      using errcode = 'unique_violation', hint = 'The car is already in a logbook.';
  end if;

  select * into v_order from public.orders o where o.id = v_report.order_id;

  if v_order.customer_id <> v_actor then
    raise exception 'Only the customer who ordered this inspection may add the car'
      using errcode = 'insufficient_privilege';
  end if;

  v_year := coalesce(v_report.subject_year, extract(year from now())::int);

  if v_report.subject_vin is not null
     and exists (select 1 from public.vehicles v
                 where v.vin = v_report.subject_vin and v.is_active) then
    raise exception 'This car already has a Habba logbook'
      using errcode = 'unique_violation',
            hint = 'Ask the current owner to transfer ownership to you in the app.';
  end if;

  insert into public.vehicles (
    owner_id, make_id, model_id, year, vin, plate_en,
    current_mileage, mileage_updated_at, nickname, created_by
  ) values (
    v_actor, p_make_id, p_model_id, v_year,
    v_report.subject_vin, v_report.subject_plate,
    coalesce(v_report.subject_mileage, 0),
    case when v_report.subject_mileage is not null then v_report.completed_at end,
    p_nickname, v_actor
  )
  returning id into v_vehicle_id;

  update public.inspection_reports set vehicle_id = v_vehicle_id where id = p_report_id;

  -- vehicle_id is guarded, and this is one of the few legitimate reasons to
  -- change it: the car the inspection examined now exists.
  perform public.begin_privileged_write();
  update public.orders set vehicle_id = v_vehicle_id where id = v_report.order_id;
  perform public.end_privileged_write();

  perform public.append_vehicle_timeline_event(
    p_vehicle_id  => v_vehicle_id,
    p_event_type  => 'vehicle_registered',
    p_summary_ar  => 'تم تسجيل السيارة في هبّة بعد فحص ما قبل الشراء',
    p_summary_en  => 'Vehicle registered with Habba following a pre-purchase inspection',
    p_occurred_at => now(),
    p_mileage     => v_report.subject_mileage
  );

  perform public.append_vehicle_timeline_event(
    p_vehicle_id  => v_vehicle_id,
    p_event_type  => 'inspection_completed',
    p_summary_ar  => format('فحص ما قبل الشراء — النتيجة %s%%', v_report.overall_score),
    p_summary_en  => format('Pre-purchase inspection — score %s%%', v_report.overall_score),
    p_occurred_at => v_report.completed_at,
    p_mileage     => v_report.subject_mileage,
    p_order_id    => v_report.order_id,
    p_provider_id => v_order.provider_id,
    p_details     => jsonb_strip_nulls(jsonb_build_object(
      'inspection_score', v_report.overall_score,
      'service_kind', 'pre_purchase_inspection',
      'notes_public', v_report.recommendation::text
    )),
    p_attachments => '[]'::jsonb
  );

  return v_vehicle_id;
end;
$$;


-- record_completion_evidence writes guarded columns on the provider's behalf.
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

  perform public.begin_privileged_write();

  update public.orders
  set completion_mileage = p_mileage,
      completion_media = coalesce(p_media, '[]'::jsonb)
  where id = p_order_id;

  perform public.end_privileged_write();
end;
$$;


-- claim_warranty and book_appointment INSERT rather than update, so they are
-- unaffected. release_slot_on_cancel touches appointment_slots, not orders.

grant execute on function public.authorise_order_payment(uuid, text) to authenticated;
grant execute on function public.capture_order_payment(uuid) to authenticated;
grant execute on function public.begin_privileged_write() to authenticated;
grant execute on function public.end_privileged_write() to authenticated;
grant execute on function public.is_privileged_write() to authenticated;


-- ---------------------------------------------------------------------------
-- accept_order
-- ---------------------------------------------------------------------------
-- A provider had no way to accept a job at all: `orders_update_assigned_provider`
-- matches on `provider_id = current_provider_id()`, which is NULL before
-- acceptance, so the update silently affected zero rows. The guard above made
-- that visible; RLS had been hiding it.
--
-- It also has to be ATOMIC. Build prompt §7.1 broadcasts to the top five
-- providers simultaneously and says "first to accept wins" — with a
-- read-then-write, two technicians can both be told they won and both drive
-- out, which is the false-dispatch cost the video triage exists to avoid.
-- The single conditional UPDATE is the whole mechanism: `provider_id is null`
-- is re-evaluated after the row lock, so exactly one caller sees a row.
create or replace function public.accept_order(p_order_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_provider uuid := public.current_provider_id();
  v_claimed  uuid;
  v_order    record;
begin
  if v_provider is null then
    raise exception 'Not a provider' using errcode = 'insufficient_privilege';
  end if;

  select * into v_order from public.orders o where o.id = p_order_id;
  if v_order is null then
    raise exception 'Order % not found', p_order_id using errcode = 'no_data_found';
  end if;

  if not exists (select 1 from public.providers p
                 where p.id = v_provider and p.verification_status = 'approved') then
    raise exception 'Only an approved provider may accept work'
      using errcode = 'insufficient_privilege';
  end if;

  if not exists (select 1 from public.provider_services ps
                 where ps.provider_id = v_provider and ps.service_id = v_order.service_id) then
    raise exception 'You do not offer that service' using errcode = 'check_violation';
  end if;

  -- Money must be held before anyone is committed to driving out. Same rule as
  -- the state machine, checked here so the failure is a clear message rather
  -- than a transition error after the claim.
  if coalesce(v_order.quoted_amount, 0) > 0 and v_order.escrow_status <> 'authorised' then
    raise exception 'This order is not funded yet'
      using errcode = 'check_violation',
            hint = 'The customer must authorise payment first.';
  end if;

  perform public.begin_privileged_write();

  update public.orders
  set provider_id = v_provider,
      status = 'accepted'
  where id = p_order_id
    and provider_id is null
    and status in ('searching', 'quoted', 'draft')
  returning provider_id into v_claimed;

  perform public.end_privileged_write();

  -- Losing the race is not an error. Four of the five broadcast providers lose
  -- every time, and telling them "someone got there first" is the honest
  -- message.
  return v_claimed is not null;
end;
$$;

grant execute on function public.accept_order(uuid) to authenticated;
