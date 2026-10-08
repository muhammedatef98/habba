-- 0099 — Where the technician is driving to
--
-- An accepted mobile job showed its address as a line of text and nothing
-- else: the technician copied it into a maps app by hand, at the roadside,
-- and an address typed by a stranded customer («عند البوابة ٣») is not
-- something a maps app can find. The pin the customer placed is exact; the
-- app could not read it, because PostgREST hands a geography column back as
-- hex WKB and the provider's order query never selected it anyway.
--
-- job_destination(order) returns that pin as plain coordinates, to the
-- technician the job is assigned to, while the job is theirs and live
-- (accepted → in progress). Before acceptance the offer stays masked
-- (ADR-0013: a distance band and a district, never a point); after the job
-- ends there is no reason to keep knowing where the customer was. The
-- privacy policy already names «موقع الخدمة» among what the assigned
-- provider receives.

create or replace function public.job_destination(p_order_id uuid)
returns table (lat double precision, lon double precision)
language sql
stable
security definer
set search_path = ''
as $$
  select extensions.st_y(o.service_location::extensions.geometry),
         extensions.st_x(o.service_location::extensions.geometry)
    from public.orders o
   where o.id = p_order_id
     and o.provider_id = public.current_provider_id()
     and o.status in ('accepted', 'en_route', 'arrived', 'in_progress')
     and o.service_location is not null;
$$;

comment on function public.job_destination(uuid) is
  'The customer''s pin for a live mobile job, to its assigned provider only. 0099.';

revoke all on function public.job_destination(uuid) from public, anon;
grant execute on function public.job_destination(uuid) to authenticated;
