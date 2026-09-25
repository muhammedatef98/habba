-- 0085 — What the media buckets accept
--
-- Both buckets (0048, 0064) are private and behind RLS, but took any file of
-- any size and type: a customer could store a gigabyte, or an HTML page that a
-- signed URL would later serve. Each now takes what the app sends and no more:
--
--   triage-media      the customer's problem clip — video, up to 50 MB
--                     (the app records 720p at 4 Mb/s: ~10 MB for 20 s)
--   completion-media  the technician's photos — images, up to 10 MB
--
-- The columns are the platform's (hosted Supabase Storage). The local harness
-- stands in for storage with a shim that has no such columns, so the update is
-- made only where they exist.

do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'storage' and table_name = 'buckets' and column_name = 'file_size_limit'
  ) then
    execute $sql$
      update storage.buckets
         set file_size_limit = 52428800,
             allowed_mime_types = array['video/mp4', 'video/quicktime']
       where id = 'triage-media'
    $sql$;
    execute $sql$
      update storage.buckets
         set file_size_limit = 10485760,
             allowed_mime_types = array['image/jpeg', 'image/png', 'image/heic', 'image/webp']
       where id = 'completion-media'
    $sql$;
  end if;
end;
$$;
