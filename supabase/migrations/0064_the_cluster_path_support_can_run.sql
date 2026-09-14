-- 0064 — The cluster path becomes one somebody can actually take
--
-- `record_mileage` refuses a reading below the series head and its hint ends
-- «use replace_odometer_cluster». ADR-0022 logged the missing screen as a
-- follow-up and understated what it costs: that RPC has no UI, so the owner is
-- pointed at something they cannot reach — and because every subsequent reading
-- is also below the head, the refusal is permanent. **The care section goes dead
-- for that vehicle and the message explains nothing the owner can act on.**
--
-- The answer is not a screen. Starting a new odometer series re-anchors the one
-- number تقرير هبّة prints and every prediction is computed from; a button for
-- it, on a case most owners meet once or never, is an invitation to clock a car
-- with two taps. So the path moves to support, and this migration makes that
-- path real in the three places it was not:
--
--   1. the message names support rather than a function name (below, and in
--      `packages/i18n` for the sentence the owner actually reads);
--   2. the grants let support run it and stop letting anybody else;
--   3. the invocation is written down.
--
-- ---------------------------------------------------------------------------
-- What the grants were, and why that was worse than "no UI"
-- ---------------------------------------------------------------------------
-- `replace_odometer_cluster` was granted to `authenticated` and gated on
-- `owns_vehicle()`. Having no screen did not make it unreachable: PostgREST
-- exposes every granted function, so any owner could POST to it and re-anchor
-- their own odometer downwards whenever they liked. The absent screen was not a
-- control — it was the only thing making the hole inconvenient.
--
-- After this file the function is reachable by `service_role` and by nothing
-- else, which is both the path support needs and the removal of a clocking
-- vector that has been open since 0058.
--
-- ---------------------------------------------------------------------------
-- Who "support" is, when the key is shared
-- ---------------------------------------------------------------------------
-- `service_role` is one key held by a server, so `auth.uid()` is null inside a
-- support call and the ledger has no actor to record. A shared key cannot
-- identify a person, so the person is NAMED instead: `p_performed_by` is
-- required and must hold `ops` or `super_admin` through `user_roles` (0040).
--
-- That is deliberately not decoration. The ops console (§5.1.6) authenticates
-- operators with 2FA and knows which of them is acting, so it has the id to
-- pass; and requiring a live ops role means a leaked service key alone cannot
-- use this function — it also needs the id of somebody the database agrees is
-- an operator.

-- ---------------------------------------------------------------------------
-- The ledger
-- ---------------------------------------------------------------------------
-- 0056/0057's conventions, for 0057's reason: a refusal or an intervention that
-- is invisible afterwards is one nobody can support. Closed to clients,
-- readable through `service_role`, and not rewritable by the account that reads
-- it — the guard is ENABLE ALWAYS, so a leaked service key cannot edit the
-- record of what it did.
create table public.odometer_series_interventions (
  id             bigint generated always as identity primary key,

  -- Not foreign keys, following `transfer_accept_attempts` (0056): a foreign
  -- key to a profile would either block the PDPL erasure path (0039) or cascade
  -- away the record of the very intervention being investigated. The vehicle is
  -- the same: this row must outlive a car that is later deleted.
  vehicle_id     uuid not null,
  performed_by   uuid not null,
  performed_at   timestamptz not null default clock_timestamp(),

  -- Which arithmetic was applied, and why in the operator's own words. Both
  -- required: the enum says what the database did, the note says what the
  -- operator was told, and neither substitutes for the other.
  reason         odometer_series_reason not null,
  note           text not null check (length(btrim(note)) >= 10),

  -- BOTH series, as they were at the moment of the swap. Reconstructable from
  -- the readings table in principle; recorded here so that answering "what did
  -- support do to this car" is one query against one table rather than a
  -- re-derivation that has to get the head rule right.
  from_series           int not null,
  from_km               int not null,
  from_lifetime_km      int not null,
  to_series             int not null,
  to_series_offset_km   int not null,
  to_km                 int not null,
  to_lifetime_km        int not null,

  -- The reading this minted, so the ledger and the series can be tied together.
  reading_id     uuid not null
);

comment on table public.odometer_series_interventions is
  'Every support-run odometer series replacement: who, which car, both series, '
  'and why in words (0064). Closed to clients, readable by service_role, and '
  'not rewritable by anyone.';

comment on column public.odometer_series_interventions.performed_by is
  'The OPERATOR, not the owner. service_role is a shared key with no auth.uid(), '
  'so the person is named explicitly and must hold ops at the time.';

-- The two questions this table serves: "what has been done to this car?" and
-- "what has this operator done?"
create index odometer_series_interventions_vehicle_idx
  on public.odometer_series_interventions (vehicle_id, performed_at desc);
create index odometer_series_interventions_actor_idx
  on public.odometer_series_interventions (performed_by, performed_at desc);


create or replace function public.guard_odometer_series_interventions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- INSERT through the RPC only, and no UPDATE or DELETE by anybody. A ledger
  -- its own reader can edit is not a ledger.
  if tg_op = 'INSERT' and public.is_privileged_write() then
    return new;
  end if;

  raise exception 'odometer_series_interventions is append-only and written only by replace_odometer_cluster (0064)'
    using errcode = 'insufficient_privilege';
end;
$$;

create trigger odometer_series_interventions_guard
  before insert or update or delete on public.odometer_series_interventions
  for each row execute function public.guard_odometer_series_interventions();

-- ENABLE ALWAYS, for 0056's reason applied to the account that reads this
-- table: support can see what was done and cannot change it.
alter table public.odometer_series_interventions
  enable always trigger odometer_series_interventions_guard;

-- Closed entirely to clients: RLS on with no policy, and no grant. It maps
-- vehicles to operators and to a free-text note about somebody's car.
alter table public.odometer_series_interventions enable row level security;
revoke all on public.odometer_series_interventions from anon, authenticated;


-- ---------------------------------------------------------------------------
-- replace_odometer_cluster — support's, and nobody else's
-- ---------------------------------------------------------------------------
-- Dropped and recreated rather than overloaded. The signature gains a required
-- operator and its `p_note` stops being optional, and a second overload would
-- have left the old four-argument form callable — which is the form granted to
-- `authenticated`, so the revoke below would have protected nothing.
drop function if exists public.replace_odometer_cluster(uuid, int, odometer_series_reason, text);

create or replace function public.replace_odometer_cluster(
  p_vehicle_id   uuid,
  p_km           int,
  p_reason       odometer_series_reason,
  p_note         text,
  p_performed_by uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_head   record;
  v_offset int;
  v_id     uuid;
  v_open   boolean;
begin
  -- The operator, checked against `user_roles` rather than taken on trust.
  -- There is no `auth.uid()` here to fall back on — see the header.
  if p_performed_by is null
     or not (public.has_role(p_performed_by, 'ops')
          or public.has_role(p_performed_by, 'super_admin')) then
    raise exception 'An odometer series is replaced by an operator, named and holding ops'
      using errcode = 'insufficient_privilege',
            hint = 'Pass the id of the signed-in ops account. See docs/runbooks/odometer-cluster-replacement.md.';
  end if;

  -- Why, in words. The enum records what the database did; this records what
  -- the operator was told, and it is the only part a person reading the ledger
  -- in six months can actually judge.
  if p_note is null or length(btrim(p_note)) < 10 then
    raise exception 'A series replacement needs a written reason'
      using errcode = 'check_violation',
            hint = 'State what the owner reported and what was verified.';
  end if;

  -- NO ownership check. That is the point of this function existing on the
  -- support side: the operator does not own the car, and the grant below is
  -- what decides who may call it.

  if p_km is null or p_km < 0 or p_km > public.odometer_ceiling_km() then
    raise exception 'Odometer reading % is not plausible (0 to % km)',
      p_km, public.odometer_ceiling_km()
      using errcode = 'check_violation';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('odometer:' || p_vehicle_id::text, 0));

  select * into v_head from public.odometer_head(p_vehicle_id);

  if v_head is null then
    raise exception 'This car has no odometer readings yet'
      using errcode = 'no_data_found',
            hint = 'Record the current reading first.';
  end if;

  v_offset := case p_reason
    -- The old cluster's distance was travelled. Keep it.
    when 'cluster_replaced' then v_head.series_offset_km + v_head.km
    -- The old scale was wrong. It contributes nothing, and lifetime distance
    -- is allowed to fall — see ADR-0022.
    when 'correction'       then v_head.series_offset_km
  end;

  v_open := public.is_privileged_write();
  perform public.begin_privileged_write();

  insert into public.vehicle_odometer_readings (
    vehicle_id, km, recorded_at, source, series, series_offset_km,
    series_reason, note, created_by
  ) values (
    p_vehicle_id, p_km, now(), 'manual', v_head.series + 1, v_offset,
    p_reason, p_note,
    -- The operator, not the owner. `created_by` on a reading has always meant
    -- "whose hand put this number here", and here that hand is support's.
    p_performed_by
  )
  returning id into v_id;

  -- Written in the same transaction as the reading it describes, so the ledger
  -- cannot record a swap that rolled back, and a swap cannot happen unrecorded.
  insert into public.odometer_series_interventions (
    vehicle_id, performed_by, reason, note,
    from_series, from_km, from_lifetime_km,
    to_series, to_series_offset_km, to_km, to_lifetime_km,
    reading_id
  ) values (
    p_vehicle_id, p_performed_by, p_reason, btrim(p_note),
    v_head.series, v_head.km, v_head.series_offset_km + v_head.km,
    v_head.series + 1, v_offset, p_km, v_offset + p_km,
    v_id
  );

  perform public.end_privileged_write_unless(v_open);

  -- §1: the logbook records what happened to the car. A replaced cluster is one
  -- of the most material facts a used-car buyer can be told, and it stays in
  -- the owner's own history whoever performed it.
  --
  -- No p_mileage: the series row above is already written, and passing a
  -- mileage here would offer the same reading to the series a second time.
  --
  -- `append_vehicle_timeline_event` authorises on auth.uid(), which is null in
  -- a service_role call — so the append runs inside the privileged-write flag,
  -- the same way every other server-side writer reaches a guarded table.
  v_open := public.is_privileged_write();
  perform public.begin_privileged_write();

  perform public.append_timeline_event_as(
    p_actor       => p_performed_by,
    p_vehicle_id  => p_vehicle_id,
    p_event_type  => 'mileage_recorded',
    p_summary_ar  => case p_reason
      when 'cluster_replaced' then format('تم تركيب عدّاد جديد — القراءة تبدأ من %s كم', p_km)
      else format('تصحيح قراءة العداد — القراءة الصحيحة %s كم', p_km)
    end,
    p_summary_en  => case p_reason
      when 'cluster_replaced' then format('Instrument cluster replaced — readings restart at %s km', p_km)
      else format('Odometer scale corrected — the true reading is %s km', p_km)
    end,
    p_details     => jsonb_strip_nulls(jsonb_build_object(
      'series', v_head.series + 1,
      'series_offset_km', v_offset,
      'notes_public', btrim(p_note)
    ))
  );

  perform public.end_privileged_write_unless(v_open);

  return v_id;
end;
$$;

comment on function public.replace_odometer_cluster(uuid, int, odometer_series_reason, text, uuid) is
  'Starts a new odometer series — the only path by which a reading may be lower '
  'than the one before it (ADR-0022). SUPPORT ONLY (0064): service_role, naming '
  'an operator who holds ops. Every call is written to '
  'odometer_series_interventions. Runbook: docs/runbooks/odometer-cluster-replacement.md.';

-- The grant that is the actual control. `authenticated` is revoked explicitly
-- rather than merely not re-granted: the old four-argument function was granted
-- to it, and 0001's ALTER DEFAULT PRIVILEGES grants execute on new functions to
-- anon, authenticated and service_role — so a fresh function starts REACHABLE
-- and has to be closed.
revoke all on function public.replace_odometer_cluster(uuid, int, odometer_series_reason, text, uuid)
  from public, anon, authenticated;
grant execute on function public.replace_odometer_cluster(uuid, int, odometer_series_reason, text, uuid)
  to service_role;


-- ---------------------------------------------------------------------------
-- One chain construction, two doors
-- ---------------------------------------------------------------------------
-- `append_vehicle_timeline_event` reads `auth.uid()` twice: once to authorise
-- the caller, once for the `created_by` it stamps. In a `service_role` call
-- that is null, so it raises before doing anything.
--
-- The obvious fix — a second function that writes the timeline for a named
-- actor — would put TWO hash-chain constructions in the catalogue, and ADR-0004
-- is unforgiving about that: a writer that canonicalises the payload even
-- slightly differently forks the chain, and because the table is append-only a
-- fork can never be repaired. Two copies of that code is two chances to drift.
--
-- So the construction is not copied. It moves into
-- `append_timeline_event_as(p_actor, …)`, and `append_vehicle_timeline_event`
-- becomes what it always was in substance — the AUTHORISATION in front of it —
-- and delegates. ADR-0003's "single write path" is unchanged where it matters:
-- one function builds every row in this table. There are now two doors to it,
-- and only one of them is open to clients.
create or replace function public.append_timeline_event_as(
  p_actor       uuid,
  p_vehicle_id  uuid,
  p_event_type  public.timeline_event_type,
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
  v_prev_hash   text;
  v_id          uuid := gen_random_uuid();
  v_provenance  public.timeline_provenance;
  v_payload     text;
  v_row_hash    text;
begin
  if p_actor is null then
    raise exception 'Not authenticated' using errcode = 'insufficient_privilege';
  end if;

  if not exists (
    select 1 from public.vehicles v where v.id = p_vehicle_id and v.is_active
  ) then
    raise exception 'Vehicle % not found', p_vehicle_id using errcode = 'no_data_found';
  end if;

  -- ADR-0012: bound client-asserted time. Backdating owner-entered history is
  -- the point of Phase 2; the future is not allowed, whoever is writing.
  if p_occurred_at > now() + interval '5 minutes' then
    raise exception 'occurred_at cannot be in the future' using errcode = 'check_violation';
  end if;

  -- ADR-0004: serialise appends per vehicle. Two concurrent inserts would read
  -- the same chain tip and fork it.
  perform pg_advisory_xact_lock(hashtextextended(p_vehicle_id::text, 0));

  -- Order by `seq`, never by recorded_at: now() is the transaction start time,
  -- so several appends in one transaction share it.
  select t.row_hash into v_prev_hash
  from public.vehicle_timeline t
  where t.vehicle_id = p_vehicle_id
  order by t.seq desc
  limit 1;

  v_prev_hash := coalesce(v_prev_hash, 'GENESIS');
  v_provenance := public.derive_timeline_provenance(p_event_type, p_order_id, p_attachments);

  v_payload := public.timeline_row_payload(
    v_prev_hash, v_id, p_vehicle_id, p_event_type, p_occurred_at, p_mileage,
    p_order_id, p_provider_id, p_actor, v_provenance, p_details, p_attachments
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
    p_actor, v_prev_hash, v_row_hash
  );

  -- 0063: a mileage on a timeline event is offered to the series, non-strict.
  if p_mileage is not null then
    perform public.append_odometer_reading(
      p_vehicle_id  => p_vehicle_id,
      p_km          => p_mileage,
      p_source      => (case when p_order_id is not null then 'service_order' else 'manual' end)
                       ::public.odometer_source,
      p_order_id    => p_order_id,
      p_recorded_at => p_occurred_at,
      p_note        => null,
      p_strict      => false
    );
  end if;

  return v_id;
end;
$$;

comment on function public.append_timeline_event_as(
  uuid, uuid, public.timeline_event_type, text, text, timestamptz, int, uuid, uuid, jsonb, jsonb) is
  'Builds every row in vehicle_timeline (ADR-0003/0004). Takes the actor rather '
  'than reading auth.uid(), for server-side callers that have none. Closed to '
  'clients — they go through append_vehicle_timeline_event, which authorises.';

revoke all on function public.append_timeline_event_as(
  uuid, uuid, public.timeline_event_type, text, text, timestamptz, int, uuid, uuid, jsonb, jsonb)
  from public, anon, authenticated;


-- The client door. Identical behaviour to 0063's version — the same
-- authorisation, the same refusals, the same return — with the construction
-- behind it rather than inside it.
create or replace function public.append_vehicle_timeline_event(
  p_vehicle_id  uuid,
  p_event_type  public.timeline_event_type,
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
  v_actor    uuid := auth.uid();
  v_owner_id uuid;
begin
  if v_actor is null then
    raise exception 'Not authenticated' using errcode = 'insufficient_privilege';
  end if;

  select v.owner_id into v_owner_id
  from public.vehicles v
  where v.id = p_vehicle_id and v.is_active;

  if v_owner_id is null then
    raise exception 'Vehicle % not found', p_vehicle_id using errcode = 'no_data_found';
  end if;

  if v_owner_id <> v_actor and not public.is_ops() then
    raise exception 'Not permitted to write to this vehicle timeline'
      using errcode = 'insufficient_privilege';
  end if;

  return public.append_timeline_event_as(
    p_actor       => v_actor,
    p_vehicle_id  => p_vehicle_id,
    p_event_type  => p_event_type,
    p_summary_ar  => p_summary_ar,
    p_summary_en  => p_summary_en,
    p_occurred_at => p_occurred_at,
    p_mileage     => p_mileage,
    p_order_id    => p_order_id,
    p_provider_id => p_provider_id,
    p_details     => p_details,
    p_attachments => p_attachments
  );
end;
$$;

comment on function public.append_vehicle_timeline_event(
  uuid, public.timeline_event_type, text, text, timestamptz, int, uuid, uuid, jsonb, jsonb) is
  'The only way a CLIENT puts a row in the timeline (ADR-0003). Authorises the '
  'caller, then delegates the chain construction to append_timeline_event_as.';


-- ---------------------------------------------------------------------------
-- The refusal stops naming a function
-- ---------------------------------------------------------------------------
-- Identical to 0063's `record_mileage` apart from the hint. An error hint is
-- returned to the client by PostgREST, so «use replace_odometer_cluster» is a
-- sentence an owner can end up reading — and it names something they cannot
-- call, in a register nothing else in this product uses.
--
-- The sentence the owner actually sees comes from `packages/i18n`
-- (`logbook.errors.mileageTooLow`), updated in the same commit. This one is
-- what a developer and a support engineer read, and it points at the runbook.
create or replace function public.record_mileage(
  p_vehicle_id  uuid,
  p_mileage     int,
  p_occurred_at timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_head    record;
  v_current int;
  v_floor   int;
begin
  if p_mileage is null or p_mileage < 0 then
    raise exception 'Mileage must be zero or more' using errcode = 'check_violation';
  end if;

  select v.current_mileage into v_current
  from public.vehicles v where v.id = p_vehicle_id;

  if v_current is null then
    raise exception 'Vehicle % not found', p_vehicle_id using errcode = 'no_data_found';
  end if;

  select * into v_head from public.odometer_head(p_vehicle_id);

  v_floor := coalesce(v_head.km, v_current);

  -- A reading below the floor is a typo or clocking. Rejected rather than
  -- accepted-and-hidden: an odometer that appears to go backwards on a resale
  -- report destroys the report's credibility, and silently dropping the value
  -- leaves the owner believing it saved.
  --
  -- Backdated readings stay a legitimate exception — recording that the car
  -- was at 40,000 km two years ago is normal when filling in history. Such a
  -- reading goes to the timeline, where it is history, and the series refuses
  -- it on its own terms, where it would break the one invariant it has.
  if p_mileage < v_floor and p_occurred_at > now() - interval '1 day' then
    raise exception 'Mileage % is lower than this car''s last reading of % km', p_mileage, v_floor
      using errcode = 'check_violation',
            hint = 'Check the reading, or date it if it is an older one. A car whose '
                   'instrument cluster was replaced needs its series restarted by '
                   'support — see docs/runbooks/odometer-cluster-replacement.md.';
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

comment on function public.record_mileage(uuid, int, timestamptz) is
  'Records one odometer reading, through the timeline, which feeds the series '
  '(ADR-0022). Rejects a reading below the head unless it is explicitly backdated; '
  'a replaced cluster is a support operation (0064), never a client one.';

grant execute on function public.record_mileage(uuid, int, timestamptz) to authenticated;
