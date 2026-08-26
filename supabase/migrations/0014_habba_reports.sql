-- 0014 — تقرير هبّة: the shareable verified vehicle report
--
-- Build prompt §7.3, CLAUDE.md §1 (moat reason 2). This is what turns an
-- accumulated logbook into money for the owner at resale, and it is the reason
-- the hash chain exists at all.
--
-- Two rules govern everything in this file:
--
--   1. The report NEVER issues on a broken chain. A report that silently omits
--      verification is worse than no report (ADR-0004).
--   2. The report shows the CAR's history, never the owner's identity
--      (build prompt §7.3 privacy rule).

create table public.habba_reports (
  id           uuid primary key default gen_random_uuid(),
  vehicle_id   uuid not null references public.vehicles(id) on delete restrict,

  -- Unguessable share token. 32 bytes of CSPRNG, base64url — this is the only
  -- thing standing between a shared link and an enumerable database of Saudi
  -- vehicle histories, so it is not a sequence and not a uuid.
  public_token text not null unique,

  -- Frozen payload. The report a buyer opened last week must not change
  -- because the seller added an entry since — a report is a statement about a
  -- moment, and its verification QR attests to that moment.
  payload      jsonb not null,

  chain_valid  boolean not null,
  chain_length int not null,

  generated_by uuid not null references public.profiles(id) on delete restrict,
  generated_at timestamptz not null default now(),
  -- Reports expire so a stale history cannot circulate as current. Renewing is
  -- one tap for the owner.
  expires_at   timestamptz not null default now() + interval '90 days',
  revoked_at   timestamptz
);

create index habba_reports_vehicle_idx on public.habba_reports (vehicle_id, generated_at desc);
create index habba_reports_token_idx on public.habba_reports (public_token)
  where revoked_at is null;

comment on table public.habba_reports is
  'Frozen, shareable vehicle history. Never issued on a broken hash chain. Build prompt §7.3.';


-- ---------------------------------------------------------------------------
-- Detail redaction
-- ---------------------------------------------------------------------------
-- `vehicle_timeline.details` is free-form jsonb. By Phase 3 it carries
-- provider notes, and customers will type addresses and phone numbers into
-- free-text fields regardless of what the field is labelled.
--
-- So the report uses an ALLOWLIST, not a denylist. A denylist means every new
-- key added anywhere in the system is public by default until someone
-- remembers to exclude it — which is how personal data leaks into a public URL.
create or replace function public.redact_timeline_details(input jsonb)
returns jsonb
language sql
immutable
parallel safe
as $$
  select coalesce(
    jsonb_object_agg(key, input -> key),
    '{}'::jsonb
  )
  from jsonb_object_keys(coalesce(input, '{}'::jsonb)) as key
  where key in (
    -- Mechanical facts about the car. Nothing about the person.
    'oil_grade', 'oil_quantity_l', 'filter_part_number', 'part_number',
    'parts', 'is_oem', 'warranty_days', 'labour_hours',
    'service_kind', 'inspection_score', 'obd_codes', 'tyre_size',
    'battery_capacity_ah', 'brake_pad_position', 'notes_public'
  );
$$;

comment on function public.redact_timeline_details(jsonb) is
  'Allowlist redaction for public reports. Never switch this to a denylist — see 0014.';


-- ---------------------------------------------------------------------------
-- generate_habba_report
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

  -- Rule 1. The whole product promise rests on this refusal.
  select * into v_chain from public.verify_vehicle_timeline(p_vehicle_id);

  if not v_chain.is_valid then
    raise exception 'Cannot issue a report: the logbook failed verification (%)', v_chain.reason
      using errcode = 'data_corrupted',
            hint = 'Contact support. Do not share an unverified history.';
  end if;

  -- 32 bytes from two v4 UUIDs (~244 bits of entropy), rendered base64url.
  --
  -- Deliberately not pgcrypto's gen_random_bytes: pgcrypto is an optional
  -- extension that lives in `public` locally but in `extensions` on hosted
  -- Supabase, so under `search_path = ''` it resolves in one environment and
  -- not the other. gen_random_uuid() is core (pg_catalog) and always resolves.
  v_token := rtrim(
    replace(replace(
      encode(
        decode(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 'hex'),
        'base64'
      ),
      '+', '-'), '/', '_'),
    '=');

  select jsonb_build_object(
    'report_version', 1,
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
    -- actually stand behind. Presenting a single undifferentiated count would
    -- be the dishonest version.
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
  'Issues تقرير هبّة. Refuses on a broken chain. Returns the public share token.';


-- ---------------------------------------------------------------------------
-- Public read — no login, by token only
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER and token-scoped rather than an RLS policy on the table:
-- a policy would still expose the table to `select` and let a caller probe it.
-- Here the only way in is to already know a 32-byte token.
create or replace function public.get_habba_report(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_report record;
begin
  select * into v_report
  from public.habba_reports r
  where r.public_token = p_token
    and r.revoked_at is null
    and r.expires_at > now();

  if v_report is null then
    -- One indistinguishable answer for "never existed", "expired" and
    -- "revoked". Distinguishing them would confirm which tokens once existed.
    return null;
  end if;

  return v_report.payload;
end;
$$;

grant execute on function public.get_habba_report(text) to anon, authenticated;
grant execute on function public.generate_habba_report(uuid) to authenticated;

alter table public.habba_reports enable row level security;

-- Owners see the reports they have issued, so they can revoke one.
create policy habba_reports_read_own on public.habba_reports
  for select to authenticated
  using (public.owns_vehicle(vehicle_id) or public.is_ops());

create policy habba_reports_revoke_own on public.habba_reports
  for update to authenticated
  using (public.owns_vehicle(vehicle_id))
  with check (public.owns_vehicle(vehicle_id));

-- No INSERT policy: reports are issued only by generate_habba_report, so a
-- client cannot fabricate one with a payload of its choosing.
revoke insert on public.habba_reports from anon, authenticated;
