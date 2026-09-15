-- 0066 — Make the completion-media read path work for the person it was for
--
-- 0064's read policy asked the question the right way and could not answer it:
--
--   exists (select 1 from public.orders o
--            where o.id::text = (storage.foldername(name))[1]
--              and (public.owns_vehicle(o.vehicle_id) or public.is_ops()))
--
-- A storage policy runs as the INVOKING user, so that subquery is itself
-- subject to RLS on `public.orders` — which only admits the order's customer
-- and its assigned provider. The one reader the policy was written for is
-- neither.
--
-- After نقل الملكية the buyer owns the car and inherits the timeline, but they
-- were not the customer on a job done before they bought it. `owns_vehicle` said
-- yes; `orders` returned no row; the `exists` was false; every photo in their
-- inherited logbook 403'd. §1.3's whole argument is that the buyer receives a
-- documented history and becomes a customer at zero CAC, and a history whose
-- evidence cannot be opened is not documentation.
--
-- Caught by `supabase/tests/37_completion_media_storage.sql` — the assertion
-- that the new owner inherits the photos, which is the only one that exercises
-- a reader who is not on the order.
--
-- Forward-only (§4): 0064 stays as it was and this corrects it. The policies
-- themselves live in supabase/storage/completion-media-policies.sql and are
-- re-applied by hand — that file now drops before creating, so re-running it is
-- safe on a project that already has the old version.

/**
 * Whether the caller may see the evidence attached to an order.
 *
 * `security definer` so the order lookup is not filtered by the caller's own
 * RLS — that filtering is exactly what broke the buyer's case. It leaks
 * nothing: the only thing it reveals is a boolean about the caller's OWN
 * relationship to the vehicle, and `owns_vehicle` is itself a definer function
 * keyed on `auth.uid()`.
 *
 * Deliberately mirrors `vehicle_timeline_read_own` (0013) rather than the
 * order's customer: these photos ARE timeline attachments, and two different
 * answers to "may I see this event" would mean a logbook entry that renders
 * with a broken image.
 */
create or replace function public.may_read_completion_media(p_order_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.orders o
     where o.id::text = p_order_key
       and (public.owns_vehicle(o.vehicle_id) or public.is_ops())
  );
$$;

/**
 * Whether the caller is the provider assigned to this order.
 *
 * Same definer reasoning. A provider can read their own orders today, so this
 * one was not broken — but leaving it as an inline subquery would leave the
 * policy's correctness resting on the shape of an unrelated table's RLS, which
 * is how 0064 got it wrong in the first place.
 */
create or replace function public.is_assigned_provider_on_order(p_order_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.orders o
      join public.providers pr on pr.id = o.provider_id
     where o.id::text = p_order_key
       and pr.owner_profile_id = auth.uid()
  );
$$;

/**
 * Whether the caller may still ADD evidence to this order.
 *
 * ⚠️ The status list is the one `record_completion_evidence` (0032) accepts, and
 * the two must not drift: a bucket that took a file the row referencing it
 * cannot be written for is an orphan photo of someone's car with nothing
 * pointing at it.
 */
create or replace function public.may_write_completion_media(p_order_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.orders o
      join public.providers pr on pr.id = o.provider_id
     where o.id::text = p_order_key
       and pr.owner_profile_id = auth.uid()
       and o.status in ('in_progress', 'arrived', 'checked_in')
  );
$$;

grant execute on function public.may_read_completion_media(text) to authenticated;
grant execute on function public.is_assigned_provider_on_order(text) to authenticated;
grant execute on function public.may_write_completion_media(text) to authenticated;
