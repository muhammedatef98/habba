-- 0064 — audit_log: who did that, and what did it use to say
--
-- Build prompt §6.10, and Amendment B (CLAUDE.md §5.1.6): "Every admin action
-- writes an immutable audit row." Until now none did. `apps/admin` performs
-- the single most consequential action in the system — approving a provider,
-- which grants the `technician` role and makes that person dispatchable to a
-- stranger's car at night — and the only record of it was domain history.
--
-- That history is not this. `provider_verification_events` (0052) answers
-- "what happened to this provider", and a provider may read their own so a
-- rejection can be appealed. `audit_log` answers "what did this operator do",
-- is readable by ops alone, and carries the row state either side of the
-- action. The two overlap on one action today and will not for long: a refund,
-- a payout run and a role grant each have an operator to hold answerable and
-- no domain history table of their own.
--
-- Immutable the way the timeline is (ADR-0003): a trigger that raises rather
-- than a rule that silently discards, ENABLE ALWAYS so it binds `service_role`
-- too, no write policy at all, and no write grant. An audit trail that its
-- subject can edit is not one.

create table public.audit_log (
  id           uuid primary key default gen_random_uuid(),
  -- Not null, per §6.10. Every writer today is a human operator acting under
  -- their own JWT; a future system process with no `auth.uid()` will need a
  -- decision made about it rather than a null slipped in here.
  actor_id     uuid not null references public.profiles(id) on delete restrict,
  -- Dotted and past-tense-free: 'provider.approve', 'order.refund',
  -- 'role.grant'. Text rather than an enum so a new admin action is a new
  -- string, not a migration that must land before the feature it audits.
  action       text not null,
  target_table text not null,
  target_id    uuid,
  before       jsonb,
  after        jsonb,
  /**
   * What the edge said the request came from.
   *
   * EVIDENCE, NEVER PROOF, and nothing may decide anything from it. It is read
   * from `x-forwarded-for`, which is a client-supplied header: anyone can put
   * any address at the front of it. The authoritative fact on this row is
   * `actor_id`, which came from a signed JWT.
   *
   * Hardening it means knowing how many proxies in front of the database are
   * trusted, and that is a property of a hosted project that does not exist
   * yet (ADR-0010). Deferred with a reason rather than forgotten.
   */
  ip           inet,
  at           timestamptz not null default now()
);

create index audit_log_actor_idx on public.audit_log (actor_id, at desc);
create index audit_log_target_idx on public.audit_log (target_table, target_id, at desc);
-- Not in §6.10, and it is the index an incident actually starts from: "what
-- happened in the last hour", before anyone knows which actor or target to ask
-- about.
create index audit_log_at_idx on public.audit_log (at desc);

comment on table public.audit_log is
  'Every action taken in apps/admin. Append-only, ops-readable, never on the mobile app''s path. §6.10.';


-- ---------------------------------------------------------------------------
-- Append-only, the same three ways the timeline is
-- ---------------------------------------------------------------------------
create or replace function public.audit_log_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_log is append-only (attempted % on row %)',
    tg_op, coalesce(old.id::text, '?')
    using errcode = 'restrict_violation',
          hint = 'A correction is a new row describing the correction.';
end;
$$;

create trigger audit_log_no_update_delete
  before update or delete on public.audit_log
  for each row execute function public.audit_log_immutable();

-- ENABLE ALWAYS: RLS never applies to `service_role`, and the admin console is
-- the one app that holds a service-role key. The single actor most able to
-- quietly rewrite this table is therefore the one RLS cannot reach.
alter table public.audit_log enable always trigger audit_log_no_update_delete;

alter table public.audit_log enable row level security;

-- Readable by ops and super_admin, and by nobody else — §6.10. There is
-- deliberately no policy letting a subject read rows about themselves: this is
-- a record of what OPERATORS did, and the appeal surface is
-- `provider_verification_events`, which is scoped for exactly that.
create policy audit_log_read on public.audit_log
  for select to authenticated using (public.is_ops());

-- ⚠️ No insert policy, and the grant is revoked outright. The only writer is
-- `record_audit()` below, which runs as owner inside another SECURITY DEFINER
-- function. A client that could insert here could manufacture a record of an
-- action nobody took, which is worse than having no log.
revoke all on public.audit_log from anon, authenticated;
grant select on public.audit_log to authenticated;


-- ---------------------------------------------------------------------------
-- The client address, as far as it can honestly be known
-- ---------------------------------------------------------------------------
/**
 * The first address in `x-forwarded-for`, or null.
 *
 * Leftmost by convention — every operations tool means "the client" by it —
 * and therefore the most forgeable element of a forgeable header. See the
 * column comment: this is context for a human reading the log, not an input
 * to any decision.
 *
 * Null rather than an exception for everything that can go wrong: no headers
 * GUC (a direct psql session, a trigger during replay), no such header, a
 * value that is not an address. An audit row that failed to write because a
 * header was malformed would mean the action went unrecorded, which is the one
 * outcome this table exists to prevent.
 */
create or replace function public.request_client_ip()
returns inet
language plpgsql
stable
parallel safe
set search_path = ''
as $$
declare
  v_headers text := current_setting('request.headers', true);
  v_raw     text;
begin
  if v_headers is null or v_headers = '' then
    return null;
  end if;

  v_raw := trim(split_part(v_headers::jsonb ->> 'x-forwarded-for', ',', 1));

  if v_raw is null or v_raw = '' then
    return null;
  end if;

  return v_raw::inet;
exception
  when others then
    return null;
end;
$$;


-- ---------------------------------------------------------------------------
-- record_audit
-- ---------------------------------------------------------------------------
/**
 * Writes one audit row. The ONLY way a row gets into this table.
 *
 * Not callable by any client role — see the revoke below. It is reachable only
 * from inside a SECURITY DEFINER function, which runs as the owner, and the
 * owner holds EXECUTE implicitly. That is what stops an operator (or anyone
 * holding a token) writing a plausible record of an action they never took.
 *
 * `before` and `after` are CURATED by the caller, never `to_jsonb(row)`. The
 * temptation is to snapshot the whole row; on `providers` that would copy
 * `national_id_encrypted` and `iban_encrypted` into a table every ops user can
 * read, undoing 0037 through the back door. The caller names the columns that
 * the action actually changed.
 */
create or replace function public.record_audit(
  p_action       text,
  p_target_table text,
  p_target_id    uuid default null,
  p_before       jsonb default null,
  p_after        jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_id    uuid;
begin
  if v_actor is null then
    raise exception 'An audited action needs an actor'
      using errcode = 'insufficient_privilege',
            hint = 'audit_log.actor_id is not null by design (§6.10).';
  end if;

  if p_action is null or length(trim(p_action)) = 0
     or p_target_table is null or length(trim(p_target_table)) = 0 then
    raise exception 'An audit row needs an action and a target table'
      using errcode = 'check_violation';
  end if;

  insert into public.audit_log (actor_id, action, target_table, target_id, before, after, ip)
  values (v_actor, trim(p_action), trim(p_target_table), p_target_id, p_before, p_after,
          public.request_client_ip())
  returning id into v_id;

  return v_id;
end;
$$;

-- ⚠️ `from public` alone would be a silent no-op here.
--
-- 0001 sets `alter default privileges in schema public grant all on functions
-- to anon, authenticated, service_role`, so every function created since has
-- arrived with a DIRECT grant to all three roles. Revoking from PUBLIC removes
-- a grant that was never the one doing the work — the same shape as the
-- column-level REVOKE that is a no-op against a table-level grant (HANDOFF §6),
-- one layer over. The roles have to be named.
--
-- `service_role` included: it is the key the admin console holds, and a console
-- able to call `record_audit` directly could write a record of an action
-- nobody took. The only intended caller is another SECURITY DEFINER function,
-- which runs as owner and needs no grant at all.
revoke execute on function public.record_audit(text, text, uuid, jsonb, jsonb)
  from public, anon, authenticated, service_role;
revoke execute on function public.request_client_ip()
  from public, anon, authenticated, service_role;


-- ---------------------------------------------------------------------------
-- The one admin action there is today
-- ---------------------------------------------------------------------------
-- Replaced wholesale rather than patched, because a forward-only migration
-- that edits a function body by hand is a function nobody can read the history
-- of. The body below is 0052's with the audit call added, and the two
-- `is_online` writes folded into the same curated `after`.
create or replace function public.set_provider_verification(
  p_provider_id uuid,
  p_status      public.verification_status,
  p_note        text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor       uuid := (select auth.uid());
  v_from        public.verification_status;
  v_was_online  boolean;
  v_now_online  boolean;
begin
  if not public.is_ops() then
    raise exception 'Only ops may set verification status'
      using errcode = 'insufficient_privilege';
  end if;

  select verification_status, is_online into v_from, v_was_online
    from public.providers where id = p_provider_id;

  if v_from is null then
    raise exception 'Provider % not found', p_provider_id using errcode = 'no_data_found';
  end if;

  if v_from = p_status then
    -- Not an error, but not an event either: re-confirming a decision that was
    -- already made would pad the history with entries that record nothing.
    -- It writes no audit row for the same reason — nothing changed, and a log
    -- full of no-ops is a log nobody reads.
    return;
  end if;

  if p_status in ('rejected', 'suspended')
     and (p_note is null or length(trim(p_note)) = 0) then
    raise exception 'A rejection or suspension needs a stated reason'
      using errcode = 'check_violation',
            hint = 'The provider is told this, and may appeal against it.';
  end if;

  perform public.begin_privileged_write();

  update public.providers
     set verification_status = p_status
   where id = p_provider_id;

  insert into public.provider_verification_events
    (provider_id, from_status, to_status, actor_id, note)
  values (p_provider_id, v_from, p_status, v_actor, nullif(trim(coalesce(p_note, '')), ''));

  perform public.end_privileged_write();

  -- A suspended or rejected provider must not stay online holding a queue
  -- position. Left online they would keep receiving offers they can no longer
  -- accept, and every one of those is a customer waiting on nobody.
  v_now_online := v_was_online;
  if p_status in ('rejected', 'suspended') then
    perform public.begin_privileged_write();
    update public.providers set is_online = false where id = p_provider_id;
    delete from public.provider_locations where provider_id = p_provider_id;
    perform public.end_privileged_write();
    v_now_online := false;
  end if;

  -- Audited last, once every write has succeeded. An audit row for an action
  -- that then rolled back would be a record of something that did not happen;
  -- this is one transaction, so a failure above takes this row with it.
  --
  -- The action name says what was decided rather than that a column moved:
  -- 'provider.approve' is what an operator would search for at 2am, and
  -- 'provider.update' is what nobody would.
  perform public.record_audit(
    p_action       => 'provider.' || p_status::text,
    p_target_table => 'providers',
    p_target_id    => p_provider_id,
    -- Curated, never the whole row: `providers` carries the encrypted KYC
    -- columns 0037 revoked, and audit_log is readable by every ops user.
    p_before       => jsonb_build_object(
                        'verification_status', v_from::text,
                        'is_online', v_was_online
                      ),
    p_after        => jsonb_strip_nulls(jsonb_build_object(
                        'verification_status', p_status::text,
                        'is_online', v_now_online,
                        'note', nullif(trim(coalesce(p_note, '')), '')
                      ))
  );
end;
$$;

revoke execute on function public.set_provider_verification(uuid, public.verification_status, text) from public;
grant execute on function public.set_provider_verification(uuid, public.verification_status, text) to authenticated;
