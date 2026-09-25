-- 0075 — Security sweep: what a signed-in stranger could still reach
--
-- A catalogue sweep (every view, every function a client role can execute,
-- every definer function that never asks who is calling) found four holes.
-- Each was reproduced as a plain `authenticated` user before it was closed,
-- and suite 48 keeps them closed.
--
--   1. `active_warranties` returned every customer's live cover — customer,
--      car, provider, order number — to any signed-in user. 0025's comment
--      said it "inherits RLS from orders because it is not SECURITY DEFINER";
--      a view runs with its OWNER's rights unless it says otherwise, and the
--      owner is not subject to the orders policies.
--
--   2. `append_vehicle_timeline_event` was executable by clients. It checks
--      that the caller owns the car, but provenance is derived from the event
--      type and the order id — so an owner could write «تم تغيير المحرك
--      بالكامل في هبّة» as a `record_annotated` event and it was stored as
--      habba_verified. That forges the one thing §1 says a buyer can trust.
--      Clients now reach the timeline only through the narrow wrappers
--      (record_past_service, record_mileage) and the new
--      log_vehicle_registration below, none of which take an event type.
--
--   3. Internal machinery with no caller check was executable by anyone:
--      broadcast_order (re-dispatch any order to technicians), match_providers
--      (which technicians are online and how far from any order), the
--      fleet-wide maintenance scan, the mileage estimator, the evidence
--      assertion and the inspection scorer. Every caller of these is itself a definer function
--      or the scheduler; none is the app.
--
--   4. capture_order_payment captured any completed order for any caller. It
--      now requires the order's customer, an operator, or no end user at all
--      (the scheduler and the definer functions in 0070 and 0071).
--
-- And two defaults tightened so the next function is closed until opened:
--
--   * Functions are no longer executable by PUBLIC (which includes `anon`) by
--     default. What signed-in users could run before, they still can; what a
--     signed-out caller can run is an explicit list.
--   * TRUNCATE, TRIGGER and REFERENCES on tables are revoked from client
--     roles. TRUNCATE ignores RLS entirely; no client has a reason to hold it.

-- ---------------------------------------------------------------------------
-- 1. The warranty view obeys the caller's RLS
-- ---------------------------------------------------------------------------
alter view public.active_warranties set (security_invoker = true);

comment on view public.active_warranties is
  'The payer''s live cover, scoped by orders RLS (security_invoker, 0075). NOT the '
  'car''s cover — after a transfer those differ; use vehicle_warranties() (ADR-0021).';


-- ---------------------------------------------------------------------------
-- 2. Registration without a free-text door into the timeline
-- ---------------------------------------------------------------------------
-- The one thing the app wrote through append_vehicle_timeline_event directly
-- was the car's first entry. This writes exactly that — fixed wording, once
-- per car, only by its owner — and nothing else.
create or replace function public.log_vehicle_registration(p_vehicle_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_existing uuid;
begin
  select v.owner_id into v_owner from public.vehicles v
   where v.id = p_vehicle_id and v.is_active;

  if v_owner is null or v_owner is distinct from (select auth.uid()) then
    raise exception 'Not permitted to register this vehicle'
      using errcode = 'insufficient_privilege';
  end if;

  select t.id into v_existing from public.vehicle_timeline t
   where t.vehicle_id = p_vehicle_id and t.event_type = 'vehicle_registered'
   limit 1;
  if v_existing is not null then
    return v_existing;
  end if;

  return public.append_vehicle_timeline_event(
    p_vehicle_id  => p_vehicle_id,
    p_event_type  => 'vehicle_registered',
    p_summary_ar  => 'تم تسجيل السيارة في هبّة',
    p_summary_en  => 'Vehicle registered with Habba',
    p_occurred_at => now()
  );
end;
$$;


-- ---------------------------------------------------------------------------
-- 4. Capture: the customer, an operator, or the system
-- ---------------------------------------------------------------------------
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
  -- operator (0070). An end user must be the one who is paying.
  if v_caller is not null and v_caller <> v_order.customer_id and not public.is_ops() then
    raise exception 'Only the customer may release payment for this order'
      using errcode = 'insufficient_privilege';
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


-- ---------------------------------------------------------------------------
-- Function privileges: closed by default, opened by name
-- ---------------------------------------------------------------------------
-- Keep what signed-in users had through PUBLIC — and only that: a blanket
-- grant would reopen what earlier migrations closed by revoking from
-- `authenticated` (issue_zatca_invoice in 0074, the privileged-write switch,
-- ...). Then take PUBLIC away; PUBLIC is how `anon` reached all of it.
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
       and p.proname not like 'test\_%'
       and (p.proacl is null
            or exists (select 1 from aclexplode(p.proacl) a
                        where a.grantee = 0 and a.privilege_type = 'EXECUTE'))
  loop
    execute format('grant execute on function %s to authenticated, service_role', r.sig);
    execute format('revoke execute on function %s from public', r.sig);
  end loop;

  for r in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
       and p.proname not like 'test\_%'
  loop
    execute format('revoke execute on function %s from anon', r.sig);
  end loop;
end
$$;

-- A signed-out caller: the public settings, a shared report by its token, the
-- chain check and the VAT rate, and is_ops() because the services and
-- maintenance item read policies call it for every role that reads them.
grant execute on function public.get_public_settings() to anon;
grant execute on function public.get_habba_report(text) to anon;
grant execute on function public.get_inspection_report(text) to anon;
grant execute on function public.verify_vehicle_timeline(uuid) to anon;
grant execute on function public.vat_rate_on(date) to anon;
grant execute on function public.is_ops() to anon;

-- Internal only (3, and 2's general writer).
revoke execute on function public.append_vehicle_timeline_event(uuid, public.timeline_event_type, text, text, timestamptz, integer, uuid, uuid, jsonb, jsonb) from authenticated;
revoke execute on function public.broadcast_order(uuid, integer) from authenticated;
revoke execute on function public.match_providers(uuid, integer, integer) from authenticated;
revoke execute on function public.run_maintenance_scan(integer) from authenticated;
-- scan_vehicle_maintenance stays open: the alert it writes goes through the
-- timeline writer's owner check, so a scan by anyone but the owner (or ops)
-- is refused before it writes, and a scan that writes nothing reveals nothing.
revoke execute on function public.estimate_current_mileage(uuid) from authenticated;
revoke execute on function public.applicable_rules(uuid) from authenticated;
revoke execute on function public.last_service_for_rule(uuid, uuid) from authenticated;
revoke execute on function public.assert_completion_evidence(uuid) from authenticated;
revoke execute on function public.score_inspection(uuid, jsonb) from authenticated;

-- The next function written is closed until a migration opens it.
alter default privileges in schema public revoke execute on functions from public;


-- ---------------------------------------------------------------------------
-- Table privileges nobody on a client needs
-- ---------------------------------------------------------------------------
revoke truncate, trigger, references on all tables in schema public from anon, authenticated;
alter default privileges in schema public revoke truncate, trigger, references on tables from anon, authenticated;
