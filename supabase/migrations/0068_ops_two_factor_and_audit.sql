-- 0068 — The console: two factors, eight hours, and a record of every change
--
-- CLAUDE.md §5.1.6 makes three things non-negotiable for admin, and none of
-- them existed:
--
--   * "2FA is mandatory on admin accounts."
--   * "Sessions expire after 8 hours. There is no 'remember me'."
--   * "Every admin action writes an immutable audit row:
--      audit_log(actor_id, action, target_table, target_id, before, after, ip, at)."
--
-- The console's own comment says it right: the screen is not the boundary,
-- is_ops() is. So the first two are enforced there, in the one function 61
-- policies and functions already ask. A password alone — phished, reused,
-- leaked — no longer opens anything an operator can open. And a session is
-- good for eight hours from the second factor, not for as long as a refresh
-- token keeps renewing it: past that, is_ops() is false until the operator
-- verifies again.
--
-- Supabase puts both facts in the access token: `aal` ('aal1' password only,
-- 'aal2' after a second factor) and `amr`, the list of methods used with the
-- time each was used.


-- ---------------------------------------------------------------------------
-- Two factors, eight hours
-- ---------------------------------------------------------------------------
create or replace function public.ops_second_factor_at()
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select max(to_timestamp((m ->> 'timestamp')::double precision))
    from jsonb_array_elements(coalesce(auth.jwt() -> 'amr', '[]'::jsonb)) as m
   where m ->> 'method' in ('totp', 'phone', 'webauthn');
$$;

create or replace function public.ops_session_ok()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
     and coalesce(public.ops_second_factor_at() > now() - interval '8 hours', false);
$$;

comment on function public.ops_session_ok() is
  'A second factor was verified in this session, within the last eight hours. §5.1.6, 0068.';

create or replace function public.is_ops()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.ops_session_ok()
     and exists (
       select 1 from public.user_roles r
        where r.user_id = auth.uid()
          and r.role in ('ops', 'super_admin')
          and r.revoked_at is null
     );
$$;


-- What the console needs to decide which screen to show: is this person an
-- operator at all, and if so, do they still need to verify, or re-verify.
-- Says nothing is_ops() would not; grants nothing.
create or replace function public.ops_whoami()
returns table (
  role             text,
  aal              text,
  second_factor_at timestamptz,
  expires_at       timestamptz,
  session_ok       boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select case when bool_or(r.role = 'super_admin') then 'super_admin'
                 when bool_or(r.role = 'ops') then 'ops' end
       from public.user_roles r
      where r.user_id = auth.uid() and r.revoked_at is null
        and r.role in ('ops', 'super_admin')),
    coalesce(auth.jwt() ->> 'aal', 'aal1'),
    public.ops_second_factor_at(),
    public.ops_second_factor_at() + interval '8 hours',
    public.ops_session_ok();
$$;

revoke execute on function public.ops_whoami() from public, anon;
grant execute on function public.ops_whoami() to authenticated;


-- ---------------------------------------------------------------------------
-- audit_log
-- ---------------------------------------------------------------------------
create table public.audit_log (
  id           bigint generated always as identity primary key,
  -- Not a foreign key: the record has to outlive the account, and a row an
  -- operator's deletion could cascade away — or be blocked by — is not an
  -- audit trail.
  actor_id     uuid not null,
  action       text not null,        -- insert | update | delete
  target_table text not null,
  target_id    text not null,
  before       jsonb,
  after        jsonb,
  ip           inet,
  at           timestamptz not null default now()
);

create index audit_log_at_idx on public.audit_log (at desc);
create index audit_log_target_idx on public.audit_log (target_table, target_id, at desc);

alter table public.audit_log enable row level security;

-- Operators read the log — accountability is the point of it. Nobody writes it
-- except the trigger below; nobody changes it at all.
create policy audit_log_read_ops on public.audit_log
  for select to authenticated
  using (public.is_ops());

revoke all on public.audit_log from anon;
revoke insert, update, delete, truncate on public.audit_log from authenticated, service_role;
grant select on public.audit_log to authenticated;

-- Immutable the way the timeline is (ADR-0003): refused by a trigger as well as
-- by grants, so a role that later gains a grant still cannot rewrite history.
create or replace function public.reject_audit_log_change()
returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_log is append-only' using errcode = 'insufficient_privilege';
end;
$$;

create trigger audit_log_append_only
  before update or delete on public.audit_log
  for each row execute function public.reject_audit_log_change();

create trigger audit_log_no_truncate
  before truncate on public.audit_log
  for each statement execute function public.reject_audit_log_change();

alter table public.audit_log enable always trigger audit_log_append_only;
alter table public.audit_log enable always trigger audit_log_no_truncate;

comment on table public.audit_log is
  'Every change an operator makes: who, what, before, after, from where. Append-only. §5.1.6, 0068.';


-- The caller's address, as the gateway forwarded it. Best effort: absent or
-- malformed is recorded as null rather than failing the operator's action.
create or replace function public.request_ip()
returns inet
language plpgsql
stable
set search_path = ''
as $$
declare
  v_forwarded text;
begin
  v_forwarded := nullif(current_setting('request.headers', true), '')::json ->> 'x-forwarded-for';
  return nullif(trim(split_part(coalesce(v_forwarded, ''), ',', 1)), '')::inet;
exception when others then
  return null;
end;
$$;

-- Ciphertext of national IDs and IBANs never enters the log: 0037 keeps those
-- columns from operators, and a log they can read must not hand them back.
create or replace function public.audit_redact(p_row jsonb)
returns jsonb
language sql
immutable
as $$
  select coalesce(jsonb_object_agg(k, v), '{}'::jsonb)
    from jsonb_each(p_row) as e(k, v)
   where k not like '%\_encrypted';
$$;


-- ---------------------------------------------------------------------------
-- Every change an operator makes, recorded where it happens
-- ---------------------------------------------------------------------------
-- A trigger on each table an operator can change, rather than a call in each
-- ops function: it covers the RPCs and the direct table writes alike, and a
-- new ops function written next year is audited without anyone remembering to.
create or replace function public.audit_ops_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before jsonb := case when tg_op <> 'INSERT' then public.audit_redact(to_jsonb(old)) end;
  v_after  jsonb := case when tg_op <> 'DELETE' then public.audit_redact(to_jsonb(new)) end;
begin
  if not public.is_ops() then
    return null;
  end if;

  if tg_op = 'UPDATE' and v_before = v_after then
    return null;
  end if;

  insert into public.audit_log (actor_id, action, target_table, target_id, before, after, ip)
  values (
    auth.uid(),
    lower(tg_op),
    tg_table_name,
    coalesce(v_after ->> 'id', v_before ->> 'id', ''),
    v_before,
    v_after,
    public.request_ip()
  );

  return null;
end;
$$;

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'cities', 'commission_rates', 'inspection_templates', 'invoice_sellers',
    'maintenance_item_types', 'maintenance_rules', 'orders', 'payouts', 'providers',
    'services', 'vehicle_makes', 'vehicle_models', 'vehicle_timeline', 'user_roles'
  ] loop
    execute format(
      'create trigger %I after insert or update or delete on public.%I
         for each row execute function public.audit_ops_change()',
      v_table || '_z_audit_ops', v_table);
  end loop;
end
$$;
