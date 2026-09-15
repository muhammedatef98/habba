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
--
-- Drops before creating, so re-running it on a project that already has an
-- earlier version is safe. That is not hypothetical: 0066 corrected the read
-- path here, and a project set up before it needs this file applied again.

drop policy if exists completion_media_insert_provider on storage.objects;
drop policy if exists completion_media_read_provider on storage.objects;
drop policy if exists completion_media_read_vehicle_owner on storage.objects;

-- Objects are keyed `<order_id>/<filename>`, so the first path segment is the
-- authorisation subject — the same convention as triage-media.
--
-- ⚠️ Every predicate below goes through a `security definer` function rather
-- than an inline subquery over `public.orders`. A storage policy runs as the
-- INVOKING user, so an inline subquery is filtered by that user's own RLS on
-- `orders` — which is how the first version of this file silently denied the
-- new owner of a transferred car every photo in their inherited logbook. See
-- 0066.


-- The ASSIGNED provider uploads, and only while the job is in a state where
-- evidence may still be recorded.
--
-- After the job leaves those statuses the photos are timeline attachments under
-- the hash chain (ADR-0004). Letting new files appear against a closed order
-- would let the record be extended after the fact, which is the property §2.4
-- exists to protect.
create policy completion_media_insert_provider on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'completion-media'
    and public.may_write_completion_media((storage.foldername(name))[1])
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
    and public.is_assigned_provider_on_order((storage.foldername(name))[1])
  );

-- Whoever owns the car reads them, which is deliberately NOT "whoever placed
-- the order".
--
-- These photos are timeline attachments, and `vehicle_timeline_read_own` (0013)
-- authorises on `owns_vehicle`, not on `orders.customer_id`. Mirroring it is
-- what makes §1.3 work: after نقل الملكية the buyer inherits the logbook, and a
-- logbook whose every photo 403s is not the thing that sells the car.
create policy completion_media_read_vehicle_owner on storage.objects
  for select to authenticated
  using (
    bucket_id = 'completion-media'
    and public.may_read_completion_media((storage.foldername(name))[1])
  );

-- ⚠️ No update and no delete policy, for anyone — the same omission as
-- triage-media, and here it is the whole point. A before/after photo that can
-- be quietly replaced after the customer has approved the job is not evidence,
-- and the hash chain over the attachment would keep verifying while the bytes
-- underneath it changed. Removal on a real complaint is an ops action through
-- the service role, which leaves a trace.
