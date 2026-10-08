-- 66 — Policies ask "who is this?" once per query
--
-- Companion to 0100. A bare auth.uid() in a policy is evaluated for every row
-- the policy checks; wrapped as (select auth.uid()) it is evaluated once.
-- Nothing about who sees what depends on the difference — the other suites
-- prove that — so this only guards against a later migration adding a bare
-- call back.

\echo '── rls initplan'

begin;

set local search_path = '';

select test.assert_eq(
  (select count(*)::int
     from pg_catalog.pg_policies
    where schemaname = 'public'
      and replace(coalesce(qual, '') || ' ' || coalesce(with_check, ''),
                  '( SELECT auth.uid() AS uid)', '') like '%auth.uid()%'),
  0,
  'no public policy calls auth.uid() bare');

select test.assert(
  (select count(*) > 20
     from pg_catalog.pg_policies
    where schemaname = 'public'
      and coalesce(qual, '') || coalesce(with_check, '') like '%( SELECT auth.uid() AS uid)%'),
  'and the policies that ask still ask, wrapped');

rollback;
