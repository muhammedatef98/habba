-- 0046 — the two things تقرير هبّة could not say
--
-- docs/design/report-pdf.md ("Two things the payload does not carry yet"):
--
--   1. Warranty STATUS. The payload carried `warranty_days` as a per-job
--      detail — a duration, not a state. "ضمان ٩٠ يوم" on a job from 2024
--      tells a buyer nothing about whether anything is still covered today.
--      Live warranties are `orders.warranty_expires_at` and the
--      `active_warranties` view (0025), which the report never read.
--
--   2. The inspection SCALE and the recommendation. `inspection_score` arrives
--      inside `details` as a bare number, so the report prints "84" with no
--      denominator. The scale (0–100) and the recommendation word are in
--      `inspection_reports` (0026) and in `score_to_recommendation`, which is
--      where the thresholds are product policy rather than a renderer's guess.
--
-- Both are added to the payload here, and only here: the report renders what
-- the server sends and computes nothing of its own, so the printed document
-- and the database cannot drift. `report_version` goes to 2 so a renderer can
-- tell a payload that carries them from one that does not — reports are frozen
-- at generation (0014) and old ones stay at version 1 forever.
--
-- Still no owner identity, on either addition. A warranty is a fact about the
-- car's last repair; an inspection score is a fact about the car. Neither
-- carries who owned it, and neither carries a token or a URL: `public_token`
-- and `pdf_url` on `inspection_reports` are secrets, and putting one inside a
-- shareable report would hand every reader a second document nobody chose to
-- share.

-- ---------------------------------------------------------------------------
-- redact_timeline_details: survive a non-object `details`
-- ---------------------------------------------------------------------------
-- `vehicle_timeline.details` is `jsonb` with no shape constraint, so it can
-- hold an array or a scalar. `jsonb_object_keys` RAISES on those rather than
-- returning no rows, which made this function — and therefore
-- generate_habba_report — throw for the whole vehicle, permanently, because a
-- single timeline row held `[]`. The timeline is append-only, so there is no
-- repair: one bad row would cost that owner the report forever.
--
-- An unknown shape has no allowlisted keys by definition, so the honest answer
-- is an empty object, exactly as for a NULL.
create or replace function public.redact_timeline_details(input jsonb)
returns jsonb
language sql
immutable
parallel safe
-- The guard sits in the FROM, not in a CASE around the aggregate: an empty
-- object yields no rows from jsonb_object_keys, where a scalar or an array
-- would raise. Nothing here depends on CASE evaluating its branches lazily.
as $$
  select coalesce(
    (
      select jsonb_object_agg(key, input -> key)
      from jsonb_object_keys(
             case when jsonb_typeof(input) = 'object' then input else '{}'::jsonb end
           ) as key
      where key in (
        -- Mechanical facts about the car. Nothing about the person.
        'oil_grade', 'oil_quantity_l', 'filter_part_number', 'part_number',
        'parts', 'is_oem', 'warranty_days', 'labour_hours',
        'service_kind', 'inspection_score', 'obd_codes', 'tyre_size',
        'battery_capacity_ah', 'brake_pad_position', 'notes_public'
      )
    ),
    '{}'::jsonb
  );
$$;

comment on function public.redact_timeline_details(jsonb) is
  'Allowlist redaction for reports. Never switch this to a denylist — see 0014. Returns {} for any non-object input.';


-- ---------------------------------------------------------------------------
-- generate_habba_report — version 2
-- ---------------------------------------------------------------------------
create or replace function public.generate_habba_report(p_vehicle_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor      uuid := auth.uid();
  v_owner_id   uuid;
  v_chain      record;
  v_token      text;
  v_payload    jsonb;
  v_vehicle    record;
begin
  if v_actor is null then
    raise exception 'Not authenticated' using errcode = 'insufficient_privilege';
  end if;

  select v.*, mk.name_ar as make_ar, mk.name_en as make_en,
         md.name_ar as model_ar, md.name_en as model_en
  into v_vehicle
  from public.vehicles v
  join public.vehicle_makes mk on mk.id = v.make_id
  join public.vehicle_models md on md.id = v.model_id
  where v.id = p_vehicle_id;

  if v_vehicle is null then
    raise exception 'Vehicle % not found', p_vehicle_id using errcode = 'no_data_found';
  end if;

  v_owner_id := v_vehicle.owner_id;

  if v_owner_id <> v_actor then
    raise exception 'Only the owner may generate a report for this vehicle'
      using errcode = 'insufficient_privilege';
  end if;

  -- Rule 1 (0014). The whole product promise rests on this refusal.
  select * into v_chain from public.verify_vehicle_timeline(p_vehicle_id);

  if not v_chain.is_valid then
    raise exception 'Cannot issue a report: the logbook failed verification (%)', v_chain.reason
      using errcode = 'data_corrupted',
            hint = 'Contact support. Do not share an unverified history.';
  end if;

  -- 32 bytes from two v4 UUIDs (~244 bits of entropy), rendered base64url.
  -- Not pgcrypto's gen_random_bytes — see the note in 0014.
  v_token := rtrim(
    replace(replace(
      encode(
        decode(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 'hex'),
        'base64'
      ),
      '+', '-'), '/', '_'),
    '=');

  select jsonb_build_object(
    -- 2: carries `warranties` and `inspections`. A renderer reading a
    -- version 1 payload must not invent either — it was never captured.
    'report_version', 2,
    'generated_at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),

    -- The car's identity: exactly what a buyer checks the report against.
    -- Deliberately no owner_id, name, phone, city or address anywhere.
    'vehicle', jsonb_build_object(
      'make_ar', v_vehicle.make_ar,
      'make_en', v_vehicle.make_en,
      'model_ar', v_vehicle.model_ar,
      'model_en', v_vehicle.model_en,
      'year', v_vehicle.year,
      'plate', v_vehicle.plate_normalised,
      'vin', v_vehicle.vin,
      'colour', v_vehicle.colour,
      'current_mileage', v_vehicle.current_mileage
    ),

    -- Duration only. "Owned for 3 years" is useful to a buyer; who owned it
    -- is not the buyer's business and not ours to publish.
    'ownership', jsonb_build_object(
      'months_on_habba',
      greatest(0, (extract(epoch from (now() - v_vehicle.created_at)) / 2592000)::int)
    ),

    'chain', jsonb_build_object(
      'is_valid', v_chain.is_valid,
      'length', v_chain.checked_count
    ),

    -- ADR-0005. The honest headline: how much of this history Habba can
    -- actually stand behind.
    'coverage', (
      select jsonb_build_object(
        'total', count(*),
        'habba_verified', count(*) filter (where t.provenance = 'habba_verified'),
        'self_documented', count(*) filter (where t.provenance = 'self_documented'),
        'self_reported', count(*) filter (where t.provenance = 'self_reported'),
        'third_party', count(*) filter (where t.provenance = 'third_party')
      )
      from public.vehicle_timeline t where t.vehicle_id = p_vehicle_id
    ),

    -- NEW: warranty as a STATE, evaluated at generation time.
    --
    -- Expired warranties are included, not filtered out. A buyer who sees
    -- only live cover cannot tell an unwarranted car from one whose cover ran
    -- out last month, and the second is a materially better car. The report
    -- is frozen at generation (0014), so `status` and `days_remaining` are
    -- statements about `generated_at` — which is printed on the document.
    --
    -- Re-service orders (`parent_order_id is not null`) are excluded: they
    -- are the claim against a warranty, not a warranty of their own, and
    -- listing both would double-count one job.
    'warranties', coalesce((
      select jsonb_agg(jsonb_build_object(
               'service_ar', w.name_ar,
               'service_en', w.name_en,
               'completed_at', to_char(w.completed_at at time zone 'UTC', 'YYYY-MM-DD'),
               'expires_at', to_char(w.warranty_expires_at at time zone 'UTC', 'YYYY-MM-DD'),
               'warranty_days', w.warranty_days,
               'status', case when w.warranty_expires_at > now() then 'active' else 'expired' end,
               'days_remaining',
                 case
                   when w.warranty_expires_at > now()
                   then greatest(0, (extract(epoch from (w.warranty_expires_at - now())) / 86400)::int)
                 end,
               -- 0025's `active_warranties` exposes this and a buyer should
               -- see it: a job already back under claim is an open question,
               -- not a reassurance.
               'has_open_claim', exists (
                 select 1 from public.orders c
                 where c.parent_order_id = w.id and c.status <> 'cancelled'
               )
             ) order by w.warranty_expires_at desc)
      from (
        select o.id, o.completed_at, o.warranty_expires_at, o.warranty_days,
               s.name_ar, s.name_en
        from public.orders o
        join public.services s on s.id = o.service_id
        where o.vehicle_id = p_vehicle_id
          and o.status = 'completed'
          -- Set by the transition trigger (0025) whenever status becomes
          -- 'completed'. Required here so every emitted row carries a date:
          -- a warranty with no start is not something to print.
          and o.completed_at is not null
          and o.warranty_expires_at is not null
          and o.parent_order_id is null
      ) w
    ), '[]'::jsonb),

    -- NEW: inspection scores WITH their scale and the recommendation word.
    --
    -- `score_scale` is emitted per row rather than assumed by the renderer:
    -- a bare "84" on paper is not a fact, and if the scale ever changes, an
    -- already-frozen report must keep printing the scale it was scored on.
    --
    -- `recommendation` prefers the stored column and falls back to
    -- `score_to_recommendation` so a report never shows a score with no word
    -- beside it. The thresholds stay in 0026 where they are product policy.
    --
    -- No `public_token` and no `pdf_url`. Both are secrets; the report is a
    -- document the owner hands to strangers.
    'inspections', coalesce((
      select jsonb_agg(jsonb_build_object(
               'completed_at', to_char(ir.completed_at at time zone 'UTC', 'YYYY-MM-DD'),
               'template_ar', it.name_ar,
               'template_en', it.name_en,
               'overall_score', ir.overall_score,
               'score_scale', 100,
               'recommendation',
                 coalesce(ir.recommendation,
                          public.score_to_recommendation(ir.overall_score)),
               'mileage_at_inspection', ir.subject_mileage
             ) order by ir.completed_at desc)
      from public.inspection_reports ir
      join public.inspection_templates it on it.id = ir.template_id
      where ir.vehicle_id = p_vehicle_id
        and ir.completed_at is not null
        and ir.overall_score is not null
    ), '[]'::jsonb),

    'mileage_history', coalesce((
      select jsonb_agg(jsonb_build_object(
               'occurred_at', to_char(t.occurred_at at time zone 'UTC', 'YYYY-MM-DD'),
               'mileage', t.mileage
             ) order by t.occurred_at)
      from public.vehicle_timeline t
      where t.vehicle_id = p_vehicle_id and t.mileage is not null
    ), '[]'::jsonb),

    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
               'occurred_at', to_char(t.occurred_at at time zone 'UTC', 'YYYY-MM-DD'),
               'recorded_at', to_char(t.recorded_at at time zone 'UTC', 'YYYY-MM-DD'),
               'event_type', t.event_type,
               'provenance', t.provenance,
               'summary_ar', t.summary_ar,
               'summary_en', t.summary_en,
               'mileage', t.mileage,
               'details', public.redact_timeline_details(t.details),
               'attachment_count', jsonb_array_length(coalesce(t.attachments, '[]'::jsonb))
             ) order by t.occurred_at desc, t.seq desc)
      from public.vehicle_timeline t
      where t.vehicle_id = p_vehicle_id
    ), '[]'::jsonb)
  ) into v_payload;

  insert into public.habba_reports (
    vehicle_id, public_token, payload, chain_valid, chain_length, generated_by
  ) values (
    p_vehicle_id, v_token, v_payload, v_chain.is_valid, v_chain.checked_count, v_actor
  );

  return v_token;
end;
$$;

comment on function public.generate_habba_report(uuid) is
  'Issues تقرير هبّة (payload version 2: adds warranties and inspections). Refuses on a broken chain. Returns the share token.';
