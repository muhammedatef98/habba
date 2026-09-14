-- 0055 — A warranty follows the car (ADR-0021)
--
-- `claim_warranty` (0025) authorises on `orders.customer_id` — the person who
-- paid. `generate_habba_report` (0014/0046) prints every live warranty on the
-- car with no reference to who paid. Before 0054 nothing could complete a
-- transfer, so the two never disagreed. Now they can, and when they do the
-- report is the one that is wrong in public:
--
--   * the buyer reads «ساري» for cover `claim_warranty` will refuse them;
--   * the seller keeps a claim on a car they no longer own;
--   * and `active_warranties` inherits the `orders` RLS, so the buyer cannot
--     even see the row they are being refused.
--
-- §1 rests the entire product on that report being trustworthy to a stranger.
-- An overstated warranty is not a small error in it — it is the failure that
-- makes every other line suspect, discovered at a counter with the document in
-- hand. So the database moves to what the report already says.
--
-- ADR-0021 has the full reasoning, including what happens to a claim that is
-- in flight when the car changes hands (the transfer is refused, in 0054) and
-- what the seller keeps afterwards (their orders and invoices; not the car).

-- ---------------------------------------------------------------------------
-- claim_warranty
-- ---------------------------------------------------------------------------
-- Dropped rather than replaced. The new signature takes a location, and adding
-- defaulted parameters to the existing one would have left two functions in
-- the catalogue and made every `claim_warranty($1, $2)` call ambiguous.
drop function if exists public.claim_warranty(uuid, text);

create or replace function public.claim_warranty(
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
  v_actor    uuid := auth.uid();
  v_parent   record;
  v_child    uuid;
  v_is_payer boolean;
  v_location extensions.geography;
  v_address  text;
begin
  if v_actor is null then
    raise exception 'Not authenticated' using errcode = 'insufficient_privilege';
  end if;

  select * into v_parent from public.orders o where o.id = p_order_id;

  if v_parent is null then
    raise exception 'Order % not found', p_order_id using errcode = 'no_data_found';
  end if;

  v_is_payer := v_parent.customer_id = v_actor;

  -- ADR-0021. The right to claim belongs to whoever owns the car now. An order
  -- with no vehicle has no car to follow — services where `requires_vehicle`
  -- is false — so it stays with the payer.
  if v_parent.vehicle_id is null then
    if not v_is_payer then
      raise exception 'Only the customer on the order may claim its warranty'
        using errcode = 'insufficient_privilege';
    end if;
  elsif not exists (
    select 1 from public.vehicles v
    where v.id = v_parent.vehicle_id and v.owner_id = v_actor
  ) then
    raise exception 'Only the current owner of the vehicle may claim this warranty'
      using errcode = 'insufficient_privilege',
            hint = 'A warranty follows the car — see ADR-0021.';
  end if;

  if v_parent.status <> 'completed' then
    raise exception 'Only a completed job carries a warranty' using errcode = 'check_violation';
  end if;

  if v_parent.warranty_expires_at is null then
    raise exception 'This job carried no warranty' using errcode = 'check_violation';
  end if;

  if v_parent.warranty_expires_at < now() then
    raise exception 'The warranty on this job expired on %',
      to_char(v_parent.warranty_expires_at, 'YYYY-MM-DD')
      using errcode = 'check_violation',
            hint = 'You can still book this as a normal paid service.';
  end if;

  -- One live claim per job. Without this, a repeated tap on a slow connection
  -- creates two free orders and dispatches the provider twice.
  if exists (
    select 1 from public.orders c
    where c.parent_order_id = p_order_id
      and c.status not in ('cancelled')
  ) then
    raise exception 'A warranty claim is already open on this job'
      using errcode = 'unique_violation';
  end if;

  -- Where the re-service happens.
  --
  -- The parent's `service_location` and `service_address_ar` are the PAYER's
  -- home. Copying them for a new owner would both send a technician to the
  -- wrong door and print the seller's address inside an order the buyer can
  -- read — the second is a data leak dressed as a convenience.
  --
  -- A workshop claim needs neither: `orders_mode_location` (0019) is satisfied
  -- by `workshop_id`, and the address is the workshop's.
  if v_parent.fulfilment_mode = 'workshop' then
    v_location := null;
    v_address  := null;
  elsif v_is_payer and p_lon is null and p_lat is null then
    v_location := v_parent.service_location;
    v_address  := v_parent.service_address_ar;
  else
    if p_lon is null or p_lat is null then
      raise exception 'A location is required for a mobile warranty claim'
        using errcode = 'check_violation',
              hint = 'The original job''s address belongs to whoever paid for it, not to this claim.';
    end if;
    perform public.assert_plausible_coordinate(p_lon, p_lat);
    v_location := extensions.st_point(p_lon, p_lat)::extensions.geography;
    v_address  := p_address_ar;
  end if;

  insert into public.orders (
    customer_id, vehicle_id, service_id, fulfilment_mode, status,
    provider_id, workshop_id,
    service_location, service_address_ar,
    problem_description, mileage_at_order,
    -- Free by construction. Not "discounted to zero" — there is no money in
    -- this order at all, which is why no authorisation is required.
    quoted_amount, parts_amount, labour_amount, vat_amount, total_amount,
    escrow_status, parent_order_id, created_by
  ) values (
    -- The CLAIMANT, not the payer. The child is dispatched to them and read
    -- back through `orders_read_customer` (0022), so a child owned by the
    -- seller would be invisible to the buyer who booked it.
    v_actor, v_parent.vehicle_id, v_parent.service_id,
    v_parent.fulfilment_mode, 'draft',
    -- Auto-routed to the SAME provider. This is the whole point.
    v_parent.provider_id, v_parent.workshop_id,
    v_location, v_address,
    p_problem, v_parent.mileage_at_order,
    0, 0, 0, 0, 0,
    'none', p_order_id, v_actor
  )
  returning id into v_child;

  return v_child;
end;
$$;

comment on function public.claim_warranty(uuid, text, double precision, double precision, text) is
  'Free re-service routed back to the original provider, claimed by the CURRENT '
  'owner of the vehicle (ADR-0021). CLAUDE.md §1.5.';

grant execute on function public.claim_warranty(uuid, text, double precision, double precision, text)
  to authenticated;


-- ---------------------------------------------------------------------------
-- vehicle_warranties — what is covered on this car, for whoever owns it
-- ---------------------------------------------------------------------------
-- The buyer's read surface, and the reason this is a function rather than a
-- policy.
--
-- The obvious fix — an `orders` policy letting the current vehicle owner read
-- rows for their car — would hand the buyer `total_amount`,
-- `problem_description`, `customer_id` and `service_address_ar`: what the
-- seller paid, what they said was wrong with the car, and where they live.
-- None of that is needed to answer "what is still covered".
--
-- So this returns the same shape `generate_habba_report` settled on in 0046,
-- plus the order id the owner needs in order to claim. Expired cover is
-- excluded here, unlike in the report: the report is a document a buyer reads
-- to judge a car's history, this is a list of things you can act on today.
create or replace function public.vehicle_warranties(p_vehicle_id uuid)
returns table (
  order_id            uuid,
  service_ar          text,
  service_en          text,
  provider_name_ar    text,
  completed_at        timestamptz,
  warranty_expires_at timestamptz,
  days_remaining      int,
  has_open_claim      boolean
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
    exists (
      select 1 from public.orders c
      where c.parent_order_id = o.id and c.status <> 'cancelled'
    )
  from public.orders o
  join public.services s on s.id = o.service_id
  left join public.providers pr on pr.id = o.provider_id
  where o.vehicle_id = p_vehicle_id
    -- The gate. SECURITY DEFINER reaches past `orders_read_customer`, so
    -- ownership is checked here explicitly and nowhere else decides it.
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

comment on function public.vehicle_warranties(uuid) is
  'Live cover on a car, for its current owner (ADR-0021). No amounts, no '
  'addresses, no payer identity — only what a claim needs.';

grant execute on function public.vehicle_warranties(uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- active_warranties keeps its meaning, and says which one it is
-- ---------------------------------------------------------------------------
-- Left exactly as 0025 wrote it. It is the PAYER's view of their own orders
-- and is still correct as that — a seller looking at what they have bought.
-- It is no longer the answer to "what is covered on this car", and the comment
-- exists so the next person reading it does not reach for it as one.
comment on view public.active_warranties is
  'The payer''s live cover, scoped by orders RLS. NOT the car''s cover — after '
  'a transfer those differ; use vehicle_warranties() (ADR-0021).';
