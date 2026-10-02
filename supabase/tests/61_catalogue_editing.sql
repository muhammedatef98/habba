-- 61 — The catalogue, made safe to edit by hand
--
-- Companion to 0094: a template of the wrong shape is refused, a template
-- with filed reports keeps the items they answered, and the bulk price
-- change is operators-only, bounded, and audited.

\echo '── catalogue editing'

begin;

insert into auth.users (id, phone) values
  ('11111111-0000-4000-6161-000000000001', '+966509610001'),
  ('33333333-0000-4000-6161-000000000003', '+966509610003');
insert into public.profiles (id, full_name, phone) values
  ('11111111-0000-4000-6161-000000000001', 'العميل', '+966509610001'),
  ('33333333-0000-4000-6161-000000000003', 'المشغّل', '+966509610003');
select test.grant_role('33333333-0000-4000-6161-000000000003', 'ops');


-- Template shape ---------------------------------------------------------------
select test.assert_raises(
  $$insert into public.inspection_templates (key, name_ar, name_en, sections)
    values ('t61_empty', 'فارغ', 'Empty', '[]'::jsonb)$$,
  'a template with no sections is refused', '23514');

select test.assert_raises(
  $$insert into public.inspection_templates (key, name_ar, name_en, sections)
    values ('t61_nolabel', 'بلا اسم', 'No label',
      '[{"key":"engine","title_ar":"المحرك","title_en":"Engine",
         "items":[{"key":"oil","type":"rating","label_ar":"","label_en":"Oil"}]}]'::jsonb)$$,
  'an item without an Arabic label is refused', '23514');

select test.assert_raises(
  $$insert into public.inspection_templates (key, name_ar, name_en, sections)
    values ('t61_dup', 'مكرر', 'Duplicate',
      '[{"key":"engine","title_ar":"المحرك","title_en":"Engine",
         "items":[{"key":"oil","type":"rating","label_ar":"زيت","label_en":"Oil"},
                  {"key":"oil","type":"rating","label_ar":"زيت","label_en":"Oil"}]}]'::jsonb)$$,
  'a repeated item key is refused', '23514');

select test.assert_raises(
  $$insert into public.inspection_templates (key, name_ar, name_en, sections)
    values ('t61_weight', 'وزن', 'Weight',
      '[{"key":"engine","title_ar":"المحرك","title_en":"Engine","weight":9,
         "items":[{"key":"oil","type":"rating","label_ar":"زيت","label_en":"Oil"}]}]'::jsonb)$$,
  'a weight out of range is refused', '23514');

insert into public.inspection_templates (id, key, name_ar, name_en, sections)
values ('70000000-0000-4000-6161-000000000001', 't61_ok', 'سليم', 'Sound',
  '[{"key":"engine","title_ar":"المحرك","title_en":"Engine","weight":3,
     "items":[{"key":"oil","type":"rating","weight":2,"required":true,"label_ar":"زيت","label_en":"Oil"},
              {"key":"belts","type":"rating","label_ar":"السيور","label_en":"Belts"}]}]'::jsonb);
select test.assert(
  exists (select 1 from public.inspection_templates where key = 't61_ok'),
  'a well-formed template goes in');

-- With no reports filed, items may still be removed.
update public.inspection_templates
   set sections = '[{"key":"engine","title_ar":"المحرك","title_en":"Engine",
     "items":[{"key":"oil","type":"rating","label_ar":"زيت","label_en":"Oil"}]}]'::jsonb
 where key = 't61_ok';
select test.ok('an unused template can lose an item');

-- Filed reports keep their items ----------------------------------------------
-- The report stands in for one filed against this template; its order and
-- inspector are beside the point, so it goes in with triggers and foreign
-- keys suspended for that one statement.
set local session_replication_role = replica;
insert into public.inspection_reports (id, order_id, template_id, subject_vin, results)
values ('80000000-0000-4000-6161-000000000001', gen_random_uuid(),
        '70000000-0000-4000-6161-000000000001', 'JTDBR32E530061616', '{}'::jsonb);
set local session_replication_role = origin;

select test.assert_raises(
  $$update public.inspection_templates
       set sections = '[{"key":"engine","title_ar":"المحرك","title_en":"Engine",
         "items":[{"key":"belts","type":"rating","label_ar":"السيور","label_en":"Belts"}]}]'::jsonb
     where key = 't61_ok'$$,
  'a template with filed reports cannot lose an item they answered', '23514');

update public.inspection_templates
   set sections = '[{"key":"engine","title_ar":"محرك السيارة","title_en":"Engine","weight":4,
     "items":[{"key":"oil","type":"rating","weight":3,"label_ar":"تسريب الزيت","label_en":"Oil leaks"},
              {"key":"coolant","type":"rating","label_ar":"سائل التبريد","label_en":"Coolant"}]}]'::jsonb
 where key = 't61_ok';
select test.ok('but can be renamed, reweighted and added to');


-- Bulk price change -------------------------------------------------------------
select base_price as oil_before from public.services where name_en = 'Oil and filter change' \gset

set role authenticated;
select test.become('11111111-0000-4000-6161-000000000001');
select test.assert_raises(
  $$select public.ops_adjust_service_prices('periodic', 10, 'زيادة الموردين')$$,
  'a customer cannot change prices', '42501');

select test.become('33333333-0000-4000-6161-000000000003');
select test.assert_raises(
  $$select public.ops_adjust_service_prices('periodic', 10, '')$$,
  'a price change needs a reason', '23514');
select test.assert_raises(
  $$select public.ops_adjust_service_prices(null, 300, 'خطأ')$$,
  'and stays within bounds', '23514');

select public.ops_adjust_service_prices('periodic', 10, 'زيادة أسعار الموردين') as changed \gset
select test.assert(:changed > 0, 'an operator raises a category''s prices in one step');

reset role;
select test.assert_eq(
  (select base_price from public.services where name_en = 'Oil and filter change'),
  round(:oil_before * 1.10, 2),
  'by exactly the percentage, to the halala');
select test.assert(
  (select count(*) >= :changed from public.audit_log
    where target_table = 'services'
      and actor_id = '33333333-0000-4000-6161-000000000003'),
  'and every changed price is in the audit log');

rollback;

\echo '   catalogue editing OK'
