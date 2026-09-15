-- 0069 — Close the functions that arrived executable by everyone
--
-- ⚠️ This is a security fix. Seven functions were callable by any signed-in
-- user, five of them added by 0065 four days ago.
--
-- The cause is one line in 0001:
--
--     alter default privileges in schema public
--       grant all on functions to anon, authenticated, service_role;
--
-- Every function created since then arrives EXECUTABLE BY ANY SIGNED-IN USER.
-- `grant execute ... to service_role` next to its definition reads like a
-- restriction and is not one — it adds a grant to a role that could already
-- call it. And `revoke ... from public` does not help either: the grant is held
-- directly by the named roles `anon` and `authenticated`, and revoking from
-- PUBLIC leaves a direct grant untouched.
--
-- 0067 hit this with `payable_order_lines` and 0068 with `reprice_order`, both
-- caught by their own suites. Probing the whole surface afterwards found the
-- rest. What was reachable:
--
--   * `claim_notification_batch` — the worst. Any signed-in user could drain
--     the outbox and read every OTHER user's notification text together with
--     their Expo push tokens. A push token is a capability: whoever holds it
--     can send notifications to that device.
--   * `enqueue_notification` — send arbitrary notification text to any user id.
--     A phishing surface with Habba's name on the banner.
--   * `disable_push_token` — silence any device whose token you hold, which the
--     first one hands you.
--   * `mark_notifications_sent` / `mark_notification_failed` — suppress someone
--     else's pending notifications, including a job offer.
--   * `run_maintenance_scan` — run the whole-fleet cron on demand.
--   * `order_parts_total` — read the parts total of any order.
--   * `broadcast_order` — force a dispatch broadcast on a STRANGER's order,
--     which since 0065 also pushes a job notification to every technician it
--     matches. Found by the standing audit rather than by hand: a hand-probe
--     with a made-up order id returns `no_data_found`, which reads like a
--     refusal and is not one.
--
-- `scan_vehicle_maintenance` and `estimate_current_mileage` were reachable too,
-- against any vehicle id. Those two are NOT revoked: scanning and estimating
-- your own car is a legitimate thing for the app to do. They are scoped to the
-- caller's own vehicle instead, which is the fix the others do not need because
-- nothing on a client should call them at all.
--
-- The moat itself held under the same probe: `append_vehicle_timeline_event`,
-- `record_past_service`, `record_mileage`, `generate_habba_report` and
-- `initiate_ownership_transfer` all refuse a vehicle that is not yours (42501).
-- Those were already scoped internally, which is the pattern the two functions
-- below are being brought in line with.
--
-- `supabase/tests/41_function_surface_audit.sql` turns this into a standing
-- check, so the next function to arrive public fails the build instead of
-- shipping.


-- Server-only entry points ----------------------------------------------------
--
-- Revoked from the NAMED roles, not from PUBLIC — see the header. The triggers
-- and Edge Functions that call these are unaffected: a SECURITY DEFINER caller
-- runs as its owner, and the owner's privilege is what is checked.

revoke all on function public.enqueue_notification(
  uuid, public.notification_kind, text, text, text, text, jsonb, text, int, uuid
) from public, anon, authenticated;

revoke all on function public.claim_notification_batch(int)
  from public, anon, authenticated;

revoke all on function public.mark_notifications_sent(uuid[])
  from public, anon, authenticated;

revoke all on function public.mark_notification_failed(uuid, text)
  from public, anon, authenticated;

revoke all on function public.disable_push_token(text, text)
  from public, anon, authenticated;

-- The fleet-wide maintenance cron. Nothing on a phone runs this.
revoke all on function public.run_maintenance_scan(int)
  from public, anon, authenticated;
grant execute on function public.run_maintenance_scan(int) to service_role;

-- ⚠️ Found by the standing audit in suite 41, not by hand-probing — the
-- hand-probe passed a uuid that did not exist and read the resulting
-- `no_data_found` as a refusal. With a REAL order id, any signed-in user could
-- force a dispatch broadcast on a stranger's order: `order_offers` rows appear,
-- the customer's "contacted" counters move, and since 0065 every one of those
-- rows sends a push notification to a technician. Its only callers are the
-- `searching` trigger (0049) and `expand_stale_searches` (0051), both definer.
revoke all on function public.broadcast_order(uuid, int)
  from public, anon, authenticated;

-- Added by 0068 and granted to `authenticated` for no reason: the quote screen
-- reads `orders.parts_amount`, which RLS already scopes. Exposed, it returns
-- the parts total of any order id.
revoke all on function public.order_parts_total(uuid)
  from public, anon, authenticated;


-- Scoped, not revoked ---------------------------------------------------------

-- Both are rebuilt with the ORIGINAL body and a guard prepended, rather than
-- wrapped: a wrapper would leave the unguarded version in the schema under a
-- second name, which is the same hole with a longer path to it.

create or replace function public.scan_vehicle_maintenance(p_vehicle_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vehicle    record;
  v_rule       record;
  v_estimated  int;
  v_last       record;
  v_due_km     int;
  v_due_date   date;
  v_service    record;
  v_created    int := 0;
  v_km_to_go   int;
  v_days_to_go int;
  v_message_ar text;
  v_message_en text;
begin
  -- ⚠️ Added by 0069. This function WRITES `maintenance_alerts`. Unscoped, any
  -- signed-in user could plant alerts on a stranger's car — a nuisance
  -- notification and a lie in the one place §1 promises the truth.
  if not (public.owns_vehicle(p_vehicle_id) or public.is_ops()
          or public.is_privileged_write()) then
    raise exception 'That vehicle is not yours to scan'
      using errcode = 'insufficient_privilege';
  end if;
  select * into v_vehicle from public.vehicles v
  where v.id = p_vehicle_id and v.is_active;
  if v_vehicle is null then
    return 0;
  end if;

  -- The product rule from §7.2, enforced before any work is done: "never send
  -- more than one alert per vehicle per week. Alert fatigue kills this
  -- feature." A vehicle alerted recently is simply skipped this run.
  if exists (
    select 1 from public.maintenance_alerts a
    where a.vehicle_id = p_vehicle_id
      and a.created_at > now() - interval '7 days'
  ) then
    return 0;
  end if;

  v_estimated := public.estimate_current_mileage(p_vehicle_id);

  for v_rule in select * from public.applicable_rules(p_vehicle_id) loop
    -- Skip a rule that already has an open alert on this vehicle.
    if exists (
      select 1 from public.maintenance_alerts a
      where a.vehicle_id = p_vehicle_id and a.rule_id = v_rule.id and a.status = 'open'
    ) then
      continue;
    end if;

    select * into v_last from public.last_service_for_rule(p_vehicle_id, v_rule.service_id);

    -- Distance-based due point.
    v_due_km := null;
    if v_rule.due_every_km is not null then
      if v_last.last_km is not null then
        v_due_km := v_last.last_km + v_rule.due_every_km;
      else
        -- Never done through Habba. Use the first-service point if the rule
        -- has one, otherwise assume the interval from where the car is now —
        -- which avoids claiming a service is overdue on a car we have only
        -- just met.
        v_due_km := coalesce(v_rule.first_due_km, v_estimated + v_rule.due_every_km);
      end if;
    end if;

    -- Time-based due point.
    v_due_date := null;
    if v_rule.due_every_months is not null and v_last.last_at is not null then
      v_due_date := (v_last.last_at + make_interval(months => v_rule.due_every_months))::date;
    end if;

    v_km_to_go := case when v_due_km is null then null else v_due_km - v_estimated end;
    v_days_to_go := case when v_due_date is null then null else v_due_date - current_date end;

    -- Within 500 km or 14 days of due — including already overdue.
    if (v_km_to_go is not null and v_km_to_go <= public.maintenance_alert_window_km())
       or (v_days_to_go is not null and v_days_to_go <= public.maintenance_alert_window_days())
    then
      select * into v_service from public.services s where s.id = v_rule.service_id;

      -- The message says what the number is based on. A generic interval
      -- presented as manufacturer guidance is a small lie that erodes trust
      -- the first time an owner checks their manual.
      if v_km_to_go is not null and v_km_to_go > 0 then
        v_message_ar := format('%s: متبقٍ حوالي %s كم', v_service.name_ar, v_km_to_go);
        v_message_en := format('%s: about %s km remaining', v_service.name_en, v_km_to_go);
      elsif v_km_to_go is not null then
        v_message_ar := format('%s: تجاوزت الموعد بحوالي %s كم', v_service.name_ar, abs(v_km_to_go));
        v_message_en := format('%s: overdue by about %s km', v_service.name_en, abs(v_km_to_go));
      else
        v_message_ar := format('%s: حان موعد الصيانة', v_service.name_ar);
        v_message_en := format('%s: service is due', v_service.name_en);
      end if;

      if v_rule.confidence = 'generic' then
        v_message_ar := v_message_ar || ' (تقدير عام)';
        v_message_en := v_message_en || ' (general estimate)';
      end if;

      insert into public.maintenance_alerts (
        vehicle_id, rule_id, service_id, due_at_km, due_at_date,
        estimated_km, confidence, message_ar, message_en
      ) values (
        p_vehicle_id, v_rule.id, v_rule.service_id, v_due_km, v_due_date,
        v_estimated, v_rule.confidence, v_message_ar, v_message_en
      );

      -- Also to the logbook: §1 says the timeline records "every warning the
      -- system raised and whether the owner acted on it".
      perform public.append_vehicle_timeline_event(
        p_vehicle_id  => p_vehicle_id,
        p_event_type  => 'alert_raised',
        p_summary_ar  => v_message_ar,
        p_summary_en  => v_message_en,
        p_occurred_at => now(),
        p_details     => jsonb_strip_nulls(jsonb_build_object(
          'service_kind', v_service.name_en,
          'notes_public', v_rule.confidence::text
        ))
      );

      v_created := v_created + 1;

      -- One alert per vehicle per run, so a car that is due for four things
      -- does not produce four notifications on the same morning.
      exit;
    end if;
  end loop;

  return v_created;
end;
$$;

create or replace function public.estimate_current_mileage(p_vehicle_id uuid)
returns int
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_first    record;
  v_last     record;
  v_days     numeric;
  v_rate     numeric;
  v_since    numeric;
begin
  -- ⚠️ Added by 0069. Unscoped, this returned an estimated odometer reading for
  -- ANY vehicle id. `is_privileged_write()` is what lets the maintenance cron
  -- keep working: it holds no `auth.uid()`, so an ownership test alone would
  -- refuse it for every car in the fleet.
  if not (public.owns_vehicle(p_vehicle_id) or public.is_ops()
          or public.is_privileged_write()) then
    raise exception 'That vehicle is not yours'
      using errcode = 'insufficient_privilege';
  end if;
  select t.mileage, t.occurred_at into v_first
  from public.vehicle_timeline t
  where t.vehicle_id = p_vehicle_id and t.mileage is not null
  order by t.occurred_at asc
  limit 1;

  -- Anchor on the HIGHEST reading, not the chronologically last.
  --
  -- Odometers do not go backwards, but readings do arrive out of order: a
  -- technician records 62,000 from a service docket today for a car that read
  -- 84,000 last month, or an owner backfills old history. Anchoring on the
  -- latest row makes the estimate collapse to that lower number and the car
  -- silently stops being alerted about anything.
  select t.mileage, t.occurred_at into v_last
  from public.vehicle_timeline t
  where t.vehicle_id = p_vehicle_id and t.mileage is not null
  order by t.mileage desc, t.occurred_at desc, t.seq desc
  limit 1;

  if v_last is null then
    -- Nothing recorded: fall back to whatever the vehicle row says.
    return (select v.current_mileage from public.vehicles v where v.id = p_vehicle_id);
  end if;

  v_days := greatest(1, extract(epoch from (v_last.occurred_at - v_first.occurred_at)) / 86400.0);

  if v_last.mileage <= v_first.mileage or v_days < 14 then
    -- Too little history to extrapolate honestly. Guessing from a single
    -- fortnight produces alerts the owner cannot make sense of.
    return v_last.mileage;
  end if;

  v_rate := (v_last.mileage - v_first.mileage) / v_days;
  v_rate := least(v_rate, 500);   -- sanity clamp

  v_since := greatest(0, extract(epoch from (now() - v_last.occurred_at)) / 86400.0);

  return (v_last.mileage + (v_rate * v_since))::int;
end;
$$;


/**
 * Rebuilt so the fleet sweep still works against the new ownership guard.
 *
 * ⚠️ The cron holds no `auth.uid()`, so `owns_vehicle` is false for every car
 * it touches. Without this bracket the guard added above would turn the nightly
 * maintenance scan into a function that raises on its first vehicle and alerts
 * nobody about anything — a silent failure of the feature §7.2 exists for.
 *
 * `end_privileged_write` is called on both paths: leaving the flag set would
 * hand the rest of the transaction a privilege it did not ask for.
 */
create or replace function public.run_maintenance_scan(p_limit int default 5000)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vehicle_id uuid;
  v_total int := 0;
begin
  perform public.begin_privileged_write();

  begin
    for v_vehicle_id in
      select v.id from public.vehicles v
      where v.is_active
      order by v.updated_at
      limit p_limit
    loop
      v_total := v_total + public.scan_vehicle_maintenance(v_vehicle_id);
    end loop;
  exception when others then
    perform public.end_privileged_write();
    raise;
  end;

  perform public.end_privileged_write();
  return v_total;
end;
$$;

-- Re-stated after the rebuild: `create or replace` keeps existing grants, but
-- the revoke above ran against the OLD definition and this file must leave the
-- function closed regardless of the order someone reads it in.
revoke all on function public.run_maintenance_scan(int)
  from public, anon, authenticated;
grant execute on function public.run_maintenance_scan(int) to service_role;
