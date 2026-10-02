-- 0083 — The terms, the privacy policy and the provider terms, as documents
--
-- 0082 made the terms and the privacy policy links; there was nothing to link
-- to. They are now documents Habba publishes and versions itself:
--
--   * legal_documents — every published version of each document, Arabic
--     (authoritative) and English. A version is never edited or deleted: what
--     a person agreed to must still be readable, word for word, years later.
--     A change is a new version, published from the console (audited), and it
--     can be dated ahead, so a change can be announced before it applies.
--
--   * legal_acceptances — who accepted which version, when, from where.
--     Append-only. This is the evidence that a person agreed; the sign-in
--     sentence alone («بالمتابعة فإنك توافق…») is weaker evidence than a tap.
--
--   * my_pending_legal_documents() — what this person still has to accept:
--     the current terms and privacy policy, and the provider terms for anyone
--     who has applied as a provider. A version published with
--     requires_acceptance = false (a typo fixed) asks nobody again.
--
-- The texts carry {{placeholders}} (the company's name, its CR number, the
-- complaint window…) filled from platform settings when shown, so they never
-- disagree with what the app does. Version 1 is below; its reviewable copy is
-- docs/legal/.

create type public.legal_document_kind as enum ('terms', 'privacy', 'provider_terms');

create table public.legal_documents (
  id                  uuid primary key default gen_random_uuid(),
  kind                public.legal_document_kind not null,
  version             int not null,
  body_ar             text not null check (length(body_ar) between 100 and 200000),
  body_en             text not null check (length(body_en) between 100 and 200000),
  summary_ar          text check (summary_ar is null or length(summary_ar) <= 500),
  requires_acceptance boolean not null default true,
  published_at        timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  created_by          uuid references public.profiles (id),
  unique (kind, version)
);

comment on table public.legal_documents is
  'Every published version of the terms, privacy policy and provider terms. Immutable. 0083.';

create table public.legal_acceptances (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id),
  document_id  uuid not null references public.legal_documents (id),
  accepted_at  timestamptz not null default now(),
  ip           inet,
  unique (user_id, document_id)
);

create index legal_acceptances_document_idx on public.legal_acceptances (document_id);

comment on table public.legal_acceptances is
  'Who accepted which version of which legal document, and when. Append-only. 0083.';


-- ---------------------------------------------------------------------------
-- A version is numbered by the database, dated now or later, and then frozen
-- ---------------------------------------------------------------------------
create or replace function public.number_legal_document()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtext('legal_documents:' || new.kind::text));
  new.version := coalesce(
    (select max(d.version) from public.legal_documents d where d.kind = new.kind), 0) + 1;
  new.created_at := now();
  new.created_by := auth.uid();
  -- A version cannot claim to have applied before it existed.
  if new.published_at < now() - interval '1 minute' then
    raise exception 'A legal document cannot be published in the past'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger legal_documents_number
  before insert on public.legal_documents
  for each row execute function public.number_legal_document();
alter table public.legal_documents enable always trigger legal_documents_number;

create or replace function public.reject_legal_record_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% is append-only: publish a new version instead', tg_table_name
    using errcode = 'insufficient_privilege';
end;
$$;

create trigger legal_documents_frozen
  before update or delete on public.legal_documents
  for each row execute function public.reject_legal_record_change();
create trigger legal_documents_no_truncate
  before truncate on public.legal_documents
  for each statement execute function public.reject_legal_record_change();
create trigger legal_acceptances_frozen
  before update or delete on public.legal_acceptances
  for each row execute function public.reject_legal_record_change();
create trigger legal_acceptances_no_truncate
  before truncate on public.legal_acceptances
  for each statement execute function public.reject_legal_record_change();

alter table public.legal_documents enable always trigger legal_documents_frozen;
alter table public.legal_documents enable always trigger legal_documents_no_truncate;
alter table public.legal_acceptances enable always trigger legal_acceptances_frozen;
alter table public.legal_acceptances enable always trigger legal_acceptances_no_truncate;

create trigger legal_documents_audit
  after insert on public.legal_documents
  for each row execute function public.audit_ops_change();

revoke execute on function public.number_legal_document() from public, anon, authenticated;
revoke execute on function public.reject_legal_record_change() from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- Who reads and writes
-- ---------------------------------------------------------------------------
-- A published document is public: anyone may read what they would be agreeing
-- to before they sign in, and the store listing links to it. A version dated
-- ahead is the operators' until its day comes.
alter table public.legal_documents enable row level security;
alter table public.legal_acceptances enable row level security;

create policy legal_documents_read on public.legal_documents
  for select to anon, authenticated
  using (published_at <= now() or (select public.is_ops()));

create policy legal_documents_publish_ops on public.legal_documents
  for insert to authenticated
  with check ((select public.is_ops()));

revoke all on public.legal_documents from anon, authenticated;
grant select on public.legal_documents to anon, authenticated;
grant insert on public.legal_documents to authenticated;

-- Acceptances are written only by accept_legal_documents(), which records the
-- caller and the time itself.
create policy legal_acceptances_read on public.legal_acceptances
  for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_ops()));

revoke all on public.legal_acceptances from anon, authenticated;
grant select on public.legal_acceptances to authenticated;


-- ---------------------------------------------------------------------------
-- What is current, what is pending, and accepting it
-- ---------------------------------------------------------------------------
create or replace function public.current_legal_document(p_kind public.legal_document_kind)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select d.id from public.legal_documents d
   where d.kind = p_kind and d.published_at <= now()
   order by d.version desc
   limit 1;
$$;

create or replace function public.my_pending_legal_documents()
returns table (
  id uuid,
  kind public.legal_document_kind,
  version int,
  summary_ar text,
  published_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select d.id, d.kind, d.version, d.summary_ar, d.published_at
    from public.legal_documents d
   where (select auth.uid()) is not null
     and d.id = public.current_legal_document(d.kind)
     -- The provider terms are for those who have applied as a provider.
     and (d.kind <> 'provider_terms'
          or exists (select 1 from public.providers p where p.owner_profile_id = (select auth.uid())))
     -- Pending unless this person accepted a version at least as new as the
     -- newest one that asked to be accepted.
     and not exists (
       select 1
         from public.legal_acceptances a
         join public.legal_documents accepted on accepted.id = a.document_id
        where a.user_id = (select auth.uid())
          and accepted.kind = d.kind
          and accepted.version >= coalesce(
                (select max(r.version) from public.legal_documents r
                  where r.kind = d.kind and r.requires_acceptance and r.published_at <= now()),
                d.version))
   order by d.kind;
$$;

create or replace function public.accept_legal_documents(p_document_ids uuid[])
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_count int;
begin
  if v_user is null then
    raise exception 'Sign in first' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(cardinality(p_document_ids), 0) = 0 then
    return 0;
  end if;

  -- Only the version in force can be accepted: agreeing to one that has
  -- since been replaced would record consent to terms that no longer apply.
  if exists (
    select 1 from unnest(p_document_ids) as ids(id)
     where not exists (
       select 1 from public.legal_documents d
        where d.id = ids.id and d.id = public.current_legal_document(d.kind))
  ) then
    raise exception 'That is not the version in force; reload and accept again'
      using errcode = 'check_violation', hint = 'legal_document_superseded';
  end if;

  insert into public.legal_acceptances (user_id, document_id, accepted_at, ip)
  select v_user, ids.id, now(), public.request_ip()
    from (select distinct unnest(p_document_ids) as id) ids
  on conflict (user_id, document_id) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- The console's list: every version, with how many people accepted it.
create or replace function public.ops_legal_documents()
returns table (
  id uuid,
  kind public.legal_document_kind,
  version int,
  summary_ar text,
  requires_acceptance boolean,
  published_at timestamptz,
  created_at timestamptz,
  created_by_name text,
  acceptances bigint,
  is_current boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_ops() then
    raise exception 'Operators only' using errcode = 'insufficient_privilege';
  end if;
  return query
    select d.id, d.kind, d.version, d.summary_ar, d.requires_acceptance, d.published_at,
           d.created_at, p.full_name,
           (select count(*) from public.legal_acceptances a where a.document_id = d.id),
           d.id = public.current_legal_document(d.kind)
      from public.legal_documents d
      left join public.profiles p on p.id = d.created_by
     order by d.kind, d.version desc;
end;
$$;

revoke execute on function public.current_legal_document(public.legal_document_kind) from public, anon, authenticated;
revoke execute on function public.my_pending_legal_documents() from public, anon;
revoke execute on function public.accept_legal_documents(uuid[]) from public, anon;
revoke execute on function public.ops_legal_documents() from public, anon;
grant execute on function public.my_pending_legal_documents() to authenticated;
grant execute on function public.accept_legal_documents(uuid[]) to authenticated;
grant execute on function public.ops_legal_documents() to authenticated;


-- ---------------------------------------------------------------------------
-- The company's details, which the documents name
-- ---------------------------------------------------------------------------
insert into public.platform_settings
  (key, value, value_type, min_value, max_value, is_public, category, label_ar, unit_ar,
   description_ar, sort_order)
values
  ('legal_company_name_ar', '"هبّة"', 'text', null, null, true, 'legal',
   'الاسم النظامي للشركة', null,
   'كما في السجل التجاري. يظهر في الشروط والأحكام وسياسة الخصوصية.', 40),
  ('legal_company_name_en', '"Habba"', 'text', null, null, true, 'legal',
   'الاسم النظامي بالإنجليزية', null, null, 50),
  ('legal_cr_number', '""', 'text', null, null, true, 'legal',
   'رقم السجل التجاري', null, null, 60),
  ('legal_address_ar', '""', 'text', null, null, true, 'legal',
   'العنوان الوطني للشركة', null, 'مثل: الرياض، حي ...، الرمز البريدي ...', 70),
  ('legal_address_en', '""', 'text', null, null, true, 'legal',
   'العنوان بالإنجليزية', null, null, 80)
on conflict (key) do nothing;


-- ---------------------------------------------------------------------------
-- Version 1
-- ---------------------------------------------------------------------------
insert into public.legal_documents (kind, body_ar, body_en, summary_ar) values
  ('terms',
$legal$# شروط وأحكام استخدام تطبيق هبّة

الإصدار {{version}} — يسري اعتباراً من {{effective_date}}

مرحباً بك في هبّة. تنظّم هذه الشروط والأحكام («الشروط») استخدامك لتطبيق هبّة وخدماته، ويقدّمها {{company}}، سجل تجاري رقم {{cr}}، وعنوانه {{address}} («هبّة» أو «نحن»). يُعدّ تسجيلك في التطبيق أو استخدامه موافقةً منك على هذه الشروط وعلى سياسة الخصوصية. إن لم توافق عليها فلا تستخدم التطبيق.

## 1. التعريفات

- **التطبيق:** تطبيق هبّة على الأجهزة المحمولة، وما يرتبط به من مواقع وخدمات.
- **العميل:** كل من يطلب خدمة عبر التطبيق أو يستخدم دفتر السيارة.
- **مقدّم الخدمة:** الفنّي المتنقل أو الورشة المسجّلة في التطبيق بعد التحقق منها، وهو مستقلّ عن هبّة.
- **الطلب:** طلب خدمة يرسله العميل عبر التطبيق، طارئاً كان أو موعداً محجوزاً أو فحصاً.
- **دفتر السيارة:** السجل الرقمي لتاريخ صيانة المركبة وخدماتها داخل التطبيق.
- **تقرير هبّة:** تقرير يُصدَر من دفتر السيارة ويمكن مشاركته برابط أو رمز QR.
- **الضمان:** مدة الضمان التي يحدّدها مقدّم الخدمة على العمل المنجز وتظهر في الطلب.

## 2. الأهلية والحساب

- يجب أن يكون عمرك 18 سنة فأكثر، وأن تكون أهلاً للتعاقد وفق أنظمة المملكة العربية السعودية.
- الحساب مرتبط برقم جوالك أو بريدك الإلكتروني، وأنت مسؤول عن كل ما يجري من خلاله وعن سرية رموز التحقق التي تصلك. لا تشارك رمز التحقق مع أي أحد، وهبّة لا تطلبه منك أبداً.
- تلتزم بتقديم بيانات صحيحة وكاملة وتحديثها، ومنها بيانات مركبتك وقراءة العدّاد.
- الدخول كضيف متاح لتجربة التطبيق، وبيانات حساب الضيف مرتبطة بالجهاز. إن سجّلت الخروج أو حذفت التطبيق قبل ربط الحساب برقم جوال أو بريد فقد تفقد بياناته نهائياً، ولا تتحمّل هبّة أي مسؤولية عن ذلك.

## 3. طبيعة خدمة هبّة

- هبّة منصة تقنية تربط العملاء بمقدّمي خدمات مستقلين لصيانة المركبات وإصلاحها وفحصها. **هبّة ليست ورشة ولا تنفّذ أعمال الصيانة بنفسها**، ومقدّم الخدمة هو المسؤول عن تنفيذ العمل وجودته وفق هذه الشروط وشروط مقدّمي الخدمة.
- تتحقق هبّة من هوية مقدّمي الخدمة قبل قبولهم، لكنها لا تضمن نتيجة عمل بعينه إلا في حدود ما تنص عليه هذه الشروط صراحةً، ومنه الضمان وإجراءات الشكاوى.
- أوقات الوصول والمدد والأسعار التقديرية المعروضة تقديرات تقريبية وليست التزاماً، وقد تتأثر بالازدحام والطقس وتوفّر مقدّمي الخدمة.
- قد تتوقف بعض الخدمات أو المدن مؤقتاً أو دائماً، ويحق لهبّة تعديل الخدمات المتاحة وطرق تقديمها في أي وقت.

## 4. الطلبات والأسعار

- تُعرض الأسعار بالريال السعودي وتشمل ضريبة القيمة المضافة (15%) ما لم يُذكر خلاف ذلك.
- قد يطلب منك التطبيق تصوير المشكلة قبل إرسال الطلب ليقدّم مقدّم الخدمة عرض سعر أدقّ. العرض غير ملزم لك حتى توافق عليه.
- **لا يُضاف إلى فاتورتك أي قطعة غيار أو عمل إضافي إلا بعد موافقتك عليه داخل التطبيق.** تُعرض كل قطعة باسمها ورقمها وسعرها وبيان إن كانت أصلية أو بديلة.
- تلتزم بتقديم وصف صحيح للمشكلة وموقع دقيق، وبأن تكون أنت أو من تفوّضه موجوداً عند التنفيذ، وأن تكون مالك المركبة أو مفوّضاً من مالكها. أزل الأغراض الثمينة من المركبة قبل تسليمها، فهبّة غير مسؤولة عن فقدانها.
- يحق لمقدّم الخدمة الاعتذار عن تنفيذ عمل يرى أنه غير آمن أو خارج قدرته أو يخالف الأنظمة.

## 5. الدفع

- عند تأكيد الطلب يُحجز مبلغ الطلب على وسيلة الدفع دون خصمه. **لا يُخصم المبلغ إلا بعد تأكيدك إنجاز العمل.**
- إن تجاوزت الفاتورة النهائية المبلغ المحجوز بسبب قطع وافقت عليها، يُطلب منك حجز الفرق عند تأكيد الإنجاز.
- إن لم تؤكّد الإنجاز ولم تفتح شكوى خلال {{auto_complete_hours}} ساعة من تسليم العمل، يُعدّ الطلب مكتملاً ويُخصم المبلغ تلقائياً.
- تتم المدفوعات عبر مزوّد دفع مرخّص، ولا تحتفظ هبّة ببيانات بطاقتك.
- تصدر فاتورة ضريبية إلكترونية لكل طلب مكتمل وفق متطلبات هيئة الزكاة والضريبة والجمارك.
- قد يسقط الحجز على البطاقة بعد مدة يحددها البنك المصدر، وعندها يُطلب منك حجز المبلغ من جديد.

## 6. الإلغاء

- يمكنك إلغاء الطلب من التطبيق قبل بدء التنفيذ، ويُلغى الحجز على وسيلة الدفع. الإلغاء مجاني حالياً، ويحق لهبّة فرض رسوم إلغاء بعد إعلانها في التطبيق مسبقاً، ولا تسري على طلب أُرسل قبل إعلانها.
- يحق لهبّة إلغاء أي طلب إذا لم يتوفر مقدّم خدمة، أو لدواعي السلامة، أو عند الاشتباه في احتيال أو مخالفة لهذه الشروط، ويُلغى الحجز أو يُسترد المبلغ في هذه الحالات.

## 7. الضمان

- لكل عمل مكتمل مدة ضمان يحدّدها مقدّم الخدمة وتظهر في الطلب وفي دفتر السيارة.
- **الضمان يتبع المركبة:** يحق لمالكها الحالي المطالبة به خلال مدته، حتى بعد بيعها ونقل ملكيتها عبر التطبيق.
- إن ظهر خلل في العمل نفسه خلال مدة الضمان، يُعاد تنفيذ العمل مجاناً، ويُوجَّه الطلب إلى مقدّم الخدمة نفسه، أو إلى غيره إذا تعذّر ذلك.
- لا يشمل الضمان: سوء الاستخدام، والحوادث، وعمل جهة أخرى على الجزء نفسه، والاستهلاك الطبيعي، والقطع التي يوفّرها العميل بنفسه، والأعطال غير المرتبطة بالعمل المنجز.
- التعويض بموجب الضمان مقصور على إعادة تنفيذ العمل، ولا يشمل التعويض النقدي إلا إذا قررت هبّة ذلك بعد مراجعة الشكوى.

## 8. الشكاوى والاسترداد

- يمكنك فتح شكوى على طلب مكتمل خلال {{dispute_window_days}} يوماً من اكتماله.
- تراجع هبّة الشكوى بناءً على الأدلة المتاحة، ومنها صور الإنجاز وقراءة العدّاد وسجل الطلب ودفتر السيارة وأقوال الطرفين، ثم تقرر: رفض الشكوى، أو استرداد المبلغ كله أو جزء منه، أو إعادة تنفيذ العمل.
- يُعاد المبلغ المسترد إلى وسيلة الدفع الأصلية، وتختلف مدة ظهوره بحسب البنك.
- لا تمس إجراءات الشكاوى أي حق نظامي لك لا يجوز التنازل عنه.

## 9. دفتر السيارة وتقرير هبّة ونقل الملكية

- تُسجَّل الخدمات المنفّذة عبر هبّة في دفتر السيارة تلقائياً، ويمكنك إضافة خدمات نُفّذت خارج هبّة، وتظهر مميّزة على أنها «مُدخلة من المالك» وليست موثّقة من هبّة.
- سجل دفتر السيارة لا يُعدَّل ولا يُحذف بعد تسجيله، حفاظاً على موثوقيته، ويمكن تصحيح أي خطأ بقيد لاحق.
- **تقرير هبّة يعكس ما سُجّل في دفتر السيارة فقط، وليس فحصاً للمركبة ولا ضماناً لحالتها أو لسلامتها أو لخلوّها من العيوب أو الحوادث.** تنصح هبّة كل مشترٍ بفحص المركبة فحصاً مستقلاً قبل الشراء، ولا تتحمّل هبّة مسؤولية أي قرار شراء أو بيع بُني على التقرير.
- رابط التقرير صالح للمدة المبيّنة عند إصداره، ويمكنك إلغاؤه في أي وقت. أنت المسؤول عمّن تشارك الرابط معهم.
- عند نقل ملكية المركبة عبر التطبيق، ينتقل دفتر السيارة وتاريخ صيانتها والضمانات السارية إلى المالك الجديد، دون بياناتك الشخصية ولا المبالغ التي دفعتها ولا عناوينك. بموافقتك على النقل فإنك توافق على ذلك.

## 10. الفحص قبل الشراء

- الفحص قبل الشراء فحص ظاهري غير تفكيكي وفق قائمة البنود المبيّنة في التقرير، ويعكس حالة المركبة وقت الفحص فقط.
- لا يُعدّ تقرير الفحص ضماناً لخلوّ المركبة من العيوب الخفية أو التي لا يمكن كشفها بالفحص الظاهري، ولا لحالتها المستقبلية.

## 11. التقييمات والمحتوى

- يمكنك تقييم الخدمة وكتابة ملاحظة وإرسال صور ومقاطع. تلتزم بأن يكون المحتوى صادقاً ولا يتضمن إساءة أو تشهيراً أو بيانات شخصية للآخرين أو ما يخالف الأنظمة والآداب العامة.
- تمنح هبّة ترخيصاً غير حصري ومجانياً وقابلاً للنقل لاستخدام التقييمات والمحتوى الذي ترسله لتشغيل الخدمة وتحسينها وعرض التقييمات، مع التزامها بسياسة الخصوصية.
- يحق لهبّة إخفاء أي تقييم أو محتوى يخالف هذه الشروط.

## 12. الاستخدام المحظور

يُحظر عليك:

- إرسال طلبات وهمية، أو تقديم بيانات كاذبة، أو انتحال شخصية غيرك.
- الاتفاق مع مقدّم خدمة تعرّفت عليه عبر هبّة على تنفيذ الطلب أو الدفع خارج التطبيق للتهرّب من رسومها. من يفعل ذلك يفقد حماية الدفع والضمان وإجراءات الشكاوى، ويجوز إيقاف حسابه.
- إساءة معاملة مقدّمي الخدمة أو موظفي هبّة أو تهديدهم.
- محاولة اختراق التطبيق أو تعطيله أو الوصول إلى بيانات غيرك، أو الهندسة العكسية له، أو جمع بياناته آلياً.
- استخدام التطبيق لأي غرض مخالف لأنظمة المملكة العربية السعودية.

## 13. إيقاف الحساب وإنهاؤه

- يحق لهبّة إيقاف حسابك أو تقييده أو إنهاؤه، مؤقتاً أو دائماً، عند مخالفة هذه الشروط أو الاشتباه في احتيال أو إساءة، أو إذا طلبت ذلك جهة مختصة. لا يمنع الإيقاف تسوية الطلبات القائمة.
- يمكنك طلب حذف حسابك بالتواصل معنا. نحذف بياناتك الشخصية أو نجهّلها، ويبقى دفتر السيارة مع المركبة، وتبقى الفواتير والسجلات التي تفرض الأنظمة الاحتفاظ بها، كما تبيّن سياسة الخصوصية.

## 14. الملكية الفكرية

جميع حقوق التطبيق وتصميمه وشعاراته واسم «هبّة» ومحتواه وبرمجياته مملوكة لهبّة أو مرخّصة لها. تمنحك هبّة ترخيصاً شخصياً محدوداً غير حصري وغير قابل للنقل لاستخدام التطبيق لأغراضك الشخصية وفق هذه الشروط، ولا يجوز نسخ أي جزء منه أو استغلاله تجارياً دون موافقة كتابية.

## 15. حدود المسؤولية

إلى أقصى حدّ تسمح به الأنظمة المعمول بها في المملكة العربية السعودية:

- يُقدَّم التطبيق «كما هو» و«حسب توفّره»، ولا تضمن هبّة عمله دون انقطاع أو خلوّه من الأخطاء.
- لا تتحمّل هبّة مسؤولية أفعال مقدّمي الخدمة أو تقصيرهم، بصفتهم مستقلين عنها، إلا في حدود ما تلتزم به صراحةً في هذه الشروط.
- لا تتحمّل هبّة أي أضرار غير مباشرة أو تبعية، ومنها فوات الربح أو الوقت أو تعطّل المركبة أو تكاليف النقل البديل.
- لا تتجاوز مسؤولية هبّة الإجمالية تجاهك، في أي مطالبة تتعلق بطلب، المبلغ الذي دفعته عن ذلك الطلب.
- لا يحدّ ما سبق من مسؤولية هبّة عن الغش أو الخطأ الجسيم، ولا من أي حق لا يجوز تقييده نظاماً.

## 16. التعويض

تلتزم بتعويض هبّة ومسؤوليها وموظفيها عن أي مطالبات أو خسائر أو تكاليف، ومنها أتعاب المحاماة المعقولة، تنشأ عن مخالفتك هذه الشروط أو الأنظمة، أو عن محتوى ترسله، أو عن نزاع بينك وبين طرف آخر بشأن مركبة لا تملكها أو غير مفوّض بها.

## 17. القوة القاهرة

لا تتحمّل هبّة مسؤولية أي تأخير أو إخفاق ناتج عن ظروف خارجة عن سيطرتها المعقولة، ومنها الكوارث الطبيعية والظروف الجوية القاسية وانقطاع الاتصالات أو خدمات السحابة أو الدفع والقرارات الحكومية.

## 18. تعديل الشروط

يحق لهبّة تعديل هذه الشروط. نعلمك بالتعديلات الجوهرية داخل التطبيق، وقد نطلب موافقتك عليها قبل متابعة الاستخدام. يسري كل إصدار من تاريخ نشره، ولا يسري على طلب أُرسل قبله. يُعدّ استمرارك في استخدام التطبيق بعد نشر التعديل قبولاً له.

## 19. النظام الواجب التطبيق وتسوية النزاعات

- تخضع هذه الشروط لأنظمة المملكة العربية السعودية وتُفسَّر وفقها.
- يسعى الطرفان إلى حل أي نزاع ودياً خلال ثلاثين يوماً من إشعار أحدهما الآخر به عبر وسائل التواصل أدناه، فإن تعذّر ذلك يُحال النزاع إلى المحاكم المختصة في مدينة الرياض.

## 20. أحكام عامة

- النص العربي لهذه الشروط هو المعتمد، ويُرجع إليه عند أي اختلاف مع ترجمتها.
- إن بطل أي حكم من هذه الشروط فلا يؤثر ذلك في بقية أحكامها.
- عدم ممارسة هبّة لأي حق لا يُعدّ تنازلاً عنه.
- يحق لهبّة التنازل عن حقوقها والتزاماتها بموجب هذه الشروط لأي جهة تابعة لها أو خلف لها، ولا يحق لك ذلك دون موافقتها.
- تُعدّ الإشعارات المرسلة عبر التطبيق أو الرسائل النصية أو البريد الإلكتروني المسجّل إشعارات صحيحة.

## 21. التواصل

- البريد الإلكتروني: {{email}}
- الهاتف: {{phone}}
- العنوان: {{address}}
$legal$,
$legal$# Habba Terms of Use

Version {{version}} — effective {{effective_date}}

Welcome to Habba. These terms of use (the "Terms") govern your use of the Habba app and its services, provided by {{company}}, commercial registration no. {{cr}}, of {{address}} ("Habba", "we"). By registering for or using the app you agree to these Terms and to the Privacy Policy. If you do not agree, do not use the app.

_This is a translation. The Arabic text is authoritative and prevails in case of any difference._

## 1. Definitions

- **App:** the Habba mobile application and its related sites and services.
- **Customer:** anyone who requests a service through the app or uses the vehicle logbook.
- **Provider:** a mobile technician or workshop registered in the app after verification, who is independent of Habba.
- **Order:** a service request sent through the app, whether an emergency, a booked appointment or an inspection.
- **Vehicle logbook:** the digital record of a vehicle's service history in the app.
- **Habba Report:** a report issued from the vehicle logbook that can be shared by link or QR code.
- **Warranty:** the warranty period a provider sets on completed work, shown on the order.

## 2. Eligibility and your account

- You must be at least 18 years old and legally capable of contracting under the laws of the Kingdom of Saudi Arabia.
- Your account is tied to your mobile number or email. You are responsible for everything done through it and for keeping the verification codes you receive secret. Never share a verification code with anyone; Habba will never ask you for it.
- You must provide accurate, complete information, including your vehicle details and odometer readings, and keep it up to date.
- Guest access lets you try the app; a guest account's data is tied to the device. If you sign out or delete the app before linking the account to a mobile number or email, its data may be permanently lost, and Habba bears no responsibility for that.

## 3. What Habba is

- Habba is a technology platform connecting customers with independent providers of vehicle maintenance, repair and inspection. **Habba is not a workshop and does not perform maintenance work itself**; the provider is responsible for performing the work and its quality under these Terms and the Provider Terms.
- Habba verifies providers' identity before accepting them, but does not guarantee the outcome of any particular job except as these Terms expressly provide, including the warranty and the complaints process.
- Arrival times, durations and estimated prices are approximate estimates, not commitments, and may be affected by traffic, weather and provider availability.
- Some services or cities may be paused temporarily or permanently, and Habba may change the services available and how they are provided at any time.

## 4. Orders and prices

- Prices are shown in Saudi riyals and include 15% VAT unless stated otherwise.
- The app may ask you to film the problem before sending an order so the provider can quote more accurately. A quote does not bind you until you accept it.
- **No part or additional work is added to your bill unless you approve it in the app.** Each part is shown with its name, number, price and whether it is original or aftermarket.
- You must describe the problem truthfully and give an accurate location, be present (or have an authorised person present) during the work, and be the vehicle's owner or authorised by its owner. Remove valuables from the vehicle before handing it over; Habba is not responsible for their loss.
- A provider may decline work they consider unsafe, beyond their ability, or unlawful.

## 5. Payment

- When an order is confirmed, its amount is held on your payment method without being charged. **You are charged only after you confirm the work is complete.**
- If the final bill exceeds the held amount because of parts you approved, you are asked to hold the difference when confirming completion.
- If you neither confirm completion nor open a complaint within {{auto_complete_hours}} hours of the work being handed back, the order is deemed complete and charged automatically.
- Payments are processed by a licensed payment provider; Habba does not store your card details.
- An electronic tax invoice is issued for every completed order in line with ZATCA requirements.
- A card hold may lapse after a period set by the issuing bank, in which case you are asked to hold the amount again.

## 6. Cancellation

- You may cancel an order in the app before work starts, and the hold on your payment method is released. Cancellation is currently free; Habba may introduce cancellation fees after announcing them in the app in advance, and they will not apply to orders sent before the announcement.
- Habba may cancel any order if no provider is available, for safety reasons, or on suspicion of fraud or breach of these Terms; in these cases the hold is released or the amount refunded.

## 7. Warranty

- Each completed job carries a warranty period set by the provider and shown on the order and in the vehicle logbook.
- **The warranty follows the vehicle:** its current owner may claim it within the period, even after the vehicle is sold and ownership transferred through the app.
- If a defect in the work itself appears within the warranty period, the work is redone free of charge, routed to the same provider or, if that is not possible, to another.
- The warranty does not cover misuse, accidents, work by another party on the same part, normal wear, parts supplied by the customer, or faults unrelated to the work done.
- The remedy under the warranty is limited to redoing the work, and does not include cash compensation unless Habba decides otherwise after reviewing a complaint.

## 8. Complaints and refunds

- You may open a complaint on a completed order within {{dispute_window_days}} days of its completion.
- Habba reviews the complaint on the available evidence, including completion photos, the odometer reading, the order record, the vehicle logbook and both parties' accounts, and decides to reject the complaint, refund all or part of the amount, or have the work redone.
- Refunds go back to the original payment method; how long they take to appear depends on your bank.
- The complaints process does not affect any statutory right you cannot waive.

## 9. Vehicle logbook, Habba Report and ownership transfer

- Services performed through Habba are recorded in the vehicle logbook automatically. You may add services performed outside Habba; these are marked "entered by owner" and are not verified by Habba.
- Logbook entries cannot be edited or deleted once recorded, to keep the record trustworthy; a mistake can be corrected by a later entry.
- **A Habba Report reflects only what is recorded in the vehicle logbook. It is not an inspection of the vehicle and not a guarantee of its condition, safety, or freedom from defects or accidents.** Habba advises every buyer to have the vehicle independently inspected before buying, and accepts no responsibility for any purchase or sale decision based on the report.
- A report link is valid for the period shown when it is issued, and you may revoke it at any time. You are responsible for whom you share the link with.
- When vehicle ownership is transferred through the app, the logbook, service history and active warranties pass to the new owner, without your personal data, the amounts you paid or your addresses. By agreeing to a transfer you agree to this.

## 10. Pre-purchase inspection

- A pre-purchase inspection is a visual, non-invasive check against the items listed in the report, and reflects the vehicle's condition at the time of inspection only.
- The inspection report is not a guarantee that the vehicle is free of hidden defects, or defects that a visual inspection cannot reveal, nor of its future condition.

## 11. Ratings and content

- You may rate a service, write a comment and send photos and videos. Your content must be truthful and must not be abusive or defamatory, contain other people's personal data, or break the law or public morals.
- You grant Habba a non-exclusive, royalty-free, transferable licence to use the ratings and content you send to operate and improve the service and to display ratings, subject to the Privacy Policy.
- Habba may hide any rating or content that breaches these Terms.

## 12. Prohibited use

You must not:

- send fake orders, provide false information, or impersonate anyone.
- arrange with a provider you met through Habba to carry out or pay for an order outside the app to avoid Habba's fees. Anyone who does so loses payment protection, the warranty and the complaints process, and their account may be suspended.
- abuse or threaten providers or Habba staff.
- attempt to breach or disrupt the app, access other people's data, reverse-engineer it, or scrape it.
- use the app for any purpose that breaks the laws of the Kingdom of Saudi Arabia.

## 13. Suspension and termination

- Habba may suspend, restrict or terminate your account, temporarily or permanently, for breach of these Terms, suspected fraud or abuse, or at the request of a competent authority. Suspension does not prevent open orders from being settled.
- You may ask us to delete your account. We delete or anonymise your personal data; the vehicle logbook stays with the vehicle, and invoices and records the law requires us to keep are retained, as the Privacy Policy explains.

## 14. Intellectual property

All rights in the app, its design, logos, the name "Habba", its content and software are owned by or licensed to Habba. Habba grants you a personal, limited, non-exclusive, non-transferable licence to use the app for your personal purposes under these Terms. No part of it may be copied or exploited commercially without written consent.

## 15. Limitation of liability

To the fullest extent permitted by the laws in force in the Kingdom of Saudi Arabia:

- The app is provided "as is" and "as available", and Habba does not guarantee it will operate without interruption or error.
- Habba is not liable for the acts or omissions of providers, who are independent of it, except to the extent it expressly undertakes in these Terms.
- Habba is not liable for any indirect or consequential loss, including loss of profit or time, vehicle downtime or alternative transport costs.
- Habba's total liability to you for any claim relating to an order does not exceed the amount you paid for that order.
- Nothing above limits Habba's liability for fraud or gross negligence, or any right that cannot lawfully be restricted.

## 16. Indemnity

You agree to indemnify Habba, its officers and employees against any claims, losses or costs, including reasonable legal fees, arising from your breach of these Terms or the law, from content you send, or from a dispute between you and a third party over a vehicle you do not own or are not authorised to use.

## 17. Force majeure

Habba is not liable for any delay or failure caused by circumstances beyond its reasonable control, including natural disasters, severe weather, outages of communications, cloud or payment services, and government decisions.

## 18. Changes to these Terms

Habba may amend these Terms. We will notify you of material changes in the app and may ask you to accept them before you continue using it. Each version applies from its publication date and does not apply to orders sent before it. Continuing to use the app after a change is published constitutes acceptance of it.

## 19. Governing law and disputes

- These Terms are governed by and construed in accordance with the laws of the Kingdom of Saudi Arabia.
- The parties will try to settle any dispute amicably within thirty days of one notifying the other through the contact details below; failing that, the dispute will be referred to the competent courts in Riyadh.

## 20. General

- The Arabic text of these Terms is authoritative and prevails over any translation.
- If any provision is held invalid, the remaining provisions are unaffected.
- Habba's failure to exercise any right is not a waiver of it.
- Habba may assign its rights and obligations under these Terms to an affiliate or successor; you may not do so without its consent.
- Notices sent through the app, by SMS or to your registered email are valid notices.

## 21. Contact

- Email: {{email}}
- Phone: {{phone}}
- Address: {{address}}
$legal$,
  'الإصدار الأول'),
  ('privacy',
$legal$# سياسة الخصوصية

الإصدار {{version}} — يسري اعتباراً من {{effective_date}}

تشرح هذه السياسة كيف يجمع {{company}}، سجل تجاري رقم {{cr}} («هبّة» أو «نحن»)، بياناتك الشخصية ويستخدمها ويحميها عند استخدامك تطبيق هبّة، وما حقوقك عليها، وفقاً لنظام حماية البيانات الشخصية في المملكة العربية السعودية ولوائحه. هبّة هي الجهة المسؤولة عن معالجة بياناتك.

## 1. البيانات التي نجمعها

**بيانات تقدّمها أنت:**

- الاسم ورقم الجوال والبريد الإلكتروني إن استخدمته.
- بيانات المركبة: الشركة المصنّعة والطراز وسنة الصنع ولوحة المركبة ورقم الهيكل (VIN) وقراءة العدّاد.
- وصف المشكلة والصور ومقاطع الفيديو التي ترسلها، والتقييمات والملاحظات، ومراسلاتك مع الدعم.
- عنوان تنفيذ الخدمة.

**بيانات تنشأ عند استخدامك التطبيق:**

- موقعك الجغرافي عند إرسال طلب، لتحديد مكان الخدمة وإيجاد أقرب مقدّم خدمة. لا نتتبّع موقع العملاء في الخلفية.
- سجل الطلبات والفواتير ودفتر السيارة والضمانات.
- بيانات الدفع: مرجع العملية ومبلغها وحالتها فقط. **لا نطّلع على رقم بطاقتك ولا نحتفظ به**، فمزوّد الدفع المرخّص هو من يعالجه.
- بيانات الجهاز: رمز الإشعارات ونوع النظام وإصدار التطبيق، وسجلات تقنية لحماية الخدمة وإصلاح الأعطال.
- سجل طلبات رموز التحقق لمنع إساءة الاستخدام.

**بيانات إضافية لمقدّمي الخدمة:**

- رقم الهوية الوطنية أو الإقامة، ونتيجة التحقق عبر «نفاذ»، ورقم الآيبان. **نحفظ رقم الهوية والآيبان مشفّرَين**، ولا يطّلع عليهما إلا من تقتضي مهمته ذلك.
- الموقع الجغرافي أثناء وضع «متاح» وأثناء تنفيذ الطلب فقط، ليرى العميل وصول الفنّي ولتوجيه الطلبات القريبة. يتوقف إرسال الموقع عند الخروج من وضع «متاح».
- صور إنجاز العمل وقراءة العدّاد وتقارير الفحص، والتقييمات والأرباح والمدفوعات.

## 2. لماذا نستخدم بياناتك

- **لتنفيذ الخدمة التي طلبتها:** إنشاء حسابك، وإيجاد مقدّم خدمة، وتتبّع الطلب، والدفع، وإصدار الفواتير، وتسجيل الخدمة في دفتر السيارة، ومعالجة الضمان والشكاوى.
- **للوفاء بالتزاماتنا النظامية:** الفوترة الإلكترونية والاحتفاظ بالسجلات وفق أنظمة الزكاة والضريبة، والتحقق من هوية مقدّمي الخدمة، والاستجابة لطلبات الجهات المختصة.
- **لمصالحنا المشروعة:** حماية المستخدمين من الاحتيال وإساءة الاستخدام، وأمن التطبيق، وتحسين الخدمة ودقة الأسعار والتنبيهات، على نحو لا يمسّ حقوقك.
- **بموافقتك:** تذكيرات الصيانة والعروض والإشعارات غير الضرورية للطلب، ويمكنك سحب موافقتك في أي وقت من إعدادات الجهاز أو التطبيق.

لا نبيع بياناتك الشخصية، ولا نستخدمها في اتخاذ قرارات آلية بالكامل تترتب عليها آثار نظامية عليك.

## 3. مع من نشارك بياناتك

- **مقدّم الخدمة المكلّف بطلبك:** نشارك معه ما يلزم لتنفيذ الطلب فقط: اسمك، وموقع الخدمة، وبيانات المركبة، ووصف المشكلة وما أرسلته من صور ومقاطع. ويرى العميل اسم مقدّم الخدمة وتقييمه وموقعه أثناء الطلب.
- **مزوّدو الخدمات التقنية** الذين يعملون لحسابنا وبموجب عقود تلزمهم بحماية البيانات: الاستضافة السحابية وقواعد البيانات، ومزوّد الدفع، ومزوّد الرسائل النصية، وخدمات الإشعارات من Apple وGoogle.
- **المالك الجديد للمركبة** عند نقل ملكيتها عبر التطبيق: ينتقل إليه تاريخ صيانة المركبة والضمانات، دون اسمك ولا بيانات تواصلك ولا المبالغ التي دفعتها ولا عناوينك.
- **من تشارك معه تقرير هبّة:** يطّلع صاحب الرابط على ما يتضمنه التقرير من تاريخ المركبة، دون بياناتك الشخصية.
- **الجهات الحكومية والقضائية** متى ألزمنا النظام بذلك.
- **عند إعادة الهيكلة أو الاستحواذ:** قد تنتقل البيانات إلى الجهة الخلف بالشروط نفسها.

## 4. نقل البيانات خارج المملكة

تُستضاف بيانات هبّة حالياً في مراكز بيانات في ألمانيا (الاتحاد الأوروبي)، حيث تخضع لمستوى حماية مرتفع. ننقل البيانات وفق ما يجيزه نظام حماية البيانات الشخصية ولائحة نقل البيانات خارج المملكة، ونطبّق ضمانات تعاقدية وتقنية مناسبة، ونقصر النقل على الحد الأدنى اللازم.

## 5. مدة الاحتفاظ

- نحتفظ ببيانات حسابك طوال مدة استخدامك التطبيق.
- نحتفظ بالفواتير وسجلات المعاملات المدة التي تفرضها الأنظمة، ومنها أنظمة الزكاة والضريبة.
- نحذف سجلات طلبات رموز التحقق بعد 30 يوماً.
- **دفتر السيارة سجل للمركبة وليس لشخصك:** عند حذف حسابك يبقى تاريخ صيانة المركبة معها ومع مالكها التالي، بعد فصله عن بياناتك الشخصية.
- عند انتهاء الغرض نحذف البيانات أو نجهّلها بحيث لا تدلّ عليك.

## 6. حقوقك

يمنحك نظام حماية البيانات الشخصية الحقوق التالية:

- **العلم:** أن تعرف كيف نجمع بياناتك ونستخدمها، وهو ما تشرحه هذه السياسة.
- **الوصول:** أن تطّلع على بياناتك وتحصل على نسخة منها بصيغة مقروءة.
- **التصحيح:** أن تطلب تصحيح بياناتك أو إكمالها أو تحديثها.
- **الإتلاف:** أن تطلب حذف بياناتك متى انتفت الحاجة إليها، إلا ما يلزمنا النظام بالاحتفاظ به.
- **سحب الموافقة:** أن تسحب موافقتك على أي معالجة قائمة على الموافقة، دون أن يؤثر ذلك في مشروعية ما سبقها.

لممارسة أي من هذه الحقوق راسلنا على {{email}}. نتحقق من هويتك ثم نرد خلال المدة النظامية (30 يوماً). إن لم تكن راضياً عن ردّنا فيحق لك تقديم شكوى إلى الهيئة السعودية للبيانات والذكاء الاصطناعي (سدايا).

## 7. حماية بياناتك

نستخدم التشفير أثناء نقل البيانات، ونشفّر البيانات الحساسة عند تخزينها، ونطبّق صلاحيات وصول صارمة على مستوى قاعدة البيانات، ونسجّل كل إجراء يتخذه موظفو التشغيل في سجل لا يُعدَّل، ونفرض التحقق الثنائي على حساباتهم. لا يوجد نظام آمن تماماً؛ وإن وقع تسرّب يمسّ بياناتك فسنخطرك ونخطر الجهة المختصة وفق ما يقتضيه النظام.

## 8. القُصَّر

التطبيق غير موجّه لمن هم دون 18 سنة، ولا نجمع بياناتهم عن علم. إن علمنا بذلك حذفنا البيانات.

## 9. تعديل هذه السياسة

قد نعدّل هذه السياسة. نعلمك بالتعديلات الجوهرية داخل التطبيق، وقد نطلب موافقتك عليها. يظهر رقم الإصدار وتاريخ سريانه أعلى هذه الصفحة.

## 10. التواصل

- الجهة المسؤولة: {{company}}، سجل تجاري رقم {{cr}}
- العنوان: {{address}}
- البريد الإلكتروني: {{email}}
- الهاتف: {{phone}}
$legal$,
$legal$# Privacy Policy

Version {{version}} — effective {{effective_date}}

This policy explains how {{company}}, commercial registration no. {{cr}} ("Habba", "we"), collects, uses and protects your personal data when you use the Habba app, and what rights you have over it, under the Saudi Personal Data Protection Law (PDPL) and its regulations. Habba is the controller of your data.

_This is a translation. The Arabic text is authoritative and prevails in case of any difference._

## 1. Data we collect

**Data you give us:**

- Your name, mobile number and email if you use one.
- Vehicle data: make, model, year, plate, chassis number (VIN) and odometer reading.
- Problem descriptions, the photos and videos you send, ratings and comments, and your messages to support.
- The address where a service is to be performed.

**Data created when you use the app:**

- Your location when you send an order, to set where the service happens and find the nearest provider. We do not track customers' location in the background.
- Your order history, invoices, vehicle logbook and warranties.
- Payment data: only the transaction reference, amount and status. **We never see or store your card number**; it is processed by the licensed payment provider.
- Device data: notification token, operating system and app version, and technical logs to protect the service and fix faults.
- A log of verification-code requests, to prevent abuse.

**Additional data for providers:**

- National ID or iqama number, the result of Nafath verification, and IBAN. **ID numbers and IBANs are stored encrypted** and are seen only by staff whose task requires it.
- Location only while "available" and while carrying out an order, so the customer can see the technician arrive and nearby orders can be routed. Location stops being sent when you leave "available".
- Completion photos, odometer readings and inspection reports, ratings, earnings and payouts.

## 2. Why we use your data

- **To provide the service you asked for:** creating your account, finding a provider, tracking the order, payment, invoicing, recording the service in the vehicle logbook, and handling warranties and complaints.
- **To meet our legal obligations:** e-invoicing and record-keeping under zakat and tax regulations, verifying providers' identity, and responding to competent authorities.
- **For our legitimate interests:** protecting users from fraud and abuse, app security, and improving the service and the accuracy of prices and alerts, in ways that do not override your rights.
- **With your consent:** maintenance reminders, offers and notifications not needed for an order. You may withdraw consent at any time in your device or app settings.

We do not sell your personal data, and we do not use it for fully automated decisions that have legal effects on you.

## 3. Who we share your data with

- **The provider assigned to your order:** only what is needed to carry it out: your name, the service location, the vehicle details, the problem description and the photos and videos you sent. The customer sees the provider's name, rating and location during the order.
- **Technical service providers** acting on our behalf under contracts that require them to protect the data: cloud hosting and databases, the payment provider, the SMS provider, and Apple and Google notification services.
- **The vehicle's new owner** when ownership is transferred through the app: the vehicle's service history and warranties pass to them, without your name, contact details, the amounts you paid or your addresses.
- **Anyone you share a Habba Report with:** the holder of the link sees the vehicle history the report contains, without your personal data.
- **Government and judicial authorities** where the law requires it.
- **In a restructuring or acquisition:** data may pass to the successor on the same terms.

## 4. Transfers outside the Kingdom

Habba's data is currently hosted in data centres in Germany (European Union), where it enjoys a high level of protection. We transfer data as permitted by the PDPL and the Regulation on Personal Data Transfer outside the Kingdom, apply appropriate contractual and technical safeguards, and limit transfers to the minimum necessary.

## 5. Retention

- We keep your account data for as long as you use the app.
- We keep invoices and transaction records for as long as the law requires, including zakat and tax regulations.
- We delete verification-code request logs after 30 days.
- **The vehicle logbook is a record of the vehicle, not of you:** when you delete your account, the vehicle's service history stays with the vehicle and its next owner, detached from your personal data.
- When the purpose ends, we delete the data or anonymise it so it no longer identifies you.

## 6. Your rights

The PDPL gives you the right to:

- **Be informed** of how we collect and use your data, which this policy explains.
- **Access** your data and obtain a copy in a readable format.
- **Rectify** your data: have it corrected, completed or updated.
- **Destruction:** have your data deleted once it is no longer needed, except what the law requires us to keep.
- **Withdraw consent** to any processing based on consent, without affecting the lawfulness of processing before it.

To exercise any of these rights, email us at {{email}}. We verify your identity and reply within the statutory period (30 days). If you are not satisfied with our reply, you may complain to the Saudi Data and Artificial Intelligence Authority (SDAIA).

## 7. How we protect your data

We encrypt data in transit and sensitive data at rest, enforce strict access controls at the database level, record every action taken by operations staff in a log that cannot be altered, and require two-factor authentication on their accounts. No system is perfectly secure; if a breach affects your data, we will notify you and the competent authority as the law requires.

## 8. Minors

The app is not directed at anyone under 18, and we do not knowingly collect their data. If we learn that we have, we delete it.

## 9. Changes to this policy

We may amend this policy. We will notify you of material changes in the app and may ask for your consent. The version number and effective date appear at the top of this page.

## 10. Contact

- Controller: {{company}}, commercial registration no. {{cr}}
- Address: {{address}}
- Email: {{email}}
- Phone: {{phone}}
$legal$,
  'الإصدار الأول'),
  ('provider_terms',
$legal$# شروط مقدّمي الخدمة

الإصدار {{version}} — يسري اعتباراً من {{effective_date}}

تنظّم هذه الشروط علاقتك بـ {{company}}، سجل تجاري رقم {{cr}} («هبّة»)، بصفتك فنّياً متنقلاً أو ورشة تقدّم خدماتها عبر تطبيق هبّة («مقدّم الخدمة» أو «أنت»). وهي مكمّلة لشروط الاستخدام العامة وسياسة الخصوصية، وعند التعارض فيما يخص عملك مقدّماً للخدمة تُقدَّم هذه الشروط.

## 1. التسجيل والتحقق

- يجب أن تكون سعودي الجنسية، أو مقيماً إقامة نظامية سارية تجيز لك ممارسة هذا العمل، وأن تحمل ما تتطلبه الأنظمة من تراخيص مهنية وبلدية. وعلى الورشة أن تكون مسجّلة بسجل تجاري ساري وترخيص بلدي.
- تلتزم بتقديم بيانات صحيحة: الهوية أو الإقامة، والتحقق عبر «نفاذ»، وآيبان حساب بنكي سعودي باسمك أو باسم منشأتك، وتحديثها فور تغيّرها.
- يحق لهبّة قبول طلب انضمامك أو رفضه أو إلغاء اعتمادك في أي وقت وفق تقديرها، ولا يُعدّ القبول ضماناً لعدد معيّن من الطلبات أو لدخل معيّن.

## 2. استقلالك عن هبّة

- أنت مقدّم خدمة مستقل، ولست موظفاً لدى هبّة ولا وكيلاً عنها ولا شريكاً لها. لا ينشئ هذا الاتفاق علاقة عمل.
- تتحمّل مسؤولية أدواتك ووسيلة تنقّلك وتكاليفك، وعمّالك إن وُجدوا، والتزاماتك تجاه الجهات الحكومية.
- تلتزم بالأنظمة المعمول بها، ومنها أنظمة المرور والسلامة والبلديات والبيئة، ومنها التخلص النظامي من الزيوت والبطاريات والقطع المستبدلة.
- تختار بنفسك أوقات إتاحتك والطلبات التي تقبلها.

## 3. معايير الخدمة

- اقبل فقط الطلبات التي تقدر على تنفيذها بإتقان وفي الوقت المعروض.
- قدّم عروض أسعار صادقة. **لا تنفّذ أي عمل إضافي ولا تركّب أي قطعة إلا بعد موافقة العميل عليها داخل التطبيق**، وسجّل كل قطعة باسمها ورقمها وسعرها وبيّن بصدق إن كانت أصلية أو بديلة.
- صور الإنجاز وقراءة العدّاد وتقارير الفحص التي ترفعها يجب أن تكون حقيقية ومن الطلب نفسه. تزويرها يُعدّ مخالفة جسيمة، لأنها تُسجَّل في دفتر السيارة وقد يعتمد عليها مشترٍ لاحق.
- تعامل مع العميل ومركبته بأمانة واحترام، ولا تستخدم المركبة لغير الغرض المطلوب.
- إن تعذّر عليك تنفيذ طلب قبلته فأبلغ عبر التطبيق فوراً.

## 4. الأسعار والعمولة والضرائب

- تُحتسب أسعار الخدمات وفق كتالوج هبّة أو وفق عرض السعر الذي يوافق عليه العميل.
- تتقاضى هبّة عمولة عن كل طلب مكتمل بالنسبة المبيّنة لك في التطبيق لكل فئة خدمة. **تُحتسب العمولة على المبلغ قبل ضريبة القيمة المضافة.**
- يحق لهبّة تعديل نسب العمولة بإشعار مسبق لا يقل عن 14 يوماً داخل التطبيق، ولا يسري التعديل على الطلبات المكتملة قبل نفاذه.
- أنت مسؤول عن التزاماتك الضريبية والزكوية، ومنها التسجيل في ضريبة القيمة المضافة إن بلغت الحد النظامي.

## 5. المستحقات والتحويل

- تُحوَّل مستحقاتك إلى الآيبان المسجّل وفق دورة التحويل المبيّنة في التطبيق، بعد خصم العمولة وأي مبالغ مستردة أو مستحقة لهبّة.
- يحق لهبّة تعليق تحويل المستحقات المرتبطة بطلب عليه شكوى مفتوحة، أو عند الاشتباه في احتيال أو مخالفة، حتى تُحسم.
- يحق لهبّة خصم أي مبلغ تستحقه عليك بموجب هذه الشروط من مستحقاتك الحالية أو اللاحقة.
- أنت مسؤول عن صحة الآيبان، ولا تتحمّل هبّة أي تحويل تم إلى آيبان قدّمته أنت.

## 6. الضمان

- تحدّد عند تسليم العمل مدة الضمان عليه، وتلتزم بها التزاماً كاملاً.
- إن ظهر خلل في عملك خلال مدة الضمان يُوجَّه الطلب إليك، وتلتزم بإعادة تنفيذ العمل **مجاناً** وفي وقت معقول. والضمان حق لمالك المركبة الحالي، حتى بعد بيعها.
- إن رفضت أو تعذّر عليك ذلك، يحق لهبّة إسناد العمل إلى مقدّم خدمة آخر وخصم تكلفته من مستحقاتك.

## 7. الشكاوى والاسترداد

- تلتزم بالتعاون مع هبّة في مراجعة أي شكوى وتقديم ما يُطلب منك من إيضاحات.
- تتخذ هبّة قرارها بناءً على الأدلة المتاحة، ومنها صور الإنجاز وقراءة العدّاد وسجل الطلب. وإن قررت استرداد المبلغ كله أو بعضه بسبب يعود إليك، يُخصم من مستحقاتك.

## 8. عدم الالتفاف على المنصة

- **يُحظر عليك** أن تعرض على عميل تعرّفت عليه عبر هبّة تنفيذ طلب أو الدفع خارج التطبيق، أو أن تعطيه وسيلة تواصل خاصة بهذا الغرض، طوال مدة تعاملك مع هبّة وخلال ستة أشهر من آخر طلب نفّذته لذلك العميل.
- مخالفة ذلك تجيز لهبّة إيقاف حسابك نهائياً، ومطالبتك بالعمولة التي كانت ستستحقها على تلك الأعمال، وخصمها من مستحقاتك.

## 9. بيانات العملاء

- تطّلع على بيانات العميل وموقعه ومركبته بالقدر اللازم لتنفيذ الطلب فقط. لا تستخدمها لأي غرض آخر، ولا تحتفظ بها بعد انتهاء الطلب، ولا تشاركها مع أحد، ولا تصوّر العميل أو مركبته إلا لتوثيق العمل داخل التطبيق.
- تلتزم بنظام حماية البيانات الشخصية، وتتحمّل مسؤولية أي استخدام مخالف لتلك البيانات.
- توافق على مشاركة موقعك مع هبّة والعميل أثناء وضع «متاح» وأثناء تنفيذ الطلب.

## 10. التقييمات والجودة

يقيّم العملاء خدمتك، وتؤثر التقييمات ومعدّل قبول الطلبات وجودة العمل في ترتيب الطلبات الموجّهة إليك. ويجوز لهبّة إيقاف حسابك أو تقييده إذا انخفضت جودة خدمتك انخفاضاً مستمراً.

## 11. المسؤولية والتعويض

- أنت مسؤول مسؤولية كاملة عن أي ضرر يلحق بالمركبة أو بالعميل أو بالغير بسبب عملك أو تقصيرك أو القطع التي تركّبها.
- تلتزم بتعويض هبّة عن أي مطالبة أو خسارة أو غرامة أو تكلفة، ومنها أتعاب المحاماة المعقولة، تنشأ عن عملك أو عن مخالفتك هذه الشروط أو الأنظمة.
- توصي هبّة بأن يكون لديك تأمين مناسب يغطي مسؤوليتك المهنية، ويجوز لها اشتراطه لبعض الخدمات.
- تسري حدود مسؤولية هبّة الواردة في شروط الاستخدام العامة على علاقتها بك.

## 12. الإيقاف والإنهاء

- يحق لهبّة إيقاف حسابك مقدّماً للخدمة أو إنهاؤه عند مخالفة هذه الشروط، أو عند الاشتباه في احتيال أو إساءة، أو انتهاء أي ترخيص أو وثيقة لازمة، أو بطلب من جهة مختصة.
- يحق لك إنهاء عملك مع هبّة في أي وقت بعد إتمام الطلبات التي قبلتها.
- يبقى التزامك بالضمان وبعدم الالتفاف على المنصة وبحماية بيانات العملاء وبالتعويض سارياً بعد الإنهاء، وتُسوّى مستحقاتك بعد خصم ما عليك.

## 13. أحكام ختامية

تخضع هذه الشروط لأنظمة المملكة العربية السعودية، وتسري عليها أحكام تسوية النزاعات والتعديل والأحكام العامة الواردة في شروط الاستخدام العامة. النص العربي هو المعتمد.

للتواصل: {{email}} — {{phone}}
$legal$,
$legal$# Provider Terms

Version {{version}} — effective {{effective_date}}

These terms govern your relationship with {{company}}, commercial registration no. {{cr}} ("Habba"), as a mobile technician or workshop offering services through the Habba app ("provider", "you"). They supplement the general Terms of Use and the Privacy Policy; where they conflict on matters concerning your work as a provider, these terms prevail.

_This is a translation. The Arabic text is authoritative and prevails in case of any difference._

## 1. Registration and verification

- You must be a Saudi national, or a lawful resident with a valid iqama permitting you to do this work, and hold the professional and municipal licences the law requires. A workshop must hold a valid commercial registration and municipal licence.
- You must provide accurate information — ID or iqama, Nafath verification, and the IBAN of a Saudi bank account in your or your business's name — and update it as soon as it changes.
- Habba may accept or reject your application, or withdraw your approval at any time at its discretion. Approval does not guarantee any number of orders or any income.

## 2. Your independence from Habba

- You are an independent provider, not Habba's employee, agent or partner. This agreement does not create an employment relationship.
- You are responsible for your tools, transport and costs, your workers if any, and your obligations to government authorities.
- You must comply with the applicable laws, including traffic, safety, municipal and environmental regulations, including the lawful disposal of oil, batteries and replaced parts.
- You choose when you are available and which orders you accept.

## 3. Service standards

- Accept only orders you can carry out well and in the time shown.
- Quote honestly. **Do not perform any additional work or fit any part until the customer approves it in the app**, and record each part with its name, number and price, stating truthfully whether it is original or aftermarket.
- The completion photos, odometer readings and inspection reports you upload must be genuine and from that order. Falsifying them is a serious breach, because they are recorded in the vehicle logbook and a later buyer may rely on them.
- Treat the customer and their vehicle with honesty and respect, and do not use the vehicle for anything other than the job.
- If you cannot carry out an order you accepted, report it in the app immediately.

## 4. Prices, commission and taxes

- Service prices follow Habba's catalogue or the quote the customer accepts.
- Habba charges a commission on each completed order at the rate shown to you in the app for each service category. **Commission is calculated on the amount before VAT.**
- Habba may change commission rates on at least 14 days' notice in the app; a change does not apply to orders completed before it takes effect.
- You are responsible for your own tax and zakat obligations, including VAT registration if you reach the statutory threshold.

## 5. Earnings and payouts

- Your earnings are paid to the registered IBAN on the payout cycle shown in the app, after deducting commission and any amounts refunded or owed to Habba.
- Habba may hold payouts connected to an order under an open complaint, or on suspicion of fraud or breach, until it is resolved.
- Habba may set off any amount you owe under these terms against your current or future earnings.
- You are responsible for the accuracy of your IBAN; Habba is not liable for any payment made to an IBAN you provided.

## 6. Warranty

- You set the warranty period on your work when you hand it back, and you are fully bound by it.
- If a defect in your work appears within the warranty period, the order is routed to you and you must redo the work **free of charge** within a reasonable time. The warranty belongs to the vehicle's current owner, even after it is sold.
- If you refuse or are unable to do so, Habba may assign the work to another provider and deduct its cost from your earnings.

## 7. Complaints and refunds

- You must cooperate with Habba in reviewing any complaint and provide any explanation requested.
- Habba decides on the available evidence, including completion photos, the odometer reading and the order record. If it refunds all or part of an amount for a reason attributable to you, the refund is deducted from your earnings.

## 8. No circumvention

- **You must not** offer a customer you met through Habba to carry out or pay for an order outside the app, or give them a private contact for that purpose, throughout your relationship with Habba and for six months after the last order you carried out for that customer.
- A breach entitles Habba to suspend your account permanently, to claim the commission it would have earned on that work, and to deduct it from your earnings.

## 9. Customer data

- You see the customer's data, location and vehicle only as far as needed to carry out the order. Do not use it for any other purpose, keep it after the order ends, or share it with anyone, and do not photograph the customer or their vehicle except to document the work in the app.
- You must comply with the PDPL and are responsible for any unlawful use of that data.
- You agree to share your location with Habba and the customer while "available" and while carrying out an order.

## 10. Ratings and quality

Customers rate your service, and ratings, your acceptance rate and the quality of your work affect the orders routed to you. Habba may suspend or restrict your account if the quality of your service declines persistently.

## 11. Liability and indemnity

- You are fully liable for any damage to the vehicle, the customer or third parties caused by your work, your negligence or the parts you fit.
- You agree to indemnify Habba against any claim, loss, fine or cost, including reasonable legal fees, arising from your work or your breach of these terms or the law.
- Habba recommends that you hold suitable insurance covering your professional liability, and may require it for some services.
- The limits on Habba's liability in the general Terms of Use apply to its relationship with you.

## 12. Suspension and termination

- Habba may suspend or terminate your provider account for breach of these terms, suspected fraud or abuse, the expiry of any required licence or document, or at the request of a competent authority.
- You may stop working with Habba at any time once the orders you accepted are complete.
- Your obligations on warranty, non-circumvention, customer data protection and indemnity survive termination, and your earnings are settled after deducting what you owe.

## 13. Final provisions

These terms are governed by the laws of the Kingdom of Saudi Arabia, and the dispute resolution, amendment and general provisions of the general Terms of Use apply to them. The Arabic text is authoritative.

Contact: {{email}} — {{phone}}
$legal$,
  'الإصدار الأول');
