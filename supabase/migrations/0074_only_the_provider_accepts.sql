-- 0074 — Only the provider accepts a booking
--
-- Found while building the workshop's «حجوزات بانتظار التأكيد» surface, and
-- recorded by suite 44 before it was closed.
--
-- `book_appointment` opens a booking at `draft` with the provider already
-- named — the customer chose them. The workshop transition table allows
-- `draft → accepted`, `orders_update_customer` (0022) lets the customer write
-- their own order, and `guard_order_columns` (0033) explicitly permits a
-- customer to "cancel and confirm". Nothing anywhere asked WHO was doing the
-- accepting.
--
-- So a customer could move their own booking to `accepted`, and the workshop
-- would find a committed job on its list that it had never agreed to: a bay
-- reserved, a technician expected, a price fixed. Its only recourse would be
-- to cancel a job the app had already told the customer was confirmed.
--
-- Nobody had done it because no surface offered it. That is not the same as it
-- being impossible — `orders` is a table clients write to directly, and §2.2 is
-- explicit that a hand-crafted request is the thing to defend against.
--
-- ⚠️ The rule is narrow on purpose. It is about ACCEPTING, and nothing else:
--
--   * A customer may still cancel, at any point. Their money, their car.
--   * A customer still confirms COMPLETION — that is the escrow promise
--     (§1.4), and 0020 already forbids the provider from doing it.
--   * `draft → quoted` is untouched: `guard_order_columns` already refuses a
--     customer any write to `quoted_amount`, so moving that status alone
--     changes no money and commits nobody to anything.
--   * On-demand is untouched. `accept_order` claims an order with NO provider
--     from inside `begin_privileged_write`, so it passes the exemption below.
--
-- A separate trigger rather than an edit to `enforce_order_transition`: that
-- function has been amended by 0025, 0032 and 0047, and re-issuing a whole
-- body to add six lines is how one of those amendments gets dropped. Named
-- `orders_b_…` so it sorts after `orders_a_guard_columns` (0033) and before
-- `orders_enforce_transition` — the acceptance is refused before the state
-- machine starts writing `accepted_at` and the warranty window.

create or replace function public.guard_booking_acceptance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = old.status then
    return new;
  end if;

  -- Ops and the server's own functions are outside this, as everywhere else.
  if public.is_ops() or public.is_privileged_write() then
    return new;
  end if;

  -- Only where a provider is ALREADY named. That is exactly the booked flow,
  -- and it is the only flow where "accepted" is somebody else's commitment to
  -- make on somebody else's behalf.
  if new.status = 'accepted'
     and old.status in ('draft', 'quoted')
     and old.provider_id is not null
     and public.current_provider_id() is distinct from old.provider_id
  then
    raise exception 'Only the provider may confirm this booking'
      using errcode = 'insufficient_privilege',
            hint = 'The workshop confirms the appointment. You can cancel it.';
  end if;

  return new;
end;
$$;

comment on function public.guard_booking_acceptance is
  'A booking is accepted by the party who has to do the work (0074).';

create trigger orders_b_guard_acceptance
  before update on public.orders
  for each row execute function public.guard_booking_acceptance();

-- `enable always`, like every other guard on this table: a replica or a
-- session-replication-role trick must not be a way around it.
alter table public.orders enable always trigger orders_b_guard_acceptance;
