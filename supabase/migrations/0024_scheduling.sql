-- 0024 — Slot booking, workshop check-in, and slot release
--
-- Build prompt §6.6: "Booking must use SELECT ... FOR UPDATE or an atomic
-- UPDATE ... WHERE booked_count < capacity to prevent double-booking under
-- concurrency. Write a test for this."
--
-- The atomic UPDATE is chosen over SELECT ... FOR UPDATE because it is a
-- single statement: there is no window between the check and the increment in
-- which application code could be interrupted, and no way to accidentally read
-- the slot without locking it. Under READ COMMITTED, a second transaction
-- blocks on the row lock and then RE-EVALUATES the WHERE clause against the
-- committed row — which is precisely the behaviour that makes this safe.

create or replace function public.book_appointment(
  p_slot_id     uuid,
  p_service_id  uuid,
  p_vehicle_id  uuid default null,
  p_problem     text default null,
  p_mileage     int default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor    uuid := auth.uid();
  v_slot     record;
  v_service  record;
  v_provider record;
  v_workshop record;
  v_mode     public.fulfilment_mode;
  v_order_id uuid;
begin
  if v_actor is null then
    raise exception 'Not authenticated' using errcode = 'insufficient_privilege';
  end if;

  select * into v_service from public.services s where s.id = p_service_id and s.is_active;
  if v_service is null then
    raise exception 'Service % not found', p_service_id using errcode = 'no_data_found';
  end if;

  if v_service.requires_vehicle and p_vehicle_id is null then
    raise exception '% requires a vehicle', v_service.name_en using errcode = 'check_violation';
  end if;

  if p_vehicle_id is not null
     and not exists (select 1 from public.vehicles v
                     where v.id = p_vehicle_id and v.owner_id = v_actor) then
    raise exception 'Vehicle % does not belong to you', p_vehicle_id
      using errcode = 'insufficient_privilege';
  end if;

  -- THE atomic claim. Everything about double-booking safety is this one
  -- statement: no row returned means the slot filled up between the customer
  -- seeing it and tapping book, which is the normal case under contention and
  -- not an error condition worth a retry loop.
  update public.appointment_slots s
  set booked_count = s.booked_count + 1
  where s.id = p_slot_id
    and not s.is_blocked
    and s.booked_count < s.capacity
    and s.starts_at > now()
  returning * into v_slot;

  if v_slot is null then
    raise exception 'That appointment slot is no longer available'
      using errcode = 'lock_not_available',
            hint = 'Choose another time.';
  end if;

  select * into v_provider from public.providers p where p.id = v_slot.provider_id;
  if v_provider.verification_status <> 'approved' then
    raise exception 'Provider is not approved' using errcode = 'check_violation';
  end if;

  if not exists (select 1 from public.provider_services ps
                 where ps.provider_id = v_slot.provider_id and ps.service_id = p_service_id) then
    raise exception 'This provider does not offer that service' using errcode = 'check_violation';
  end if;

  -- A workshop provider with a fixed location books as `workshop`; a mobile
  -- provider booked for a future time is `mobile_scheduled`. The distinction
  -- decides which transition table the order will follow.
  select * into v_workshop from public.workshops w where w.provider_id = v_slot.provider_id;
  v_mode := case when v_workshop is null then 'mobile_scheduled' else 'workshop' end;

  if not (v_mode = any(v_service.supported_modes)) then
    raise exception '% is not available for % booking', v_service.name_en, v_mode
      using errcode = 'check_violation';
  end if;

  insert into public.orders (
    customer_id, vehicle_id, service_id, fulfilment_mode, status,
    provider_id, workshop_id, slot_id, scheduled_for,
    service_location, service_address_ar,
    problem_description, mileage_at_order, quoted_amount, created_by
  ) values (
    v_actor, p_vehicle_id, p_service_id, v_mode, 'draft',
    v_slot.provider_id,
    case when v_mode = 'workshop' then v_slot.provider_id else null end,
    p_slot_id, v_slot.starts_at,
    -- A workshop order is located at the workshop; a scheduled mobile visit
    -- needs a customer location, which the caller supplies separately before
    -- confirming. The orders_mode_location constraint enforces the pairing.
    case when v_mode = 'workshop' then null else v_workshop.location end,
    case when v_mode = 'workshop' then v_workshop.address_ar else null end,
    p_problem, p_mileage, v_service.base_price, v_actor
  )
  returning id into v_order_id;

  return v_order_id;
end;
$$;

comment on function public.book_appointment is
  'Atomically claims a slot and creates the order. No row updated = slot gone. Build prompt §6.6.';


-- Releasing a slot ----------------------------------------------------------
-- A cancelled booking must return its capacity, or a workshop silently loses
-- a bay for the day every time someone changes their mind.
create or replace function public.release_slot_on_cancel()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'cancelled' and old.status <> 'cancelled' and new.slot_id is not null then
    update public.appointment_slots
    set booked_count = greatest(0, booked_count - 1)
    where id = new.slot_id;
  end if;
  return new;
end;
$$;

create trigger orders_release_slot
  after update of status on public.orders
  for each row execute function public.release_slot_on_cancel();


-- Workshop check-in ---------------------------------------------------------
-- ADR-0006: workshop orders skip en_route/arrived. `checked_in` means the
-- vehicle is physically at the workshop, which is the workshop equivalent of
-- `arrived` and gates the start of work.
create or replace function public.check_in_vehicle(p_order_id uuid)
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

  if v_order.fulfilment_mode <> 'workshop' then
    raise exception 'Check-in applies to workshop orders only' using errcode = 'check_violation';
  end if;

  -- Either side can check the car in: the customer dropping it off, or the
  -- workshop receiving it.
  if auth.uid() <> v_order.customer_id
     and v_order.provider_id is distinct from public.current_provider_id() then
    raise exception 'Not permitted to check in this order'
      using errcode = 'insufficient_privilege';
  end if;

  update public.orders set status = 'checked_in' where id = p_order_id;
end;
$$;


-- Slot generation -----------------------------------------------------------
-- Providers publish availability in bulk rather than one row at a time.
create or replace function public.generate_slots(
  p_from      date,
  p_days      int,
  p_start_hour int default 8,
  p_end_hour   int default 20,
  p_slot_minutes int default 60,
  p_capacity   int default 1
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_provider_id uuid := public.current_provider_id();
  v_created int := 0;
  v_day date;
  v_slot timestamptz;
begin
  if v_provider_id is null then
    raise exception 'Not a provider' using errcode = 'insufficient_privilege';
  end if;

  if p_days < 1 or p_days > 60 then
    raise exception 'Generate between 1 and 60 days at a time' using errcode = 'check_violation';
  end if;

  for i in 0 .. p_days - 1 loop
    v_day := p_from + i;
    v_slot := (v_day + make_time(p_start_hour, 0, 0)) at time zone 'Asia/Riyadh';

    while extract(hour from (v_slot at time zone 'Asia/Riyadh')) < p_end_hour loop
      insert into public.appointment_slots (provider_id, starts_at, ends_at, capacity)
      values (v_provider_id, v_slot,
              v_slot + make_interval(mins => p_slot_minutes), p_capacity)
      on conflict (provider_id, starts_at) do nothing;

      v_created := v_created + 1;
      v_slot := v_slot + make_interval(mins => p_slot_minutes);
    end loop;
  end loop;

  return v_created;
end;
$$;

grant execute on function public.book_appointment(uuid, uuid, uuid, text, int) to authenticated;
grant execute on function public.check_in_vehicle(uuid) to authenticated;
grant execute on function public.generate_slots(date, int, int, int, int, int) to authenticated;
