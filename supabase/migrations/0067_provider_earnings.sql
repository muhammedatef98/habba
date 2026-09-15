-- 0067 — What the technician has earned, from the same arithmetic that pays them
--
-- 0031 computes payouts and nothing has ever read them. A technician finished a
-- job and the money vanished from view: `listMyJobs` filters to live statuses,
-- so completed work left the app entirely, and `payouts` only gains a row when
-- ops runs `build_payout` — which may be a week later, or never in a pilot.
-- Between finishing the work and being paid there was no screen that said
-- anything at all.
--
-- ⚠️ The rule this file exists to enforce: the number a provider is SHOWN and
-- the number they are PAID must come from one piece of code.
--
-- The obvious implementation is a query on the earnings screen that sums
-- completed orders and applies the commission rate. It would be a second
-- implementation of `build_payout`'s arithmetic, and the two would drift the
-- first time either changed — commission on the gross instead of the net, a
-- different idea of which orders are eligible, a rounding difference of two
-- halalas per line. A technician told 480 and paid 460 does not file a bug
-- report; they stop using the app, and they tell the other technicians why.
--
-- So `payable_order_lines` below is the single source, and `build_payout` is
-- rebuilt to call it. There is no second formula to keep in step —
-- `supabase/tests/39_provider_earnings.sql` asserts the estimate equals the
-- payout that follows it, to the halala.


/**
 * Commission on one order line.
 *
 * Taken on the NET, never the gross: charging commission on the VAT would mean
 * taking a cut of money that belongs to ZATCA. Lifted out of `build_payout`
 * verbatim so the rate and the rounding have one home.
 */
create or replace function public.payout_line_commission(
  p_parts  numeric,
  p_labour numeric,
  p_rate   numeric
)
returns numeric
language sql
immutable
parallel safe
as $$
  select round((coalesce(p_parts, 0) + coalesce(p_labour, 0)) * coalesce(p_rate, 0), 2);
$$;

/**
 * Every order this provider is owed for and has not been paid for.
 *
 * The eligibility rules, all of which were inline in `build_payout`:
 *
 *   * `completed` — not merely handed back. The customer confirms (ADR-0006).
 *   * `escrow_status = 'captured'` — the money was actually taken. Paying out
 *     on a failed capture means paying a provider from Habba's own pocket.
 *   * not already in `payout_orders` — an order is paid once, ever.
 *
 * `p_from`/`p_to` are optional. `build_payout` passes a settlement period; the
 * provider-facing view passes nothing, because "what am I owed" has no period —
 * it is everything that has not been settled yet, including work from a period
 * ops has not run.
 */
create or replace function public.payable_order_lines(
  p_provider_id uuid,
  p_from        date default null,
  p_to          date default null
)
returns table (
  order_id     uuid,
  order_number text,
  service_name_ar text,
  service_name_en text,
  completed_at timestamptz,
  gross        numeric(12,2),
  commission   numeric(12,2),
  net          numeric(12,2)
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    o.id,
    o.order_number,
    s.name_ar,
    s.name_en,
    o.completed_at,
    o.total_amount,
    public.payout_line_commission(
      o.parts_amount, o.labour_amount,
      coalesce(public.commission_rate_for(s.category, coalesce(p_to, current_date)), 0.20)
    ),
    o.total_amount - public.payout_line_commission(
      o.parts_amount, o.labour_amount,
      coalesce(public.commission_rate_for(s.category, coalesce(p_to, current_date)), 0.20)
    )
  from public.orders o
  join public.services s on s.id = o.service_id
  where o.provider_id = p_provider_id
    and o.status = 'completed'
    and o.escrow_status = 'captured'
    and coalesce(o.total_amount, 0) > 0
    and (p_from is null or o.completed_at::date >= p_from)
    and (p_to   is null or o.completed_at::date <= p_to)
    and not exists (select 1 from public.payout_orders po where po.order_id = o.id)
  order by o.completed_at desc;
$$;

-- ⚠️ Revoked from `anon` and `authenticated` BY NAME, not just from `public`.
--
-- 0001 sets `alter default privileges in schema public grant all on functions
-- to anon, authenticated, service_role`, so every new function arrives
-- executable by any signed-in user — and a `revoke ... from public` does not
-- touch a grant held directly by a named role. This function takes a provider
-- id, and an argument is a thing a client can change: left as it arrived, any
-- signed-in user could read any technician's earnings by passing their id.
--
-- Caught by suite 39, which asserts a second technician gets 42501 here.
revoke all on function public.payable_order_lines(uuid, date, date)
  from public, anon, authenticated;
grant execute on function public.payable_order_lines(uuid, date, date) to service_role;


/**
 * The technician's own unsettled work.
 *
 * ⚠️ Takes no provider id. It reads `current_provider_id()`, so there is no
 * argument to tamper with — the shape of the API is the access control, the
 * same reasoning as `list_open_orders_for_provider` (ADR-0013).
 */
create or replace function public.my_unsettled_orders()
returns table (
  order_id     uuid,
  order_number text,
  service_name_ar text,
  service_name_en text,
  completed_at timestamptz,
  gross        numeric(12,2),
  commission   numeric(12,2),
  net          numeric(12,2)
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_provider uuid := public.current_provider_id();
begin
  if v_provider is null then return; end if;
  return query select * from public.payable_order_lines(v_provider, null, null);
end;
$$;

grant execute on function public.my_unsettled_orders() to authenticated;

/**
 * The same thing totalled, for the headline figure.
 *
 * A separate call rather than summing the list on the device: the list is
 * paginated in the UI eventually, and a total computed from a page is a total
 * that silently shrinks. It also keeps the arithmetic where the money is.
 */
create or replace function public.my_earnings_summary()
returns table (
  unsettled_count      int,
  unsettled_gross      numeric(12,2),
  unsettled_commission numeric(12,2),
  unsettled_net        numeric(12,2),
  paid_net             numeric(12,2),
  last_paid_at         timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_provider uuid := public.current_provider_id();
begin
  if v_provider is null then return; end if;

  return query
  select
    coalesce(u.n, 0)::int,
    coalesce(u.gross, 0)::numeric(12,2),
    coalesce(u.commission, 0)::numeric(12,2),
    coalesce(u.net, 0)::numeric(12,2),
    coalesce(p.paid_net, 0)::numeric(12,2),
    p.last_paid_at
  from
    (select count(*) as n, sum(l.gross) as gross,
            sum(l.commission) as commission, sum(l.net) as net
       from public.payable_order_lines(v_provider, null, null) l) u
    left join lateral (
      -- `paid`, not `approved`. An approved payout is a promise; this figure
      -- sits next to «غير مسدّد» and the difference between them has to be the
      -- difference between money received and money owed, or the screen is
      -- lying in the one place a technician checks it.
      select sum(py.net_amount) as paid_net, max(py.paid_at) as last_paid_at
        from public.payouts py
       where py.provider_id = v_provider and py.status = 'paid'
    ) p on true;
end;
$$;

grant execute on function public.my_earnings_summary() to authenticated;


-- Rebuilt to use the shared line source. Behaviour is unchanged; what changes
-- is that there is now exactly one definition of "which orders, at what
-- commission" in the schema, and the provider's screen reads the same one.
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
  v_line record;
begin
  if not public.is_ops() then
    raise exception 'Only ops may build payouts' using errcode = 'insufficient_privilege';
  end if;

  insert into public.payouts (
    provider_id, period_start, period_end, gross_amount, commission, net_amount, order_count
  ) values (p_provider_id, p_period_start, p_period_end, 0, 0, 0, 0)
  returning id into v_payout_id;

  for v_line in
    select * from public.payable_order_lines(p_provider_id, p_period_start, p_period_end)
  loop
    insert into public.payout_orders (payout_id, order_id, gross, commission)
    values (v_payout_id, v_line.order_id, v_line.gross, v_line.commission);

    v_gross := v_gross + v_line.gross;
    v_commission := v_commission + v_line.commission;
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


/**
 * The orders behind one payout, with their service names.
 *
 * `payout_orders` is readable under RLS already, but only as ids and figures.
 * A statement listing six uuids is not a statement anyone can check, and the
 * point of showing a payout's lines at all is that a technician can reconcile
 * it against the work they remember doing.
 *
 * Definer, but scoped to the caller's own payout — an id belonging to someone
 * else returns nothing rather than raising, so the function cannot be used to
 * probe which payout ids exist.
 */
create or replace function public.my_payout_lines(p_payout_id uuid)
returns table (
  order_id     uuid,
  order_number text,
  service_name_ar text,
  service_name_en text,
  completed_at timestamptz,
  gross        numeric(12,2),
  commission   numeric(12,2),
  net          numeric(12,2)
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_provider uuid := public.current_provider_id();
begin
  if v_provider is null then return; end if;

  if not exists (
    select 1 from public.payouts p
     where p.id = p_payout_id and p.provider_id = v_provider
  ) then
    return;
  end if;

  return query
  select
    po.order_id, o.order_number, s.name_ar, s.name_en, o.completed_at,
    po.gross, po.commission, (po.gross - po.commission)::numeric(12,2)
  from public.payout_orders po
  join public.orders o on o.id = po.order_id
  join public.services s on s.id = o.service_id
  where po.payout_id = p_payout_id
  order by o.completed_at desc;
end;
$$;

grant execute on function public.my_payout_lines(uuid) to authenticated;
