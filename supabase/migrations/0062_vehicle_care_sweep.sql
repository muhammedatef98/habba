-- 0062 — The daily sweep, and the cap that makes it survivable
--
-- Everything before this file is a screen nobody opens. A maintenance schedule
-- is only worth keeping if it comes to the owner; the whole value of knowing
-- the oil is due is in being told before, not in a list that rewards people who
-- happen to look.
--
-- Which makes the notification the dangerous part of the slice, not the useful
-- part. §7.2 puts it plainly — "alert fatigue kills this feature" — and the way
-- a daily sweep kills it is entirely mechanical: an item stays due until
-- somebody acts on it, so a sweep with no memory re-sends the same sentence
-- every morning until the owner turns notifications off. After that the app has
-- no channel to the customer at all, and it lost it over an oil change.
--
-- ---------------------------------------------------------------------------
-- Three suppressions, and they do different jobs
-- ---------------------------------------------------------------------------
--   1. **One per vehicle per day.** A hard ceiling, and a UNIQUE INDEX rather
--      than an `if` in the loop, because the failure mode being guarded against
--      is the scheduler firing twice — which is exactly the case an in-loop
--      check inside a different transaction does not cover. A car due for four
--      things produces ONE notification listing four things.
--   2. **The repeat window.** The ceiling alone still permits a reminder every
--      single day, which is the fatigue case verbatim. An item that appeared in
--      a reminder in the last `care_reminder_repeat_days()` is not sent again.
--      This is what `vehicle_reminders` is FOR: without a record of what was
--      sent, "have we already said this" has no answer.
--   3. **The snooze.** The owner's own instruction, per item, and it outranks
--      both: «ذكّرني بعد أسبوعين» means nothing about that item until then, and
--      the reminder does not go out at all if every due item is snoozed.
--
-- ---------------------------------------------------------------------------
-- Why reminder history does NOT travel with the car
-- ---------------------------------------------------------------------------
-- Every other table in this slice is keyed on the vehicle and gated by
-- `owns_vehicle()`, so it follows the car through a handover. This one is keyed
-- on the vehicle AND on the person, and the person is the gate.
--
-- Odometer history and the maintenance schedule are facts about the car: a
-- buyer paid for them, and §1.2 is the argument for why. What was pushed to the
-- previous owner's phone, and whether they tapped «تم» or ignored it, is a fact
-- about the previous owner. It is their behaviour, not the car's history, and
-- handing it to a stranger who bought their car would be a privacy failure
-- under ADR-0010 dressed up as a feature.
--
-- It also has to work this way for the section to behave correctly: a buyer
-- with no reminder history for their new car is told about its due items on day
-- one, instead of being silenced by a window the seller used up.

-- ---------------------------------------------------------------------------
-- The windows, as data
-- ---------------------------------------------------------------------------
create or replace function public.care_reminder_repeat_days() returns int
language sql immutable as $$ select 7 $$;

comment on function public.care_reminder_repeat_days() is
  'An item that appeared in a reminder this recently is not re-sent. The daily '
  'cap is a ceiling; THIS is what stops a daily drumbeat.';

create or replace function public.care_default_snooze_days() returns int
language sql immutable as $$ select 14 $$;


-- ---------------------------------------------------------------------------
-- vehicle_reminders
-- ---------------------------------------------------------------------------
create type vehicle_reminder_response as enum ('done', 'snoozed', 'ignored');

create table public.vehicle_reminders (
  id           uuid primary key default gen_random_uuid(),
  vehicle_id   uuid not null references public.vehicles(id) on delete cascade,

  -- WHO it went to. The reason this table does not transfer — see the header.
  user_id      uuid not null references public.profiles(id) on delete cascade,

  -- The cap's key. A date rather than a truncation of `sent_at` so the unique
  -- index below is on a plain column and needs no immutable-expression games.
  sent_on      date not null default current_date,
  sent_at      timestamptz not null default now(),

  -- Everything that went into this one notification: one entry per due item or
  -- expiring document, each carrying what the three actions need (the item to
  -- mark done or snooze, the service to book). Frozen at send time, so the
  -- record says what the owner was actually shown rather than what the
  -- schedule happens to say today.
  items        jsonb not null default '[]'::jsonb,

  title_ar     text not null,
  title_en     text not null,
  body_ar      text not null,
  body_en      text not null,

  -- 'done' | 'snoozed' | 'ignored', or null for "not answered". Null is a real
  -- state and not a missing value: most reminders are never answered, and
  -- treating silence as `ignored` would claim to know something we do not.
  response     vehicle_reminder_response,
  responded_at timestamptz,

  created_at   timestamptz not null default now(),

  constraint vehicle_reminders_items_is_array check (jsonb_typeof(items) = 'array'),
  constraint vehicle_reminders_response_has_time check (
    (response is null) = (responded_at is null)
  )
);

-- THE CAP. One notification per vehicle per day, enforced by the database
-- rather than by the sweep, so a scheduler that fires twice — or two sweeps
-- racing in separate transactions — collides here instead of double-notifying.
create unique index vehicle_reminders_one_per_vehicle_per_day_idx
  on public.vehicle_reminders (vehicle_id, sent_on);

create index vehicle_reminders_recent_idx
  on public.vehicle_reminders (vehicle_id, user_id, sent_at desc);

comment on table public.vehicle_reminders is
  'What was sent, when, to whom, and what they did. The cap and the repeat '
  'window are both computed from it (ADR-0022). Does NOT transfer with the car.';


-- ---------------------------------------------------------------------------
-- RLS — the recipient, not the owner
-- ---------------------------------------------------------------------------
alter table public.vehicle_reminders enable row level security;

-- `user_id = auth.uid()`, NOT `owns_vehicle(vehicle_id)`. That one word is the
-- whole of "reminder history does not transfer": a buyer who now owns the car
-- still cannot read what was sent to the seller, and the seller keeps their own
-- record of what they were told about a car they used to own.
create policy vehicle_reminders_read on public.vehicle_reminders
  for select to authenticated
  using (user_id = auth.uid() or public.is_ops());

create policy vehicle_reminders_update on public.vehicle_reminders
  for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- No INSERT policy: reminders come from the sweep, not from clients.


-- A client may answer a reminder. It may not rewrite what it said, who it went
-- to, or when — a ledger a client can edit is not a ledger, and the repeat
-- window is computed from exactly the columns it would be worth editing.
create or replace function public.guard_vehicle_reminder_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.is_ops() or public.is_privileged_write() then
    return new;
  end if;

  if new.id is distinct from old.id
     or new.vehicle_id is distinct from old.vehicle_id
     or new.user_id is distinct from old.user_id
     or new.sent_on is distinct from old.sent_on
     or new.sent_at is distinct from old.sent_at
     or new.items is distinct from old.items
     or new.title_ar is distinct from old.title_ar
     or new.title_en is distinct from old.title_en
     or new.body_ar is distinct from old.body_ar
     or new.body_en is distinct from old.body_en
     or new.created_at is distinct from old.created_at then
    raise exception 'Only a reminder''s response may be changed by a client (0062)'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

create trigger vehicle_reminders_guard_columns
  before update on public.vehicle_reminders
  for each row execute function public.guard_vehicle_reminder_columns();

alter table public.vehicle_reminders
  enable always trigger vehicle_reminders_guard_columns;


-- ---------------------------------------------------------------------------
-- respond_to_reminder
-- ---------------------------------------------------------------------------
-- «تم» / «ذكّرني لاحقًا» / dismissed. The reminder records the answer; the
-- consequences of «تم» and «ذكّرني لاحقًا» belong to the ITEM and are applied
-- through `mark_maintenance_item_done` and `snooze_maintenance_item` (0059) —
-- one reminder can carry several items, and the owner may act on one of them.
create or replace function public.respond_to_reminder(
  p_reminder_id uuid,
  p_response    vehicle_reminder_response
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reminder record;
begin
  select * into v_reminder
  from public.vehicle_reminders r where r.id = p_reminder_id;

  if v_reminder is null or v_reminder.user_id is distinct from auth.uid() then
    raise exception 'Reminder not found' using errcode = 'no_data_found';
  end if;

  perform public.begin_privileged_write();

  update public.vehicle_reminders
  set response = p_response, responded_at = now()
  where id = p_reminder_id;

  perform public.end_privileged_write();
end;
$$;

grant execute on function public.respond_to_reminder(uuid, vehicle_reminder_response)
  to authenticated;


-- ---------------------------------------------------------------------------
-- sweep_vehicle_care — one vehicle, one day
-- ---------------------------------------------------------------------------
-- Returns the reminder id, or null when there was nothing to say. The copy is
-- composed here rather than in the app for the reason ADR-0022 gives: the
-- distinction between what the database KNOWS (a date on a document) and what
-- it INFERS (a distance since a reading that may be weeks old) is a property of
-- the data, and a client that has to re-derive it will eventually get it wrong
-- in the direction that reads better.
create or replace function public.sweep_vehicle_care(p_vehicle_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner     uuid;
  v_item      record;
  v_doc       record;
  v_items     jsonb := '[]'::jsonb;
  v_lines_ar  text[] := array[]::text[];
  v_lines_en  text[] := array[]::text[];
  v_doc_ar    text;
  v_doc_en    text;
  v_phrase_ar text;
  v_phrase_en text;
  v_id        uuid;
begin
  select v.owner_id into v_owner
  from public.vehicles v
  where v.id = p_vehicle_id and v.is_active;

  if v_owner is null then
    return null;
  end if;

  -- The cap, checked before any work. The unique index is what actually
  -- enforces it; this is the cheap path and the reason the sweep does not
  -- recompute a whole vehicle it is not allowed to notify about.
  if exists (
    select 1 from public.vehicle_reminders r
    where r.vehicle_id = p_vehicle_id and r.sent_on = current_date
  ) then
    return null;
  end if;

  -- --- maintenance -------------------------------------------------------
  for v_item in
    select * from public.maintenance_item_status(p_vehicle_id) s
    where (s.is_due or s.is_approaching)
      and (s.snoozed_until is null or s.snoozed_until <= now())
  loop
    -- The repeat window, scoped to THIS owner. A reminder sent to the previous
    -- owner suppresses nothing for the buyer — see the header on why this
    -- table is keyed on the person.
    if exists (
      select 1
      from public.vehicle_reminders r,
           lateral jsonb_array_elements(r.items) e
      where r.vehicle_id = p_vehicle_id
        and r.user_id = v_owner
        and r.sent_at > now() - make_interval(days => public.care_reminder_repeat_days())
        and e ->> 'key' = v_item.item_type
    ) then
      continue;
    end if;

    -- ADR-0022's language rule, as code.
    --
    -- The DATE axis is arithmetic on two things we know exactly: when the item
    -- was last done, and how many months it runs. It may be stated plainly.
    --
    -- The DISTANCE axis rests on a reading that may be a month old, and the app
    -- cannot see the odometer in between. It is never stated as a fact, and the
    -- sentence carries the one action that would make it one — confirm the
    -- reading.
    if v_item.due_by_date then
      v_phrase_ar := format('%s: حان موعده', v_item.name_ar);
      v_phrase_en := format('%s: due now', v_item.name_en);
    elsif v_item.due_by_km then
      v_phrase_ar := format('%s: متوقع أنه حان — أكّد قراءة العداد', v_item.name_ar);
      v_phrase_en := format('%s: likely due — confirm your odometer', v_item.name_en);
    elsif v_item.days_remaining is not null
          and v_item.days_remaining <= public.care_lead_days() then
      v_phrase_ar := format('%s: بعد %s يوم', v_item.name_ar, v_item.days_remaining);
      v_phrase_en := format('%s: in %s days', v_item.name_en, v_item.days_remaining);
    else
      v_phrase_ar := format('%s: متوقع قريبًا — أكّد قراءة العداد', v_item.name_ar);
      v_phrase_en := format('%s: expected soon — confirm your odometer', v_item.name_en);
    end if;

    v_items := v_items || jsonb_build_object(
      'kind', 'maintenance',
      'key', v_item.item_type,
      'item_id', v_item.item_id,
      'service_id', v_item.service_id,
      -- What the copy may claim. Carried on the row so a client rendering the
      -- notification cannot quietly upgrade an estimate into a certainty.
      'certain', v_item.due_by_date,
      'text_ar', v_phrase_ar,
      'text_en', v_phrase_en
    );
    v_lines_ar := v_lines_ar || v_phrase_ar;
    v_lines_en := v_lines_en || v_phrase_en;
  end loop;

  -- --- documents ---------------------------------------------------------
  for v_doc in
    select * from public.document_expiry_status(p_vehicle_id) s
    where s.is_expired or s.is_expiring
  loop
    if exists (
      select 1
      from public.vehicle_reminders r,
           lateral jsonb_array_elements(r.items) e
      where r.vehicle_id = p_vehicle_id
        and r.user_id = v_owner
        and r.sent_at > now() - make_interval(days => public.care_reminder_repeat_days())
        and e ->> 'key' = v_doc.doc_type::text
    ) then
      continue;
    end if;

    v_doc_ar := case v_doc.doc_type
      when 'registration' then 'الاستمارة'
      when 'insurance' then 'التأمين'
      else 'الفحص الدوري'
    end;
    v_doc_en := case v_doc.doc_type
      when 'registration' then 'Registration'
      when 'insurance' then 'Insurance'
      else 'Periodic inspection'
    end;

    -- No hedging here, and that is the point of having documents in this
    -- section at all. An expiry date is a date somebody read off a document;
    -- nothing is being estimated, so nothing is qualified.
    if v_doc.is_expired then
      v_phrase_ar := format('%s: منتهية منذ %s يوم', v_doc_ar, abs(v_doc.days_remaining));
      v_phrase_en := format('%s: expired %s days ago', v_doc_en, abs(v_doc.days_remaining));
    elsif v_doc.days_remaining = 0 then
      v_phrase_ar := format('%s: تنتهي اليوم', v_doc_ar);
      v_phrase_en := format('%s: expires today', v_doc_en);
    else
      v_phrase_ar := format('%s: تنتهي بعد %s يوم', v_doc_ar, v_doc.days_remaining);
      v_phrase_en := format('%s: expires in %s days', v_doc_en, v_doc.days_remaining);
    end if;

    v_items := v_items || jsonb_build_object(
      'kind', 'document',
      'key', v_doc.doc_type::text,
      'document_id', v_doc.document_id,
      'certain', true,
      'text_ar', v_phrase_ar,
      'text_en', v_phrase_en
    );
    v_lines_ar := v_lines_ar || v_phrase_ar;
    v_lines_en := v_lines_en || v_phrase_en;
  end loop;

  if jsonb_array_length(v_items) = 0 then
    return null;
  end if;

  perform public.begin_privileged_write();

  insert into public.vehicle_reminders (
    vehicle_id, user_id, items, title_ar, title_en, body_ar, body_en
  ) values (
    p_vehicle_id, v_owner, v_items,
    'سيارتك تحتاج انتباهك', 'Your car needs attention',
    array_to_string(v_lines_ar, E'\n'), array_to_string(v_lines_en, E'\n')
  )
  -- The cap again, as the index sees it. A second sweep in the same day loses
  -- the race here rather than sending a second notification.
  on conflict (vehicle_id, sent_on) do nothing
  returning id into v_id;

  perform public.end_privileged_write();

  return v_id;
end;
$$;

comment on function public.sweep_vehicle_care(uuid) is
  'One vehicle''s daily reminder: every due item and expiring document in ONE '
  'notification, or null (ADR-0022). Honours the snooze and the repeat window.';

revoke all on function public.sweep_vehicle_care(uuid) from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- run_vehicle_care_sweep — the job
-- ---------------------------------------------------------------------------
-- The loop is in SQL rather than in an Edge Function for 0029's reason: a
-- scheduler that fires twice cannot double-notify, because the cap is evaluated
-- where the data is.
--
-- Delivery — Expo Push, §3 — reads the rows this writes. A row here IS the
-- send record: it is written once, it is capped once, and a delivery layer that
-- crashes and retries cannot turn one reminder into two.
create or replace function public.run_vehicle_care_sweep(p_limit int default 5000)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vehicle_id uuid;
  v_sent       int := 0;
begin
  for v_vehicle_id in
    select v.id from public.vehicles v
    where v.is_active
    order by v.updated_at
    limit p_limit
  loop
    if public.sweep_vehicle_care(v_vehicle_id) is not null then
      v_sent := v_sent + 1;
    end if;
  end loop;

  return v_sent;
end;
$$;

revoke all on function public.run_vehicle_care_sweep(int) from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- Is the sweep actually scheduled?
-- ---------------------------------------------------------------------------
-- 0056's pattern, and its reason restated because it applies more sharply
-- here: the failure mode of a scheduled job is that everybody assumes it runs.
-- 0056 could afford that — ownership-transfer expiry is also enforced inline on
-- initiation and acceptance, so the sweep there is housekeeping. This one has
-- no inline path. If it is not scheduled, NOTHING sends reminders, and the only
-- symptom is silence.
--
-- So the answer is a function anybody can call, rather than a line in a
-- migration log, and supabase/tests/36 asserts that it and `cron.job` agree.
create or replace function public.vehicle_care_sweep_scheduled()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  if to_regclass('cron.job') is null then
    return false;
  end if;

  execute $q$
    select count(*)::int from cron.job
    where jobname = 'habba-vehicle-care-sweep' and active
  $q$ into v_count;

  return v_count > 0;
end;
$$;

comment on function public.vehicle_care_sweep_scheduled() is
  'Whether the daily care sweep is on a clock. FALSE MEANS NO REMINDERS ARE '
  'SENT AT ALL — unlike 0056, there is no inline fallback (ADR-0022).';

revoke all on function public.vehicle_care_sweep_scheduled()
  from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- pg_cron, if it can be had
-- ---------------------------------------------------------------------------
-- Attempt, announce, verify — 0056's three outcomes, none of them assumed.
-- `create extension pg_cron` needs the library in shared_preload_libraries, a
-- superuser, and the database named by cron.database_name; none of that is
-- knowable from inside a migration, so it is attempted and the failure is
-- caught and reported with its SQLSTATE.
do $cron$
declare
  v_available boolean;
begin
  begin
    execute 'create extension if not exists pg_cron';
  exception when others then
    raise notice '0062: pg_cron could not be installed here (%: %)', sqlstate, sqlerrm;
  end;

  select exists (select 1 from pg_extension where extname = 'pg_cron')
  into v_available;

  if not v_available then
    raise notice
      '0062: no pg_cron. The vehicle-care sweep is NOT scheduled, and unlike '
      '0056 there is no inline fallback — no maintenance or document reminder '
      'will be sent until something calls run_vehicle_care_sweep(). Check '
      'public.vehicle_care_sweep_scheduled(). See ADR-0022.';
    return;
  end if;

  begin
    -- 05:00 UTC is 08:00 in Riyadh (+03, no DST): early enough to be read
    -- before the working day, late enough not to arrive overnight. cron.schedule
    -- is UTC, so this is written as UTC rather than as the local hour it means.
    execute $j$
      select cron.schedule('habba-vehicle-care-sweep', '0 5 * * *',
                           'select public.run_vehicle_care_sweep()')
    $j$;

    raise notice '0062: pg_cron present — the daily vehicle-care sweep is scheduled.';
  exception when others then
    raise notice
      '0062: pg_cron is installed but scheduling failed (%: %). NO REMINDERS '
      'WILL BE SENT. Check public.vehicle_care_sweep_scheduled().',
      sqlstate, sqlerrm;
  end;
end
$cron$;
