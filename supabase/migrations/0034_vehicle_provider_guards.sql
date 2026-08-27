-- 0034 — Column-level write control on vehicles and providers
--
-- ⚠️ SECURITY FIX, second pass. 0033 closed this on `orders`; the same
-- question had never been asked of the other two tables clients can update.
-- Probed empirically, all of these worked:
--
--   update vehicles  set current_mileage = 40000   -- odometer rollback
--   update vehicles  set vin = '...'               -- transplant the history
--   update providers set rating_avg = 5.00, rating_count = 480,
--                        jobs_completed = 900, acceptance_rate = 100
--   update providers set nafath_verified_at = now()
--
-- The odometer one is the worst. `record_mileage` refuses a reading below the
-- recorded one, but a direct table UPDATE never touched that function — and
-- `vehicles.current_mileage` is what تقرير هبّة prints as the car's odometer.
-- A seller could roll it back before generating the report the entire resale
-- proposition rests on.
--
-- The provider one manipulates dispatch: `match_providers` ranks on rating and
-- acceptance_rate, so a brand-new provider could fabricate 480 five-star jobs
-- and jump the queue over genuinely good ones — while showing an ops reviewer
-- a Nafath-verified badge they granted themselves.

create or replace function public.guard_vehicle_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.is_ops() or public.is_privileged_write() then
    return new;
  end if;

  -- The odometer is derived from the logbook, never asserted. Every legitimate
  -- change comes through append_vehicle_timeline_event, which records WHERE
  -- the number came from — and the hash chain then protects it.
  if new.current_mileage is distinct from old.current_mileage
     or new.mileage_updated_at is distinct from old.mileage_updated_at then
    raise exception 'The odometer is recorded through the logbook, not set directly'
      using errcode = 'insufficient_privilege',
            hint = 'Record a mileage reading or complete a service.';
  end if;

  -- A VIN identifies the physical car. Changing it moves a history onto a
  -- different vehicle, which is the one thing the logbook exists to prevent.
  -- It may be filled in once (owners often do not know it at sign-up), never
  -- rewritten or cleared.
  if old.vin is not null and new.vin is distinct from old.vin then
    raise exception 'The VIN cannot be changed once recorded'
      using errcode = 'insufficient_privilege',
            hint = 'Contact support if it was entered incorrectly.';
  end if;

  -- Ownership moves through the transfer flow, which verifies the recipient
  -- by OTP. A direct write would hand a logbook to anyone.
  if new.owner_id is distinct from old.owner_id then
    raise exception 'Ownership changes through a transfer, not directly'
      using errcode = 'insufficient_privilege';
  end if;

  if new.created_at is distinct from old.created_at
     or new.created_by is distinct from old.created_by then
    raise exception 'Vehicle audit fields cannot be changed'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

create trigger vehicles_a_guard_columns
  before update on public.vehicles
  for each row execute function public.guard_vehicle_columns();

alter table public.vehicles enable always trigger vehicles_a_guard_columns;


create or replace function public.guard_provider_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.is_ops() or public.is_privileged_write() then
    return new;
  end if;

  -- Reputation is earned. These are maintained by refresh_provider_rating from
  -- actual ratings on completed orders, and they feed the matching score
  -- directly — a provider writing their own is a provider assigning their own
  -- dispatch priority.
  if new.rating_avg is distinct from old.rating_avg
     or new.rating_count is distinct from old.rating_count
     or new.jobs_completed is distinct from old.jobs_completed
     or new.acceptance_rate is distinct from old.acceptance_rate then
    raise exception 'Ratings and job history are earned, not set'
      using errcode = 'insufficient_privilege';
  end if;

  -- Verification is an ops decision, and Nafath is an external fact. A
  -- provider granting themselves either makes KYC theatre.
  if new.verification_status is distinct from old.verification_status
     or new.nafath_verified_at is distinct from old.nafath_verified_at then
    raise exception 'Verification status is set by Habba, not by the provider'
      using errcode = 'insufficient_privilege';
  end if;

  if new.owner_profile_id is distinct from old.owner_profile_id
     or new.created_at is distinct from old.created_at then
    raise exception 'Provider identity cannot be reassigned'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

create trigger providers_a_guard_columns
  before update on public.providers
  for each row execute function public.guard_provider_columns();

alter table public.providers enable always trigger providers_a_guard_columns;


-- The old policy required `verification_status = 'pending'` on the NEW row,
-- which meant an approved provider could not edit their own business details
-- at all without demoting themselves. The guard above now owns that rule, so
-- the policy goes back to being about ownership.
drop policy if exists providers_update_own on public.providers;
create policy providers_update_own on public.providers
  for update to authenticated
  using (owner_profile_id = auth.uid())
  with check (owner_profile_id = auth.uid());


-- The legitimate writers now have to say so explicitly.
create or replace function public.refresh_provider_rating()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.begin_privileged_write();

  update public.providers p
  set rating_avg = sub.avg_stars,
      rating_count = sub.n
  from (
    select round(avg(stars)::numeric, 2) as avg_stars, count(*)::int as n
    from public.ratings where provider_id = new.provider_id
  ) as sub
  where p.id = new.provider_id;

  perform public.end_privileged_write();
  return null;
end;
$$;


-- append_vehicle_timeline_event is the only sanctioned route to the odometer,
-- so it is the only thing allowed past the guard.
create or replace function public.append_vehicle_timeline_event(
  p_vehicle_id  uuid,
  p_event_type  timeline_event_type,
  p_summary_ar  text,
  p_summary_en  text,
  p_occurred_at timestamptz default now(),
  p_mileage     int default null,
  p_order_id    uuid default null,
  p_provider_id uuid default null,
  p_details     jsonb default '{}'::jsonb,
  p_attachments jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor       uuid := auth.uid();
  v_owner_id    uuid;
  v_actor_role  public.user_role;
  v_prev_hash   text;
  v_id          uuid := gen_random_uuid();
  v_provenance  public.timeline_provenance;
  v_payload     text;
  v_row_hash    text;
begin
  if v_actor is null then
    raise exception 'Not authenticated' using errcode = 'insufficient_privilege';
  end if;

  select p.role into v_actor_role from public.profiles p where p.id = v_actor;

  select v.owner_id into v_owner_id
  from public.vehicles v
  where v.id = p_vehicle_id and v.is_active;

  if v_owner_id is null then
    raise exception 'Vehicle % not found', p_vehicle_id using errcode = 'no_data_found';
  end if;

  if v_owner_id <> v_actor and coalesce(v_actor_role, 'customer') not in ('ops', 'super_admin') then
    raise exception 'Not permitted to write to this vehicle timeline'
      using errcode = 'insufficient_privilege';
  end if;

  if p_occurred_at > now() + interval '5 minutes' then
    raise exception 'occurred_at cannot be in the future' using errcode = 'check_violation';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_vehicle_id::text, 0));

  select t.row_hash into v_prev_hash
  from public.vehicle_timeline t
  where t.vehicle_id = p_vehicle_id
  order by t.seq desc
  limit 1;

  v_prev_hash := coalesce(v_prev_hash, 'GENESIS');
  v_provenance := public.derive_timeline_provenance(p_event_type, p_order_id, p_attachments);

  v_payload := public.timeline_row_payload(
    v_prev_hash, v_id, p_vehicle_id, p_event_type, p_occurred_at, p_mileage,
    p_order_id, p_provider_id, v_actor, v_provenance, p_details, p_attachments
  );
  v_row_hash := public.timeline_row_hash(v_payload);

  insert into public.vehicle_timeline (
    id, vehicle_id, event_type, occurred_at, recorded_at, mileage,
    order_id, provider_id, provenance, summary_ar, summary_en,
    details, attachments, created_by, prev_hash, row_hash
  ) values (
    v_id, p_vehicle_id, p_event_type, p_occurred_at, now(), p_mileage,
    p_order_id, p_provider_id, v_provenance, p_summary_ar, p_summary_en,
    coalesce(p_details, '{}'::jsonb), coalesce(p_attachments, '[]'::jsonb),
    v_actor, v_prev_hash, v_row_hash
  );

  if p_mileage is not null then
    -- The odometer only ever moves forward, and only from here.
    perform public.begin_privileged_write();

    update public.vehicles
    set current_mileage = greatest(current_mileage, p_mileage),
        mileage_updated_at = now()
    where id = p_vehicle_id;

    perform public.end_privileged_write();
  end if;

  return v_id;
end;
$$;


-- convert_inspection_to_vehicle sets vehicles.vehicle_id/owner via INSERT, so
-- it is unaffected — but the duplicate-VIN check it performs is redundant:
-- `vehicles.vin` is UNIQUE table-wide, so a second row is impossible whether
-- or not the first is active. Verified by probe; the explicit check stays only
-- because it produces a message a person can act on.
