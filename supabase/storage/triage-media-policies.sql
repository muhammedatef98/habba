-- Storage policies for the `triage-media` bucket.
--
-- ⚠️ THIS IS NOT A MIGRATION, and it is not run by verify-hosted.sh.
--
-- `storage.objects` is owned by `supabase_storage_admin` on a hosted project.
-- `create policy` on a table requires ownership of it (or membership in the
-- owning role), and the project's `postgres` role — the one a `psql` migration
-- connection uses — has neither. It is refused with "must be owner of table
-- objects", which is exactly how migration 0048 failed on its first real run.
--
-- So these policies are applied the way the platform actually permits, from
-- the **Supabase dashboard SQL editor**, which runs with the storage owner's
-- rights. It is the same shape as PostGIS in §2 of docs/supabase-setup.md: a
-- privileged one-off that a migration cannot perform, documented as a step
-- rather than pretended away.
--
-- Paste this file into Dashboard → SQL Editor and run it once, after the
-- migrations. §6 of the runbook then verifies all three policies exist; the
-- bucket is unusable without them, because RLS denies by default.
--
-- The local harness applies this file as the storage owner (local-db.sh), so
-- supabase/tests/24_triage_media_storage.sql exercises the real policies.

-- Objects are keyed `<order_id>/<filename>`, so the first path segment is the
-- authorisation subject. Anything else is rejected by the policies below
-- simply by not matching an order.


-- The customer uploads to their own order, and only while it is still theirs
-- to add to. After completion the clip is evidence in the timeline; letting
-- new files appear against a closed order would let the record be edited
-- after the fact, which is the tamper-evidence property §2.4 exists to protect.
create policy triage_media_insert_customer on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'triage-media'
    and exists (
      select 1 from public.orders o
      where o.id::text = (storage.foldername(name))[1]
        and o.customer_id = (select auth.uid())
        and o.status not in ('completed', 'cancelled', 'disputed')
    )
  );

create policy triage_media_read_customer on storage.objects
  for select to authenticated
  using (
    bucket_id = 'triage-media'
    and exists (
      select 1 from public.orders o
      where o.id::text = (storage.foldername(name))[1]
        and o.customer_id = (select auth.uid())
    )
  );

-- The assigned provider reads it — that is the entire point of the feature.
-- Scoped to the assignment, so a provider who lost the job or was never on it
-- sees nothing. Deliberately NOT limited to in-transit statuses: the clip is
-- most useful while they are still deciding what to bring.
create policy triage_media_read_assigned_provider on storage.objects
  for select to authenticated
  using (
    bucket_id = 'triage-media'
    and exists (
      select 1
        from public.orders o
        join public.providers pr on pr.id = o.provider_id
       where o.id::text = (storage.foldername(name))[1]
         and pr.owner_profile_id = (select auth.uid())
    )
  );

-- ⚠️ No update and no delete policy, for anyone. RLS denies by default, so
-- omitting them is the enforcement: a triage clip is part of the order record,
-- and an order record that can be quietly replaced is not a record. Removal on
-- a real complaint is an ops action through the service role, which leaves a
-- trace — not a client call that does not.
