-- 0043 — Role rows may be removed with the account they belong to
--
-- Found by CI, not by review: the slot-concurrency script cleans up after
-- itself with `delete from public.profiles where id in (...)`, and that failed
-- with "Roles are granted by Habba, not requested".
--
-- The cause is in 0040. `user_roles.user_id` cascades on delete from
-- `profiles`, and the cascade issues a DELETE on `user_roles` — which the
-- ENABLE ALWAYS guard refuses, because it refuses every delete. So the guard,
-- written to stop a user revoking someone else's role, also made **deleting an
-- account impossible**. Nothing tested that, because nothing had needed to
-- delete a profile since the guard landed.
--
-- That is worse than a broken test. PDPL gives a person the right to have
-- their data erased, and ADR-0010 already has the harder half of that question
-- open (an append-only timeline cannot be rewritten). Being unable to delete
-- the account row at all would have turned an open question into a defect.
--
-- The fix is narrow rather than an exemption: a role row may be deleted only
-- when the profile it belongs to is already gone. During a cascade Postgres
-- deletes the parent first, so that condition is true for exactly the deletes
-- that are part of removing an account — and false for a direct
-- `delete from user_roles`, which is what the guard exists to stop.

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

  -- A role row whose profile no longer exists is the tail of a cascade from
  -- `delete from profiles`. Allowing it is what makes account deletion
  -- possible; it grants nothing, because the account is already gone.
  --
  -- Note the ordering this relies on: within one statement Postgres removes
  -- the parent row before firing the cascade, so `not exists` is true here and
  -- false for a client deleting role rows directly.
  if tg_op = 'DELETE'
     and not exists (select 1 from public.profiles p where p.id = old.user_id) then
    return old;
  end if;

  raise exception 'Roles are granted by Habba, not requested'
    using errcode = 'insufficient_privilege',
          hint = 'Apply from the profile screen; approval grants the role.';
end;
$$;

-- The same shape of hole exists wherever an ENABLE ALWAYS guard sits on a table
-- that something else cascades into. `otp_send_attempts` (0042) has no foreign
-- key, and the timeline is append-only by design and never cascaded into, so
-- `user_roles` was the only one. 22_account_deletion.sql keeps it that way.
