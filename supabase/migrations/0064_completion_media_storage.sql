-- 0064 — Storage for completion evidence photos
--
-- `orders.completion_media` has existed since 0032, `record_completion_evidence`
-- has accepted it since then, and `assert_completion_evidence` refuses to let a
-- job be handed back without a before and an after. What has never existed is
-- anywhere to put the file.
--
-- So the provider's evidence screen invented one. `addPhoto()` fabricated
-- `habba://captured/before/<timestamp>` and the screen went green: the gap list
-- cleared, the save succeeded, the server's count of before/after rows was
-- satisfied, and the photo flowed into the timeline as an attachment the hash
-- chain then faithfully protected. A URL pointing at nothing, signed and
-- tamper-evident.
--
-- That is worse than having no photos, for the reason 0032 gives about exempt
-- services: junk evidence looks like evidence. §1's whole argument is that a
-- documented car sells for more, and it rests on those attachments being real.
--
-- Private bucket, for the same reason as `triage-media` (0048): these are
-- photographs of someone's car, often their driveway, and public storage URLs
-- are guessable and permanent.

insert into storage.buckets (id, name, public)
values ('completion-media', 'completion-media', false)
on conflict (id) do nothing;

-- ⚠️ No `alter table storage.objects enable row level security` here, and no
-- `create policy` either. That table is owned by `supabase_storage_admin` on a
-- hosted project; a migration connection runs as `postgres` and is refused with
-- "must be owner of table objects" — which is exactly how 0048 failed on its
-- first real run. See supabase/storage/completion-media-policies.sql, applied
-- once from the dashboard SQL editor, and §6 of the runbook.
--
-- Assert RLS is on rather than trying to turn it on, so a project where it is
-- somehow off fails loudly here instead of shipping an open bucket.
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

-- Until the policies are applied the bucket is closed rather than open — RLS
-- denies by default — so the failure mode of forgetting this step is an upload
-- that is refused, not a photo anyone can read.
