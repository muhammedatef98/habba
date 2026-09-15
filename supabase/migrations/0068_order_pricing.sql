-- 0068 — The quote is derived from its lines, not asserted alongside them
--
-- `order_parts` has existed since 0019 with a column guard (0035) and RLS that
-- lets the assigned provider write lines. Nothing has ever created one: there
-- is no provider screen, so §1's sixth differentiator — parts line-itemed with
-- part numbers, OEM flagged, priced before approval — is a table nobody fills
-- in, and `orders.quoted_amount` reaching `quoted` was never possible either.
--
-- Building that screen surfaced a hole underneath it.
--
-- ⚠️ `orders.parts_amount` is a column the PROVIDER writes, and the
-- customer-approval gate reads it:
--
--     if new.parts_amount > 0 then
--       ... refuse hand-back while any line is unapproved
--
-- So a provider could add three unapproved part lines, leave `parts_amount` at
-- its default of 0, and hand the job straight back. The gate that exists to
-- stop a customer being charged for parts they never agreed to was bypassable
-- by not updating a number the same person controls.
--
-- Two fixes, and they are different in kind:
--
--   1. `parts_amount` stops being asserted and starts being DERIVED — a trigger
--      recomputes it from the lines on every change, so it cannot be stale or
--      understated whatever path wrote them.
--   2. The approval gate stops consulting it at all. A derived column is still
--      a column; the question "is any line unapproved" has an answer that does
--      not pass through one.
--
-- Money arithmetic lives here rather than on the device for the ordinary reason
-- (§2.2): the client is a thin renderer, and VAT at 15% on parts + labour is
-- precisely the kind of rule that must not have two implementations.


/**
 * What the lines on this order come to.
 *
 * Definer so the trigger can total lines regardless of who is writing — the
 * customer approving a line must produce the same total as the provider adding
 * one.
 */
create or replace function public.order_parts_total(p_order_id uuid)
returns numeric(12,2)
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(p.quantity * p.unit_price), 0)::numeric(12,2)
    from public.order_parts p
   where p.order_id = p_order_id;
$$;

/**
 * Recomputes an order's money from its parts, its labour and the VAT rate.
 *
 * ⚠️ ONE statement, and `p_labour` is a parameter rather than something the
 * caller writes first.
 *
 * `orders_totals_reconcile` (0019) asserts
 * `total = parts + labour + vat` on every write, so an implementation that set
 * `labour_amount` and then repriced is rejected between the two — the row is
 * momentarily inconsistent and the constraint is not deferred. That is the
 * constraint doing its job: these four columns only mean anything together.
 *
 * The VAT rate is read for TODAY on an open order, and `vat_rate_applied` is
 * the snapshot that survives a future rate change (ADR-0007). An order that is
 * already closed is never repriced — see the status check — so a VAT change
 * next year cannot silently restate a completed job's invoice.
 *
 * @param p_labour Null keeps whatever labour is already on the order, which is
 *   what a part-line change wants. `set_order_labour` passes a value.
 */
create or replace function public.reprice_order(
  p_order_id uuid,
  p_labour   numeric default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order  record;
  v_parts  numeric(12,2);
  v_labour numeric(12,2);
  v_rate   numeric;
  v_vat    numeric(12,2);
begin
  select * into v_order from public.orders o where o.id = p_order_id;
  if v_order is null then return; end if;

  -- Nothing is repriced once the customer has closed the job. The figures on a
  -- completed order are what was invoiced and what a payout was built from
  -- (0067); recomputing them later would move money that has already moved.
  if v_order.status in ('completed', 'cancelled', 'disputed') then return; end if;

  v_parts  := public.order_parts_total(p_order_id);
  v_labour := round(coalesce(p_labour, v_order.labour_amount, 0), 2);
  v_rate   := coalesce(public.vat_rate_on(current_date), 0.15);
  v_vat    := round((v_parts + v_labour) * v_rate, 2);

  -- Privileged: `guard_order_columns` (0033) reserves these columns for the
  -- assigned provider, and this runs on the customer's behalf too when they
  -- approve a line.
  perform public.begin_privileged_write();

  update public.orders
     set parts_amount     = v_parts,
         labour_amount    = v_labour,
         vat_amount       = v_vat,
         vat_rate_applied = v_rate,
         total_amount     = v_parts + v_labour + v_vat
   where id = p_order_id;

  perform public.end_privileged_write();
end;
$$;


create or replace function public.reprice_on_part_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.reprice_order(coalesce(new.order_id, old.order_id));
  return coalesce(new, old);
end;
$$;

create trigger order_parts_z_reprice
  after insert or update or delete on public.order_parts
  for each row execute function public.reprice_on_part_change();

-- `enable always`, like the column guard it sits beside: a derived total that
-- can be switched off by a session setting is not derived.
alter table public.order_parts enable always trigger order_parts_z_reprice;


/**
 * A part line cannot appear on a job that is no longer open.
 *
 * `order_parts_write_provider` (0022) checks WHO may write and never checked
 * WHEN. Adding a line after the customer approved the job, or after it
 * completed, would move `total_amount` under an invoice that has already been
 * issued and a payout that may already have been built.
 *
 * The status list is the window in which a customer can still approve what they
 * are being charged for.
 */
create or replace function public.guard_order_part_window()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.order_status;
begin
  if public.is_ops() or public.is_privileged_write() then
    return coalesce(new, old);
  end if;

  select o.status into v_status
    from public.orders o
   where o.id = coalesce(new.order_id, old.order_id);

  -- An approval by the customer is an UPDATE and must stay possible while the
  -- job is with them. Only adding and removing lines is closed off here.
  if tg_op in ('INSERT', 'DELETE')
     and v_status not in ('accepted', 'en_route', 'arrived', 'checked_in', 'in_progress') then
    raise exception 'Parts can only be added or removed while the job is open (status is %)',
      v_status
      using errcode = 'check_violation',
            hint = 'A customer must be able to approve every line before the job is handed back.';
  end if;

  return coalesce(new, old);
end;
$$;

create trigger order_parts_a_guard_window
  before insert or delete on public.order_parts
  for each row execute function public.guard_order_part_window();

alter table public.order_parts enable always trigger order_parts_a_guard_window;


/**
 * The labour half of the quote.
 *
 * An RPC rather than a column write, because setting it has to reprice — and a
 * provider who updated `labour_amount` directly would leave `total_amount`
 * disagreeing with its own check constraint's inputs until something else
 * touched the order.
 */
create or replace function public.set_order_labour(p_order_id uuid, p_labour numeric)
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
    raise exception 'Only the assigned provider may price this job'
      using errcode = 'insufficient_privilege';
  end if;

  if p_labour is null or p_labour < 0 then
    raise exception 'Labour cannot be negative' using errcode = 'check_violation';
  end if;

  if v_order.status not in ('accepted', 'en_route', 'arrived', 'checked_in', 'in_progress') then
    raise exception 'The price can only be set while the job is open (status is %)', v_order.status
      using errcode = 'check_violation';
  end if;

  -- One call, one write. See `reprice_order`: setting labour separately breaks
  -- `orders_totals_reconcile` between the two statements.
  perform public.reprice_order(p_order_id, p_labour);
end;
$$;

grant execute on function public.set_order_labour(uuid, numeric) to authenticated;
grant execute on function public.order_parts_total(uuid) to authenticated;
-- Not granted to `authenticated`: repricing is something the system does in
-- response to a change, never something a client asks for. ⚠️ Revoked from the
-- named roles too — 0001's default privileges grant execute on every new
-- function to `anon, authenticated`, and a `revoke from public` leaves that
-- untouched (the hole 0067 found).
revoke all on function public.reprice_order(uuid, numeric) from public, anon, authenticated;


/**
 * Hand-back is refused while ANY line is unapproved.
 *
 * ⚠️ Deliberately does not consult `orders.parts_amount`.
 *
 * `enforce_order_transition` (0032) guards the same thing behind
 * `if new.parts_amount > 0`, and that column is written by the provider — the
 * same person the gate exists to check. Adding lines and leaving the column at
 * zero walked straight past it. The trigger above now keeps that column
 * truthful, but a gate whose correctness depends on another trigger having run
 * is a gate with a sequence to get right; this one asks the question directly.
 *
 * Both remain. 0032's is not removed, because two independent refusals are
 * cheaper than one and this is the customer's money.
 */
create or replace function public.assert_parts_approved()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_unapproved int;
begin
  if new.status is not distinct from old.status then return new; end if;
  if new.status not in ('awaiting_approval', 'completed') then return new; end if;

  select count(*) into v_unapproved
    from public.order_parts p
   where p.order_id = new.id and not p.approved_by_customer;

  if v_unapproved > 0 then
    raise exception '% part line(s) are not approved by the customer', v_unapproved
      using errcode = 'check_violation',
            hint = 'The customer approves each part before the job can be handed back.';
  end if;

  return new;
end;
$$;

-- `b_` so it runs after `orders_a_guard_columns` and alongside the transition
-- enforcement — the order does not matter for correctness, since both raise.
create trigger orders_b_assert_parts_approved
  before update of status on public.orders
  for each row execute function public.assert_parts_approved();

alter table public.orders enable always trigger orders_b_assert_parts_approved;

comment on column public.orders.parts_amount is
  'DERIVED from order_parts by reprice_order (0068). Never assert it directly — it is recomputed on every line change.';
