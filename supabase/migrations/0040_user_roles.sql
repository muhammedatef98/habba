-- 0040 — Roles become a join table
--
-- Amendment A (CLAUDE.md §5.1.2): `profiles.role` — one enum column, one role,
-- self-declared at signup — is replaced by
--
--   user_roles(user_id, role, granted_at, revoked_at, granted_by)
--
-- Three things were wrong with the column that this fixes:
--
--   1. It could hold only one role. A technician who also owns a car is the
--      normal case, not an edge case, and one app now serves both (§5.1.1).
--   2. It carried no history. Who granted this, when, and when was it taken
--      away are exactly the questions asked after a fraud incident, and the
--      column answered none of them. §2.6 requires every mutation to be
--      auditable; a role is the most sensitive mutation in the system.
--   3. It was set at signup. §5.1.1: everyone is a customer, and `provider`
--      is a consequence of an approved KYC record — never a thing a user picks
--      from a menu.
--
-- Revocation is a timestamp, never a DELETE. `granted_at` is part of the
-- primary key so a re-grant after revocation is a new row rather than an
-- overwrite of the history.

-- ---------------------------------------------------------------------------
-- The table
-- ---------------------------------------------------------------------------
create table public.user_roles (
  user_id     uuid not null references public.profiles(id) on delete cascade,
  role        public.user_role not null,
  -- clock_timestamp(), not now(): now() is the transaction start time, so a
  -- revoke-then-regrant inside one transaction would produce two grants with
  -- an identical primary key and the second would silently vanish. The same
  -- trap the timeline hit with recorded_at (ADR-0004).
  granted_at  timestamptz not null default clock_timestamp(),
  revoked_at  timestamptz,
  -- null = granted by the system (the customer role on signup, the provider
  -- role on approval). A uuid means a person did it, and who.
  granted_by  uuid references public.profiles(id),

  primary key (user_id, role, granted_at),
  constraint user_roles_revoked_after_grant check (revoked_at is null or revoked_at >= granted_at)
);

-- A role is HELD when a live row exists. At most one live grant per role, so
-- "held" is never ambiguous and a double-grant fails loudly instead of
-- silently doubling.
create unique index user_roles_live_uniq
  on public.user_roles (user_id, role) where revoked_at is null;

create index user_roles_live_idx on public.user_roles (user_id) where revoked_at is null;

comment on table public.user_roles is
  'Held roles. A role is live when revoked_at is null. Never client-writable — '
  'see grant_user_role()/revoke_user_role() and the guard trigger below.';


-- ---------------------------------------------------------------------------
-- Backfill, before anything starts reading the new shape
-- ---------------------------------------------------------------------------
insert into public.user_roles (user_id, role, granted_at)
select p.id, p.role, p.created_at from public.profiles p;


-- ---------------------------------------------------------------------------
-- Reading a role
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER for the same reason is_ops() was: a policy on user_roles
-- that had to read user_roles would recurse.
create or replace function public.has_role(p_user uuid, p_role public.user_role)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_roles r
    where r.user_id = p_user and r.role = p_role and r.revoked_at is null
  );
$$;

comment on function public.has_role(uuid, public.user_role) is
  'The only sanctioned role check. Never reads a client-supplied claim.';

-- is_ops() keeps its name and meaning; only its source of truth moves.
create or replace function public.is_ops()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_roles r
    where r.user_id = auth.uid()
      and r.role in ('ops', 'super_admin')
      and r.revoked_at is null
  );
$$;

-- «مقدّم خدمة» in the product sense: an individual technician or a workshop
-- admin. Both map onto the provider route group in the app (§5.1.4).
create or replace function public.is_provider(p_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_roles r
    where r.user_id = p_user
      and r.role in ('technician', 'workshop_admin')
      and r.revoked_at is null
  );
$$;


-- ---------------------------------------------------------------------------
-- Writing a role — never from a client
-- ---------------------------------------------------------------------------
-- §5.1.3. A user granting themselves 'technician' would unlock the provider
-- surface; 'ops' would unlock everything. Both are blocked three ways, the
-- same three layers that hold the timeline (ADR-0003): no write policy, no
-- grants, and a trigger that fires even for service_role.
create or replace function public.guard_user_roles()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.is_privileged_write() then
    return coalesce(new, old);
  end if;

  raise exception 'Roles are granted by Habba, not requested'
    using errcode = 'insufficient_privilege',
          hint = 'Apply from the profile screen; approval grants the role.';
end;
$$;

-- ENABLE ALWAYS: RLS does not apply to service_role, so a leaked service key
-- would otherwise walk straight through the "no policy" layer.
create trigger user_roles_guard_writes
  before insert or update or delete on public.user_roles
  for each row execute function public.guard_user_roles();
alter table public.user_roles enable always trigger user_roles_guard_writes;

create or replace function public.grant_user_role(
  p_user uuid,
  p_role public.user_role,
  p_granted_by uuid default auth.uid()
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.begin_privileged_write();

  insert into public.user_roles (user_id, role, granted_by)
  values (p_user, p_role, p_granted_by)
  on conflict do nothing;   -- already held; granting twice is a no-op, not an error

  perform public.end_privileged_write();
end;
$$;

create or replace function public.revoke_user_role(p_user uuid, p_role public.user_role)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.begin_privileged_write();

  update public.user_roles
  set revoked_at = clock_timestamp()
  where user_id = p_user and role = p_role and revoked_at is null;

  perform public.end_privileged_write();
end;
$$;

-- These are the server-side path, not a client API. The ops console calls them
-- with the service key; a signed-in user must never be able to.
revoke all on function public.grant_user_role(uuid, public.user_role, uuid) from public, anon, authenticated;
revoke all on function public.revoke_user_role(uuid, public.user_role) from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- Everyone signs up as a customer (§5.1.1)
-- ---------------------------------------------------------------------------
-- In the database, so it is true of every profile however it was created —
-- app, ops console, seed script or migration. Signup asks no role question,
-- and there is no code path where it could.
create or replace function public.grant_customer_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.grant_user_role(new.id, 'customer', null);
  return new;
end;
$$;

create trigger profiles_grant_customer_role
  after insert on public.profiles
  for each row execute function public.grant_customer_role();
alter table public.profiles enable always trigger profiles_grant_customer_role;


-- ---------------------------------------------------------------------------
-- Approval — and only approval — grants the provider role (§5.1.1)
-- ---------------------------------------------------------------------------
-- The role and the KYC record cannot disagree, because one is derived from the
-- other in the same transaction. Suspension or rejection revokes it with no
-- client action and no token refresh: the next request simply fails the policy.
create or replace function public.sync_provider_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.user_role :=
    case new.provider_type when 'workshop' then 'workshop_admin' else 'technician' end;
begin
  if new.verification_status = 'approved' then
    perform public.grant_user_role(new.owner_profile_id, v_role, null);
  else
    perform public.revoke_user_role(new.owner_profile_id, v_role);
  end if;

  return new;
end;
$$;

create trigger providers_sync_role
  after insert or update of verification_status, provider_type on public.providers
  for each row execute function public.sync_provider_role();
alter table public.providers enable always trigger providers_sync_role;

-- Backfill for providers approved before this migration existed.
do $$
declare r record;
begin
  for r in
    select owner_profile_id, provider_type from public.providers
    where verification_status = 'approved'
  loop
    perform public.grant_user_role(
      r.owner_profile_id,
      case r.provider_type when 'workshop' then 'workshop_admin' else 'technician' end,
      null);
  end loop;
end $$;


-- ---------------------------------------------------------------------------
-- A provider record only counts once it is approved
-- ---------------------------------------------------------------------------
-- current_provider_id() previously matched any providers row for the caller,
-- so a self-registered `pending` applicant already held provider-side RLS
-- access — the open-order feed, live locations, earnings — before anyone had
-- looked at their ID. Amendment A6 states the rule plainly: only `approved`
-- grants anything.
create or replace function public.current_provider_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id from public.providers p
  where p.owner_profile_id = auth.uid()
    and p.verification_status = 'approved';
$$;


-- ---------------------------------------------------------------------------
-- RLS: own rows readable, nothing writable
-- ---------------------------------------------------------------------------
alter table public.user_roles enable row level security;

create policy user_roles_read_own on public.user_roles
  for select to authenticated
  using (user_id = auth.uid() or public.is_ops());

-- Deliberately no insert/update/delete policy. Default deny means the absence
-- of a policy is the refusal (§2.3).
grant select on public.user_roles to authenticated;
revoke insert, update, delete on public.user_roles from anon, authenticated;


-- ---------------------------------------------------------------------------
-- Re-point everything that read profiles.role
-- ---------------------------------------------------------------------------
-- The column guard loses its role clause: there is no longer a role column on
-- profiles to protect. The protection moved to user_roles, where it is
-- stronger — that table has no write policy at all, whereas profiles must stay
-- self-updatable for names and locales.
create or replace function public.guard_profile_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Still deliberately does NOT exempt is_ops() — see 0036. The reasoning
  -- survives the move: is_ops() now reads user_roles, and if a user could
  -- reach that table this guard would be circular again.
  if public.is_privileged_write() then
    return new;
  end if;

  if new.id is distinct from old.id
     or new.created_at is distinct from old.created_at then
    raise exception 'Profile identity cannot be changed'
      using errcode = 'insufficient_privilege';
  end if;

  if new.phone_verified is distinct from old.phone_verified then
    raise exception 'Phone verification cannot be set directly'
      using errcode = 'insufficient_privilege',
            hint = 'Verify the number by SMS.';
  end if;

  if new.email_verified is distinct from old.email_verified then
    raise exception 'Email verification cannot be set directly'
      using errcode = 'insufficient_privilege',
            hint = 'Verify the address by email.';
  end if;

  if new.phone is distinct from old.phone then
    new.phone_verified := false;
  end if;

  if new.email is distinct from old.email then
    new.email_verified := false;
  end if;

  if new.is_guest and not old.is_guest then
    raise exception 'An account cannot be turned back into a guest'
      using errcode = 'insufficient_privilege';
  end if;

  if old.is_guest and not new.is_guest
     and new.phone is null and new.email is null then
    raise exception 'Add a phone number or an email address to keep this account'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

-- The timeline write path asked profiles for the actor's role. It now asks
-- is_ops(), which is the question it was actually asking.
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
  v_actor       uuid := auth.uid();
  v_owner_id    uuid;
  v_prev_hash   text;
  v_id          uuid := gen_random_uuid();
  v_provenance  public.timeline_provenance;
  v_payload     text;
  v_row_hash    text;
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


-- ---------------------------------------------------------------------------
-- The column goes
-- ---------------------------------------------------------------------------
-- Forward-only (§4): the column is dropped rather than left behind as a
-- second source of truth. Two places to read a role is how they drift, and a
-- stale `profiles.role = 'ops'` left readable would be a live claim.
drop index if exists public.profiles_role_idx;
alter table public.profiles drop column role;
