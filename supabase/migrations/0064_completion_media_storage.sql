-- 0064 — Storage for completion photos, and evidence that must exist
--
-- 0032 made before/after photos mandatory before a job can be handed back,
-- and 0033 routed them through record_completion_evidence(). But the function
-- accepted any string as a photo. The app had no camera behind it yet and sent
-- `habba://captured/before/<timestamp>` — a string, not a photo — and the
-- database counted it. Every `habba_verified` service entry written that way
-- carries attachments that point at nothing. §11: "Do not skip the completion
-- photos/mileage. Without them the moat is empty." A placeholder URL is a
-- skipped photo that looks like a taken one, which is worse than an empty
-- field, because the resale report counts it.
--
-- Two changes:
--
--   1. A private `completion-media` bucket, keyed `<order_id>/<file>` exactly
--      like `triage-media` (0048), so the policies can authorise on the first
--      path segment. Policies: supabase/storage/completion-media-policies.sql,
--      applied from the dashboard for the reason 0048 documents.
--
--   2. record_completion_evidence() accepts only references to objects that
--      were actually uploaded into THIS order's folder. The reference is
--      `storage://completion-media/<order_id>/<file>` — the bucket and path,
--      never a signed URL. The media lands in the hash-chained timeline
--      (ADR-0004) and a signed URL expires; a project URL ties a permanent
--      record to a hostname that may change. A reference resolves the same
--      way forever.
--
-- What this does NOT prove: that the photo shows this car. Nothing server-side
-- can. It proves the photo exists, was uploaded by the assigned provider while
-- the job was open (the insert policy), and cannot be replaced afterwards (no
-- update or delete policy). That is the difference between evidence and a
-- claim of evidence.

insert into storage.buckets (id, name, public)
values ('completion-media', 'completion-media', false)
on conflict (id) do nothing;


-- Who may look at an order's completion photos: the customer who paid for
-- the work, the provider who did it, and whoever owns the car NOW.
--
-- The last is the logbook's portability promise (§1, ADR-0021): the photos are
-- timeline attachments, the timeline follows the car through a transfer, and
-- a buyer who inherits a verified entry but cannot open its photos has
-- inherited a claim, not evidence. A definer function rather than a subquery
-- in the storage policy, because the buyer cannot read the seller's `orders`
-- row and must not be able to — 0055 refuses that policy for what it would
-- leak. This answers yes or no and nothing else.
create or replace function public.can_read_completion_media(p_order_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.orders o
      left join public.providers pr on pr.id = o.provider_id
      left join public.vehicles v on v.id = o.vehicle_id
     where o.id::text = p_order_id
       and (
         o.customer_id = (select auth.uid())
         or pr.owner_profile_id = (select auth.uid())
         or v.owner_id = (select auth.uid())
       )
  );
$$;

revoke execute on function public.can_read_completion_media(text) from public, anon;
grant execute on function public.can_read_completion_media(text) to authenticated;


create or replace function public.record_completion_evidence(
  p_order_id uuid,
  p_mileage  int,
  p_media    jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order  record;
  v_item   jsonb;
  v_url    text;
  v_prefix text := 'storage://completion-media/' || p_order_id::text || '/';
  v_name   text;
begin
  select * into v_order from public.orders o where o.id = p_order_id;

  if v_order is null then
    raise exception 'Order % not found', p_order_id using errcode = 'no_data_found';
  end if;

  if v_order.provider_id is distinct from public.current_provider_id() then
    raise exception 'Only the assigned provider may record completion evidence'
      using errcode = 'insufficient_privilege';
  end if;

  if v_order.status not in ('in_progress', 'arrived', 'checked_in') then
    raise exception 'Evidence is recorded while the job is in progress (status is %)',
      v_order.status
      using errcode = 'check_violation';
  end if;

  if p_media is not null and jsonb_typeof(p_media) <> 'array' then
    raise exception 'Completion media must be a list' using errcode = 'invalid_parameter_value';
  end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_media, '[]'::jsonb)) loop
    if jsonb_typeof(v_item) <> 'object'
       or coalesce(v_item ->> 'kind', '') not in ('before', 'after', 'part') then
      raise exception 'Each photo needs a kind of before, after or part'
        using errcode = 'invalid_parameter_value';
    end if;

    v_url := coalesce(v_item ->> 'url', '');

    -- The prefix pins the photo to THIS order. Without it, a provider could
    -- reuse one good photo from an earlier job on every later one.
    if left(v_url, length(v_prefix)) <> v_prefix then
      raise exception 'A completion photo must be uploaded to this order, not linked from elsewhere'
        using errcode = 'invalid_parameter_value',
              hint = 'Upload the photo to completion-media/<order_id>/ and pass its storage:// reference.';
    end if;

    v_name := substr(v_url, length('storage://completion-media/') + 1);

    if position('/' in substr(v_url, length(v_prefix) + 1)) > 0 then
      raise exception 'A completion photo must sit directly in the order''s folder'
        using errcode = 'invalid_parameter_value';
    end if;

    if not exists (
      select 1 from storage.objects so
      where so.bucket_id = 'completion-media' and so.name = v_name
    ) then
      raise exception 'The photo % was never uploaded', v_url
        using errcode = 'invalid_parameter_value',
              hint = 'Upload first, then record. A reference to nothing is not evidence.';
    end if;
  end loop;

  perform public.begin_privileged_write();

  update public.orders
  set completion_mileage = p_mileage,
      completion_media = coalesce(p_media, '[]'::jsonb)
  where id = p_order_id;

  perform public.end_privileged_write();
end;
$$;

comment on function public.record_completion_evidence(uuid, int, jsonb) is
  'The provider''s one call for completion evidence. Photos must be storage://completion-media/<order_id>/<file> references to objects that exist. 0064.';

grant execute on function public.record_completion_evidence(uuid, int, jsonb) to authenticated;
