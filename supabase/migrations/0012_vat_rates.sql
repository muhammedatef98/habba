-- 0012 — VAT rates as data
-- ADR-0007. Nothing charges VAT until Phase 3, but the historical record has
-- to start correct: an invoice must reproduce the rate in force on its issue
-- date, not today's rate. Saudi VAT already moved 5% → 15% once (July 2020).

create table public.vat_rates (
  id         uuid primary key default gen_random_uuid(),
  rate       numeric(5,4) not null check (rate >= 0 and rate < 1),
  valid_from date not null,
  valid_to   date,
  created_at timestamptz not null default now(),

  constraint vat_rates_range check (valid_to is null or valid_to > valid_from)
);

-- Exactly one open-ended (current) rate.
create unique index vat_rates_one_current_idx on public.vat_rates ((valid_to is null))
  where valid_to is null;

create or replace function public.vat_rate_on(p_date date default current_date)
returns numeric
language sql
stable
as $$
  select r.rate
  from public.vat_rates r
  where r.valid_from <= p_date
    and (r.valid_to is null or r.valid_to > p_date)
  order by r.valid_from desc
  limit 1;
$$;

insert into public.vat_rates (rate, valid_from, valid_to) values
  (0.0500, date '2018-01-01', date '2020-07-01'),
  (0.1500, date '2020-07-01', null);

comment on table public.vat_rates is
  'VAT rate history. Never hardcode 15% — invoices must reproduce the rate in force. ADR-0007.';
