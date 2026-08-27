-- 0035 — Column guards on order_parts and maintenance_alerts
--
-- ⚠️ SECURITY FIX, third pass. Probed, both worked:
--
--   -- customer approves the battery at 320, provider then makes it 1200
--   update order_parts set unit_price = 1200 where id = <approved line>;
--
--   -- owner rewrites Habba's own maintenance advice
--   update maintenance_alerts set confidence = 'oem', message_ar = '...';
--
-- The first defeats transparent parts pricing (§1.6) completely. The state
-- machine checks that every line has `approved_by_customer = true` before the
-- job can be handed back — so a provider quotes a battery at 320, the customer
-- approves it, the provider silently changes the line to 1200, and the guard
-- still sees "all approved". The customer approved a number that no longer
-- exists.

create or replace function public.guard_order_parts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order    record;
  v_provider uuid := public.current_provider_id();
  v_is_customer boolean;
  v_is_provider boolean;
  v_priced_change boolean;
begin
  if public.is_ops() or public.is_privileged_write() then
    return new;
  end if;

  select * into v_order from public.orders o where o.id = old.order_id;

  v_is_customer := auth.uid() is not null and auth.uid() = v_order.customer_id;
  v_is_provider := v_provider is not null and v_provider = v_order.provider_id;

  if new.order_id is distinct from old.order_id then
    raise exception 'A part line cannot be moved to another order'
      using errcode = 'insufficient_privilege';
  end if;

  v_priced_change :=
       new.unit_price is distinct from old.unit_price
    or new.quantity is distinct from old.quantity
    or new.name_ar is distinct from old.name_ar
    or new.part_number is distinct from old.part_number
    or new.is_oem is distinct from old.is_oem
    or new.warranty_days is distinct from old.warranty_days;

  -- What the part is and what it costs is the provider's to state.
  if v_priced_change and not v_is_provider then
    raise exception 'Only the assigned provider may change a part line'
      using errcode = 'insufficient_privilege';
  end if;

  -- Whether to pay for it is the customer's to decide.
  if (new.approved_by_customer is distinct from old.approved_by_customer
      or new.approved_at is distinct from old.approved_at)
     and not v_is_customer then
    raise exception 'Only the customer may approve a part line'
      using errcode = 'insufficient_privilege';
  end if;

  -- Changing a line the customer already approved REVOKES that approval,
  -- rather than being refused outright. A provider who genuinely mis-typed a
  -- price should be able to correct it — but the customer then has to approve
  -- the corrected line, and the state machine blocks hand-back until they do.
  -- Silently keeping the approval is what made the attack work.
  if v_priced_change and old.approved_by_customer then
    new.approved_by_customer := false;
    new.approved_at := null;
  end if;

  return new;
end;
$$;

create trigger order_parts_a_guard
  before update on public.order_parts
  for each row execute function public.guard_order_parts();

alter table public.order_parts enable always trigger order_parts_a_guard;


-- ---------------------------------------------------------------------------
-- maintenance_alerts
-- ---------------------------------------------------------------------------
-- An alert is Habba's assertion about the car, including whether the interval
-- behind it is a generic estimate or manufacturer guidance. An owner rewriting
-- `confidence` from 'generic' to 'oem', or editing the message, is editing
-- something Habba said.
--
-- The direct UPDATE policy existed so owners could dismiss an alert — but
-- dismissal already goes through `dismiss_alert`, and conversion through
-- `convert_alert_to_order`. Both are SECURITY DEFINER, so removing the policy
-- costs nothing and closes the column question entirely rather than
-- enumerating it.
drop policy if exists maintenance_alerts_update on public.maintenance_alerts;


-- ---------------------------------------------------------------------------
-- Ownership transfer: a MISSING capability, recorded rather than fixed here
-- ---------------------------------------------------------------------------
-- Probing showed a transfer recipient cannot accept a transfer — the update
-- silently matches zero rows, because `ownership_transfers` has no UPDATE
-- policy at all. That is not a vulnerability; it is the acceptance half of the
-- acquisition loop never having been built (the table landed in Phase 1 with
-- §6.2, and Phase 2 built the logbook rather than the transfer flow).
--
-- It needs: OTP verification against otp_code_hash, expiry enforcement, an
-- atomic claim so a repeated tap cannot transfer twice, reassignment of
-- vehicles.owner_id through a privileged write, and an `ownership_transferred`
-- timeline event so the logbook records that the car changed hands.
--
-- Left undone deliberately rather than half-built: it is a flow, not a guard,
-- and it deserves its own tests. Flagged here so the gap is visible in the
-- schema rather than only in a report.
comment on table public.ownership_transfers is
  'Vehicle handover. ⚠️ INCOMPLETE: no acceptance path exists yet — see 0035.';
