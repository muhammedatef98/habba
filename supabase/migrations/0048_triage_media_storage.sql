-- 0048 — Storage for triage clips
--
-- `orders.triage_media` has existed since 0019 and `create_emergency_order`
-- has accepted `p_triage_media` since 0023, but there has never been anywhere
-- to put the file. The customer app now records a 20-second clip (§1's third
-- differentiator: a provider who has seen and heard the fault brings the right
-- part instead of driving out blind), so it needs a home.
--
-- Private bucket. A triage clip is video of someone's car, often their
-- driveway, sometimes them — and it is captured at a moment of stress by
-- someone who is not thinking about who else can watch it. Public URLs are
-- guessable and permanent; this stays behind RLS and is read through signed
-- URLs with a short life.

insert into storage.buckets (id, name, public)
values ('triage-media', 'triage-media', false)
on conflict (id) do nothing;

-- ⚠️ There is deliberately no `alter table storage.objects enable row level
-- security` here. On a hosted project that table is owned by
-- `supabase_storage_admin`, migrations run as `postgres`, and the statement is
-- refused with "must be owner of table objects" — which is exactly how this
-- migration failed on its first real run. RLS on `storage.objects` is the
-- platform's, enabled before any migration exists; there is nothing to turn on.
--
-- Assert it instead, so a project where it is somehow off fails loudly here
-- rather than shipping wide-open policies that look restrictive.
do $$
begin
  if not exists (
    select 1 from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'storage' and c.relname = 'objects' and c.relrowsecurity
  ) then
    raise exception 'storage.objects does not have row level security enabled'
      using hint = 'This is the platform''s to set. Check the project''s storage configuration before continuing.';
  end if;
end
$$;

-- The policies themselves are NOT here. `create policy on storage.objects`
-- needs ownership of that table, which a migration connection does not have —
-- see supabase/storage/triage-media-policies.sql, which is applied once from
-- the dashboard SQL editor and verified by §6 of the runbook.
--
-- Deliberately not asserted here: on a fresh project the migrations run BEFORE
-- that step, so requiring the policies would make the first run impossible.
-- Until they are applied the bucket is closed rather than open — RLS denies by
-- default — so the failure mode of forgetting is an upload that is refused,
-- not a clip anyone can read.
