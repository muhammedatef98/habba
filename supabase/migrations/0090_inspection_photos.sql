-- 0090 — Photos on inspection items
--
-- The results document always had room for them ({rating, note, photos[]},
-- 0026), but nothing put one there and nothing checked one. Now the inspector
-- can photograph an item, and the report is refused unless every photo it
-- names is one of this order's inspection photos that was actually uploaded:
--
--   storage://completion-media/<order_id>/insp-<name>
--
-- The same bucket as the completion photos (0064). Its policies already say
-- who may upload (the assigned provider, while the job is open) and who may
-- look (the customer, the provider, the car's owner now), and an inspection
-- is an order like any other. A reference to another order's file, to a file
-- that was never uploaded, or to anything outside the bucket would put a
-- picture in a buyer's report that the inspector did not take of this car.

create or replace function public.check_inspection_photos()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prefix text := 'storage://completion-media/' || new.order_id || '/';
  v_section record;
  v_item record;
  v_photo jsonb;
  v_url text;
  v_total int := 0;
begin
  if jsonb_typeof(new.results) <> 'object' then
    raise exception 'Inspection results must be an object' using errcode = 'invalid_parameter_value';
  end if;

  for v_section in select key, value from jsonb_each(new.results) loop
    if jsonb_typeof(v_section.value) <> 'object' then
      continue;
    end if;
    for v_item in select key, value from jsonb_each(v_section.value) loop
      if jsonb_typeof(v_item.value) <> 'object' or not (v_item.value ? 'photos') then
        continue;
      end if;
      if jsonb_typeof(v_item.value -> 'photos') <> 'array' then
        raise exception 'Photos on % must be a list', v_section.key || '.' || v_item.key
          using errcode = 'invalid_parameter_value';
      end if;
      if jsonb_array_length(v_item.value -> 'photos') > 4 then
        raise exception 'At most 4 photos per item (% has %)', v_section.key || '.' || v_item.key,
          jsonb_array_length(v_item.value -> 'photos')
          using errcode = 'check_violation';
      end if;

      for v_photo in select * from jsonb_array_elements(v_item.value -> 'photos') loop
        v_total := v_total + 1;
        v_url := v_photo #>> '{}';
        if jsonb_typeof(v_photo) <> 'string'
           or left(v_url, length(v_prefix)) <> v_prefix
           or substr(v_url, length(v_prefix) + 1) !~ '^insp-[A-Za-z0-9_.-]+$' then
          raise exception 'An inspection photo must be one of this order''s inspection photos'
            using errcode = 'invalid_parameter_value';
        end if;
        if not exists (
          select 1 from storage.objects so
           where so.bucket_id = 'completion-media'
             and so.name = substr(v_url, length('storage://completion-media/') + 1)
        ) then
          raise exception 'An inspection photo was never uploaded'
            using errcode = 'invalid_parameter_value',
                  hint = 'Upload first, then submit. A reference to nothing is not evidence.';
        end if;
      end loop;
    end loop;
  end loop;

  if v_total > 40 then
    raise exception 'At most 40 photos in one inspection' using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

revoke execute on function public.check_inspection_photos() from public, anon, authenticated;

drop trigger if exists inspection_reports_check_photos on public.inspection_reports;
create trigger inspection_reports_check_photos
  before insert or update of results on public.inspection_reports
  for each row execute function public.check_inspection_photos();
