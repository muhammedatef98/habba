-- 0003 — Shared helpers and audit scaffolding
-- CLAUDE.md §2.6: created_at, updated_at, created_by on everything.

-- Keeps updated_at honest without trusting the client to send it.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function public.set_updated_at() is
  'BEFORE UPDATE trigger: stamps updated_at server-side. CLAUDE.md §2.6.';

-- Canonical JSON serialisation for hashing. See ADR-0004.
--
-- ⚠️ FROZEN INFRASTRUCTURE. Changing this function retroactively invalidates
-- every hash ever computed, which would break verification for every vehicle
-- in the system. It is IMMUTABLE, it is covered by a fixture test, and it must
-- never be altered — only superseded by a versioned successor alongside a
-- documented migration of the chain.
--
-- Why this exists rather than hashing `details::text`: jsonb's text rendering
-- is an implementation detail, not a documented cross-version contract. A
-- Postgres major upgrade that changed it would silently invalidate the entire
-- logbook. This pins the representation to something we control.
create or replace function public.canonical_json(input jsonb)
returns text
language sql
immutable
strict
parallel safe
as $$
  select case jsonb_typeof(input)
    when 'object' then
      coalesce(
        '{' || (
          select string_agg(
            to_json(key)::text || ':' || public.canonical_json(input -> key),
            ','
            order by key            -- deterministic key order, independent of storage
          )
          from jsonb_object_keys(input) as key
        ) || '}',
        '{}'
      )
    when 'array' then
      coalesce(
        '[' || (
          select string_agg(public.canonical_json(element), ',' order by ordinality)
          from jsonb_array_elements(input) with ordinality as t(element, ordinality)
        ) || ']',
        '[]'
      )
    else input::text            -- scalars: jsonb already normalises these
  end;
$$;

comment on function public.canonical_json(jsonb) is
  'Deterministic JSON serialisation for hash chains. FROZEN — see ADR-0004. Never modify.';
