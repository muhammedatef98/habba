-- 0031 — Provider payouts
--
-- Build prompt §6.8. What a provider is owed for a settlement period, less
-- commission.
--
-- ⚠️ This computes the figures. It does NOT move money — that depends on
-- ADR-0008 (whether Habba may hold and disburse provider funds at all, which
-- is a SAMA question). The schema is deliberately arranged so the arithmetic
-- is settled and auditable before the mechanism is chosen.

create table public.commission_rates (
  id           uuid primary key default gen_random_uuid(),
  -- Null category = the default rate.
  category     service_category,
  rate         numeric(5,4) not null check (rate >= 0 and rate < 1),
  valid_from   date not null,
  valid_to     date,
  created_at   timestamptz not null default now(),

  constraint commission_rates_range check (valid_to is null or valid_to > valid_from)
);

-- One open-ended rate per category, and only one default.
-- NULLS NOT DISTINCT (Postgres 15+) is what makes the default row unique:
-- with the usual NULL semantics two null-category rows would both be allowed,
-- and `coalesce(category::text, '*')` cannot be indexed because the enum cast
-- is not IMMUTABLE.
create unique index commission_rates_current_idx
  on public.commission_rates (category) nulls not distinct where valid_to is null;

create or replace function public.commission_rate_for(
  p_category service_category,
  p_on       date default current_date
)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select r.rate
  from public.commission_rates r
  where (r.category = p_category or r.category is null)
    and r.valid_from <= p_on
    and (r.valid_to is null or r.valid_to > p_on)
  -- A category-specific rate beats the default.
  order by (r.category is not null) desc, r.valid_from desc
  limit 1;
$$;


create type payout_status as enum ('pending', 'approved', 'paid', 'failed');

create table public.payouts (
  id           uuid primary key default gen_random_uuid(),
  provider_id  uuid not null references public.providers(id) on delete restrict,
  period_start date not null,
  period_end   date not null,

  gross_amount numeric(12,2) not null,
  commission   numeric(12,2) not null,
  net_amount   numeric(12,2) not null,
  order_count  int not null,

  status       payout_status not null default 'pending',
  paid_at      timestamptz,
  reference    text,

  created_at   timestamptz not null default now(),

  constraint payouts_period check (period_end >= period_start),
  constraint payouts_reconcile check (net_amount = gross_amount - commission),
  constraint payouts_non_negative check (
    gross_amount >= 0 and commission >= 0 and net_amount >= 0
  ),
  constraint payouts_paid_consistent check (
    (status = 'paid' and paid_at is not null) or (status <> 'paid' and paid_at is null)
  )
);

-- One payout per provider per period. A repeated run of the payout job must
-- not create a second one and pay twice.
create unique index payouts_unique_period_idx
  on public.payouts (provider_id, period_start, period_end);

create index payouts_status_idx on public.payouts (status, period_end desc);


-- Which orders belong to a payout, so a provider can see what they were paid
-- for and a dispute can be traced to a line.
create table public.payout_orders (
  payout_id uuid not null references public.payouts(id) on delete cascade,
  order_id  uuid not null references public.orders(id) on delete restrict,
  gross     numeric(12,2) not null,
  commission numeric(12,2) not null,
  primary key (payout_id, order_id)
);

-- An order can only ever be paid once.
create unique index payout_orders_order_idx on public.payout_orders (order_id);


create or replace function public.build_payout(
  p_provider_id uuid,
  p_period_start date,
  p_period_end   date
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payout_id uuid;
  v_gross numeric(12,2) := 0;
  v_commission numeric(12,2) := 0;
  v_count int := 0;
  v_order record;
  v_rate numeric;
  v_line_commission numeric(12,2);
begin
  if not public.is_ops() then
    raise exception 'Only ops may build payouts' using errcode = 'insufficient_privilege';
  end if;

  insert into public.payouts (
    provider_id, period_start, period_end, gross_amount, commission, net_amount, order_count
  ) values (p_provider_id, p_period_start, p_period_end, 0, 0, 0, 0)
  returning id into v_payout_id;

  for v_order in
    select o.*, s.category
    from public.orders o
    join public.services s on s.id = o.service_id
    where o.provider_id = p_provider_id
      and o.status = 'completed'
      and o.completed_at::date between p_period_start and p_period_end
      -- Money must actually have been taken. Paying out on an order whose
      -- capture failed means paying a provider from Habba's own pocket.
      and o.escrow_status = 'captured'
      and coalesce(o.total_amount, 0) > 0
      -- Never pay for the same order twice.
      and not exists (select 1 from public.payout_orders po where po.order_id = o.id)
  loop
    v_rate := coalesce(public.commission_rate_for(v_order.category, p_period_end), 0.20);

    -- Commission is taken on the net, not the gross. Charging commission on
    -- the VAT would mean taking a cut of money that belongs to the tax
    -- authority.
    v_line_commission := round(
      (v_order.parts_amount + v_order.labour_amount) * v_rate, 2);

    insert into public.payout_orders (payout_id, order_id, gross, commission)
    values (v_payout_id, v_order.id, v_order.total_amount, v_line_commission);

    v_gross := v_gross + v_order.total_amount;
    v_commission := v_commission + v_line_commission;
    v_count := v_count + 1;
  end loop;

  update public.payouts
  set gross_amount = v_gross,
      commission = v_commission,
      net_amount = v_gross - v_commission,
      order_count = v_count
  where id = v_payout_id;

  return v_payout_id;
end;
$$;

grant execute on function public.build_payout(uuid, date, date) to authenticated;
grant execute on function public.commission_rate_for(service_category, date) to authenticated;

alter table public.commission_rates enable row level security;
alter table public.payouts enable row level security;
alter table public.payout_orders enable row level security;

create policy commission_rates_read on public.commission_rates
  for select to authenticated using (true);
create policy commission_rates_write on public.commission_rates
  for all to authenticated using (public.is_ops()) with check (public.is_ops());

-- A provider sees their own payouts and nobody else's earnings.
create policy payouts_read on public.payouts
  for select to authenticated
  using (provider_id = public.current_provider_id() or public.is_ops());
create policy payouts_write on public.payouts
  for all to authenticated using (public.is_ops()) with check (public.is_ops());

create policy payout_orders_read on public.payout_orders
  for select to authenticated using (
    exists (select 1 from public.payouts p
            where p.id = payout_orders.payout_id
              and (p.provider_id = public.current_provider_id() or public.is_ops()))
  );


-- Seed: default commission and the Habba selling entity ------------------------
-- ⚠️ Both are placeholders. The commission rate is a business decision nobody
-- has made, and the VAT number is not a real registration — it is
-- format-valid so the QR encoder can be exercised. Neither may reach
-- production unreviewed.
insert into public.commission_rates (category, rate, valid_from)
values (null, 0.2000, date '2026-01-01')
on conflict do nothing;

insert into public.invoice_sellers (provider_id, legal_name_ar, vat_number, cr_number)
values (null, 'شركة هبّة للتقنية', '300000000000003', '1010000000')
on conflict do nothing;
