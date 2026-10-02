-- 0095 — The technician's own dashboard
--
-- A technician had a shift toggle and a list of live jobs, and nothing else:
-- no idea what the week had earned, what was waiting to be paid, how
-- customers had rated the work, or what had been done last Tuesday. All of it
-- was already in the database (orders, payouts, ratings, the provider row);
-- none of it was readable in one place, and some of it — the net after
-- commission — is arithmetic the app must not do on its own (§2.2).
--
-- provider_dashboard() returns it in one call, for the caller's own approved
-- provider record and nobody else's:
--
--   profile   name, type, city, rating, jobs done, member since, verification
--   periods   today / this week (from Sunday) / this month, Riyadh time:
--             jobs, gross, net — net as build_payout computes it, commission
--             on parts + labour, never on VAT
--   unpaid    completed, captured, not yet in any payout
--   payouts   the last six
--   stars     how many of each, 1–5 (visible reviews only)
--   reviews   the last ten visible ones: stars, tags, comment, date — never
--             who wrote them
--   recent    the last fifteen completed jobs
--
-- Money leaves as 2dp strings, never JSON numbers (ADR-0007).
--
-- §5.1.3: a customer-only user, or an applicant not yet approved, gets
-- nothing — the function raises rather than returning an empty dashboard,
-- so a hand-crafted call learns no more than the app would show.

create or replace function public.provider_dashboard()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_provider  uuid := public.current_provider_id();
  v_today     date := (now() at time zone 'Asia/Riyadh')::date;
  v_week      date;
  v_month     date;
  v_result    jsonb;
begin
  if v_provider is null or not public.is_provider() then
    raise exception 'Only an approved provider has a dashboard'
      using errcode = 'insufficient_privilege', hint = 'provider:not_approved';
  end if;

  -- The Saudi week starts on Sunday (dow 0).
  v_week  := v_today - extract(dow from v_today)::int;
  v_month := date_trunc('month', v_today)::date;

  with done as (
    select o.id,
           o.order_number,
           o.total_amount,
           o.escrow_status,
           (o.completed_at at time zone 'Asia/Riyadh')::date as day,
           o.completed_at,
           s.name_ar,
           s.name_en,
           o.total_amount - round(
             (o.parts_amount + o.labour_amount)
             * coalesce(public.commission_rate_for(
                 s.category, (o.completed_at at time zone 'Asia/Riyadh')::date), 0.20),
             2) as net
      from public.orders o
      join public.services s on s.id = o.service_id
     where o.provider_id = v_provider
       and o.status = 'completed'
       and coalesce(o.total_amount, 0) > 0
  ),
  period as (
    select jsonb_build_object(
      'today', jsonb_build_object(
        'jobs',  count(*) filter (where day = v_today),
        'gross', coalesce(sum(total_amount) filter (where day = v_today), 0)::numeric(12,2)::text,
        'net',   coalesce(sum(net) filter (where day = v_today), 0)::numeric(12,2)::text),
      'week', jsonb_build_object(
        'jobs',  count(*) filter (where day >= v_week),
        'gross', coalesce(sum(total_amount) filter (where day >= v_week), 0)::numeric(12,2)::text,
        'net',   coalesce(sum(net) filter (where day >= v_week), 0)::numeric(12,2)::text),
      'month', jsonb_build_object(
        'jobs',  count(*) filter (where day >= v_month),
        'gross', coalesce(sum(total_amount) filter (where day >= v_month), 0)::numeric(12,2)::text,
        'net',   coalesce(sum(net) filter (where day >= v_month), 0)::numeric(12,2)::text)
    ) as periods
    from done
  )
  select jsonb_build_object(
    'profile', (
      select jsonb_build_object(
        'business_name_ar', p.business_name_ar,
        'business_name_en', p.business_name_en,
        'provider_type',    p.provider_type,
        'city_name_ar',     c.name_ar,
        'city_name_en',     c.name_en,
        'rating_avg',       p.rating_avg,
        'rating_count',     p.rating_count,
        'jobs_completed',   p.jobs_completed,
        'acceptance_rate',  p.acceptance_rate,
        'nafath_verified',  p.nafath_verified_at is not null,
        'member_since',     p.created_at)
        from public.providers p
        join public.cities c on c.id = p.city_id
       where p.id = v_provider),
    'periods', (select periods from period),
    'unpaid', (
      select jsonb_build_object(
        'jobs', count(*),
        'net',  coalesce(sum(d.net), 0)::numeric(12,2)::text)
        from done d
       where d.escrow_status = 'captured'
         and not exists (select 1 from public.payout_orders po where po.order_id = d.id)),
    'payouts', coalesce((
      select jsonb_agg(x order by x.period_end desc)
        from (
          select py.id, py.period_start, py.period_end, py.net_amount::text as net_amount, py.order_count,
                 py.status, py.paid_at
            from public.payouts py
           where py.provider_id = v_provider
           order by py.period_end desc
           limit 6
        ) x), '[]'::jsonb),
    'stars', (
      select jsonb_build_object(
        '1', count(*) filter (where r.stars = 1),
        '2', count(*) filter (where r.stars = 2),
        '3', count(*) filter (where r.stars = 3),
        '4', count(*) filter (where r.stars = 4),
        '5', count(*) filter (where r.stars = 5))
        from public.ratings r
       where r.provider_id = v_provider and r.hidden_at is null),
    'reviews', coalesce((
      select jsonb_agg(x order by x.created_at desc)
        from (
          select r.stars, coalesce(r.tags, '{}') as tags, r.comment, r.created_at
            from public.ratings r
           where r.provider_id = v_provider and r.hidden_at is null
           order by r.created_at desc
           limit 10
        ) x), '[]'::jsonb),
    'recent', coalesce((
      select jsonb_agg(x order by x.completed_at desc)
        from (
          select d.id as order_id, d.order_number, d.name_ar, d.name_en,
                 d.completed_at, d.total_amount::text as total_amount,
                 d.net::numeric(12,2)::text as net
            from done d
           order by d.completed_at desc
           limit 15
        ) x), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

comment on function public.provider_dashboard() is
  'The caller''s own earnings, payouts, ratings and recent jobs, for an approved provider only. 0095.';

revoke all on function public.provider_dashboard() from public, anon;
grant execute on function public.provider_dashboard() to authenticated;
