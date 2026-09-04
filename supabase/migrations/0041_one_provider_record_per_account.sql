-- 0041 — One provider record per account, and a role that follows the account
--
-- Found by tests/rls.spec.ts, not by reading the schema: re-running the suite
-- produced a user with several `providers` rows, and the second insert REVOKED
-- the technician role the first one had earned.
--
-- Two separate defects, both created by 0018/0040 assuming what nothing
-- enforced:
--
--   1. `providers` had no uniqueness on owner_profile_id. Nothing stopped a
--      user from holding several provider records — which makes
--      `current_provider_id()` ambiguous (it silently returns whichever row
--      sorts first), makes "your application status" a question with several
--      answers, and gives a rejected applicant an obvious workaround: apply
--      again and again.
--
--   2. `sync_provider_role()` reasoned about the ROW being written rather than
--      about the ACCOUNT. Inserting any non-approved row revoked the role,
--      even when a different, approved record still existed. A suspended-then-
--      reinstated provider, or an approved technician who applied to register
--      a workshop, would have lost access with no action against them.
--
-- The role is a fact about the person, so it is derived from all of their
-- records, not from the last one written.

-- ---------------------------------------------------------------------------
-- Collapse any duplicates, then forbid new ones
-- ---------------------------------------------------------------------------
-- Keeps the most meaningful record: approved beats in_review beats pending,
-- and the earliest wins a tie, so a user never loses a verified record to a
-- later throwaway one.
with ranked as (
  select id,
         row_number() over (
           partition by owner_profile_id
           order by
             case verification_status
               when 'approved'  then 0
               when 'suspended' then 1
               when 'in_review' then 2
               when 'pending'   then 3
               else 4
             end,
             created_at
         ) as rank
  from public.providers
)
delete from public.providers p
using ranked r
where p.id = r.id and r.rank > 1;

create unique index providers_one_per_owner on public.providers (owner_profile_id);

comment on index public.providers_one_per_owner is
  'One provider record per account (§5.1.1): becoming a provider is an upgrade '
  'of the account you already have, not a second identity.';


-- ---------------------------------------------------------------------------
-- The role reflects the account, not the row
-- ---------------------------------------------------------------------------
create or replace function public.sync_provider_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid := new.owner_profile_id;
begin
  -- Ask the question about the person: do they hold an approved record of
  -- this kind? Both role grants are recomputed, so changing provider_type
  -- moves the role rather than leaving a stale one behind.
  if exists (
    select 1 from public.providers p
    where p.owner_profile_id = v_owner
      and p.verification_status = 'approved'
      and p.provider_type = 'individual'
  ) then
    perform public.grant_user_role(v_owner, 'technician', null);
  else
    perform public.revoke_user_role(v_owner, 'technician');
  end if;

  if exists (
    select 1 from public.providers p
    where p.owner_profile_id = v_owner
      and p.verification_status = 'approved'
      and p.provider_type = 'workshop'
  ) then
    perform public.grant_user_role(v_owner, 'workshop_admin', null);
  else
    perform public.revoke_user_role(v_owner, 'workshop_admin');
  end if;

  return new;
end;
$$;


-- ---------------------------------------------------------------------------
-- current_provider_id() can no longer be ambiguous
-- ---------------------------------------------------------------------------
-- With the unique index in place this returns at most one row by construction.
-- Restated here so the guarantee is visible where the function is read, rather
-- than only in an index definition three files away.
comment on function public.current_provider_id() is
  'The caller''s APPROVED provider record, or null. At most one exists — see '
  'providers_one_per_owner (0041).';
