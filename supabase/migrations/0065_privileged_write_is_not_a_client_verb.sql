-- 0065 — the guard-exemption switch is not a client verb
--
-- Found while writing 0064's suite, which asserted that `record_audit` was not
-- executable by a client role and failed. The revoke was `from public`, and
-- that is not where the grant was.
--
-- 0001 ends with:
--
--     alter default privileges in schema public
--       grant all on functions to anon, authenticated, service_role;
--
-- so every function created since has arrived with a DIRECT grant to all three
-- roles. `revoke ... from public` removes a grant that was never doing the
-- work. It is the same shape as the bug HANDOFF §6 records one layer down — a
-- column-level REVOKE is a silent no-op against an existing table-level grant —
-- and it fails the same way: quietly, looking exactly like the intended
-- outcome.
--
-- What that leaves open here:
--
--     grant execute on function public.begin_privileged_write() to authenticated;
--     grant execute on function public.end_privileged_write()   to authenticated;
--
-- 0033:405. `begin_privileged_write()` is the switch that exempts a write from
-- EVERY column guard in the system — the guards that stop self-approval, price
-- rewriting, odometer rollback, escrow forgery and privilege escalation to
-- `ops` (0033–0039). It was granted to every signed-in user.
--
-- Is it reachable today? Not through PostgREST, which gives a request one
-- statement and one transaction, and the flag is transaction-local: a client
-- can turn it on and the transaction ends before they can use it. That is the
-- only thing standing in the way, and it is a property of the HTTP layer in
-- front of the database rather than of the database — which is the reasoning
-- CLAUDE.md §2.2 exists to reject. A second statement in one transaction, from
-- anywhere, and every guard in 0033–0039 is off.
--
-- Nothing legitimate loses anything. Every one of the forty-six callers of
-- these functions is SECURITY DEFINER and therefore runs as the owner, which
-- holds EXECUTE without a grant. The grant was never what made them work.

revoke execute on function public.begin_privileged_write()
  from public, anon, authenticated, service_role;
revoke execute on function public.end_privileged_write()
  from public, anon, authenticated, service_role;

-- 0063's variant, which closes the flag only if this call opened it. Same
-- switch, same reasoning.
revoke execute on function public.end_privileged_write_unless(boolean)
  from public, anon, authenticated, service_role;

-- `is_privileged_write()` is deliberately left alone. It only READS the flag,
-- it is called from the guard triggers, and a client that learns the flag is
-- off learns nothing it could not have guessed. Revoking it would be tidiness
-- rather than a fix, and a migration that cannot say what it prevents should
-- not be making the change.

comment on function public.begin_privileged_write() is
  'Internal. Exempts a write from every column guard; callable only from a SECURITY DEFINER function, which runs as owner. Never granted to a client role — see 0065.';
comment on function public.end_privileged_write() is
  'Internal. Closes the exemption opened by begin_privileged_write(). See 0065.';
