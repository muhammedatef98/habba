-- 0052 — Provider verification, as a decision with a record
--
-- `verification_status` gates everything: `match_providers` will not consider a
-- provider who is not `approved`, and 0034 already stops a provider setting it
-- themselves. But an ops user could change it with a bare UPDATE, and nothing
-- recorded who decided, when, or why.
--
-- That is not acceptable for a KYC decision. Approving a provider is the moment
-- Habba vouches for someone who will be sent to a stranger's car at night; a
-- rejection is a livelihood refused. Both need to be answerable later, and
-- "the row says approved" answers nothing.

create table public.provider_verification_events (
  id           uuid primary key default gen_random_uuid(),
  provider_id  uuid not null references public.providers(id) on delete cascade,
  from_status  public.verification_status,
  to_status    public.verification_status not null,
  -- Nullable because the actor may be a system process; never nullable in
  -- practice for a human decision, which is what the function below enforces.
  actor_id     uuid references public.profiles(id) on delete set null,
  note         text,
  created_at   timestamptz not null default now()
);

create index provider_verification_events_provider_idx
  on public.provider_verification_events (provider_id, created_at desc);

comment on table public.provider_verification_events is
  'Append-only record of every verification decision. Who vouched for whom, and when.';

alter table public.provider_verification_events enable row level security;

-- Ops read the history to make the next decision. A provider reads their own,
-- because being told "rejected" without being told when or why is how an
-- appeals process becomes a support queue.
create policy provider_verification_events_read on public.provider_verification_events
  for select to authenticated
  using (
    public.is_ops()
    or exists (
      select 1 from public.providers pr
      where pr.id = provider_verification_events.provider_id
        and pr.owner_profile_id = (select auth.uid())
    )
  );

-- ⚠️ No insert, update or delete policy for anyone. The only writer is the
-- function below, and the record is append-only by omission — an audit trail
-- that can be edited is not one.
revoke all on public.provider_verification_events from anon, authenticated;
grant select on public.provider_verification_events to authenticated;


/**
 * Records a verification decision and applies it.
 *
 * Both halves in one transaction, because the whole point is that the status
 * and the reason for it cannot drift apart.
 *
 * A rejection or suspension requires a note. An approval does not — "this
 * paperwork was in order" is the default expectation — but taking someone's
 * livelihood away needs a stated reason, and requiring it at the point of
 * decision is the only time it will actually be written down.
 */
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
  v_actor uuid := (select auth.uid());
  v_from  public.verification_status;
begin
  if not public.is_ops() then
    raise exception 'Only ops may set verification status'
      using errcode = 'insufficient_privilege';
  end if;

  select verification_status into v_from
    from public.providers where id = p_provider_id;

  if v_from is null then
    raise exception 'Provider % not found', p_provider_id using errcode = 'no_data_found';
  end if;

  if v_from = p_status then
    -- Not an error, but not an event either: re-confirming a decision that was
    -- already made would pad the history with entries that record nothing.
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
  if p_status in ('rejected', 'suspended') then
    perform public.begin_privileged_write();
    update public.providers set is_online = false where id = p_provider_id;
    delete from public.provider_locations where provider_id = p_provider_id;
    perform public.end_privileged_write();
  end if;
end;
$$;

revoke execute on function public.set_provider_verification(uuid, public.verification_status, text) from public;
grant execute on function public.set_provider_verification(uuid, public.verification_status, text) to authenticated;
