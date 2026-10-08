-- 0100 — Policies that ask "who is this?" once per query, not once per row
--
-- The performance advisor (auth_rls_initplan) found 29 policies calling
-- auth.uid() bare. Postgres evaluates that per row it checks; wrapped as
-- (select auth.uid()) it becomes an init-plan, evaluated once per statement.
-- The answer is the same — the caller does not change mid-query — so this
-- changes cost, never who can see what. Every RLS suite and rls.spec.ts run
-- against the result.
--
-- The rewrite is mechanical, so it is done mechanically: each public policy's
-- expressions are read back fully schema-qualified (search_path '' while
-- deparsing), bare auth.uid() is wrapped, already-wrapped calls are left
-- alone, and only policies that actually change are altered. Suite 66 fails
-- if a later migration adds a bare call back.
--
-- And covering indexes for the foreign keys the app actually joins or
-- filters on (unindexed_foreign_keys): the order's service, workshop, slot
-- and warranty parent; a vehicle's make and model; and the rows looked up by
-- user or by parent. Audit columns (created_by, granted_by) are left as
-- they are: nothing reads by them, and profiles are anonymised, not deleted.

do $$
declare
  p        record;
  v_qual   text;
  v_check  text;
  v_wrap   constant text := '( SELECT auth.uid() AS uid)';
begin
  set local search_path = '';
  for p in
    select tablename, policyname, qual, with_check
      from pg_catalog.pg_policies
     where schemaname = 'public'
       and (coalesce(qual, '') like '%auth.uid()%' or coalesce(with_check, '') like '%auth.uid()%')
  loop
    v_qual := replace(replace(replace(p.qual, v_wrap, '@@uid@@'), 'auth.uid()', '(select auth.uid())'), '@@uid@@', v_wrap);
    v_check := replace(replace(replace(p.with_check, v_wrap, '@@uid@@'), 'auth.uid()', '(select auth.uid())'), '@@uid@@', v_wrap);

    if p.qual is not null and v_qual is distinct from p.qual then
      execute format('alter policy %I on public.%I using (%s)', p.policyname, p.tablename, v_qual);
    end if;
    if p.with_check is not null and v_check is distinct from p.with_check then
      execute format('alter policy %I on public.%I with check (%s)', p.policyname, p.tablename, v_check);
    end if;
  end loop;
end
$$;

create index if not exists orders_service_idx            on public.orders (service_id);
create index if not exists orders_workshop_idx           on public.orders (workshop_id);
create index if not exists orders_slot_idx               on public.orders (slot_id);
create index if not exists orders_parent_order_idx       on public.orders (parent_order_id);
create index if not exists vehicles_make_idx             on public.vehicles (make_id);
create index if not exists vehicles_model_idx            on public.vehicles (model_id);
create index if not exists ratings_rater_idx             on public.ratings (rater_id);
create index if not exists provider_services_service_idx on public.provider_services (service_id);
create index if not exists notification_outbox_user_idx on public.notification_outbox (user_id);
create index if not exists push_tickets_notification_idx on public.push_tickets (notification_id);
create index if not exists order_events_actor_idx        on public.order_events (actor_id);
create index if not exists ownership_transfers_from_idx  on public.ownership_transfers (from_owner_id);
create index if not exists ownership_transfers_to_idx    on public.ownership_transfers (to_owner_id);
create index if not exists maintenance_alerts_rule_idx   on public.maintenance_alerts (rule_id);
create index if not exists maintenance_alerts_service_idx on public.maintenance_alerts (service_id);
create index if not exists maintenance_alerts_order_idx  on public.maintenance_alerts (order_id);
create index if not exists vehicle_reminders_user_idx    on public.vehicle_reminders (user_id);
create index if not exists vehicle_maintenance_items_type_idx
  on public.vehicle_maintenance_items (item_type);
create index if not exists inspection_reports_template_idx on public.inspection_reports (template_id);
