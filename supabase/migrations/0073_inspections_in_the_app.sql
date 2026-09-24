-- 0073 — The inspection, as the app does it
--
-- The inspection backend (0026, 0027) has been complete and tested since
-- Phase 5, with no screens in front of it. Building them needs three facts the
-- schema did not state:
--
--   1. Which services are inspections that produce a structured report.
--      Not "the inspection category": Computer diagnostics sits in that
--      category and is not a 42-point assessment. So each service names its
--      template, or none — a column an operator sets from the catalogue.
--   2. That a report is filed against the template its service names. A
--      technician's app picking the wrong one would produce a scored report
--      about the wrong things.
--   3. That the job is not handed back until the report is filed. The report
--      is the product the customer paid for; a pre-purchase inspection with
--      no report is a technician's visit with nothing to show for it.

alter table public.services
  add column inspection_template_key text
    references public.inspection_templates (key) on update cascade on delete set null;

comment on column public.services.inspection_template_key is
  'The inspection template this service is performed against, if it is an inspection that files a report (0073).';

update public.services set inspection_template_key = 'pre_purchase_v1'
 where name_en = 'Pre-purchase inspection';


create or replace function public.inspection_report_matches_service()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expected text;
  v_actual   text;
begin
  select s.inspection_template_key into v_expected
    from public.orders o join public.services s on s.id = o.service_id
   where o.id = new.order_id;

  select t.key into v_actual from public.inspection_templates t where t.id = new.template_id;

  if v_expected is not null and v_expected <> v_actual then
    raise exception 'This order is inspected against the % template, not %', v_expected, v_actual
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger inspection_reports_a_matches_service
  before insert on public.inspection_reports
  for each row execute function public.inspection_report_matches_service();

alter table public.inspection_reports enable always trigger inspection_reports_a_matches_service;


create or replace function public.require_inspection_report()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  if (new.status = 'awaiting_approval'
      or (new.status = 'completed' and old.status = 'in_progress'))
     and exists (select 1 from public.services s
                  where s.id = new.service_id and s.inspection_template_key is not null)
     and not exists (select 1 from public.inspection_reports r where r.order_id = new.id) then
    raise exception 'The inspection report has to be filed before the job is handed back'
      using errcode = 'check_violation',
            hint = 'inspection_report_required';
  end if;
  return new;
end;
$$;

-- `c`: after the column guards and the bill, before the state machine writes
-- its event — a refused hand-back leaves no trace.
create trigger orders_c_require_inspection_report
  before update of status on public.orders
  for each row execute function public.require_inspection_report();

alter table public.orders enable always trigger orders_c_require_inspection_report;
