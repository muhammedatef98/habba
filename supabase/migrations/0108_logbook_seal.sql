-- 0108 — The sealed logbook, on all three surfaces
--
-- The timeline is hash-chained (0009/0010) and verify_vehicle_timeline()
-- proves no row was changed after it was written. Only the Habba report ever
-- asked it. The owner never saw that their logbook is sealed, the technician
-- working on the car never saw its history, and ops could not check the chain.
--
--   logbook_seal()          the owner's view: is the chain intact, how many
--                           entries, how many of them Habba verified (ADR-0005)
--                           against the owner's own, the span they cover, and
--                           whether the odometer was ever replaced or corrected.
--   job_vehicle_history()   the assigned provider, while the job is live, reads
--                           the car's service history: what was done, when, at
--                           what mileage and who vouched for it. Summaries only:
--                           no attachments, no details, no addresses, nobody's
--                           name. Behind feature_job_history so ops can turn it
--                           off; the owner is told on their logbook.
--   ops_vehicle_detail()    adds the chain check to the vehicle file.
--   ops_verify_timelines()  walks every chain and lists the broken ones.

insert into public.platform_settings
  (key, value, value_type, min_value, max_value, is_public, category, label_ar, unit_ar, description_ar, sort_order)
values
  ('feature_job_history', 'true', 'boolean', null, null, true, 'features',
   'سجل السيارة للفنّي أثناء العمل', null,
   'يرى الفنّي المكلّف ما أُجري للسيارة سابقاً وعند أي عدّاد، ما دام الطلب قائماً. دون صور أو عناوين أو أسماء.', 330)
on conflict (key) do nothing;


create or replace function public.logbook_seal(p_vehicle_id uuid)
returns table (
  is_valid          boolean,
  entries           int,
  verified_entries  int,
  first_at          timestamptz,
  last_at           timestamptz,
  odometer_replaced boolean,
  odometer_corrected boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_chain record;
begin
  if not public.owns_vehicle(p_vehicle_id) then
    raise exception 'Vehicle % is not yours', p_vehicle_id
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_chain from public.verify_vehicle_timeline(p_vehicle_id);

  return query
    select v_chain.is_valid,
           v_chain.checked_count,
           (select count(*)::int from public.vehicle_timeline t
             where t.vehicle_id = p_vehicle_id
               and t.provenance in ('habba_verified', 'third_party')),
           (select min(t.occurred_at) from public.vehicle_timeline t where t.vehicle_id = p_vehicle_id),
           (select max(t.occurred_at) from public.vehicle_timeline t where t.vehicle_id = p_vehicle_id),
           exists (select 1 from public.vehicle_odometer_readings r
                    where r.vehicle_id = p_vehicle_id and r.series_reason = 'cluster_replaced'),
           exists (select 1 from public.vehicle_odometer_readings r
                    where r.vehicle_id = p_vehicle_id and r.series_reason = 'correction');
end;
$$;

comment on function public.logbook_seal(uuid) is
  'The owner''s seal on their logbook: chain intact, entries, Habba-verified share, span, odometer history. 0108.';

revoke all on function public.logbook_seal(uuid) from public, anon;
grant execute on function public.logbook_seal(uuid) to authenticated;


create or replace function public.job_vehicle_history(p_order_id uuid, p_limit int default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_chain record;
begin
  if not public.setting_bool('feature_job_history', true) then
    raise exception 'The car''s history is switched off'
      using errcode = 'check_violation', hint = 'history:disabled';
  end if;

  select * into v_order from public.orders where id = p_order_id;

  -- The same answer for an order that is not theirs, one that is over, and
  -- one that does not exist.
  if not found
     or v_order.provider_id is null
     or v_order.provider_id is distinct from public.current_provider_id()
     or v_order.status not in
          ('accepted', 'checked_in', 'en_route', 'arrived', 'in_progress', 'awaiting_approval') then
    raise exception 'Not an assigned live job'
      using errcode = 'insufficient_privilege', hint = 'history:not_assigned';
  end if;

  select * into v_chain from public.verify_vehicle_timeline(v_order.vehicle_id);

  return jsonb_build_object(
    'is_valid', v_chain.is_valid,
    'entries', v_chain.checked_count,
    'current_mileage', (select v.current_mileage from public.vehicles v where v.id = v_order.vehicle_id),
    'odometer_replaced', exists (select 1 from public.vehicle_odometer_readings r
                                  where r.vehicle_id = v_order.vehicle_id
                                    and r.series_reason in ('cluster_replaced', 'correction')),
    'events', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'event_type', x.event_type, 'occurred_at', x.occurred_at, 'mileage', x.mileage,
               'provenance', x.provenance, 'summary_ar', x.summary_ar, 'summary_en', x.summary_en)
               order by x.occurred_at desc), '[]'::jsonb)
        from (
          select t.event_type, t.occurred_at, t.mileage, t.provenance, t.summary_ar, t.summary_en
            from public.vehicle_timeline t
           where t.vehicle_id = v_order.vehicle_id
             and t.event_type in ('service_completed', 'inspection_completed', 'parts_replaced',
                                  'warranty_claimed', 'mileage_recorded')
             and (t.order_id is null or t.order_id <> p_order_id)
           order by t.occurred_at desc
           limit least(greatest(coalesce(p_limit, 30), 1), 100)
        ) x)
  );
end;
$$;

comment on function public.job_vehicle_history(uuid, int) is
  'The assigned provider''s read of the car''s service history while the job is live. Summaries only. 0108.';

revoke all on function public.job_vehicle_history(uuid, int) from public, anon;
grant execute on function public.job_vehicle_history(uuid, int) to authenticated;


alter function public.ops_vehicle_detail(uuid) rename to ops_vehicle_detail_0070;
revoke execute on function public.ops_vehicle_detail_0070(uuid) from public, anon, authenticated;

create or replace function public.ops_vehicle_detail(p_vehicle_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_chain  record;
begin
  -- The wrapped body asserts ops and records the read (0070).
  v_result := public.ops_vehicle_detail_0070(p_vehicle_id);
  select * into v_chain from public.verify_vehicle_timeline(p_vehicle_id);
  return v_result || jsonb_build_object(
    'chain', jsonb_build_object(
      'is_valid', v_chain.is_valid,
      'checked_count', v_chain.checked_count,
      'first_invalid_id', v_chain.first_invalid_id,
      'reason', v_chain.reason));
end;
$$;

revoke execute on function public.ops_vehicle_detail(uuid) from public, anon;
grant execute on function public.ops_vehicle_detail(uuid) to authenticated;


create or replace function public.ops_verify_timelines()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vehicle record;
  v_chain   record;
  v_checked int := 0;
  v_rows    bigint := 0;
  v_broken  jsonb := '[]'::jsonb;
begin
  perform public.assert_ops();

  for v_vehicle in
    select v.id, coalesce(v.plate_ar, v.plate_en, v.vin) as label
      from public.vehicles v
     where exists (select 1 from public.vehicle_timeline t where t.vehicle_id = v.id)
  loop
    select * into v_chain from public.verify_vehicle_timeline(v_vehicle.id);
    v_checked := v_checked + 1;
    v_rows := v_rows + v_chain.checked_count;
    if not v_chain.is_valid then
      v_broken := v_broken || jsonb_build_array(jsonb_build_object(
        'vehicle_id', v_vehicle.id, 'label', v_vehicle.label,
        'checked_count', v_chain.checked_count,
        'first_invalid_id', v_chain.first_invalid_id, 'reason', v_chain.reason));
    end if;
  end loop;

  perform public.audit_ops_read('vehicle_timeline', 'all',
    jsonb_build_object('vehicles', v_checked, 'broken', jsonb_array_length(v_broken)));

  return jsonb_build_object(
    'checked_vehicles', v_checked,
    'checked_entries', v_rows,
    'checked_at', now(),
    'broken', v_broken);
end;
$$;

comment on function public.ops_verify_timelines() is
  'Walks every vehicle''s hash chain and lists the broken ones, on the audit log. 0108.';

revoke all on function public.ops_verify_timelines() from public, anon;
grant execute on function public.ops_verify_timelines() to authenticated;
