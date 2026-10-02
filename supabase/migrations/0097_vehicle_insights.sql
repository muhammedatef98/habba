-- 0097 — صحة السيارة and تكلفة الملكية: what the logbook knows, said in one glance
--
-- The logbook records everything and, until now, concluded nothing. An owner
-- could see eleven entries, two items in القادم and an insurance date, and
-- still not know the one thing they actually wanted: is this car in good
-- shape, and what is it costing me? Both answers were already in the
-- database; neither was anywhere a person could read it. They are the moat's
-- shop window (§1): a number that improves as the logbook fills up is a
-- reason to keep it filled.
--
-- Both are computed here, not in the app (§2.2). The score is a judgement and
-- the cost is money — the two things a client must never decide for itself —
-- and the console, the report and a future buyer must all see the same
-- figure the owner sees.
--
-- vehicle_health(vehicle) → jsonb
--   score 0–100 and a grade, plus every factor that moved it, so the app can
--   say WHY in the owner's language rather than show a bare number:
--     overdue care item         −15 each, at most −45
--     care item coming up        −5 each, at most −15
--     snoozed past due           −8 each (counted instead of "overdue")
--     expired document          −15 each, at most −30
--     document expiring soon     −5 each, at most −10
--     no service in 18 months   −10 (only once the logbook has any service)
--     undocumented services     up to −10, by the share without evidence
--     live warranty              +5
--   A car with nothing recorded is not "excellent" by default: with no care
--   items, no documents and no services there is nothing to judge, and the
--   grade is `unknown` — an honest empty state instead of a flattering 100.
--
-- vehicle_cost_summary(vehicle) → jsonb
--   What the car has cost: all time, the last 12 months, this year (Riyadh),
--   twelve monthly totals, the 12 months by category, and the cost per
--   1,000 km when the odometer moved far enough for that to mean anything.
--   Habba orders count what the customer finally paid (total less refunds,
--   VAT included); the owner's own entries count the `cost_sar` they typed.
--   Money leaves as 2dp strings (ADR-0007).
--
-- Both: the vehicle's current owner or ops, nobody else (42501).

create or replace function public.vehicle_health(p_vehicle_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_overdue      int := 0;
  v_snoozed      int := 0;
  v_approaching  int := 0;
  v_items        int := 0;
  v_doc_expired  int := 0;
  v_doc_expiring int := 0;
  v_docs         int := 0;
  v_services     int := 0;
  v_documented   int := 0;
  v_last_service timestamptz;
  v_warranty     boolean;
  v_score        int := 100;
  v_impact       int;
  v_factors      jsonb := '[]'::jsonb;
  v_grade        text;
begin
  if not (public.owns_vehicle(p_vehicle_id) or public.is_ops()) then
    raise exception 'Not your vehicle' using errcode = 'insufficient_privilege';
  end if;

  select count(*),
         count(*) filter (where s.is_due and coalesce(s.snoozed_until, '-infinity') <= now()),
         count(*) filter (where s.is_due and s.snoozed_until > now()),
         count(*) filter (where not s.is_due and s.is_approaching)
    into v_items, v_overdue, v_snoozed, v_approaching
    from public.maintenance_item_status(p_vehicle_id) s;

  select count(*),
         count(*) filter (where d.is_expired),
         count(*) filter (where not d.is_expired and d.is_expiring)
    into v_docs, v_doc_expired, v_doc_expiring
    from public.document_expiry_status(p_vehicle_id) d;

  select count(*),
         count(*) filter (where t.provenance <> 'self_reported'),
         max(t.occurred_at)
    into v_services, v_documented, v_last_service
    from public.vehicle_timeline t
   where t.vehicle_id = p_vehicle_id
     and t.event_type in ('service_completed', 'parts_replaced',
                          'inspection_completed', 'warranty_claimed');

  v_warranty := exists (
    select 1 from public.orders o
     where o.vehicle_id = p_vehicle_id
       and o.status = 'completed'
       and o.warranty_expires_at > now());

  if v_items = 0 and v_docs = 0 and v_services = 0 then
    return jsonb_build_object(
      'score', null, 'grade', 'unknown', 'factors', '[]'::jsonb,
      'computed_at', now());
  end if;

  if v_overdue > 0 then
    v_impact := -least(v_overdue * 15, 45);
    v_score := v_score + v_impact;
    v_factors := v_factors || jsonb_build_object('key', 'care_overdue', 'count', v_overdue, 'impact', v_impact);
  end if;

  if v_snoozed > 0 then
    v_impact := -least(v_snoozed * 8, 24);
    v_score := v_score + v_impact;
    v_factors := v_factors || jsonb_build_object('key', 'care_snoozed', 'count', v_snoozed, 'impact', v_impact);
  end if;

  if v_approaching > 0 then
    v_impact := -least(v_approaching * 5, 15);
    v_score := v_score + v_impact;
    v_factors := v_factors || jsonb_build_object('key', 'care_soon', 'count', v_approaching, 'impact', v_impact);
  end if;

  if v_doc_expired > 0 then
    v_impact := -least(v_doc_expired * 15, 30);
    v_score := v_score + v_impact;
    v_factors := v_factors || jsonb_build_object('key', 'documents_expired', 'count', v_doc_expired, 'impact', v_impact);
  end if;

  if v_doc_expiring > 0 then
    v_impact := -least(v_doc_expiring * 5, 10);
    v_score := v_score + v_impact;
    v_factors := v_factors || jsonb_build_object('key', 'documents_expiring', 'count', v_doc_expiring, 'impact', v_impact);
  end if;

  if v_services > 0 and v_last_service < now() - interval '18 months' then
    v_score := v_score - 10;
    v_factors := v_factors || jsonb_build_object('key', 'no_recent_service', 'count', 1, 'impact', -10);
  end if;

  if v_services > 0 and v_documented < v_services then
    v_impact := -round(10.0 * (v_services - v_documented) / v_services)::int;
    if v_impact < 0 then
      v_score := v_score + v_impact;
      v_factors := v_factors || jsonb_build_object(
        'key', 'undocumented', 'count', v_services - v_documented, 'impact', v_impact);
    end if;
  end if;

  if v_warranty then
    v_score := v_score + 5;
    v_factors := v_factors || jsonb_build_object('key', 'warranty_active', 'count', 1, 'impact', 5);
  end if;

  v_score := greatest(0, least(100, v_score));
  v_grade := case
    when v_score >= 85 then 'excellent'
    when v_score >= 70 then 'good'
    when v_score >= 50 then 'fair'
    else 'attention'
  end;

  return jsonb_build_object(
    'score', v_score,
    'grade', v_grade,
    'factors', v_factors,
    'computed_at', now());
end;
$$;

comment on function public.vehicle_health(uuid) is
  'صحة السيارة: 0–100, a grade, and every factor that moved it (0097). '
  'Current owner or ops.';

revoke execute on function public.vehicle_health(uuid) from public, anon;
grant execute on function public.vehicle_health(uuid) to authenticated;


-- The bucket a cost falls in. Orders carry their service's category; an
-- owner's own entry carries the type they picked on the form.
create or replace function public.cost_bucket(p_category text, p_service_type text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_category = 'emergency' then 'emergency'
    when p_category = 'inspection' then 'inspection'
    when p_category = 'wash' then 'wash'
    when p_category = 'bodywork' or p_service_type = 'bodywork' then 'bodywork'
    when p_category = 'periodic'
      or p_service_type in ('oil_change', 'brakes', 'battery', 'tyres', 'air_filter', 'ac_service')
      then 'maintenance'
    else 'other'
  end;
$$;

revoke execute on function public.cost_bucket(text, text) from public, anon, authenticated;


-- Every amount the car has cost, one row each. Internal: ungated, and only
-- the gated summary below reads it.
create or replace function public.vehicle_cost_lines(p_vehicle_id uuid)
returns table (day date, amount numeric(12,2), bucket text)
language sql
stable
security definer
set search_path = ''
as $$
  -- Habba orders: what the customer finally paid.
  select (o.completed_at at time zone 'Asia/Riyadh')::date,
         (coalesce(o.total_amount, 0) - o.refunded_amount)::numeric(12,2),
         public.cost_bucket(s.category::text, null)
    from public.orders o
    join public.services s on s.id = o.service_id
   where o.vehicle_id = p_vehicle_id
     and o.status = 'completed'
     and coalesce(o.total_amount, 0) - o.refunded_amount > 0
  union all
  -- The owner's own entries: what they typed, when it parses as money.
  select (t.occurred_at at time zone 'Asia/Riyadh')::date,
         round((t.details ->> 'cost_sar')::numeric, 2),
         public.cost_bucket(null, t.details ->> 'service_type')
    from public.vehicle_timeline t
   where t.vehicle_id = p_vehicle_id
     and t.order_id is null
     and t.details ? 'cost_sar'
     and (t.details ->> 'cost_sar') ~ '^[0-9]+(\.[0-9]{1,2})?$'
     and (t.details ->> 'cost_sar')::numeric > 0;
$$;

revoke execute on function public.vehicle_cost_lines(uuid) from public, anon, authenticated;


create or replace function public.vehicle_cost_summary(p_vehicle_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today       date := (now() at time zone 'Asia/Riyadh')::date;
  v_year_start  date := date_trunc('year', (now() at time zone 'Asia/Riyadh'))::date;
  v_window      date := (date_trunc('month', (now() at time zone 'Asia/Riyadh')) - interval '11 months')::date;
  v_total       numeric(12,2);
  v_12m         numeric(12,2);
  v_year        numeric(12,2);
  v_entries     int;
  v_km_now      int;
  v_km_then     int;
  v_km          int;
  v_months      jsonb;
  v_categories  jsonb;
begin
  if not (public.owns_vehicle(p_vehicle_id) or public.is_ops()) then
    raise exception 'Not your vehicle' using errcode = 'insufficient_privilege';
  end if;

  select coalesce(sum(amount), 0),
         coalesce(sum(amount) filter (where day >= v_window), 0),
         coalesce(sum(amount) filter (where day >= v_year_start), 0),
         count(*)
    into v_total, v_12m, v_year, v_entries
    from public.vehicle_cost_lines(p_vehicle_id);

  select jsonb_agg(jsonb_build_object(
           'month', to_char(m.month, 'YYYY-MM'),
           'amount', to_char(coalesce(
             (select sum(c.amount) from public.vehicle_cost_lines(p_vehicle_id) c
               where c.day >= m.month and c.day < (m.month + interval '1 month')::date), 0),
             'FM9999999990.00'))
           order by m.month)
    into v_months
    from generate_series(v_window, date_trunc('month', v_today)::date, interval '1 month') as m(month);

  select coalesce(jsonb_agg(jsonb_build_object(
           'category', b.bucket, 'amount', to_char(b.amount, 'FM9999999990.00'))
           order by b.amount desc), '[]'::jsonb)
    into v_categories
    from (select bucket, sum(amount) as amount from public.vehicle_cost_lines(p_vehicle_id)
           where day >= v_window group by bucket) b;

  -- Distance over the same 12 months: today's lifetime reading against the
  -- last one at or before the window opened (or the first inside it).
  v_km_now := public.vehicle_lifetime_km(p_vehicle_id);
  select r.series_offset_km + r.km into v_km_then
    from public.vehicle_odometer_readings r
   where r.vehicle_id = p_vehicle_id
     and (r.recorded_at at time zone 'Asia/Riyadh')::date <= v_window
   order by r.series desc, r.km desc limit 1;
  if v_km_then is null then
    select min(r.series_offset_km + r.km) into v_km_then
      from public.vehicle_odometer_readings r
     where r.vehicle_id = p_vehicle_id;
  end if;
  v_km := greatest(coalesce(v_km_now, 0) - coalesce(v_km_then, v_km_now, 0), 0);

  return jsonb_build_object(
    'currency', 'SAR',
    'total', to_char(v_total, 'FM9999999990.00'),
    'last_12_months', to_char(v_12m, 'FM9999999990.00'),
    'this_year', to_char(v_year, 'FM9999999990.00'),
    'entries', v_entries,
    'months', coalesce(v_months, '[]'::jsonb),
    'categories', v_categories,
    'km_12_months', v_km,
    -- Under 500 km the ratio is noise (one oil change over 80 km reads as a
    -- fortune per kilometre), so it is withheld rather than shown.
    'per_1000_km', case when v_km >= 500 and v_12m > 0
                        then to_char(round(v_12m * 1000 / v_km, 2), 'FM9999999990.00') end);
end;
$$;

comment on function public.vehicle_cost_summary(uuid) is
  'تكلفة الملكية: all time, 12 months, this year, monthly, by category, per 1,000 km (0097). '
  'Current owner or ops.';

revoke execute on function public.vehicle_cost_summary(uuid) from public, anon;
grant execute on function public.vehicle_cost_summary(uuid) to authenticated;
