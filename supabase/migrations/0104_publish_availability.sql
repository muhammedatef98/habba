-- 0104 — A technician can say when they are free
--
-- Booking a visit lists the chosen technician's appointment slots, and the
-- list was always empty: slots come only from generate_slots() (0024), which
-- nothing in the app ever called. A customer picked an available technician
-- and was shown no times at all.
--
-- These are what the provider's «مواعيدي» screen needs:
--
--   publish_availability()  chosen days, one working window, one slot length.
--                           Days off are simply not chosen (generate_slots
--                           filled every day in a range). Riyadh time, past
--                           times skipped, existing slots left alone, and the
--                           count actually added is returned.
--   my_slots()              the caller's own coming slots, booked or blocked.
--   set_slot_blocked()      close a time, or open it again. A booked slot can
--                           be closed to further bookings; the booking it
--                           already holds stands.

create or replace function public.publish_availability(
  p_dates        date[],
  p_start_minute int,
  p_end_minute   int,
  p_slot_minutes int
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_provider_id uuid := public.current_provider_id();
  v_today       date := (now() at time zone 'Asia/Riyadh')::date;
  v_day         date;
  v_minute      int;
  v_starts_at   timestamptz;
  v_added       int := 0;
  v_rows        int;
begin
  if v_provider_id is null then
    raise exception 'Only an approved provider publishes availability'
      using errcode = 'insufficient_privilege', hint = 'slots:not_provider';
  end if;

  if p_dates is null or cardinality(p_dates) not between 1 and 31 then
    raise exception 'Choose between 1 and 31 days'
      using errcode = 'check_violation', hint = 'slots:days';
  end if;

  if p_slot_minutes not in (30, 45, 60, 90, 120)
     or p_start_minute is null or p_end_minute is null
     or p_start_minute < 0 or p_end_minute > 1440
     or p_end_minute - p_start_minute < p_slot_minutes then
    raise exception 'The working window must fit at least one appointment'
      using errcode = 'check_violation', hint = 'slots:window';
  end if;

  foreach v_day in array p_dates loop
    if v_day < v_today or v_day > v_today + 60 then
      raise exception 'Days must be from today to 60 days ahead'
        using errcode = 'check_violation', hint = 'slots:days';
    end if;

    v_minute := p_start_minute;
    while v_minute + p_slot_minutes <= p_end_minute loop
      v_starts_at := (v_day + make_interval(mins => v_minute))::timestamp at time zone 'Asia/Riyadh';
      if v_starts_at > now() then
        insert into public.appointment_slots (provider_id, starts_at, ends_at, capacity)
        values (v_provider_id, v_starts_at, v_starts_at + make_interval(mins => p_slot_minutes), 1)
        on conflict (provider_id, starts_at) do nothing;
        get diagnostics v_rows = row_count;
        v_added := v_added + v_rows;
      end if;
      v_minute := v_minute + p_slot_minutes;
    end loop;
  end loop;

  return v_added;
end;
$$;

comment on function public.publish_availability(date[], int, int, int) is
  'Adds the caller''s appointment slots on the chosen Riyadh days, inside one daily window. 0104.';

revoke all on function public.publish_availability(date[], int, int, int) from public, anon;
grant execute on function public.publish_availability(date[], int, int, int) to authenticated;


create or replace function public.my_slots(p_days int default 14)
returns table (
  id           uuid,
  starts_at    timestamptz,
  ends_at      timestamptz,
  capacity     int,
  booked_count int,
  is_blocked   boolean
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
    raise exception 'Only an approved provider has a calendar'
      using errcode = 'insufficient_privilege', hint = 'slots:not_provider';
  end if;

  return query
    select s.id, s.starts_at, s.ends_at, s.capacity, s.booked_count, s.is_blocked
      from public.appointment_slots s
     where s.provider_id = v_provider_id
       and s.starts_at > now()
       and s.starts_at < now() + make_interval(days => least(greatest(coalesce(p_days, 14), 1), 60))
     order by s.starts_at;
end;
$$;

comment on function public.my_slots(int) is
  'The caller''s own coming appointment slots, booked and blocked included. 0104.';

revoke all on function public.my_slots(int) from public, anon;
grant execute on function public.my_slots(int) to authenticated;


create or replace function public.set_slot_blocked(p_slot_id uuid, p_blocked boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_provider_id uuid := public.current_provider_id();
begin
  if v_provider_id is null then
    raise exception 'Only an approved provider has a calendar'
      using errcode = 'insufficient_privilege', hint = 'slots:not_provider';
  end if;

  update public.appointment_slots
     set is_blocked = coalesce(p_blocked, true)
   where id = p_slot_id
     and provider_id = v_provider_id
     and starts_at > now();

  if not found then
    -- The same answer for someone else's slot and for one already past.
    raise exception 'No such coming slot of yours'
      using errcode = 'no_data_found', hint = 'slots:not_found';
  end if;
end;
$$;

comment on function public.set_slot_blocked(uuid, boolean) is
  'Closes or reopens one of the caller''s coming appointment slots. 0104.';

revoke all on function public.set_slot_blocked(uuid, boolean) from public, anon;
grant execute on function public.set_slot_blocked(uuid, boolean) to authenticated;
