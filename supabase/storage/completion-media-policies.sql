-- Storage policies for the `completion-media` bucket (migration 0064).
--
-- ⚠️ THIS IS NOT A MIGRATION. Same reason as triage-media-policies.sql:
-- `create policy on storage.objects` needs ownership of that table, which the
-- migration connection does not have on a hosted project. Paste this file
-- into Dashboard → SQL Editor and run it once, after the migrations
-- (docs/supabase-setup.md §7). The local harness applies it as the storage
-- owner, so supabase/tests/37_completion_media_storage.sql exercises the real
-- policies.
--
-- Objects are keyed `<order_id>/<filename>`; the first path segment is the
-- authorisation subject.


-- The assigned provider uploads, and only while the job is open — the same
-- statuses record_completion_evidence() accepts. After hand-back the photos
-- are the customer's evidence of the work, and a provider adding files to a
-- job the customer is already reviewing would be editing the record under
-- review.
create policy completion_media_insert_provider on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'completion-media'
    and exists (
      select 1
        from public.orders o
        join public.providers pr on pr.id = o.provider_id
       where o.id::text = (storage.foldername(name))[1]
         and pr.owner_profile_id = (select auth.uid())
         and o.status in ('arrived', 'checked_in', 'in_progress')
    )
  );

-- Who can look: the customer, the provider, and whoever owns the car NOW.
-- Decided by public.can_read_completion_media() (0064) rather than inline,
-- because the current owner after a transfer cannot read the seller's order
-- row, and must not be able to.
create policy completion_media_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'completion-media'
    and public.can_read_completion_media((storage.foldername(name))[1])
  );

-- ⚠️ No update and no delete policy, for anyone. The photos are hash-chained
-- into the timeline by reference; a file that can be swapped behind an
-- unchanged reference would make the chain verify something that is no longer
-- there. Removal on a legitimate complaint is an ops action through the
-- service role, which leaves a trace.
