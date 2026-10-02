-- 0082 — The terms, the privacy policy, and how long a report lives
--
-- The app never linked to terms of use or a privacy policy. Both stores refuse
-- an app that collects personal data without a privacy policy reachable from
-- inside it, and the PDPL expects the person to be told, before they hand over
-- a phone number, what is done with it. The documents are the business's to
-- write and to change, so they are links set in the console («الشروط
-- والخصوصية»), not text baked into a build: the sign-in screen and the
-- account tab show them whenever they are set.
--
-- And a Habba report's public link lived for exactly 90 days (0014), a number
-- nobody could change. It is now a setting; a report keeps the lifetime it was
-- issued with.

insert into public.platform_settings
  (key, value, value_type, min_value, max_value, is_public, category, label_ar, unit_ar,
   description_ar, sort_order)
values
  ('terms_url', '""', 'text', null, null, true, 'legal',
   'رابط الشروط والأحكام', null,
   'يظهر في شاشة الدخول وفي «حسابي». يبدأ بـ https://', 10),
  ('privacy_url', '""', 'text', null, null, true, 'legal',
   'رابط سياسة الخصوصية', null,
   'مطلوب لنشر التطبيق في App Store وGoogle Play، ولنظام حماية البيانات الشخصية.', 20),
  ('habba_report_valid_days', '90', 'integer', 1, 365, false, 'legal',
   'مدة صلاحية رابط تقرير هبّة', 'يوم',
   'للتقارير الجديدة فقط. التقرير الصادر يبقى بالمدة التي صدر بها.', 30)
on conflict (key) do nothing;

alter table public.habba_reports
  alter column expires_at
  set default now() + make_interval(days => public.setting_number('habba_report_valid_days', 90)::int);

-- A link the app opens is https or nothing. The console is trusted, but a
-- typo («htps://», a pasted «javascript:…») should be refused where it is
-- made, not discovered on someone's phone. Every link setting is named *_url.
create or replace function public.check_setting_url()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_url text;
begin
  if new.key like '%\_url' and new.value_type = 'text' then
    v_url := new.value #>> '{}';
    if v_url <> '' and v_url !~ '^https://[^\s/]+\.[^\s]+$' then
      raise exception 'Setting % must be an https:// link', new.key
        using errcode = 'check_violation', hint = 'setting_url_https';
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function public.check_setting_url() from public, anon, authenticated;

create trigger platform_settings_url_shape
  before insert or update of value on public.platform_settings
  for each row execute function public.check_setting_url();
