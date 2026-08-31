-- 0043 — The provider's side of an offer
--
-- 0042 records what was broadcast; this is how a provider responds to it.
--
-- Both actions go through functions rather than a direct UPDATE. The column
-- guard already refuses the dangerous write (self-acceptance), but "mark this
-- viewed" is still a transition with rules — it must not resurrect a declined
-- offer, and it must not touch someone else's — and a function is where those
-- rules can live and be tested. A client issuing raw UPDATEs against a queue
-- is how queues drift.

/**
 * Records that the provider opened the job.
 *
 * This is what moves the customer's "reviewing" counter, which is the entire
 * argument of the waiting screen: a number that changes because something
 * real happened. Idempotent — opening a job twice is not two people looking.
 */
create or replace function public.mark_offer_viewed(p_order_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_provider uuid;
begin
  select pr.id into v_provider
    from public.providers pr
   where pr.owner_profile_id = (select auth.uid());

  if v_provider is null then
    raise exception 'Only a provider may view an offer'
      using errcode = 'insufficient_privilege';
  end if;

  update public.order_offers
     set outcome = 'viewed', viewed_at = coalesce(viewed_at, now())
   where order_id = p_order_id
     and provider_id = v_provider
     -- Only from pending. A declined offer that reopens because the provider
     -- scrolled past it again would tell the customer someone is considering
     -- them when nobody is.
     and outcome = 'pending';

  return found;
end;
$$;

/**
 * Declines an offer.
 *
 * Declining is not failure — it is the signal that makes the radius ladder
 * worth expanding, and a provider who cannot decline cheaply will simply
 * ignore offers instead, which looks identical to the dispatcher and is worse
 * for everyone.
 */
create or replace function public.decline_offer(p_order_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_provider uuid;
begin
  select pr.id into v_provider
    from public.providers pr
   where pr.owner_profile_id = (select auth.uid());

  if v_provider is null then
    raise exception 'Only a provider may decline an offer'
      using errcode = 'insufficient_privilege';
  end if;

  update public.order_offers
     set outcome = 'declined', responded_at = now()
   where order_id = p_order_id
     and provider_id = v_provider
     and outcome in ('pending', 'viewed');

  return found;
end;
$$;

/**
 * Closes the loop when someone wins the job.
 *
 * Everyone else's offer becomes `expired` rather than being left pending
 * forever. Without this the customer's counters keep claiming people are
 * reviewing a job that was settled minutes ago, and the acceptance-rate
 * statistic that feeds `match_providers` would punish providers for not
 * answering an offer that no longer existed.
 */
create or replace function public.settle_offers_on_accept()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.provider_id is not null and old.provider_id is distinct from new.provider_id then
    -- ⚠️ Needed because the column guard on order_offers refuses any write of
    -- `accepted` — that guard is what stops a provider declaring themselves
    -- the winner, and it cannot tell a system path from a client one. This is
    -- the system path: the order already has a provider, which only
    -- accept_order() can arrange, and it has already checked the escrow.
    perform public.begin_privileged_write();

    update public.order_offers
       set outcome = 'accepted', responded_at = coalesce(responded_at, now())
     where order_id = new.id and provider_id = new.provider_id;

    update public.order_offers
       set outcome = 'expired', responded_at = coalesce(responded_at, now())
     where order_id = new.id
       and provider_id <> new.provider_id
       and outcome in ('pending', 'viewed');

    perform public.end_privileged_write();
  end if;

  return new;
end;
$$;

create trigger orders_settle_offers
  after update of provider_id on public.orders
  for each row execute function public.settle_offers_on_accept();

alter table public.orders enable always trigger orders_settle_offers;

grant execute on function public.mark_offer_viewed(uuid) to authenticated;
grant execute on function public.decline_offer(uuid) to authenticated;
