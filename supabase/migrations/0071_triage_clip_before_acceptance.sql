-- 0071 — Let the provider watch the clip BEFORE they accept
--
-- ⚠️ §1's third differentiator does not work, and has never worked.
--
--     Video triage before dispatch. Customer records 20s of the problem/sound.
--     Provider quotes before driving out. Kills false dispatches — the #1 cost
--     in this business.
--
-- The whole value is in the word BEFORE. `triage_media_read_assigned_provider`
-- (0048) authorises on:
--
--     join public.providers pr on pr.id = o.provider_id
--
-- and `orders.provider_id` is NULL until someone accepts. So at the one moment
-- the clip exists for — a technician looking at an offer, deciding whether to
-- drive out and what to put in the van — they can read nothing. By the time the
-- policy admits them they have already committed to the journey the clip was
-- supposed to help them judge.
--
-- Worse, the app promises it: `OpenJobCard` renders a "has video" badge on
-- exactly these pre-acceptance offers. A provider taps a job expecting to see
-- what is wrong with the car and gets an empty screen.
--
-- Proved before fixing: a provider holding a live offer saw 0 clips.
--
-- The fix is to authorise on the OFFER rather than the assignment. That grants
-- no visibility they do not already have — `list_open_orders_for_provider`
-- (0021) already shows these providers this job — it adds the clip they were
-- told about. A declined or expired offer loses it again, because a technician
-- who said no has no further business with the customer's driveway.


/**
 * Whether the caller may watch this order's triage clip.
 *
 * ⚠️ `security definer`, for the reason 0066 documents: a storage policy runs as
 * the INVOKING user, so an inline subquery over `public.orders` is filtered by
 * that user's own RLS — and a provider who has merely been OFFERED a job cannot
 * read its `orders` row at all. That is by design (ADR-0013); the masked
 * `list_open_orders_for_provider` exists precisely because the row is withheld.
 * An inline predicate would therefore have been false for every offered
 * provider, which is the same shape of bug as the one 0066 fixed.
 *
 * It leaks nothing: the answer is a boolean about the caller's own relationship
 * to the order.
 */
create or replace function public.may_watch_triage_clip(p_order_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.orders o
      join public.providers pr on pr.owner_profile_id = auth.uid()
      left join public.order_offers off
        on off.order_id = o.id and off.provider_id = pr.id
     where o.id::text = p_order_key
       and (
         -- Assigned: the original rule, unchanged.
         o.provider_id = pr.id
         -- Or holding a live offer. `pending` and `viewed` only: a provider who
         -- declined, or whose round was superseded, has no further business
         -- watching video of a stranger's driveway.
         or (off.id is not null and off.outcome in ('pending', 'viewed'))
       )
  );
$$;

grant execute on function public.may_watch_triage_clip(text) to authenticated;

-- ⚠️ The policy itself lives in supabase/storage/triage-media-policies.sql and
-- is applied by hand from the dashboard SQL editor — `create policy` on
-- `storage.objects` needs an ownership a migration connection does not have
-- (0048 documents how that was discovered). That file now drops before
-- creating, so a project set up before today needs it applied again.
--
-- Until it is, the behaviour is the old one: the clip is unreadable before
-- acceptance. That is a feature not working, not a hole opening.
