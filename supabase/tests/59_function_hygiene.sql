-- 59 — Function hygiene
--
-- Companion to 0091. Standing checks, so the next function written is held
-- to the same rule without anyone remembering it.

\echo '── function hygiene'

begin;

select test.assert_eq(
  (select coalesce(string_agg(p.proname, ', ' order by p.proname), '')
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      and p.prolang in (select oid from pg_language where lanname in ('sql', 'plpgsql'))
      and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')
      and not exists (select 1 from pg_depend d
                       where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')),
  '', 'every function in public has a fixed search_path');

select test.assert_eq(
  (select coalesce(string_agg(p.proname, ', ' order by p.proname), '')
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prorettype = 'trigger'::regtype
      and (has_function_privilege('authenticated', p.oid, 'EXECUTE')
           or has_function_privilege('anon', p.oid, 'EXECUTE'))
      and not exists (select 1 from pg_depend d
                       where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')),
  '', 'no client can execute a trigger function');

rollback;

\echo '   function hygiene OK'
