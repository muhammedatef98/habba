-- 0036 — Privilege escalation, report tampering, slot capacity
--
-- ⚠️ The first of these is the most severe defect found in this project, and
-- it silently invalidated every guard added in 0033–0035:
--
--     update profiles set role = 'ops' where id = auth.uid();
--
-- `is_ops()` then returns true, and is_ops() is the FIRST check in every
-- column guard. A customer could promote themselves and then do everything
-- those migrations were written to prevent — plus read every profile, every
-- vehicle, every logbook, every payout.
--
-- It was reachable because `profiles_update_own` grants a user UPDATE on their
-- own row, and `role` is a column on that row. The same shape as every other
-- finding: RLS grants the row, and nothing said which columns.
--
-- The second lets a seller rewrite a report AFTER issuing it:
--
--     update habba_reports set payload = jsonb_set(payload, '{vehicle,current_mileage}', '40000');
--
-- The hash chain protects the TIMELINE; the report payload is a separate
-- frozen snapshot that had no protection at all. Rewriting it changes what the
-- public page serves to a buyer — the odometer included.

create or replace function public.guard_profile_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Deliberately does NOT exempt is_ops(): the whole point is that role is not
  -- self-assignable, and an is_ops() exemption here would be circular — a user
  -- who set their own role to 'ops' would pass it. Only a privileged
  -- server-side write (the ops console, once it exists) may change a role.
  if public.is_privileged_write() then
    return new;
  end if;

  if new.id is distinct from old.id
     or new.created_at is distinct from old.created_at then
    raise exception 'Profile identity cannot be changed'
      using errcode = 'insufficient_privilege';
  end if;

  -- THE escalation.
  if new.role is distinct from old.role then
    raise exception 'Your role is set by Habba, not by you'
      using errcode = 'insufficient_privilege';
  end if;

  -- Verification is a fact about an SMS that was received, not a claim.
  if new.phone_verified is distinct from old.phone_verified then
    raise exception 'Phone verification cannot be set directly'
      using errcode = 'insufficient_privilege',
            hint = 'Verify the number by SMS.';
  end if;

  -- Changing the number REVOKES its verification, the same way re-pricing a
  -- part revokes its approval (0035). Otherwise a user could verify one
  -- number and then swap in another that inherits the verified flag.
  if new.phone is distinct from old.phone then
    new.phone_verified := false;
  end if;

  return new;
end;
$$;

create trigger profiles_a_guard_columns
  before update on public.profiles
  for each row execute function public.guard_profile_columns();

alter table public.profiles enable always trigger profiles_a_guard_columns;


-- ---------------------------------------------------------------------------
-- habba_reports
-- ---------------------------------------------------------------------------
-- The policy is named `revoke_own` because revoking a shared link is the only
-- thing an owner should be able to do to an issued report. It granted UPDATE
-- on the whole row.
create or replace function public.guard_habba_report_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.is_ops() or public.is_privileged_write() then
    return new;
  end if;

  -- A report is a statement about a moment, and its verification QR attests to
  -- that moment. Everything except revocation is frozen.
  if new.payload is distinct from old.payload
     or new.public_token is distinct from old.public_token
     or new.vehicle_id is distinct from old.vehicle_id
     or new.chain_valid is distinct from old.chain_valid
     or new.chain_length is distinct from old.chain_length
     or new.generated_at is distinct from old.generated_at
     or new.generated_by is distinct from old.generated_by
     or new.expires_at is distinct from old.expires_at then
    raise exception 'An issued report cannot be edited'
      using errcode = 'insufficient_privilege',
            hint = 'Revoke it and generate a new one.';
  end if;

  return new;
end;
$$;

create trigger habba_reports_a_guard_columns
  before update on public.habba_reports
  for each row execute function public.guard_habba_report_columns();

alter table public.habba_reports enable always trigger habba_reports_a_guard_columns;


-- ---------------------------------------------------------------------------
-- appointment_slots
-- ---------------------------------------------------------------------------
-- A provider owns their calendar, but `booked_count` is not calendar — it is
-- the count of customers who hold a booking. A provider lowering it oversells
-- the slot; raising it silently cancels availability the customer can see.
create or replace function public.guard_slot_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.is_ops() or public.is_privileged_write() then
    return new;
  end if;

  if new.booked_count is distinct from old.booked_count then
    raise exception 'Booked places are counted by Habba, not set by the provider'
      using errcode = 'insufficient_privilege',
            hint = 'Block the slot instead of editing the count.';
  end if;

  if new.provider_id is distinct from old.provider_id then
    raise exception 'A slot cannot be moved to another provider'
      using errcode = 'insufficient_privilege';
  end if;

  -- Shrinking capacity below what is already booked would strand customers who
  -- hold a confirmed appointment.
  if new.capacity < old.booked_count then
    raise exception 'Capacity cannot be reduced below the % place(s) already booked',
      old.booked_count
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger appointment_slots_a_guard_columns
  before update on public.appointment_slots
  for each row execute function public.guard_slot_columns();

alter table public.appointment_slots enable always trigger appointment_slots_a_guard_columns;


-- The legitimate writers of booked_count declare themselves.
create or replace function public.release_slot_on_cancel()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'cancelled' and old.status <> 'cancelled' and new.slot_id is not null then
    perform public.begin_privileged_write();

    update public.appointment_slots
    set booked_count = greatest(0, booked_count - 1)
    where id = new.slot_id;

    perform public.end_privileged_write();
  end if;
  return new;
end;
$$;


-- book_appointment claims a place, so it is the other legitimate writer.
-- The atomic UPDATE stays exactly as it was (§6.6); only the privileged
-- window is added around it.
create or replace function public.book_appointment(
  p_slot_id     uuid,
  p_service_id  uuid,
  p_vehicle_id  uuid default null,
  p_problem     text default null,
  p_mileage     int default null,
  p_lon         double precision default null,
  p_lat         double precision default null,
  p_address_ar  text default null
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

  perform public.begin_privileged_write();

  update public.appointment_slots s
  set booked_count = s.booked_count + 1
  where s.id = p_slot_id
    and not s.is_blocked
    and s.booked_count < s.capacity
    and s.starts_at > now()
  returning * into v_slot;

  perform public.end_privileged_write();

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

  select * into v_workshop from public.workshops w where w.provider_id = v_slot.provider_id;
  v_mode := case when v_workshop is null then 'mobile_scheduled' else 'workshop' end;

  if not (v_mode = any(v_service.supported_modes)) then
    raise exception '% is not available for % booking', v_service.name_en, v_mode
      using errcode = 'check_violation';
  end if;

  if v_mode = 'mobile_scheduled' then
    if p_lon is null or p_lat is null then
      raise exception 'A mobile appointment needs the address the technician should visit'
        using errcode = 'check_violation';
    end if;
    perform public.assert_plausible_coordinate(p_lon, p_lat);
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
    case when v_mode = 'workshop'
         then null
         else extensions.st_point(p_lon, p_lat)::extensions.geography end,
    case when v_mode = 'workshop' then v_workshop.address_ar else p_address_ar end,
    p_problem, p_mileage, v_service.base_price, v_actor
  )
  returning id into v_order_id;

  return v_order_id;
end;
$$;


-- ---------------------------------------------------------------------------
-- Two guards written before ENABLE ALWAYS became the convention
-- ---------------------------------------------------------------------------
-- Found by the standing audit in tests/16, not by hand. Both were registered
-- with the default ENABLE ORIGIN, which means they do NOT fire for
-- `service_role` — the actor most worth guarding, since RLS does not apply to
-- it at all. A leaked service key could therefore:
--
--   * set a provider's own price on an emergency service, which §11 forbids
--     precisely because roadside price competition is a race to the bottom;
--   * insert a rating on an order that was never completed, or on someone
--     else's order, inflating a provider's dispatch ranking.
alter table public.provider_services
  enable always trigger provider_services_price_guard;

alter table public.ratings
  enable always trigger ratings_guard;
