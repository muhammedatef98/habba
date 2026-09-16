-- 0072 — generate_slots reports what it created, not what it attempted
--
-- 0024 counts `v_created + 1` per loop iteration, unconditionally, while the
-- insert carries `on conflict (provider_id, starts_at) do nothing`. Nothing
-- read the return value, so the overcount was invisible: `generate_slots` was
-- a function no screen had ever called (§Phase 4's provider side did not
-- exist).
--
-- It stops being invisible the moment a workshop sees «أُنشئ ١٢ موعد» after
-- pressing the button a second time on a week it has already published. The
-- honest answer there is zero, and a workshop that is told twelve will go
-- looking for twelve slots that are not there — or worse, believe it has
-- doubled its capacity.
--
-- `get diagnostics ... row_count` after an `on conflict do nothing` is the
-- number of rows actually inserted, which is the question being asked.
--
-- Also: a slot in the past cannot be booked (`book_appointment` requires
-- `starts_at > now()`, 0024), so generating them is pure clutter in a calendar
-- the workshop has to scroll. Refused at the door rather than silently
-- creating rows nobody can use — a workshop that mistypes the date should be
-- told, not left wondering why its new slots never fill.

create or replace function public.generate_slots(
  p_from      date,
  p_days      int,
  p_start_hour int default 8,
  p_end_hour   int default 20,
  p_slot_minutes int default 60,
  p_capacity   int default 1
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_provider_id uuid := public.current_provider_id();
  v_created int := 0;
  v_inserted int;
  v_day date;
  v_slot timestamptz;
  v_close timestamptz;
begin
  if v_provider_id is null then
    raise exception 'Not a provider' using errcode = 'insufficient_privilege';
  end if;

  if p_days < 1 or p_days > 60 then
    raise exception 'Generate between 1 and 60 days at a time' using errcode = 'check_violation';
  end if;

  -- Riyadh's calendar day, not UTC's. At 02:00 local on the 1st, UTC still
  -- reads the 30th, and a workshop publishing "from today" would be refused.
  if p_from < (now() at time zone 'Asia/Riyadh')::date then
    raise exception 'Appointments cannot be published in the past'
      using errcode = 'check_violation';
  end if;

  if p_start_hour < 0 or p_end_hour > 24 or p_start_hour >= p_end_hour then
    raise exception 'The working day must start before it ends'
      using errcode = 'check_violation';
  end if;

  if p_slot_minutes < 15 or p_slot_minutes > 480 then
    raise exception 'A slot runs between 15 minutes and 8 hours'
      using errcode = 'check_violation';
  end if;

  if p_capacity < 1 then
    raise exception 'A slot must hold at least one car' using errcode = 'check_violation';
  end if;

  for i in 0 .. p_days - 1 loop
    v_day := p_from + i;
    v_slot := (v_day + make_time(p_start_hour, 0, 0)) at time zone 'Asia/Riyadh';
    -- ⚠️ Closing time as a timestamp, not as an hour to compare against.
    --
    -- 0024 looped on `extract(hour from v_slot) < p_end_hour`, which never
    -- terminates at `p_end_hour = 24`: the slot walks past midnight, the hour
    -- wraps to 0, and 0 < 24 forever. Nothing had ever called the function
    -- with a round-the-clock day, so a workshop open 24 hours would have been
    -- the first to hang its own connection.
    --
    -- Built from `v_day::timestamp + hours` rather than `make_time`, which
    -- rejects hour 24 outright.
    v_close := (v_day::timestamp + make_interval(hours => p_end_hour)) at time zone 'Asia/Riyadh';

    -- `<= v_close` and not `< v_close`: the slot has to FIT. A 50-minute slot
    -- in a day closing at 20:00 must not be published starting 19:40, because
    -- the customer who books it is promised a bay until 20:30.
    while v_slot + make_interval(mins => p_slot_minutes) <= v_close loop
      -- An hour that has already gone is not availability.
      --
      -- `book_appointment` requires `starts_at > now()`, so a slot published
      -- into this morning can never be booked — it is clutter in a calendar
      -- the workshop has to scroll past, and it makes the day look fuller than
      -- it is. A workshop publishing "from today" at two in the afternoon
      -- means the rest of today.
      if v_slot > now() then
        insert into public.appointment_slots (provider_id, starts_at, ends_at, capacity)
        values (v_provider_id, v_slot,
                v_slot + make_interval(mins => p_slot_minutes), p_capacity)
        on conflict (provider_id, starts_at) do nothing;

        -- ⚠️ The count the caller is shown. `do nothing` makes this 0 for a
        -- slot that already existed, which is the whole point: publishing over
        -- a week that is already published creates nothing and must say so.
        get diagnostics v_inserted = row_count;
        v_created := v_created + v_inserted;
      end if;

      v_slot := v_slot + make_interval(mins => p_slot_minutes);
    end loop;
  end loop;

  return v_created;
end;
$$;

-- 0069's rule: `from public` alone leaves the named-role grants standing.
revoke all on function public.generate_slots(date, int, int, int, int, int)
  from public, anon, authenticated;
grant execute on function public.generate_slots(date, int, int, int, int, int) to authenticated;
