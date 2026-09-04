-- Test helpers. Loaded first by local-db.sh (files run in filename order).
--
-- Deliberately not pgTAP: pgTAP is another extension to install everywhere CI
-- runs, and these assertions raise real exceptions, which combined with
-- psql's ON_ERROR_STOP=1 is enough to fail a build.

create schema if not exists test;

create or replace function test.ok(label text)
returns void language plpgsql as $$
begin
  raise notice '  ok   %', label;
end $$;

create or replace function test.assert(condition boolean, label text)
returns void language plpgsql as $$
begin
  if condition is not true then
    raise exception 'FAIL: %', label using errcode = 'assert_failure';
  end if;
  raise notice '  ok   %', label;
end $$;

create or replace function test.assert_eq(actual anyelement, expected anyelement, label text)
returns void language plpgsql as $$
begin
  if actual is distinct from expected then
    raise exception 'FAIL: % — expected %, got %', label, expected, actual
      using errcode = 'assert_failure';
  end if;
  raise notice '  ok   %', label;
end $$;

-- Asserts that a statement raises. Optionally pins the SQLSTATE, so a test
-- cannot pass because something unrelated blew up.
create or replace function test.assert_raises(
  stmt text,
  label text,
  expected_sqlstate text default null
)
returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    if expected_sqlstate is not null and sqlstate <> expected_sqlstate then
      raise exception 'FAIL: % — expected SQLSTATE %, got % (%)',
        label, expected_sqlstate, sqlstate, sqlerrm using errcode = 'assert_failure';
    end if;
    raise notice '  ok   % (raised %)', label, sqlstate;
    return;
  end;
  raise exception 'FAIL: % — expected an exception, none was raised', label
    using errcode = 'assert_failure';
end $$;

-- Impersonate a user the way Supabase does: set the JWT subject GUC, then
-- switch to the `authenticated` role so real RLS applies.
create or replace function test.become(p_user_id uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_user_id::text, true);
end $$;

create or replace function test.become_anon()
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

-- Grants a role the way the server does (0040): through grant_user_role(),
-- never by writing user_roles directly. Fixtures that need a technician, a
-- workshop admin or an operator call this; `customer` needs no call at all,
-- because every profile gets it on insert (§5.1.1).
--
-- Runs as the privileged migration role, standing in for the ops console.
create or replace function test.grant_role(p_user_id uuid, p_role public.user_role)
returns void language plpgsql as $$
begin
  perform public.grant_user_role(p_user_id, p_role, null);
end $$;

-- The RLS suite runs as the `authenticated` role so that real policies apply
-- (the table owner and any superuser bypass RLS, which would make the whole
-- suite vacuous). That role therefore needs to reach these helpers.
grant usage on schema test to authenticated, anon;
grant execute on all functions in schema test to authenticated, anon;
