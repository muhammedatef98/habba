-- 0065 — An order the customer sends actually goes somewhere, and ends with a bill
--
-- Traced end to end through the app rather than through hand-ordered RPC
-- calls, the request pipeline stopped at the first step:
--
--   * create_emergency_order() and book_appointment() both create a `draft`.
--     Dispatch fires on the move to `searching` (0049) and nothing in the app
--     made that move, so an emergency was never broadcast. The customer's
--     tracking screen treats `draft` as "searching", so they waited on a
--     search that had never started.
--   * accept_order() refuses an unfunded order (0033) and nothing in the app
--     authorised payment, so no technician could have accepted it anyway.
--   * A booking is created with its provider already set, and accept_order()
--     only claims orders with no provider — so a booking could never be
--     accepted at all.
--   * Nothing ever computed the bill. The technician app does not set the
--     amounts and neither did the server, so a completed job had no total,
--     which is what the invoice, the payout and the capture all read.
--
-- submit_order() is the customer's commit: payment held, then either
-- broadcast (on demand) or confirmed with the provider they chose (booked).
-- The bill is computed by the server at hand-back, because pricing is never
-- the client's (§2.2).


-- ---------------------------------------------------------------------------
-- submit_order
-- ---------------------------------------------------------------------------
create or replace function public.submit_order(p_order_id uuid)
returns public.order_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order record;
  v_next  public.order_status;
begin
  select * into v_order from public.orders o where o.id = p_order_id;

  if v_order is null then
    raise exception 'Order % not found', p_order_id using errcode = 'no_data_found';
  end if;

  if v_order.customer_id is distinct from auth.uid() then
    raise exception 'Only the customer may submit their order'
      using errcode = 'insufficient_privilege';
  end if;

  -- A retry after a dropped response must not fail: the first call worked,
  -- and telling someone at the roadside "error" about a request that is in
  -- fact out there sends them to request it twice.
  if v_order.status <> 'draft' then
    if v_order.status in ('searching', 'accepted') then
      return v_order.status;
    end if;
    raise exception 'This order has already moved on (status is %)', v_order.status
      using errcode = 'check_violation';
  end if;

  -- Nobody is asked to drive out on an unfunded order, and no workshop holds a
  -- bay for one. Free orders (a warranty re-service) hold no money.
  if coalesce(v_order.quoted_amount, 0) > 0 and v_order.escrow_status <> 'authorised' then
    raise exception 'Payment has not been authorised for this order'
      using errcode = 'check_violation',
            hint = 'Authorise the payment, then submit.';
  end if;

  if v_order.fulfilment_mode = 'mobile_ondemand' then
    v_next := 'searching';
  elsif v_order.provider_id is not null then
    -- The customer chose the provider and the slot was claimed atomically
    -- (0024). There is nothing left for anyone to accept: it is confirmed.
    v_next := 'accepted';
  else
    raise exception 'A booked order must name its provider' using errcode = 'check_violation';
  end if;

  update public.orders set status = v_next where id = p_order_id;

  return v_next;
end;
$$;

comment on function public.submit_order(uuid) is
  'The customer commits a funded draft: on-demand orders are broadcast, booked ones confirmed. Idempotent. 0065.';

revoke execute on function public.submit_order(uuid) from public, anon;
grant execute on function public.submit_order(uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- The bill, at hand-back
-- ---------------------------------------------------------------------------
-- Labour is the agreed price (the catalogue's, or the provider's for a
-- service that allows one — never typed in at the end). Parts are the lines
-- the customer approved; a line they never approved is not on their bill.
-- VAT is the rate in force today (0012), rounded half-up to the halala like
-- @habba/core's SarAmount (ADR-0007).
--
-- Only when no bill exists yet. Amounts set explicitly — by ops correcting a
-- job, or a fixture — are not overwritten.
--
-- `orders_b_…` so it runs after the column guard (`orders_a_…`), which has
-- already judged what the CLIENT tried to write, and before the transition
-- trigger, which checks unapproved parts against the amounts computed here.
create or replace function public.compute_order_bill()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_parts numeric(12,2);
  v_rate  numeric;
begin
  if new.status is not distinct from old.status
     or new.status not in ('awaiting_approval', 'completed')
     or old.status <> 'in_progress'
     or new.total_amount is not null then
    return new;
  end if;

  select coalesce(sum(p.quantity * p.unit_price), 0)
    into v_parts
    from public.order_parts p
   where p.order_id = new.id and p.approved_by_customer;

  v_rate := coalesce(new.vat_rate_applied, public.vat_rate_on(current_date), 0);

  -- Both columns default to 0, not null (0019), so 0 means "never set".
  new.labour_amount    := coalesce(nullif(new.labour_amount, 0), new.quoted_amount, 0);
  new.parts_amount     := coalesce(nullif(new.parts_amount, 0), v_parts);
  new.vat_rate_applied := v_rate;
  new.vat_amount       := round((new.labour_amount + new.parts_amount) * v_rate, 2);
  new.total_amount     := new.labour_amount + new.parts_amount + new.vat_amount;

  return new;
end;
$$;

create trigger orders_b_compute_bill
  before update of status on public.orders
  for each row execute function public.compute_order_bill();

-- Same reasoning as the guards (0033): it must fire for service_role too, or
-- an ops-driven hand-back would complete a job with no bill.
alter table public.orders enable always trigger orders_b_compute_bill;


-- ---------------------------------------------------------------------------
-- The warranty, set with the evidence
-- ---------------------------------------------------------------------------
-- §1 differentiator 5: every job carries a warranty. The warranty is the
-- provider's commitment, so it is given at hand-back — but nothing in the app
-- ever set warranty_days, and a job completed through the app carried none.
-- It joins the evidence call so the two cannot be half-saved: a job handed
-- back with photos and no warranty, or the reverse.
--
-- Dropped and recreated rather than overloaded: two signatures differing by
-- a defaulted parameter make every three-argument call ambiguous.
drop function public.record_completion_evidence(uuid, int, jsonb);

create function public.record_completion_evidence(
  p_order_id uuid,
  p_mileage  int,
  p_media    jsonb,
  p_warranty_days int default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order  record;
  v_item   jsonb;
  v_url    text;
  v_prefix text := 'storage://completion-media/' || p_order_id::text || '/';
  v_name   text;
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

  if p_media is not null and jsonb_typeof(p_media) <> 'array' then
    raise exception 'Completion media must be a list' using errcode = 'invalid_parameter_value';
  end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_media, '[]'::jsonb)) loop
    if jsonb_typeof(v_item) <> 'object'
       or coalesce(v_item ->> 'kind', '') not in ('before', 'after', 'part') then
      raise exception 'Each photo needs a kind of before, after or part'
        using errcode = 'invalid_parameter_value';
    end if;

    v_url := coalesce(v_item ->> 'url', '');

    -- The prefix pins the photo to THIS order. Without it, a provider could
    -- reuse one good photo from an earlier job on every later one.
    if left(v_url, length(v_prefix)) <> v_prefix then
      raise exception 'A completion photo must be uploaded to this order, not linked from elsewhere'
        using errcode = 'invalid_parameter_value',
              hint = 'Upload the photo to completion-media/<order_id>/ and pass its storage:// reference.';
    end if;

    v_name := substr(v_url, length('storage://completion-media/') + 1);

    if position('/' in substr(v_url, length(v_prefix) + 1)) > 0 then
      raise exception 'A completion photo must sit directly in the order''s folder'
        using errcode = 'invalid_parameter_value';
    end if;

    if not exists (
      select 1 from storage.objects so
      where so.bucket_id = 'completion-media' and so.name = v_name
    ) then
      raise exception 'The photo % was never uploaded', v_url
        using errcode = 'invalid_parameter_value',
              hint = 'Upload first, then record. A reference to nothing is not evidence.';
    end if;
  end loop;

  if p_warranty_days is not null and (p_warranty_days < 0 or p_warranty_days > 365) then
    raise exception 'A warranty is between 0 and 365 days' using errcode = 'invalid_parameter_value';
  end if;

  perform public.begin_privileged_write();

  update public.orders
  set completion_mileage = p_mileage,
      completion_media = coalesce(p_media, '[]'::jsonb),
      warranty_days = coalesce(p_warranty_days, warranty_days)
  where id = p_order_id;

  perform public.end_privileged_write();
end;
$$;


comment on function public.record_completion_evidence(uuid, int, jsonb, int) is
  'The provider''s one call at hand-back: mileage, uploaded photos (0064), and the warranty they give. 0065.';

grant execute on function public.record_completion_evidence(uuid, int, jsonb, int) to authenticated;


-- ---------------------------------------------------------------------------
-- A booking is quoted at the price the customer chose it for
-- ---------------------------------------------------------------------------
-- The provider cards in the booking flow show each provider's own price where
-- the service allows one, but book_appointment() quoted the catalogue price
-- regardless — so a customer could pick a provider at 150 and be held and
-- billed 180. And where neither price exists, the booking went through with
-- nothing to hold or bill. Carried forward from 0036 with those two changes.
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

  -- A service the catalogue does not price, from a provider who has not
  -- priced it either, has no price at all. Booking it held nothing and billed
  -- nothing — the job would have been done for free.
  if coalesce(
       (select ps.custom_price from public.provider_services ps
         where ps.provider_id = v_slot.provider_id and ps.service_id = p_service_id),
       v_service.base_price) is null then
    raise exception 'This provider has not set a price for that service'
      using errcode = 'check_violation',
            hint = 'Choose another provider.';
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
    p_problem, p_mileage,
    -- The price the customer was shown on the provider's card: their own
    -- where the service allows one (0018), the catalogue's otherwise.
    coalesce(
      (select ps.custom_price from public.provider_services ps
        where ps.provider_id = v_slot.provider_id and ps.service_id = p_service_id),
      v_service.base_price),
    v_actor
  )
  returning id into v_order_id;

  return v_order_id;
end;
$$;
