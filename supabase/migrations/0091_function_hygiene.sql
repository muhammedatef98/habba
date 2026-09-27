-- 0091 — Function hygiene: a fixed search_path everywhere, and trigger
-- functions that only triggers can call
--
-- The Supabase security advisor flags two things across the schema:
--
-- 1. function_search_path_mutable — about fifty SECURITY INVOKER functions
--    resolve names through the caller's search_path. The definer functions
--    were pinned long ago (and suite 48 keeps them pinned); these were left
--    because an invoker function runs with the caller's rights anyway. It is
--    still worth closing: a function whose meaning depends on who calls it is
--    one a future schema could shadow. Each is pinned to the schemas it was
--    written against — public, then extensions (PostGIS, pgcrypto) — with
--    pg_temp last so a temporary object can never stand in for a real one.
--    pg_catalog is always searched first.
--
-- 2. authenticated_security_definer_function_executable — among the ~150
--    definer functions a signed-in client can call, about forty-five are
--    trigger functions. PostgREST cannot call them, and Postgres checks
--    EXECUTE on a trigger function only when the trigger is created, not when
--    it fires. Revoking it changes nothing that works and removes forty-five
--    entries a reviewer would otherwise have to rule out one by one.
--
-- Both are applied by catalog query rather than by name, so a function added
-- later is caught by suite 59 rather than by memory.

do $$
declare
  v_fn regprocedure;
begin
  for v_fn in
    select p.oid::regprocedure
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prokind = 'f'
       and not p.prosecdef
       and p.prolang in (select oid from pg_language where lanname in ('sql', 'plpgsql'))
       and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')
       and not exists (select 1 from pg_depend d
                        where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
       and pg_get_userbyid(p.proowner) = current_user
  loop
    execute format('alter function %s set search_path = public, extensions, pg_temp', v_fn);
  end loop;

  for v_fn in
    select p.oid::regprocedure
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prorettype = 'trigger'::regtype
       and not exists (select 1 from pg_depend d
                        where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
       and pg_get_userbyid(p.proowner) = current_user
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', v_fn);
  end loop;
end;
$$;
