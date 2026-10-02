-- 0094 — The catalogue, made safe to edit by hand
--
-- The console's catalogue grew a visual editor for inspection checklists and a
-- one-step price change. Both are ways for an operator to change a great deal
-- at once, so the database now holds the rules the screens assume:
--
--   1. An inspection template is checked on every write: sections and items
--      each with a key and both names, weights in range, no repeated keys.
--      The scorer (0026) trusted the shape; a template edited by hand must
--      not be the thing that breaks a report a buyer is reading.
--
--      And a template that reports have been filed against keeps every
--      section and item those reports answered. Their answers are stored by
--      key; removing a key would silently drop a finding from a report
--      already shared. Names and weights may change; to retire items, make
--      a new template.
--
--   2. ops_adjust_service_prices — every price in a category (or all of
--      them) up or down by a percentage, in one statement, with a reason.
--      Each changed row lands in the audit log (0068), as any edit does.

create or replace function public.validate_inspection_template()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_section   jsonb;
  v_item      jsonb;
  v_sections  text[] := '{}';
  v_items     text[];
  v_old       jsonb;
  v_missing   text;
begin
  if jsonb_typeof(new.sections) <> 'array' or jsonb_array_length(new.sections) = 0 then
    raise exception 'A template needs at least one section'
      using errcode = 'check_violation', hint = 'template:no_sections';
  end if;

  for v_section in select * from jsonb_array_elements(new.sections) loop
    if jsonb_typeof(v_section) <> 'object'
       or coalesce(v_section ->> 'key', '') !~ '^[a-z][a-z0-9_]*$'
       or length(trim(coalesce(v_section ->> 'title_ar', ''))) = 0
       or length(trim(coalesce(v_section ->> 'title_en', ''))) = 0 then
      raise exception 'Every section needs a key and an Arabic and English title'
        using errcode = 'check_violation', hint = 'template:section_shape';
    end if;
    if (v_section ->> 'key') = any (v_sections) then
      raise exception 'Section key % is repeated', v_section ->> 'key'
        using errcode = 'check_violation', hint = 'template:duplicate_section';
    end if;
    v_sections := v_sections || (v_section ->> 'key');

    if v_section ? 'weight' and (
         jsonb_typeof(v_section -> 'weight') <> 'number'
         or (v_section ->> 'weight')::numeric not between 1 and 5) then
      raise exception 'A section weight is between 1 and 5'
        using errcode = 'check_violation', hint = 'template:weight';
    end if;

    if jsonb_typeof(v_section -> 'items') <> 'array'
       or jsonb_array_length(v_section -> 'items') = 0 then
      raise exception 'Section % has no items', v_section ->> 'key'
        using errcode = 'check_violation', hint = 'template:no_items';
    end if;

    v_items := '{}';
    for v_item in select * from jsonb_array_elements(v_section -> 'items') loop
      if jsonb_typeof(v_item) <> 'object'
         or coalesce(v_item ->> 'key', '') !~ '^[a-z][a-z0-9_]*$'
         or length(trim(coalesce(v_item ->> 'label_ar', ''))) = 0
         or length(trim(coalesce(v_item ->> 'label_en', ''))) = 0
         or coalesce(v_item ->> 'type', 'rating') <> 'rating' then
        raise exception 'Every item needs a key and an Arabic and English label'
          using errcode = 'check_violation', hint = 'template:item_shape';
      end if;
      if (v_item ->> 'key') = any (v_items) then
        raise exception 'Item key % is repeated in section %', v_item ->> 'key', v_section ->> 'key'
          using errcode = 'check_violation', hint = 'template:duplicate_item';
      end if;
      v_items := v_items || (v_item ->> 'key');

      if v_item ? 'weight' and (
           jsonb_typeof(v_item -> 'weight') <> 'number'
           or (v_item ->> 'weight')::numeric not between 1 and 5) then
        raise exception 'An item weight is between 1 and 5'
          using errcode = 'check_violation', hint = 'template:weight';
      end if;
    end loop;
  end loop;

  -- Filed reports answered the old keys. Every one of them must still exist.
  if tg_op = 'UPDATE' and exists (
       select 1 from public.inspection_reports r where r.template_id = old.id) then
    v_old := old.sections;
    select string_agg(o.section_key || '.' || o.item_key, ', ')
      into v_missing
      from (
        select s ->> 'key' as section_key, i ->> 'key' as item_key
          from jsonb_array_elements(v_old) s,
               jsonb_array_elements(s -> 'items') i
      ) o
     where not exists (
       select 1
         from jsonb_array_elements(new.sections) ns,
              jsonb_array_elements(ns -> 'items') ni
        where ns ->> 'key' = o.section_key and ni ->> 'key' = o.item_key
     );
    if v_missing is not null then
      raise exception 'Reports use items this change removes: %', v_missing
        using errcode = 'check_violation', hint = 'template:items_in_use';
    end if;
  end if;

  return new;
end;
$$;

create trigger inspection_templates_validate
  before insert or update on public.inspection_templates
  for each row execute function public.validate_inspection_template();


create or replace function public.ops_adjust_service_prices(
  p_category text,
  p_percent  numeric,
  p_reason   text
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  perform public.assert_ops();
  perform public.assert_reason(p_reason);

  if p_percent is null or p_percent = 0 or p_percent < -50 or p_percent > 100 then
    raise exception 'A change between -50%% and +100%%'
      using errcode = 'check_violation', hint = 'Choose a percentage between -50 and 100.';
  end if;

  update public.services s
     set base_price = round(s.base_price * (1 + p_percent / 100), 2),
         updated_at = now()
   where s.base_price is not null
     and (p_category is null or s.category::text = p_category);

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.ops_adjust_service_prices(text, numeric, text) is
  'Every catalogue price in a category (or all) up or down by a percentage. Operators only; audited per row. 0094.';

revoke all on function public.ops_adjust_service_prices(text, numeric, text) from public, anon;
grant execute on function public.ops_adjust_service_prices(text, numeric, text) to authenticated;
revoke all on function public.validate_inspection_template() from public, anon, authenticated;
