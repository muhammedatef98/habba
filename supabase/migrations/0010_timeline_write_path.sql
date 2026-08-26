-- 0010 — The single sanctioned write path into the timeline
-- ADR-0003 (one write path), ADR-0004 (concurrency), ADR-0005 (provenance).

-- ---------------------------------------------------------------------------
-- Provenance derivation
-- ---------------------------------------------------------------------------
-- ADR-0005: provenance is DERIVED from the caller's context, never accepted as
-- a parameter. A client cannot claim a trust level it did not earn.
create or replace function public.derive_timeline_provenance(
  p_event_type  timeline_event_type,
  p_order_id    uuid,
  p_attachments jsonb
)
returns timeline_provenance
language sql
immutable
parallel safe
as $$
  -- Types are schema-qualified because callers run with search_path = ''.
  select case
    -- Produced by a completed Habba order: provider identity, photos and a
    -- mileage reading were all captured under our control.
    when p_order_id is not null then 'habba_verified'::public.timeline_provenance
    -- A system fact about Habba itself, not a claim about past service.
    when p_event_type in ('vehicle_registered', 'ownership_transferred', 'alert_raised', 'alert_dismissed')
      then 'habba_verified'::public.timeline_provenance
    -- Owner-entered history with an invoice or photo attached.
    when jsonb_array_length(coalesce(p_attachments, '[]'::jsonb)) > 0
      then 'self_documented'::public.timeline_provenance
    -- Owner-entered history, unevidenced. Still useful; never called verified.
    else 'self_reported'::public.timeline_provenance
  end;
$$;


-- ---------------------------------------------------------------------------
-- append_vehicle_timeline_event — the ONLY way a row enters the timeline
-- ---------------------------------------------------------------------------
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
-- Mandatory on every SECURITY DEFINER function: without it, a caller can
-- prepend a schema to search_path and hijack an unqualified reference.
set search_path = ''
as $$
declare
  -- Types are schema-qualified: with search_path = '' a bare `user_role` does
  -- not resolve at runtime, and plpgsql DECLARE blocks resolve lazily on first
  -- execution — so an unqualified type here fails in production, not at
  -- migration time.
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

  -- Phase 1/2 authorisation: the owner, or ops. Phase 3 extends this to a
  -- provider holding a non-terminal order on the vehicle.
  if v_owner_id <> v_actor and coalesce(v_actor_role, 'customer') not in ('ops', 'super_admin') then
    raise exception 'Not permitted to write to this vehicle timeline'
      using errcode = 'insufficient_privilege';
  end if;

  -- ADR-0012: bound client-asserted time. Backdating owner-entered history is
  -- the whole point of Phase 2, so past values are allowed freely — those rows
  -- are self_reported and labelled as such. The future is not allowed.
  if p_occurred_at > now() + interval '5 minutes' then
    raise exception 'occurred_at cannot be in the future' using errcode = 'check_violation';
  end if;

  -- ADR-0004: serialise appends per vehicle. Two concurrent inserts would
  -- otherwise both read the same chain tip and fork it — and because the table
  -- is append-only, a fork can NEVER be repaired. Transaction-scoped, so it
  -- releases on commit or rollback with no cleanup path.
  perform pg_advisory_xact_lock(hashtextextended(p_vehicle_id::text, 0));

  -- Order by `seq`, never by recorded_at: now() is the transaction start time,
  -- so several appends in one transaction share it and the tip becomes
  -- whichever random UUID sorted highest. See the note on seq in 0009.
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

  -- Keep the vehicle's odometer in step with the latest reading, never
  -- backwards (a later-synced older event must not lower it).
  if p_mileage is not null then
    update public.vehicles
    set current_mileage = greatest(current_mileage, p_mileage),
        mileage_updated_at = now()
    where id = p_vehicle_id;
  end if;

  return v_id;
end;
$$;

comment on function public.append_vehicle_timeline_event is
  'The only sanctioned write path into vehicle_timeline. Direct INSERT is revoked. ADR-0003.';


-- ---------------------------------------------------------------------------
-- verify_vehicle_timeline — what makes تقرير هبّة trustworthy
-- ---------------------------------------------------------------------------
-- Returns the first break rather than a bare boolean, so support can diagnose
-- rather than just observe that something is wrong.
create or replace function public.verify_vehicle_timeline(p_vehicle_id uuid)
returns table (
  is_valid         boolean,
  checked_count    int,
  first_invalid_id uuid,
  reason           text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r             record;
  v_expected    text := 'GENESIS';
  v_count       int  := 0;
  v_payload     text;
  v_recomputed  text;
begin
  -- Walk in INSERT order (seq), not occurred_at: backdated and offline-synced
  -- rows are legitimately out of chronological order, and the chain was built
  -- in insert order (ADR-0012).
  for r in
    select * from public.vehicle_timeline t
    where t.vehicle_id = p_vehicle_id
    order by t.seq
  loop
    if r.prev_hash is distinct from v_expected then
      return query select false, v_count, r.id,
        format('prev_hash mismatch: expected %s, found %s', v_expected, r.prev_hash);
      return;
    end if;

    v_payload := public.timeline_row_payload(
      r.prev_hash, r.id, r.vehicle_id, r.event_type, r.occurred_at, r.mileage,
      r.order_id, r.provider_id, r.created_by, r.provenance, r.details, r.attachments
    );
    v_recomputed := public.timeline_row_hash(v_payload);

    if v_recomputed <> r.row_hash then
      return query select false, v_count, r.id,
        format('row_hash mismatch: stored %s, recomputed %s', r.row_hash, v_recomputed);
      return;
    end if;

    v_expected := r.row_hash;
    v_count := v_count + 1;
  end loop;

  return query select true, v_count, null::uuid, null::text;
end;
$$;

comment on function public.verify_vehicle_timeline(uuid) is
  'Walks the hash chain in insert order. generate_habba_report must refuse to issue on a false result.';


-- ---------------------------------------------------------------------------
-- Grants: no client role writes to the timeline directly, ever (ADR-0003)
-- ---------------------------------------------------------------------------
revoke insert, update, delete, truncate on public.vehicle_timeline from anon, authenticated;

grant execute on function public.append_vehicle_timeline_event(
  uuid, timeline_event_type, text, text, timestamptz, int, uuid, uuid, jsonb, jsonb
) to authenticated;
grant execute on function public.verify_vehicle_timeline(uuid) to authenticated, anon;
