/**
 * Inspection templates, edited as sections and items rather than JSON.
 *
 * What the technician fills in, item by item, and how much each finding
 * weighs in the score a buyer reads (0026). The rules the database checks
 * (0094) are checked here while typing (templateProblems), so a problem is
 * named next to the field rather than returned by the server after save.
 *
 * Keys are what filed reports store their answers under. A new section or
 * item gets one from its English name; an existing key is never changed, and
 * the database refuses to drop an item that a filed report answered.
 */

'use client';

import { useMemo, useState } from 'react';
import {
  MAX_WEIGHT,
  MIN_WEIGHT,
  keyFrom,
  parseTemplate,
  templateProblems,
  type TemplateItem,
  type TemplateProblem,
  type TemplateSection,
} from '@habba/core/inspection-template';
import { api } from '@/data/api';
import type { Row } from '@/data/transport';
import { explain } from '@/data/transport';
import {
  Badge,
  Button,
  Card,
  DataTable,
  Dialog,
  Field,
  Loadable,
  Switch,
  useLoad,
  useToast,
} from '../../ui';
import { ListToolbar, confirmDiscard, matches } from './common';

const WEIGHTS = Array.from(
  { length: MAX_WEIGHT - MIN_WEIGHT + 1 },
  (_, index) => index + MIN_WEIGHT,
);
const WEIGHT_TEXT: Readonly<Record<number, string>> = {
  1: 'عادي',
  2: 'مهم',
  3: 'مهم جداً',
  4: 'أساسي',
  5: 'حاسم',
};

function summary(sections: readonly TemplateSection[]) {
  const items = sections.flatMap((section) => section.items);
  return {
    sections: sections.length,
    items: items.length,
    required: items.filter((item) => item.required === true).length,
    critical: items.filter((item) => item.critical === true).length,
  };
}

export function TemplatesEditor() {
  const state = useLoad(
    () => api.table<Row>('inspection_templates', { order: 'key' }),
    'inspection_templates',
  );
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Row | 'new' | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const rows = (state.data ?? []).filter((row) =>
    matches(query, row['name_ar'], row['name_en'], row['key']),
  );

  return (
    <Card
      title="نماذج الفحص"
      actions={
        <Button tone="primary" onClick={() => setEditing('new')}>
          نموذج جديد
        </Button>
      }
    >
      <p className="subtle" style={{ marginTop: 0 }}>
        البنود التي يفحصها الفنّي ويقيّم كل واحد منها: سليم، يحتاج متابعة، أو فيه خلل. الأهمية تحدد
        وزن البند في النتيجة، والبند «الحاسم» إن كان فيه خلل يخفض النتيجة مهما كانت بقية البنود.
      </p>
      <ListToolbar query={query} onQuery={setQuery} count={rows.length} />
      {error !== null ? (
        <p className="notice" data-tone="bad">
          {error}
        </p>
      ) : null}
      <Loadable state={state}>
        {() => (
          <DataTable<Row>
            rows={rows}
            rowKey={(row) => String(row['id'])}
            onRowClick={(row) => setEditing(row)}
            empty="لا نماذج بعد."
            columns={[
              {
                label: 'النموذج',
                render: (row) => (
                  <>
                    <strong>{String(row['name_ar'])}</strong>
                    <div className="subtle" dir="ltr" style={{ textAlign: 'end' }}>
                      {String(row['key'])}
                    </div>
                  </>
                ),
              },
              {
                label: 'المحتوى',
                render: (row) => {
                  const counts = summary(parseTemplate(row['sections']));
                  return (
                    <span className="chip-group">
                      <Badge>{counts.sections} قسم</Badge>
                      <Badge>{counts.items} بند</Badge>
                      {counts.critical > 0 ? (
                        <Badge tone="warn">{counts.critical} حاسم</Badge>
                      ) : null}
                    </span>
                  );
                },
              },
              {
                label: 'متاح',
                nowrap: true,
                render: (row) => (
                  <Switch
                    label={`${String(row['name_ar'])} متاح`}
                    checked={row['is_active'] === true}
                    busy={busyId === row['id']}
                    onChange={async (next) => {
                      setBusyId(String(row['id']));
                      setError(null);
                      try {
                        await api.updateRow(
                          'inspection_templates',
                          { id: row['id'] },
                          { is_active: next },
                        );
                        toast(next ? 'النموذج متاح.' : 'أُوقف النموذج.');
                        state.reload();
                      } catch (cause) {
                        setError(explain(cause));
                      } finally {
                        setBusyId(null);
                      }
                    }}
                  />
                ),
              },
            ]}
          />
        )}
      </Loadable>
      {editing !== null ? (
        <TemplateForm
          row={editing === 'new' ? null : editing}
          takenKeys={new Set((state.data ?? []).map((row) => String(row['key'])))}
          onClose={() => setEditing(null)}
          onSaved={(message) => {
            setEditing(null);
            toast(message);
            state.reload();
          }}
        />
      ) : null}
    </Card>
  );
}

function problemText(problem: TemplateProblem, sections: readonly TemplateSection[]): string {
  const index = 'section' in problem ? problem.section : -1;
  const section = sections[index];
  const where = section !== undefined ? `«${section.title_ar || index + 1}»` : '';
  switch (problem.code) {
    case 'no_sections':
      return 'أضف قسماً واحداً على الأقل.';
    case 'section_title':
      return `القسم ${where}: اكتب اسمه بالعربي والإنجليزي.`;
    case 'no_items':
      return `القسم ${where}: أضف بنداً واحداً على الأقل.`;
    case 'item_label':
      return `القسم ${where}، البند ${(problem.item ?? 0) + 1}: اكتب اسمه بالعربي والإنجليزي.`;
    case 'weight':
      return `القسم ${where}: الأهمية بين ${MIN_WEIGHT} و${MAX_WEIGHT}.`;
    case 'duplicate_key':
      return problem.item === undefined
        ? `القسم ${where}: الاسم الإنجليزي مكرر مع قسم آخر.`
        : `القسم ${where}، البند ${problem.item + 1}: الاسم الإنجليزي مكرر في هذا القسم.`;
  }
}

/** Fills the key of every new section and item from its English name. */
function withKeys(sections: readonly TemplateSection[]): TemplateSection[] {
  const sectionKeys = new Set(sections.map((section) => section.key).filter((key) => key !== ''));
  return sections.map((section) => {
    const key =
      section.key !== '' ? section.key : keyFrom(section.title_en, sectionKeys, 'section');
    sectionKeys.add(key);
    const itemKeys = new Set(section.items.map((item) => item.key).filter((k) => k !== ''));
    return {
      ...section,
      key,
      items: section.items.map((item) => {
        if (item.key !== '') return item;
        const itemKey = keyFrom(item.label_en, itemKeys, 'item');
        itemKeys.add(itemKey);
        return { ...item, key: itemKey };
      }),
    };
  });
}

function move<T>(list: readonly T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length) return [...list];
  const next = [...list];
  const [entry] = next.splice(from, 1);
  next.splice(to, 0, entry as T);
  return next;
}

const blankItem = (): TemplateItem => ({
  key: '',
  type: 'rating',
  label_ar: '',
  label_en: '',
  weight: 1,
  required: true,
});

function TemplateForm({
  row,
  takenKeys,
  onClose,
  onSaved,
}: {
  readonly row: Row | null;
  readonly takenKeys: ReadonlySet<string>;
  readonly onClose: () => void;
  readonly onSaved: (message: string) => void;
}) {
  const initialSections = useMemo(() => parseTemplate(row?.['sections']), [row]);
  const [nameAr, setNameAr] = useState(String(row?.['name_ar'] ?? ''));
  const [nameEn, setNameEn] = useState(String(row?.['name_en'] ?? ''));
  const [active, setActive] = useState(row === null ? true : row['is_active'] === true);
  const [sections, setSections] = useState<TemplateSection[]>(
    initialSections.length > 0
      ? initialSections
      : [{ key: '', title_ar: '', title_en: '', weight: 1, items: [blankItem()] }],
  );
  const [showJson, setShowJson] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const keyed = withKeys(sections);
  const problems = templateProblems(keyed);
  const counts = summary(sections);
  const dirty =
    JSON.stringify(sections) !== JSON.stringify(initialSections) ||
    nameAr !== String(row?.['name_ar'] ?? '') ||
    nameEn !== String(row?.['name_en'] ?? '');

  const close = () => {
    if (confirmDiscard(dirty)) onClose();
  };

  const setSection = (index: number, patch: Partial<TemplateSection>) =>
    setSections((current) =>
      current.map((section, s) => (s === index ? { ...section, ...patch } : section)),
    );

  const setItem = (sectionIndex: number, itemIndex: number, patch: Partial<TemplateItem>) =>
    setSections((current) =>
      current.map((section, s) =>
        s !== sectionIndex
          ? section
          : {
              ...section,
              items: section.items.map((item, i) =>
                i === itemIndex ? { ...item, ...patch } : item,
              ),
            },
      ),
    );

  const save = async () => {
    setError(null);
    if (nameAr.trim() === '' || nameEn.trim() === '')
      return setError('اكتب اسم النموذج بالعربي والإنجليزي.');
    if (problems.length > 0) return setError('صحّح الملاحظات أعلاه أولاً.');
    setBusy(true);
    try {
      if (row === null) {
        await api.insertRow('inspection_templates', {
          key: keyFrom(nameEn, takenKeys, 'template'),
          name_ar: nameAr.trim(),
          name_en: nameEn.trim(),
          sections: keyed,
          is_active: active,
        });
        onSaved('أُضيف النموذج.');
      } else {
        await api.updateRow(
          'inspection_templates',
          { id: row['id'] },
          { name_ar: nameAr.trim(), name_en: nameEn.trim(), sections: keyed, is_active: active },
        );
        onSaved('حُفظ النموذج.');
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '';
      setError(
        /Reports use items/i.test(message)
          ? 'لا يمكن حذف بنود فُحصت بها سيارات من قبل؛ تقاريرها تعتمد عليها. غيّر الاسم أو الأهمية فقط، أو أنشئ نموذجاً جديداً وأوقف هذا.'
          : explain(cause),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={row === null ? 'نموذج فحص جديد' : `تعديل: ${String(row['name_ar'])}`}
      onClose={close}
      wide
    >
      <div className="two-col">
        <Field label="اسم النموذج بالعربي *">
          <input
            className="input"
            value={nameAr}
            onChange={(event) => setNameAr(event.target.value)}
          />
        </Field>
        <Field label="بالإنجليزي *">
          <input
            className="input"
            dir="ltr"
            value={nameEn}
            onChange={(event) => setNameEn(event.target.value)}
          />
        </Field>
      </div>
      <div className="actions" style={{ alignItems: 'center' }}>
        <Badge>{counts.sections} قسم</Badge>
        <Badge>{counts.items} بند</Badge>
        <Badge tone="info">{counts.required} إلزامي</Badge>
        {counts.critical > 0 ? <Badge tone="warn">{counts.critical} حاسم</Badge> : null}
        <span style={{ marginInlineStart: 'auto' }}>
          <Switch
            label="النموذج متاح"
            checked={active}
            onChange={setActive}
            onText="متاح"
            offText="موقوف"
          />
        </span>
      </div>

      {sections.map((section, s) => (
        <div key={s} className="template-section">
          <div className="actions" style={{ alignItems: 'end' }}>
            <Field label={`القسم ${s + 1} — بالعربي`}>
              <input
                className="input"
                value={section.title_ar}
                onChange={(event) => setSection(s, { title_ar: event.target.value })}
              />
            </Field>
            <Field label="بالإنجليزي">
              <input
                className="input"
                dir="ltr"
                value={section.title_en}
                onChange={(event) => setSection(s, { title_en: event.target.value })}
              />
            </Field>
            <Field label="أهمية القسم">
              <select
                className="input"
                value={section.weight ?? 1}
                onChange={(event) => setSection(s, { weight: Number(event.target.value) })}
              >
                {WEIGHTS.map((weight) => (
                  <option key={weight} value={weight}>
                    {weight} — {WEIGHT_TEXT[weight]}
                  </option>
                ))}
              </select>
            </Field>
            <Button
              size="small"
              disabled={s === 0}
              onClick={() => setSections(move(sections, s, s - 1))}
            >
              ↑
            </Button>
            <Button
              size="small"
              disabled={s === sections.length - 1}
              onClick={() => setSections(move(sections, s, s + 1))}
            >
              ↓
            </Button>
            <Button
              size="small"
              tone="danger"
              onClick={() => {
                if (window.confirm(`حذف القسم «${section.title_ar || s + 1}» وكل بنوده؟`)) {
                  setSections(sections.filter((_, index) => index !== s));
                }
              }}
            >
              حذف القسم
            </Button>
          </div>

          <div className="subtle template-item" aria-hidden="true">
            <span>البند بالعربي</span>
            <span>بالإنجليزي</span>
            <span>الأهمية</span>
            <span />
            <span />
            <span />
          </div>
          {section.items.map((item, i) => (
            <div key={i} className="template-item">
              <input
                className="input"
                aria-label={`البند ${i + 1} بالعربي`}
                value={item.label_ar}
                onChange={(event) => setItem(s, i, { label_ar: event.target.value })}
              />
              <input
                className="input"
                dir="ltr"
                aria-label={`البند ${i + 1} بالإنجليزي`}
                value={item.label_en}
                onChange={(event) => setItem(s, i, { label_en: event.target.value })}
              />
              <select
                className="input"
                aria-label="الأهمية"
                value={item.weight ?? 1}
                onChange={(event) => setItem(s, i, { weight: Number(event.target.value) })}
              >
                {WEIGHTS.map((weight) => (
                  <option key={weight} value={weight}>
                    {weight} — {WEIGHT_TEXT[weight]}
                  </option>
                ))}
              </select>
              <label className="actions subtle" style={{ alignItems: 'center', gap: 4 }}>
                <input
                  type="checkbox"
                  title="لا يُرسل التقرير قبل تقييم هذا البند"
                  checked={item.required === true}
                  onChange={(event) => setItem(s, i, { required: event.target.checked })}
                />
                إلزامي
              </label>
              <label className="actions subtle" style={{ alignItems: 'center', gap: 4 }}>
                <input
                  type="checkbox"
                  title="خلل في هذا البند يخفض النتيجة مهما كانت بقية البنود"
                  checked={item.critical === true}
                  onChange={(event) => setItem(s, i, { critical: event.target.checked })}
                />
                حاسم
              </label>
              <span className="actions">
                <Button
                  size="small"
                  disabled={i === 0}
                  onClick={() => setSection(s, { items: move(section.items, i, i - 1) })}
                >
                  ↑
                </Button>
                <Button
                  size="small"
                  disabled={i === section.items.length - 1}
                  onClick={() => setSection(s, { items: move(section.items, i, i + 1) })}
                >
                  ↓
                </Button>
                <Button
                  size="small"
                  tone="danger"
                  onClick={() =>
                    setSection(s, { items: section.items.filter((_, index) => index !== i) })
                  }
                >
                  ✕
                </Button>
              </span>
            </div>
          ))}
          <div>
            <Button
              size="small"
              onClick={() => setSection(s, { items: [...section.items, blankItem()] })}
            >
              + بند
            </Button>
          </div>
        </div>
      ))}

      <div>
        <Button
          onClick={() =>
            setSections([
              ...sections,
              { key: '', title_ar: '', title_en: '', weight: 1, items: [blankItem()] },
            ])
          }
        >
          + قسم جديد
        </Button>
      </div>

      {problems.length > 0 ? (
        <div className="notice" data-tone="warn" style={{ margin: 0 }}>
          <strong>قبل الحفظ:</strong>
          <ul style={{ margin: 0, paddingInlineStart: '1.2em' }}>
            {problems.slice(0, 6).map((problem, index) => (
              <li key={index}>{problemText(problem, sections)}</li>
            ))}
            {problems.length > 6 ? <li>و{problems.length - 6} ملاحظات أخرى.</li> : null}
          </ul>
        </div>
      ) : null}

      <label className="actions subtle" style={{ alignItems: 'center' }}>
        <input
          type="checkbox"
          checked={showJson}
          onChange={(event) => setShowJson(event.target.checked)}
        />
        عرض البنية التقنية (للمطوّرين)
      </label>
      {showJson ? (
        <textarea
          className="input"
          dir="ltr"
          rows={8}
          readOnly
          value={JSON.stringify(keyed, null, 2)}
        />
      ) : null}

      {error !== null ? (
        <p className="notice" data-tone="bad" style={{ margin: 0 }}>
          {error}
        </p>
      ) : null}
      <div className="actions">
        <Button
          tone="primary"
          busy={busy}
          disabled={problems.length > 0}
          onClick={() => void save()}
        >
          حفظ
        </Button>
        <Button onClick={close}>إلغاء</Button>
      </div>
    </Dialog>
  );
}
