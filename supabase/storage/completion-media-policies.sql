-- Storage policies for the `completion-media` bucket.
--
-- ⚠️ THIS IS NOT A MIGRATION, and it is not run by verify-hosted.sh.
--
-- Same constraint as triage-media-policies.sql: `create policy` on
-- `storage.objects` needs ownership of that table, and the `postgres` role a
-- migration connection uses does not have it on a hosted project. Paste this
-- into Dashboard → SQL Editor and run it once, after the migrations.
--
-- The local harness applies this file as the storage owner (local-db.sh), so
-- supabase/tests/37_completion_media_storage.sql exercises the real policies.

-- Objects are keyed `<order_id>/<filename>`, so the first path segment is the
-- authorisation subject — the same convention as triage-media.


-- The ASSIGNED provider uploads, and only while the job is in a state where
-- evidence may still be recorded.
--
-- Those three statuses are not a guess: they are exactly the list
-- `record_completion_evidence` (0032) accepts. If the two ever disagree, the
-- bucket would take a file that the row referencing it cannot be written for —
-- an orphan photo of someone's car with nothing pointing at it.
--
-- After the job leaves those statuses the photos are timeline attachments under
-- the hash chain (ADR-0004). Letting new files appear against a closed order
-- would let the record be extended after the fact, which is the property §2.4
-- exists to protect.
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
         and o.status in ('in_progress', 'arrived', 'checked_in')
    )
  );

-- The provider reads back what they took — a technician who cannot see the
-- before photo they captured ten minutes ago will simply take it again.
--
-- Not limited by status: after completion this is still their record of the
-- work, and it is what they would produce in a dispute.
create policy completion_media_read_provider on storage.objects
  for select to authenticated
  using (
    bucket_id = 'completion-media'
    and exists (
      select 1
        from public.orders o
        join public.providers pr on pr.id = o.provider_id
       where o.id::text = (storage.foldername(name))[1]
         and pr.owner_profile_id = (select auth.uid())
    )
  );

-- Whoever owns the car reads them, which is deliberately NOT "whoever placed
-- the order".
--
-- These photos are timeline attachments, and `vehicle_timeline_read_own` (0013)
-- authorises on `owns_vehicle`, not on `orders.customer_id`. Mirroring it is
-- what makes §1.3 work: after نقل الملكية the buyer inherits the logbook, and a
-- logbook whose every photo 403s is not the thing that sells the car.
--
-- `is_ops()` is here for the same reason it is on the timeline policy — dispute
-- resolution has to be able to look at the evidence.
create policy completion_media_read_vehicle_owner on storage.objects
  for select to authenticated
  using (
    bucket_id = 'completion-media'
    and exists (
      select 1 from public.orders o
       where o.id::text = (storage.foldername(name))[1]
         and (public.owns_vehicle(o.vehicle_id) or public.is_ops())
    )
  );

-- ⚠️ No update and no delete policy, for anyone — the same omission as
-- triage-media, and here it is the whole point. A before/after photo that can
-- be quietly replaced after the customer has approved the job is not evidence,
-- and the hash chain over the attachment would keep verifying while the bytes
-- underneath it changed. Removal on a real complaint is an ops action through
-- the service role, which leaves a trace.
