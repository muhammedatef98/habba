-- 0070 — audit_log: every ops action, with what it changed
--
-- Build prompt §6.10 and Amendment B (CLAUDE.md §5.1.6) both require it:
--
--     Every admin action writes an immutable audit row:
--     audit_log(actor_id, action, target_table, target_id, before, after, ip, at)
--
-- It was specified in Phase 1 and never migrated. `provider_verification_events`
-- (0052) records the one ops decision that grants a role, and nothing records
-- the rest — an operator editing a service price, cancelling somebody's order,
-- approving a payout or changing a commission rate leaves no trace at all.
--
-- ⚠️ What makes this worth having is that it is NOT opt-in.
--
-- An audit that each ops action has to remember to write is an audit with holes
-- exactly where somebody was in a hurry. This is a trigger on the tables ops can
-- write, so the row appears whether or not the person changing the data thought
-- about it — the same argument as `vehicle_timeline` being append-only by
-- trigger rather than by convention (§2.4).
--
-- The rows are append-only for the same reason the timeline is: an audit log
-- that its subject can edit is not evidence of anything.


create table public.audit_log (
  id           bigint generated always as identity primary key,

  -- Nullable: a system process (the dispatch tick, the maintenance cron) has no
  -- `auth.uid()`. Never null for a human action — `actor_is_human` below is how
  -- you tell the two apart when reading.
  actor_id     uuid references public.profiles(id) on delete set null,
  actor_role   public.user_role,

  action       text not null,
  target_table text not null,
  target_id    text,

  -- The changed columns only, not the whole row.
  --
  -- A full before/after of `providers` would copy `national_id_encrypted` and
  -- `iban_encrypted` into a table with different access rules on every edit —
  -- an audit log that quietly becomes a second, less guarded copy of the KYC
  -- vault. `changed_columns` records what moved; the values are there for the
  -- columns that actually changed, and 0037's column revokes still apply to the
  -- table the audit is about.
  changed_columns text[],
  before       jsonb,
  after        jsonb,

  ip           inet,
  at           timestamptz not null default now()
);

create index audit_log_target_idx on public.audit_log (target_table, target_id, at desc);
create index audit_log_actor_idx  on public.audit_log (actor_id, at desc);
create index audit_log_at_idx     on public.audit_log (at desc);

comment on table public.audit_log is
  'Immutable record of every ops write (Amendment B §5.1.6). Append-only: no update or delete policy exists, and the grants below revoke both.';

alter table public.audit_log enable row level security;

-- Ops reads it. Nobody else, including the subject of the row: a provider who
-- could read their own audit trail could enumerate which operator reviewed them
-- and when, which is a route to pressuring a named person.
create policy audit_log_read_ops on public.audit_log
  for select to authenticated using (public.is_ops());

-- ⚠️ No insert, update or delete policy for anyone, deliberately. Writes happen
-- only through the definer trigger below. The revokes are belt and braces: RLS
-- already denies by default, and 0001's default privileges granted table-level
-- rights that a policy-less table does not expose — but an audit log is the one
-- table where "denied twice" is worth the two lines.
revoke insert, update, delete on public.audit_log from anon, authenticated;


/**
 * The client IP, when the platform tells us.
 *
 * PostgREST forwards the request headers in a GUC. Absent for a direct `psql`
 * connection and for anything the database does to itself, which is correct —
 * a null IP means "not an HTTP request", not "unknown".
 *
 * ⚠️ `x-forwarded-for` is a chain; the first entry is the client as the edge saw
 * it. It is attacker-controllable in general, so this is recorded as evidence
 * of what was claimed, never used to authorise anything.
 */
create or replace function public.request_ip()
returns inet
language plpgsql
stable
as $$
declare
  v_raw text;
begin
  v_raw := current_setting('request.headers', true);
  if v_raw is null or v_raw = '' then return null; end if;

  v_raw := split_part(nullif(v_raw::json ->> 'x-forwarded-for', ''), ',', 1);
  if v_raw is null or v_raw = '' then return null; end if;

  return trim(v_raw)::inet;
exception when others then
  -- A malformed header must never fail the write it is describing.
  return null;
end;
$$;


/**
 * Records an ops write on whatever table it is attached to.
 *
 * Only fires for a human operator. A trigger that logged every system write
 * would bury the twelve rows a month that matter under the dispatch tick, and
 * the system's own actions are already recorded where they happen —
 * `order_events`, `vehicle_timeline`, `notification_outbox`.
 */
create or replace function public.audit_ops_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor   uuid := auth.uid();
  v_role    public.user_role;
  v_before  jsonb;
  v_after   jsonb;
  v_changed text[];
  v_target  text;
begin
  if v_actor is null then return coalesce(new, old); end if;

  -- ⚠️ `user_roles`, never `profiles.role`. Amendment A (§5.1.2) replaced that
  -- column and 0040 dropped it; reading it here failed every suite that has an
  -- ops actor. `apps/admin` was reading it too, which meant the console told
  -- every real operator they were not ops.
  select r.role into v_role
    from public.user_roles r
   where r.user_id = v_actor
     and r.revoked_at is null
     and r.role in ('ops', 'super_admin')
   order by (r.role = 'super_admin') desc
   limit 1;

  if v_role is null then return coalesce(new, old); end if;

  v_before := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  v_after  := case when tg_op = 'DELETE' then null else to_jsonb(new) end;

  if tg_op = 'UPDATE' then
    select array_agg(key order by key) into v_changed
      from jsonb_each(v_after)
     where v_before -> key is distinct from v_after -> key;

    -- An UPDATE that changed nothing is noise. Skipping it keeps the log
    -- readable, which is the only property that makes anyone consult it.
    if v_changed is null then return new; end if;

    -- Narrowed to what moved. See the `changed_columns` comment on the table:
    -- a full row copy would duplicate the KYC ciphertext into a second place on
    -- every edit.
    v_before := (select jsonb_object_agg(k, v_before -> k) from unnest(v_changed) k);
    v_after  := (select jsonb_object_agg(k, v_after  -> k) from unnest(v_changed) k);
  end if;

  v_target := coalesce(v_after ->> 'id', v_before ->> 'id',
                       to_jsonb(coalesce(new, old)) ->> 'id');

  insert into public.audit_log
    (actor_id, actor_role, action, target_table, target_id,
     changed_columns, before, after, ip)
  values
    (v_actor, v_role, lower(tg_op), tg_table_name, v_target,
     v_changed, v_before, v_after, public.request_ip());

  return coalesce(new, old);
end;
$$;


-- Attached to every table an operator can write ---------------------------------
--
-- The list is the one `16_write_surface_audit.sql` calls ops-writable, plus the
-- tables where ops can intervene in somebody's live order. Suite 42 asserts the
-- two stay in step, so a new ops-writable table cannot appear unaudited.

create trigger providers_audit          after insert or update or delete on public.providers          for each row execute function public.audit_ops_write();
create trigger orders_audit             after update or delete             on public.orders             for each row execute function public.audit_ops_write();
create trigger profiles_audit           after update or delete             on public.profiles           for each row execute function public.audit_ops_write();
create trigger user_roles_audit         after insert or update or delete on public.user_roles         for each row execute function public.audit_ops_write();
create trigger payouts_audit            after insert or update or delete on public.payouts            for each row execute function public.audit_ops_write();
create trigger commission_rates_audit   after insert or update or delete on public.commission_rates   for each row execute function public.audit_ops_write();
create trigger services_audit           after insert or update or delete on public.services           for each row execute function public.audit_ops_write();
create trigger cities_audit             after insert or update or delete on public.cities             for each row execute function public.audit_ops_write();
create trigger maintenance_rules_audit  after insert or update or delete on public.maintenance_rules  for each row execute function public.audit_ops_write();
create trigger invoice_sellers_audit    after insert or update or delete on public.invoice_sellers    for each row execute function public.audit_ops_write();
create trigger vat_rates_audit          after insert or update or delete on public.vat_rates          for each row execute function public.audit_ops_write();
create trigger inspection_templates_audit after insert or update or delete on public.inspection_templates for each row execute function public.audit_ops_write();
-- ⚠️ These three were missed on the first pass and found by suite 42's standing
-- check, which is the entire argument for having it: a hand-written list of
-- audited tables is a list somebody forgets to add to.
create trigger vehicle_makes_audit         after insert or update or delete on public.vehicle_makes         for each row execute function public.audit_ops_write();
create trigger vehicle_models_audit        after insert or update or delete on public.vehicle_models        for each row execute function public.audit_ops_write();
create trigger maintenance_item_types_audit after insert or update or delete on public.maintenance_item_types for each row execute function public.audit_ops_write();

-- `enable always` throughout: an audit trigger that a session setting can
-- disable is an audit trigger that is off whenever it matters most. Note this
-- also means a privileged write is logged — `is_privileged_write()` is
-- deliberately NOT consulted in the function above.
alter table public.providers            enable always trigger providers_audit;
alter table public.orders               enable always trigger orders_audit;
alter table public.profiles             enable always trigger profiles_audit;
alter table public.user_roles           enable always trigger user_roles_audit;
alter table public.payouts              enable always trigger payouts_audit;
alter table public.commission_rates     enable always trigger commission_rates_audit;
alter table public.services             enable always trigger services_audit;
alter table public.cities               enable always trigger cities_audit;
alter table public.maintenance_rules    enable always trigger maintenance_rules_audit;
alter table public.invoice_sellers      enable always trigger invoice_sellers_audit;
alter table public.vat_rates            enable always trigger vat_rates_audit;
alter table public.inspection_templates enable always trigger inspection_templates_audit;
alter table public.vehicle_makes          enable always trigger vehicle_makes_audit;
alter table public.vehicle_models         enable always trigger vehicle_models_audit;
alter table public.maintenance_item_types enable always trigger maintenance_item_types_audit;


/**
 * An explicit entry for an action that is not a row write.
 *
 * Reading a customer's phone number during a dispute, exporting a report,
 * impersonating nothing but looking at everything — a trigger cannot see any of
 * those, and they are exactly what an operator would be asked about afterwards.
 */
create or replace function public.record_ops_action(
  p_action       text,
  p_target_table text,
  p_target_id    text default null,
  p_detail       jsonb default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_role  public.user_role;
begin
  if v_actor is null then
    raise exception 'Not authenticated' using errcode = 'insufficient_privilege';
  end if;

  select r.role into v_role
    from public.user_roles r
   where r.user_id = v_actor
     and r.revoked_at is null
     and r.role in ('ops', 'super_admin')
   order by (r.role = 'super_admin') desc
   limit 1;

  if v_role is null then
    raise exception 'Only ops may record an ops action'
      using errcode = 'insufficient_privilege';
  end if;

  insert into public.audit_log
    (actor_id, actor_role, action, target_table, target_id, after, ip)
  values
    (v_actor, v_role, p_action, p_target_table, p_target_id, p_detail, public.request_ip());
end;
$$;

-- ⚠️ Granted to `authenticated` ON PURPOSE, unlike the functions 0069 revoked.
--
-- An operator reaches PostgREST as `authenticated` like everyone else, so this
-- has to be callable by that role to be callable at all. What makes it safe is
-- the role check INSIDE it: a non-ops caller raises rather than writing. That is
-- the difference between this and `enqueue_notification` — that one had no
-- internal check and relied entirely on a grant that 0001 had already given
-- away. A function exposed to `authenticated` must carry its own guard; the
-- grant is never the guard.
--
-- Forging an entry against a named operator would be worse than having no log,
-- which is why the guard is a role lookup against `user_roles` and not a claim
-- in the caller's token.
grant execute on function public.record_ops_action(text, text, text, jsonb) to authenticated;
