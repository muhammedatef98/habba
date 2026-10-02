-- 0076 — The tables the app watches live
--
-- The app subscribes to changes on orders, their parts and technicians'
-- offers (apps/mobile/src/features/shared/lib/live.ts) and refetches through
-- the normal API when one arrives. Supabase Realtime only streams tables in
-- its publication, and only rows the subscriber's RLS lets them select — so
-- adding a table here widens nothing: a customer still hears only about
-- their own orders, a technician only about their own offers.
--
-- The publication exists on a Supabase project and not in the bare-Postgres
-- harness, hence the guard.

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables
                    where pubname = 'supabase_realtime' and tablename = 'orders') then
      alter publication supabase_realtime add table public.orders;
    end if;
    if not exists (select 1 from pg_publication_tables
                    where pubname = 'supabase_realtime' and tablename = 'order_parts') then
      alter publication supabase_realtime add table public.order_parts;
    end if;
    if not exists (select 1 from pg_publication_tables
                    where pubname = 'supabase_realtime' and tablename = 'order_offers') then
      alter publication supabase_realtime add table public.order_offers;
    end if;
  end if;
end
$$;
