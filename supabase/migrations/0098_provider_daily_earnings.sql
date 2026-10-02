-- 0098 — The technician's week, day by day
--
-- 0095 gave a technician today / this week / this month as three totals. A
-- total says how much; it does not say which days were good, which is the
-- thing a person working for themselves actually plans around ("Thursdays
-- are busy, Sundays are not"). This adds `daily`: the last seven days in
-- Riyadh time, oldest first, each with its jobs and net — net exactly as
-- 0095 computes it, commission off parts and labour, never off the VAT.
--
-- 0095 is wrapped, not rewritten, so nothing it already returns can change
-- (the pattern 0079 and 0096 use). The wrapped function keeps the approval
-- check: a customer, or an applicant not yet approved, is refused before any
-- of this runs.

alter function public.provider_dashboard() rename to provider_dashboard_0095;
revoke execute on function public.provider_dashboard_0095() from public, anon, authenticated;

create or replace function public.provider_dashboard()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_base     jsonb := public.provider_dashboard_0095();
  v_provider uuid := public.current_provider_id();
  v_today    date := (now() at time zone 'Asia/Riyadh')::date;
begin
  return v_base || jsonb_build_object('daily', (
    select jsonb_agg(jsonb_build_object(
             'day', to_char(d.day, 'YYYY-MM-DD'),
             'jobs', coalesce(x.jobs, 0),
             'net', coalesce(x.net, 0)::numeric(12,2)::text)
             order by d.day)
      from generate_series(v_today - 6, v_today, interval '1 day') as d(day)
      left join (
        select (o.completed_at at time zone 'Asia/Riyadh')::date as day,
               count(*) as jobs,
               sum(o.total_amount - round(
                     (o.parts_amount + o.labour_amount)
                     * coalesce(public.commission_rate_for(
                         s.category, (o.completed_at at time zone 'Asia/Riyadh')::date), 0.20),
                     2)) as net
          from public.orders o
          join public.services s on s.id = o.service_id
         where o.provider_id = v_provider
           and o.status = 'completed'
           and coalesce(o.total_amount, 0) > 0
           and (o.completed_at at time zone 'Asia/Riyadh')::date >= v_today - 6
         group by 1
      ) x on x.day = d.day::date));
end;
$$;

comment on function public.provider_dashboard() is
  'The caller''s own provider dashboard (0095), plus the last seven days (0098).';

revoke all on function public.provider_dashboard() from public, anon;
grant execute on function public.provider_dashboard() to authenticated;
