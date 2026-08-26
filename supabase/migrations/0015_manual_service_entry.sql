-- 0015 — Owner-entered service history and mileage
--
-- Phase 2's standalone value: an owner can record the service their car had
-- BEFORE Habba existed, and get something useful immediately — long before any
-- order is placed. This is what makes the logbook top-of-funnel rather than a
-- by-product of transacting (build prompt §11: never gate the logbook).
--
-- Everything written here is owner-asserted, so it lands as self_reported or
-- self_documented and can never present itself as verified (ADR-0005). These
-- wrappers exist so the app cannot pass a provenance at all.

-- ---------------------------------------------------------------------------
-- record_past_service
-- ---------------------------------------------------------------------------
create or replace function public.record_past_service(
  p_vehicle_id  uuid,
  p_summary_ar  text,
  p_occurred_at timestamptz,
  p_mileage     int default null,
  p_summary_en  text default null,
  p_details     jsonb default '{}'::jsonb,
  p_attachments jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_summary_en text;
begin
  if coalesce(trim(p_summary_ar), '') = '' then
    raise exception 'A description is required'
      using errcode = 'check_violation';
  end if;

  -- Owner-entered history is by definition in the past. A future date is
  -- either a typo or an attempt to pad the record.
  if p_occurred_at > now() then
    raise exception 'A past service cannot be dated in the future'
      using errcode = 'check_violation';
  end if;

  -- Arabic is the source of truth for owner-entered copy (CLAUDE.md §2.1).
  -- The English column is non-null in the timeline, so it mirrors the Arabic
  -- rather than being machine-translated — an owner's own words should not be
  -- silently rewritten on a report a buyer will read.
  v_summary_en := coalesce(nullif(trim(coalesce(p_summary_en, '')), ''), p_summary_ar);

  -- Provenance is NOT a parameter. append_vehicle_timeline_event derives it,
  -- and with no p_order_id this can only ever produce self_reported or
  -- self_documented.
  return public.append_vehicle_timeline_event(
    p_vehicle_id  => p_vehicle_id,
    p_event_type  => 'service_completed',
    p_summary_ar  => p_summary_ar,
    p_summary_en  => v_summary_en,
    p_occurred_at => p_occurred_at,
    p_mileage     => p_mileage,
    p_order_id    => null,
    p_provider_id => null,
    p_details     => coalesce(p_details, '{}'::jsonb),
    p_attachments => coalesce(p_attachments, '[]'::jsonb)
  );
end;
$$;

comment on function public.record_past_service is
  'Owner records service that predates Habba. Always self_reported/self_documented — ADR-0005.';


-- ---------------------------------------------------------------------------
-- record_mileage
-- ---------------------------------------------------------------------------
-- Mileage is the input the predictive-maintenance engine runs on (build prompt
-- §7.2), so capturing it regularly in Phase 2 is what makes Phase 6 possible.
create or replace function public.record_mileage(
  p_vehicle_id uuid,
  p_mileage    int,
  p_occurred_at timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current int;
begin
  if p_mileage is null or p_mileage < 0 then
    raise exception 'Mileage must be zero or more' using errcode = 'check_violation';
  end if;

  select v.current_mileage into v_current
  from public.vehicles v where v.id = p_vehicle_id;

  if v_current is null then
    raise exception 'Vehicle % not found', p_vehicle_id using errcode = 'no_data_found';
  end if;

  -- A reading below the recorded odometer is either a typo or clocking. We
  -- reject rather than accept-and-hide: an odometer that appears to go
  -- backwards on a resale report destroys the report's credibility, and
  -- silently ignoring the value would leave the owner thinking it saved.
  --
  -- Backdated readings are a legitimate exception — recording that the car
  -- was at 40,000 km two years ago is normal when filling in history.
  if p_mileage < v_current and p_occurred_at > now() - interval '1 day' then
    raise exception 'Mileage % is lower than the recorded % km', p_mileage, v_current
      using errcode = 'check_violation',
            hint = 'Check the reading. If you are recording an older reading, set its date.';
  end if;

  return public.append_vehicle_timeline_event(
    p_vehicle_id  => p_vehicle_id,
    p_event_type  => 'mileage_recorded',
    p_summary_ar  => format('قراءة العداد: %s كم', p_mileage),
    p_summary_en  => format('Mileage reading: %s km', p_mileage),
    p_occurred_at => p_occurred_at,
    p_mileage     => p_mileage
  );
end;
$$;

comment on function public.record_mileage is
  'Owner records an odometer reading. Rejects an implausible decrease rather than hiding it.';

grant execute on function public.record_past_service(uuid, text, timestamptz, int, text, jsonb, jsonb)
  to authenticated;
grant execute on function public.record_mileage(uuid, int, timestamptz) to authenticated;
