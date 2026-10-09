-- 0107 — A workshop can say where it is; ops can see every calendar
--
-- A workshop booking shows the workshop's address and the customer drives
-- there. The address and the map point come only from upsert_workshop()
-- (0023), which nothing in the app called: an approved workshop had no row,
-- and the booking picker showed it as «يأتيك إلى موقعك».
--
--   my_workshop()          the caller's own workshop row, for the «ورشتي»
--                          screen to edit (upsert_workshop writes it).
--   ops_provider_detail()  adds the provider's calendar (0104): open, booked
--                          and closed times in the next 14 days and the next
--                          open one — so ops can see why a technician gets no
--                          bookings, under the rule that every feature
--                          reaches the console too.

create or replace function public.my_workshop()
returns table (
  address_ar    text,
  lat           double precision,
  lon           double precision,
  bay_count     int,
  opening_hours jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_provider_id uuid := public.current_provider_id();
begin
  if v_provider_id is null then
    raise exception 'Only an approved provider has a workshop'
      using errcode = 'insufficient_privilege';
  end if;

  return query
    select w.address_ar,
           extensions.st_y(w.location::extensions.geometry),
           extensions.st_x(w.location::extensions.geometry),
           w.bay_count,
           w.opening_hours
      from public.workshops w
     where w.provider_id = v_provider_id;
end;
$$;

revoke all on function public.my_workshop() from public, anon;
grant execute on function public.my_workshop() to authenticated;


alter function public.ops_provider_detail(uuid) rename to ops_provider_detail_0070;
revoke execute on function public.ops_provider_detail_0070(uuid) from public, anon, authenticated;

create or replace function public.ops_provider_detail(p_provider_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- The wrapped body asserts ops and records the read (0070).
  return public.ops_provider_detail_0070(p_provider_id)
    || jsonb_build_object(
         'availability', (
           select jsonb_build_object(
                    'open', count(*) filter (where not s.is_blocked and s.booked_count < s.capacity),
                    'booked', count(*) filter (where s.booked_count > 0),
                    'closed', count(*) filter (where s.is_blocked and s.booked_count = 0),
                    'next_open_at', min(s.starts_at) filter (where not s.is_blocked and s.booked_count < s.capacity))
             from public.appointment_slots s
            where s.provider_id = p_provider_id
              and s.starts_at > now()
              and s.starts_at < now() + interval '14 days'));
end;
$$;

revoke execute on function public.ops_provider_detail(uuid) from public, anon;
grant execute on function public.ops_provider_detail(uuid) to authenticated;
