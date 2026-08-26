-- 0009 — vehicle_timeline: the append-only, tamper-evident logbook
--
-- CLAUDE.md §1 and §2.4. This is the moat. Read ADR-0003, ADR-0004 and
-- ADR-0005 before changing anything in this file.

create table public.vehicle_timeline (
  id          uuid primary key default gen_random_uuid(),

  -- Strict insertion order. This is what the chain is ordered by, and it
  -- exists because the obvious alternatives are both wrong:
  --   * `recorded_at` uses now(), which is the TRANSACTION start time and is
  --     therefore identical for every row written in one transaction.
  --   * `id` is a random UUID, so ordering by it is meaningless.
  -- Ordering by (recorded_at desc, id desc) picked an arbitrary row as the
  -- chain tip and forked the chain on the very first multi-append
  -- transaction. Caught by supabase/tests/03_tamper.sql. See ADR-0004.
  seq         bigint generated always as identity,

  vehicle_id  uuid not null references public.vehicles(id) on delete restrict,
  event_type  timeline_event_type not null,

  -- ADR-0012: two timestamps with different meanings.
  --   occurred_at — when it happened in the world (client-asserted, bounded)
  --   recorded_at — when it was durably written (server, authoritative)
  -- The chain is ordered by recorded_at; the UI displays by occurred_at. A job
  -- completed underground at 14:00 and synced at 16:30 is hashed at 16:30.
  occurred_at timestamptz not null default now(),
  recorded_at timestamptz not null default now(),

  mileage     int check (mileage is null or mileage >= 0),

  -- ⚠️ No foreign keys on these two yet: `orders` and `providers` do not exist
  -- until Phase 3. The COLUMNS must exist now because they are part of the
  -- hashed payload, and the payload can never change without invalidating
  -- every historical hash (ADR-0004). Phase 3 adds the FK constraints via
  -- ALTER; existing rows hold NULL, which satisfies them.
  order_id    uuid,
  provider_id uuid,

  -- ADR-0005: what "verified" is allowed to mean. Derived server-side, never
  -- supplied by a client, and part of the hash so a row cannot be quietly
  -- promoted from self_reported to habba_verified.
  provenance  timeline_provenance not null,

  -- Denormalised snapshot: the timeline must survive deletion of its source.
  summary_ar  text not null,
  summary_en  text not null,
  details     jsonb not null default '{}'::jsonb,
  attachments jsonb not null default '[]'::jsonb,   -- [{url, type, caption}]

  -- CLAUDE.md §2.6. For the timeline this is evidence, not audit hygiene:
  -- "who asserted this" is load-bearing in تقرير هبّة.
  created_by  uuid not null references public.profiles(id) on delete restrict,
  created_at  timestamptz not null default now(),

  -- Tamper evidence. prev_hash is NOT NULL with a 'GENESIS' sentinel for the
  -- first row of each chain — if it were nullable, the unique index below
  -- would not prevent two competing genesis rows, since NULLs are distinct.
  prev_hash   text not null,
  row_hash    text not null,

  -- Backstop against a forked chain. Even if the advisory lock in
  -- append_vehicle_timeline_event were bypassed, a fork becomes a loud
  -- constraint violation instead of silent, unrepairable corruption.
  constraint vehicle_timeline_chain_unique unique (vehicle_id, prev_hash)
);

create index vehicle_timeline_vehicle_idx
  on public.vehicle_timeline (vehicle_id, occurred_at desc);
-- Chain traversal and tip lookup both use (vehicle_id, seq).
create unique index vehicle_timeline_chain_idx
  on public.vehicle_timeline (vehicle_id, seq);
create index vehicle_timeline_order_idx
  on public.vehicle_timeline (order_id) where order_id is not null;

comment on table public.vehicle_timeline is
  'Append-only, hash-chained vehicle logbook. THE MOAT. Never UPDATE or DELETE — see ADR-0003.';


-- ---------------------------------------------------------------------------
-- Hash payload (ADR-0004)
-- ---------------------------------------------------------------------------
-- ⚠️ FROZEN. Changing this function invalidates every hash ever computed.
--
-- Differences from the build prompt's formula, both deliberate:
--   * `attachments` and `mileage` are included. The spec omits them, which
--     would let a seller swap the before/after photos or lower the recorded
--     odometer without breaking verification — the two things a fraudulent
--     seller most wants to change.
--   * Fields are delimited by U+001E (record separator). Naive concatenation
--     is ambiguous: ('ab','c') and ('a','bc') would hash identically.
create or replace function public.timeline_row_payload(
  p_prev_hash   text,
  p_id          uuid,
  p_vehicle_id  uuid,
  p_event_type  timeline_event_type,
  p_occurred_at timestamptz,
  p_mileage     int,
  p_order_id    uuid,
  p_provider_id uuid,
  p_created_by  uuid,
  p_provenance  timeline_provenance,
  p_details     jsonb,
  p_attachments jsonb
)
returns text
language sql
immutable
parallel safe
as $$
  select concat_ws(
    chr(30),
    coalesce(p_prev_hash, 'GENESIS'),
    p_id::text,
    p_vehicle_id::text,
    p_event_type::text,
    -- Fixed-precision UTC. timestamptz::text renders using the session's
    -- TimeZone and DateStyle, which would make verification depend on the
    -- connection settings: valid for a Riyadh client, invalid for a UTC cron.
    to_char(p_occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    coalesce(p_mileage::text, ''),
    coalesce(p_order_id::text, ''),
    coalesce(p_provider_id::text, ''),
    p_created_by::text,
    p_provenance::text,
    public.canonical_json(p_details),
    public.canonical_json(p_attachments)
  );
$$;

create or replace function public.timeline_row_hash(payload text)
returns text
language sql
immutable
parallel safe
as $$
  select encode(sha256(convert_to(payload, 'UTF8')), 'hex');
$$;


-- ---------------------------------------------------------------------------
-- Append-only enforcement (ADR-0003)
-- ---------------------------------------------------------------------------
-- The build prompt uses Postgres RULES with DO INSTEAD NOTHING. Those SILENTLY
-- DISCARD the write and report success — a buggy UPDATE returns "UPDATE 0" and
-- every layer above assumes it worked. That contradicts CLAUDE.md §2.4, which
-- says to enforce with triggers, and it contradicts failing loudly.
create or replace function public.timeline_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'vehicle_timeline is append-only (attempted % on row %)',
    tg_op, coalesce(old.id::text, '?')
    using errcode = 'restrict_violation',
          hint = 'Corrections are new compensating events, never edits. See ADR-0003.';
end;
$$;

create trigger vehicle_timeline_no_update_delete
  before update or delete on public.vehicle_timeline
  for each row execute function public.timeline_immutable();

-- ENABLE ALWAYS, not the default ENABLE ORIGIN: the trigger must also fire
-- during replication and logical replay, which is exactly when an unnoticed
-- mutation would be most damaging. This also means the trigger applies to
-- service_role — RLS does not, so a leaked service key would otherwise have
-- free rein over the logbook.
alter table public.vehicle_timeline
  enable always trigger vehicle_timeline_no_update_delete;
