-- 0029 — The maintenance scan
--
-- Build prompt §7.2: an Edge Function on a daily cron. The logic lives here in
-- Postgres rather than in Deno so it is testable without deploying anything,
-- and so the "one alert per vehicle per week" rule is enforced where the data
-- is rather than in a scheduler that might run twice.

-- The alert window from the spec: within 500 km or 14 days of due.
create or replace function public.maintenance_alert_window_km() returns int
language sql immutable as $$ select 500 $$;

create or replace function public.maintenance_alert_window_days() returns int
language sql immutable as $$ select 14 $$;


-- The rule that applies to a given vehicle for a given service.
-- Most specific wins: model rule, then make rule, then generic.
create or replace function public.applicable_rules(p_vehicle_id uuid)
returns setof public.maintenance_rules
language sql
stable
security definer
set search_path = ''
as $$
  select distinct on (r.service_id) r.*
  from public.maintenance_rules r
  join public.vehicles v on v.id = p_vehicle_id
  where r.is_active
    and (r.make_id is null or r.make_id = v.make_id)
    and (r.model_id is null or r.model_id = v.model_id)
  order by r.service_id,
           -- model-specific first, then make-specific, then generic
           (r.model_id is not null) desc,
           (r.make_id is not null) desc,
           r.created_at;
$$;


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


-- The daily sweep. An Edge Function on a cron calls this; keeping the loop in
-- SQL means a scheduler that fires twice cannot double-alert, because the
-- one-per-week rule is evaluated per vehicle inside the transaction.
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
  for v_vehicle_id in
    select v.id from public.vehicles v
    where v.is_active
    order by v.updated_at
    limit p_limit
  loop
    v_total := v_total + public.scan_vehicle_maintenance(v_vehicle_id);
  end loop;

  return v_total;
end;
$$;


-- ---------------------------------------------------------------------------
-- Alert → booking
-- ---------------------------------------------------------------------------
-- §7.2: "Alert becomes a one-tap booking with the correct service
-- pre-selected." The conversion is recorded so the effect of alerting can be
-- measured rather than assumed.
create or replace function public.convert_alert_to_order(
  p_alert_id uuid,
  p_slot_id  uuid,
  p_lon      double precision default null,
  p_lat      double precision default null,
  p_address_ar text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alert   record;
  v_order_id uuid;
begin
  select * into v_alert from public.maintenance_alerts a where a.id = p_alert_id;

  if v_alert is null then
    raise exception 'Alert % not found', p_alert_id using errcode = 'no_data_found';
  end if;

  if not public.owns_vehicle(v_alert.vehicle_id) then
    raise exception 'Not your vehicle' using errcode = 'insufficient_privilege';
  end if;

  if v_alert.status <> 'open' then
    raise exception 'That alert is no longer open' using errcode = 'check_violation';
  end if;

  v_order_id := public.book_appointment(
    p_slot_id    => p_slot_id,
    p_service_id => v_alert.service_id,
    p_vehicle_id => v_alert.vehicle_id,
    p_problem    => v_alert.message_ar,
    p_mileage    => v_alert.estimated_km,
    p_lon        => p_lon,
    p_lat        => p_lat,
    p_address_ar => p_address_ar
  );

  update public.maintenance_alerts
  set status = 'converted', order_id = v_order_id
  where id = p_alert_id;

  return v_order_id;
end;
$$;


create or replace function public.dismiss_alert(p_alert_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alert record;
begin
  select * into v_alert from public.maintenance_alerts a where a.id = p_alert_id;

  if v_alert is null or not public.owns_vehicle(v_alert.vehicle_id) then
    raise exception 'Alert not found' using errcode = 'no_data_found';
  end if;

  update public.maintenance_alerts
  set status = 'dismissed', dismissed_at = now()
  where id = p_alert_id;

  -- §1: the timeline records whether the owner acted on a warning. A dismissed
  -- alert is a fact about the car's history — a buyer reading a resale report
  -- is entitled to know a service was flagged and declined.
  perform public.append_vehicle_timeline_event(
    p_vehicle_id  => v_alert.vehicle_id,
    p_event_type  => 'alert_dismissed',
    p_summary_ar  => format('تم تجاهل التنبيه: %s', v_alert.message_ar),
    p_summary_en  => format('Alert dismissed: %s', v_alert.message_en),
    p_occurred_at => now()
  );
end;
$$;

grant execute on function public.scan_vehicle_maintenance(uuid) to authenticated;
grant execute on function public.run_maintenance_scan(int) to authenticated;
grant execute on function public.convert_alert_to_order(uuid, uuid, double precision, double precision, text) to authenticated;
grant execute on function public.dismiss_alert(uuid) to authenticated;
grant execute on function public.applicable_rules(uuid) to authenticated;
