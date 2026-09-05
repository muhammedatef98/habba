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

alter table storage.objects enable row level security;

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
