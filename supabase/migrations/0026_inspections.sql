-- 0026 — Inspections
-- Build prompt §6.7.
--
-- The pre-purchase inspection is the one order that runs against a car nobody
-- in the system owns yet. That shapes everything here: the report carries its
-- own subject identity (VIN/plate) rather than a vehicle_id, and only becomes
-- attached to a `vehicles` row if the buyer actually purchases (0027).

create table public.inspection_templates (
  id          uuid primary key default gen_random_uuid(),
  key         text not null unique,
  name_ar     text not null,
  name_en     text not null,
  -- [{key, title_ar, title_en, weight, items:[{key,label_ar,label_en,type,required,weight}]}]
  sections    jsonb not null,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger inspection_templates_set_updated_at
  before update on public.inspection_templates
  for each row execute function public.set_updated_at();


create type inspection_recommendation as enum ('buy', 'negotiate', 'avoid');

create table public.inspection_reports (
  id             uuid primary key default gen_random_uuid(),
  order_id       uuid not null unique references public.orders(id) on delete restrict,
  template_id    uuid not null references public.inspection_templates(id) on delete restrict,

  -- Null for a pre-purchase inspection: the buyer does not own the car, and
  -- may never own it. Set on conversion (0027).
  vehicle_id     uuid references public.vehicles(id) on delete restrict,

  -- The car's identity, carried by the report itself so it means something
  -- before any vehicle row exists.
  subject_vin    text,
  subject_plate  text,
  subject_make_ar  text,
  subject_model_ar text,
  subject_year   int,
  subject_mileage int check (subject_mileage is null or subject_mileage >= 0),

  results        jsonb not null,   -- {section_key: {item_key: {rating, note, photos[]}}}
  overall_score  int check (overall_score between 0 and 100),
  recommendation inspection_recommendation,

  pdf_url        text,
  public_token   text unique,

  completed_at   timestamptz,
  created_at     timestamptz not null default now(),
  created_by     uuid references public.profiles(id) on delete restrict,

  -- A report must identify the car it is about, one way or the other.
  -- Otherwise it is an unattributable score.
  constraint inspection_subject_identified check (
    vehicle_id is not null or subject_vin is not null or subject_plate is not null
  ),
  constraint inspection_vin_format check (
    subject_vin is null or subject_vin ~ '^[A-HJ-NPR-Z0-9]{17}$'
  )
);

create index inspection_reports_vehicle_idx on public.inspection_reports (vehicle_id)
  where vehicle_id is not null;
create index inspection_reports_token_idx on public.inspection_reports (public_token)
  where public_token is not null;
create index inspection_reports_subject_idx on public.inspection_reports (subject_vin)
  where subject_vin is not null;

comment on table public.inspection_reports is
  'Structured inspection. Pre-purchase reports have no vehicle_id until the buyer converts (0027).';


-- ---------------------------------------------------------------------------
-- Scoring
-- ---------------------------------------------------------------------------
-- Ratings map to a score, and items carry a weight so that "brakes" does not
-- count the same as "interior trim". A `na` item is excluded from the
-- denominator rather than scored as zero — a car with no sunroof should not be
-- marked down for the sunroof it does not have.
create or replace function public.rating_to_score(p_rating text)
returns numeric
language sql
immutable
parallel safe
as $$
  select case p_rating
    when 'pass'      then 100
    when 'attention' then 60
    when 'fail'      then 0
    else null            -- 'na' or unknown: excluded from the average
  end::numeric;
$$;

create or replace function public.score_inspection(
  p_template_id uuid,
  p_results     jsonb
)
returns int
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_sections jsonb;
  v_section  jsonb;
  v_item     jsonb;
  v_rating   text;
  v_score    numeric;
  v_weight   numeric;
  v_total    numeric := 0;
  v_weights  numeric := 0;
  v_cap      int := 100;
begin
  select t.sections into v_sections
  from public.inspection_templates t where t.id = p_template_id;

  if v_sections is null then
    raise exception 'Template % not found', p_template_id using errcode = 'no_data_found';
  end if;

  for v_section in select * from jsonb_array_elements(v_sections) loop
    for v_item in select * from jsonb_array_elements(v_section -> 'items') loop
      v_rating := p_results
        -> (v_section ->> 'key')
        -> (v_item ->> 'key')
        ->> 'rating';

      v_score := public.rating_to_score(v_rating);

      if v_score is not null then
        v_weight := coalesce((v_item ->> 'weight')::numeric, 1)
                  * coalesce((v_section ->> 'weight')::numeric, 1);
        v_total := v_total + (v_score * v_weight);
        v_weights := v_weights + v_weight;
      end if;

      -- Some findings are disqualifying, not merely costly.
      --
      -- A weighted average cannot express "this one thing settles it". With
      -- pure weighting, a car with confirmed accident repair scored 92% and
      -- recommended `buy`, because one failure among ~40 sound items barely
      -- moves the mean. In the Saudi used-car market, evidence of a repaired
      -- accident or an inconsistent odometer is precisely the finding that
      -- changes the decision — so a critical failure CAPS the score instead.
      if coalesce((v_item ->> 'critical')::boolean, false) then
        if v_rating = 'fail' then
          v_cap := least(v_cap, 45);      -- avoid
        elsif v_rating = 'attention' then
          v_cap := least(v_cap, 70);      -- negotiate
        end if;
      end if;
    end loop;
  end loop;

  if v_weights = 0 then
    return null;
  end if;

  return least(round(v_total / v_weights)::int, v_cap);
end;
$$;


-- Thresholds are product policy, kept in one place rather than scattered
-- through the app. A buyer acts on this word, so it must be consistent
-- everywhere it appears.
create or replace function public.score_to_recommendation(p_score int)
returns public.inspection_recommendation
language sql
immutable
parallel safe
as $$
  select case
    when p_score is null then null
    when p_score >= 80 then 'buy'
    when p_score >= 60 then 'negotiate'
    else 'avoid'
  end::public.inspection_recommendation;
$$;


-- ---------------------------------------------------------------------------
-- submit_inspection_report
-- ---------------------------------------------------------------------------
create or replace function public.submit_inspection_report(
  p_order_id       uuid,
  p_template_key   text,
  p_results        jsonb,
  p_subject_vin    text default null,
  p_subject_plate  text default null,
  p_subject_make_ar text default null,
  p_subject_model_ar text default null,
  p_subject_year   int default null,
  p_subject_mileage int default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order     record;
  v_template  record;
  v_section   jsonb;
  v_item      jsonb;
  v_rating    text;
  v_missing   text[] := array[]::text[];
  v_score     int;
  v_token     text;
  v_report_id uuid;
begin
  select * into v_order from public.orders o where o.id = p_order_id;
  if v_order is null then
    raise exception 'Order % not found', p_order_id using errcode = 'no_data_found';
  end if;

  -- Only the provider who did the work may file the report.
  if v_order.provider_id is distinct from public.current_provider_id() then
    raise exception 'Only the assigned provider may submit this inspection'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_template
  from public.inspection_templates t where t.key = p_template_key and t.is_active;
  if v_template is null then
    raise exception 'Inspection template % not found', p_template_key
      using errcode = 'no_data_found';
  end if;

  -- Every required item must be answered. A partially filled inspection that
  -- still produces a score is worse than no score: it looks complete to a
  -- buyer while quietly omitting whatever the inspector skipped.
  for v_section in select * from jsonb_array_elements(v_template.sections) loop
    for v_item in select * from jsonb_array_elements(v_section -> 'items') loop
      if coalesce((v_item ->> 'required')::boolean, false) then
        v_rating := p_results -> (v_section ->> 'key') -> (v_item ->> 'key') ->> 'rating';
        if v_rating is null then
          v_missing := v_missing || ((v_section ->> 'key') || '.' || (v_item ->> 'key'));
        end if;
      end if;
    end loop;
  end loop;

  if array_length(v_missing, 1) > 0 then
    raise exception 'Inspection is incomplete: % required item(s) unanswered (%)',
      array_length(v_missing, 1), array_to_string(v_missing[1:5], ', ')
      using errcode = 'check_violation';
  end if;

  v_score := public.score_inspection(v_template.id, p_results);

  -- A pre-purchase inspection must identify the car it examined, since there
  -- is no vehicle row to borrow an identity from.
  if v_order.vehicle_id is null
     and p_subject_vin is null and p_subject_plate is null then
    raise exception 'A pre-purchase inspection must record the VIN or plate of the car inspected'
      using errcode = 'check_violation';
  end if;

  v_token := rtrim(
    replace(replace(
      encode(decode(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 'hex'),
             'base64'),
      '+', '-'), '/', '_'),
    '=');

  insert into public.inspection_reports (
    order_id, template_id, vehicle_id,
    subject_vin, subject_plate, subject_make_ar, subject_model_ar,
    subject_year, subject_mileage,
    results, overall_score, recommendation, public_token, completed_at, created_by
  ) values (
    p_order_id, v_template.id, v_order.vehicle_id,
    upper(nullif(p_subject_vin, '')), p_subject_plate, p_subject_make_ar, p_subject_model_ar,
    p_subject_year, p_subject_mileage,
    p_results, v_score, public.score_to_recommendation(v_score),
    v_token, now(), auth.uid()
  )
  returning id into v_report_id;

  -- When the inspection IS against a car already in Habba (a periodic
  -- inspection on a car the customer owns), it belongs in that car's logbook
  -- immediately. Pre-purchase reports wait for conversion.
  if v_order.vehicle_id is not null then
    perform public.append_vehicle_timeline_event(
      p_vehicle_id  => v_order.vehicle_id,
      p_event_type  => 'inspection_completed',
      p_summary_ar  => format('فحص مكتمل — النتيجة %s%%', v_score),
      p_summary_en  => format('Inspection completed — score %s%%', v_score),
      p_occurred_at => now(),
      p_mileage     => p_subject_mileage,
      p_order_id    => p_order_id,
      p_provider_id => v_order.provider_id,
      p_details     => jsonb_build_object(
        'inspection_score', v_score,
        'service_kind', 'inspection'
      ),
      p_attachments => '[]'::jsonb
    );
  end if;

  return v_report_id;
end;
$$;


-- Public read by token, mirroring get_habba_report: one indistinguishable
-- answer for missing, and no way to enumerate.
create or replace function public.get_inspection_report(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_report record;
  v_template record;
begin
  select * into v_report
  from public.inspection_reports r
  where r.public_token = p_token and r.completed_at is not null;

  if v_report is null then
    return null;
  end if;

  select * into v_template
  from public.inspection_templates t where t.id = v_report.template_id;

  -- Deliberately no customer identity: the report is about the CAR, exactly
  -- as تقرير هبّة is (build prompt §7.3). A seller sharing this with buyers
  -- must not be sharing the name of whoever paid for the inspection.
  return jsonb_build_object(
    'report_version', 1,
    'completed_at', to_char(v_report.completed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'subject', jsonb_strip_nulls(jsonb_build_object(
      'vin', v_report.subject_vin,
      'plate', v_report.subject_plate,
      'make_ar', v_report.subject_make_ar,
      'model_ar', v_report.subject_model_ar,
      'year', v_report.subject_year,
      'mileage', v_report.subject_mileage
    )),
    'overall_score', v_report.overall_score,
    'recommendation', v_report.recommendation,
    'template', jsonb_build_object(
      'key', v_template.key,
      'name_ar', v_template.name_ar,
      'sections', v_template.sections
    ),
    'results', v_report.results
  );
end;
$$;

grant execute on function public.get_inspection_report(text) to anon, authenticated;
grant execute on function public.submit_inspection_report(uuid, text, jsonb, text, text, text, text, int, int) to authenticated;
grant execute on function public.score_inspection(uuid, jsonb) to authenticated;
grant execute on function public.rating_to_score(text) to authenticated;
grant execute on function public.score_to_recommendation(int) to authenticated;


alter table public.inspection_templates enable row level security;
alter table public.inspection_reports enable row level security;

create policy inspection_templates_read on public.inspection_templates
  for select to authenticated using (is_active or public.is_ops());
create policy inspection_templates_write on public.inspection_templates
  for all to authenticated using (public.is_ops()) with check (public.is_ops());

-- The customer who paid for it, and the provider who performed it.
-- Anonymous access is by token through get_inspection_report only.
create policy inspection_reports_read on public.inspection_reports
  for select to authenticated using (
    exists (
      select 1 from public.orders o
      where o.id = inspection_reports.order_id
        and (o.customer_id = auth.uid() or o.provider_id = public.current_provider_id())
    )
    or public.is_ops()
  );

-- No INSERT policy: reports are filed only through submit_inspection_report,
-- which validates completeness and computes the score. A hand-written row
-- could carry any score its author liked.
revoke insert on public.inspection_reports from anon, authenticated;
