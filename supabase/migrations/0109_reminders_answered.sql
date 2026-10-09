-- 0109 — Every warning, and whether the owner acted on it
--
-- §1 puts "every warning the system raised and whether the owner acted on it"
-- in the record. The care sweep (0062) records each reminder it sends, and
-- respond_to_reminder() was meant to record the answer — but nothing calls it:
-- the push carries no reminder id, and the owner acts on the ITEM («تم»,
-- «ذكّرني لاحقًا», or a Habba job that does the work), not on the notification.
-- So every reminder ever sent reads as unanswered.
--
--   answer_reminders_from_item  the item is where the answer happens, so the
--                               answer is recorded there: when an item that a
--                               recent reminder carried is done or snoozed, that
--                               reminder is answered, server-side, whichever
--                               screen or job did it.
--   job_vehicle_history()       also lists what is due on the car, so the
--                               technician already at it can offer to do it.
--   ops_vehicle_detail()        adds the reminders sent and how each was
--                               answered.

create or replace function public.answer_reminders_from_item()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_response public.vehicle_reminder_response;
  v_open     boolean;
begin
  if new.last_done_at is not null and new.last_done_at is distinct from old.last_done_at then
    v_response := 'done';
  elsif new.snoozed_until is not null
        and (old.snoozed_until is null or new.snoozed_until > old.snoozed_until) then
    v_response := 'snoozed';
  else
    return new;
  end if;

  v_open := public.is_privileged_write();
  perform public.begin_privileged_write();

  -- The reminders that carried this item in the last month and are still
  -- unanswered. Older ones are left as they were: an item done in March does
  -- not answer a reminder from January.
  update public.vehicle_reminders r
     set response = v_response, responded_at = now()
   where r.vehicle_id = new.vehicle_id
     and r.response is null
     and r.sent_at > now() - interval '30 days'
     and r.items @> jsonb_build_array(jsonb_build_object('item_id', new.id));

  perform public.end_privileged_write_unless(v_open);
  return new;
end;
$$;

revoke execute on function public.answer_reminders_from_item() from public, anon, authenticated;

create trigger vehicle_maintenance_items_answer_reminders
  after update of last_done_at, snoozed_until on public.vehicle_maintenance_items
  for each row execute function public.answer_reminders_from_item();


-- The notification opens the car it is about, not the list of cars.
create or replace function public.notify_care_reminder()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.enqueue_notification(
    new.user_id, 'care_reminder',
    new.title_ar, new.title_en, new.body_ar, new.body_en,
    jsonb_build_object('route', '/vehicles', 'vehicleId', new.vehicle_id, 'id', new.vehicle_id),
    format('reminder:%s', new.id));
  return new;
end;
$$;


alter function public.job_vehicle_history(uuid, int) rename to job_vehicle_history_0108;
revoke execute on function public.job_vehicle_history_0108(uuid, int) from public, anon, authenticated;

create or replace function public.job_vehicle_history(p_order_id uuid, p_limit int default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result  jsonb;
  v_vehicle uuid;
begin
  -- The wrapped body checks the switch and that this is the caller's live job.
  v_result := public.job_vehicle_history_0108(p_order_id, p_limit);
  select o.vehicle_id into v_vehicle from public.orders o where o.id = p_order_id;

  return v_result || jsonb_build_object(
    'due', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'name_ar', s.name_ar, 'name_en', s.name_en,
               'is_due', s.is_due, 'km_remaining', s.km_remaining,
               'days_remaining', s.days_remaining, 'km_is_estimated', s.km_is_estimated)
               order by s.is_due desc, s.km_remaining nulls last), '[]'::jsonb)
        from public.maintenance_item_status(v_vehicle) s
       where s.is_due or s.is_approaching));
end;
$$;

comment on function public.job_vehicle_history(uuid, int) is
  'The assigned provider''s read of the car''s service history and what is due, while the job is live. 0108, 0109.';

revoke all on function public.job_vehicle_history(uuid, int) from public, anon;
grant execute on function public.job_vehicle_history(uuid, int) to authenticated;


alter function public.ops_vehicle_detail(uuid) rename to ops_vehicle_detail_0108;
revoke execute on function public.ops_vehicle_detail_0108(uuid) from public, anon, authenticated;

create or replace function public.ops_vehicle_detail(p_vehicle_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- The wrapped body asserts ops and records the read (0070, 0108).
  return public.ops_vehicle_detail_0108(p_vehicle_id)
    || jsonb_build_object(
         'reminders', (
           select coalesce(jsonb_agg(jsonb_build_object(
                    'id', r.id, 'sent_at', r.sent_at, 'title_ar', r.title_ar, 'body_ar', r.body_ar,
                    'items', jsonb_array_length(r.items),
                    'response', r.response, 'responded_at', r.responded_at)
                    order by r.sent_at desc), '[]'::jsonb)
             from (select * from public.vehicle_reminders r
                    where r.vehicle_id = p_vehicle_id
                    order by r.sent_at desc limit 30) r));
end;
$$;

revoke execute on function public.ops_vehicle_detail(uuid) from public, anon;
grant execute on function public.ops_vehicle_detail(uuid) to authenticated;
