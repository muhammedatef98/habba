/**
 * The app's words: every sentence the app shows, and the operators' changes
 * to it (0093).
 *
 * The shipped sentences come from @habba/i18n — the same files the app is
 * built from — so this page lists exactly what is on the phones. A change is a
 * row in app_copy; the app lays it over its own words at launch and every few
 * minutes after. "رجوع للأصل" deletes the row.
 *
 * A sentence with {{amount}} or a <terms> link must keep them: the screen
 * fills them in. The check runs here before saving, and again in the app
 * before showing (copyProblem), so a broken sentence never reaches a screen.
 */

'use client';

import { useMemo, useState } from 'react';
import { resources } from '@habba/i18n';
import { copyProblem, flattenCopy, placeholdersOf, type CopyProblem } from '@habba/i18n/overrides';
import { api } from '@/data/api';
import { explain } from '@/data/transport';
import { dateTime } from '@/lib/format';
import { Badge, Button, Card, Field, Loadable, PageHead, useLoad, useToast } from '../ui';

interface CopyRow {
  readonly key: string;
  readonly ar: string | null;
  readonly en: string | null;
  readonly updated_at?: string;
  readonly [column: string]: unknown;
}

const SHIPPED_AR = flattenCopy(resources.ar);
const SHIPPED_EN = flattenCopy(resources.en);
const ALL_KEYS = [...SHIPPED_AR.keys()];

/** The first part of a key is the screen or area it belongs to. */
const AREA: Readonly<Record<string, string>> = {
  common: 'عام',
  auth: 'الدخول',
  vehicle: 'إضافة السيارة',
  logbook: 'دفتر السيارة',
  care: 'مواعيد الصيانة',
  settings: 'حسابي',
  errors: 'رسائل الأخطاء',
  home: 'الرئيسية',
  booking: 'الحجز',
  emergency: 'الطلب الطارئ',
  tracking: 'متابعة الطلب',
  quote: 'قطع الغيار (العميل)',
  job: 'عمل الفنّي',
  provider: 'الفنّي',
  profile: 'الملف الشخصي',
  nav: 'الشريط السفلي',
  orders: 'طلباتي',
  transfer: 'نقل الملكية',
  platform: 'رسائل المنصّة',
  inspection: 'الفحص (الفنّي)',
  inspectionReport: 'تقرير الفحص',
  documents: 'المستندات',
  invoices: 'الفواتير',
  features: 'الميزات المتوقفة',
  update: 'التحديث',
  legal: 'الشروط',
  cardForm: 'الدفع بالبطاقة',
};

const PROBLEM: Readonly<Record<CopyProblem, string>> = {
  unknown_key: 'هذا المفتاح غير موجود في التطبيق.',
  empty: 'النص فارغ.',
  placeholders: 'يجب أن يبقى في النص نفس المتغيّرات بين {{ }} كما في الأصل.',
  tags: 'يجب أن يبقى الرابط بين <> كما في الأصل.',
};

const PAGE = 40;

export function CopySection() {
  const state = useLoad(
    () => api.table<CopyRow>('app_copy', { order: 'key', ascending: true }),
    'app_copy',
  );

  return (
    <>
      <PageHead
        title="نصوص التطبيق"
        description="كل جملة تظهر في التطبيق. عدّل أي نص بالعربي أو الإنجليزي ويظهر للمستخدمين خلال دقائق، بدون تحديث التطبيق. «رجوع للأصل» يعيد النص كما كان."
      />
      <Loadable state={state}>
        {(rows) => <CopyEditor rows={rows} onChanged={state.reload} />}
      </Loadable>
    </>
  );
}

function CopyEditor({
  rows,
  onChanged,
}: {
  readonly rows: readonly CopyRow[];
  readonly onChanged: () => void;
}) {
  const [query, setQuery] = useState('');
  const [area, setArea] = useState('');
  const [changedOnly, setChangedOnly] = useState(false);
  const [shown, setShown] = useState(PAGE);

  const overrides = useMemo(() => new Map(rows.map((row) => [row.key, row])), [rows]);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return ALL_KEYS.filter((key) => {
      if (area !== '' && key.split('.')[0] !== area) return false;
      if (changedOnly && !overrides.has(key)) return false;
      if (needle === '') return true;
      const row = overrides.get(key);
      return [key, SHIPPED_AR.get(key), SHIPPED_EN.get(key), row?.ar, row?.en].some(
        (text) => typeof text === 'string' && text.toLowerCase().includes(needle),
      );
    });
  }, [query, area, changedOnly, overrides]);

  return (
    <div className="grid">
      <Card>
        <div className="actions" style={{ alignItems: 'end' }}>
          <Field label="ابحث في النصوص">
            <input
              className="input"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setShown(PAGE);
              }}
              placeholder="كلمة من النص، أو اسم المفتاح"
              style={{ minWidth: 280 }}
            />
          </Field>
          <Field label="الشاشة">
            <select
              className="input"
              value={area}
              onChange={(event) => {
                setArea(event.target.value);
                setShown(PAGE);
              }}
            >
              <option value="">كل الشاشات</option>
              {Object.entries(AREA).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <label className="actions" style={{ alignItems: 'center', gap: 'var(--space-xs)' }}>
            <input
              type="checkbox"
              checked={changedOnly}
              onChange={(event) => setChangedOnly(event.target.checked)}
            />
            المعدّلة فقط ({rows.length})
          </label>
        </div>
        <p className="subtle" style={{ marginBottom: 0 }}>
          {matches.length} نص
        </p>
      </Card>

      {matches.slice(0, shown).map((key) => (
        <CopyItem key={key} copyKey={key} row={overrides.get(key)} onChanged={onChanged} />
      ))}

      {matches.length > shown ? (
        <Button onClick={() => setShown((current) => current + PAGE)}>
          عرض المزيد ({matches.length - shown})
        </Button>
      ) : null}
    </div>
  );
}

function CopyItem({
  copyKey,
  row,
  onChanged,
}: {
  readonly copyKey: string;
  readonly row: CopyRow | undefined;
  readonly onChanged: () => void;
}) {
  const shippedAr = SHIPPED_AR.get(copyKey) ?? '';
  const shippedEn = SHIPPED_EN.get(copyKey) ?? '';
  const [editing, setEditing] = useState(false);
  const [ar, setAr] = useState(row?.ar ?? shippedAr);
  const [en, setEn] = useState(row?.en ?? shippedEn);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  const placeholders = [...new Set(placeholdersOf(shippedAr))];

  const save = async () => {
    setError(null);
    const problemAr = copyProblem(shippedAr, ar);
    const problemEn = shippedEn === '' ? null : copyProblem(shippedEn, en);
    if (problemAr !== null) return setError(`العربي: ${PROBLEM[problemAr]}`);
    if (problemEn !== null) return setError(`الإنجليزي: ${PROBLEM[problemEn]}`);

    // Only what differs from the shipped words is stored, so a later fix to
    // the shipped sentence is not hidden behind an identical copy of it.
    const nextAr = ar.trim() === shippedAr ? null : ar.trim();
    const nextEn = en.trim() === shippedEn ? null : en.trim();

    setBusy(true);
    try {
      if (nextAr === null && nextEn === null) {
        if (row !== undefined) await api.deleteRow('app_copy', { key: copyKey });
      } else if (row === undefined) {
        await api.insertRow('app_copy', { key: copyKey, ar: nextAr, en: nextEn });
      } else {
        await api.updateRow('app_copy', { key: copyKey }, { ar: nextAr, en: nextEn });
      }
      toast('حُفظ النص. يظهر في التطبيق خلال دقائق.');
      setEditing(false);
      onChanged();
    } catch (cause) {
      setError(explain(cause));
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.deleteRow('app_copy', { key: copyKey });
      setAr(shippedAr);
      setEn(shippedEn);
      toast('عاد النص الأصلي.');
      setEditing(false);
      onChanged();
    } catch (cause) {
      setError(explain(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title={
        <span style={{ fontSize: 'var(--text-md, 1rem)' }}>
          {row?.ar ?? shippedAr}
          {row !== undefined ? (
            <>
              {' '}
              <Badge tone="brand">معدّل</Badge>
            </>
          ) : null}
        </span>
      }
      actions={
        editing ? null : (
          <>
            <Button size="small" tone="primary" onClick={() => setEditing(true)}>
              تعديل
            </Button>
            {row !== undefined ? (
              <Button size="small" busy={busy} onClick={() => void reset()}>
                رجوع للأصل
              </Button>
            ) : null}
          </>
        )
      }
    >
      <div className="subtle" style={{ direction: 'ltr', textAlign: 'right' }}>
        {AREA[copyKey.split('.')[0] ?? ''] ?? ''} · <code>{copyKey}</code>
        {row?.updated_at !== undefined ? ` · عُدّل ${dateTime(row.updated_at)}` : ''}
      </div>
      {row !== undefined && !editing ? (
        <p className="subtle" style={{ marginBottom: 0 }}>
          الأصل: {shippedAr}
        </p>
      ) : null}
      {!editing && (row?.en ?? null) !== null ? (
        <p className="subtle" dir="ltr" style={{ marginBottom: 0 }}>
          {row?.en}
        </p>
      ) : null}

      {editing ? (
        <div style={{ display: 'grid', gap: 'var(--space-sm)', marginTop: 'var(--space-sm)' }}>
          <Field label="بالعربي" hint={`الأصل: ${shippedAr}`}>
            <textarea
              className="input"
              rows={Math.min(6, Math.max(2, Math.ceil(ar.length / 70)))}
              value={ar}
              onChange={(event) => setAr(event.target.value)}
            />
          </Field>
          <Field label="بالإنجليزي" hint={shippedEn !== '' ? `Original: ${shippedEn}` : undefined}>
            <textarea
              className="input"
              dir="ltr"
              rows={Math.min(6, Math.max(2, Math.ceil(en.length / 70)))}
              value={en}
              onChange={(event) => setEn(event.target.value)}
            />
          </Field>
          {placeholders.length > 0 ? (
            <p className="notice" style={{ margin: 0 }}>
              اترك هذه كما هي، التطبيق يملؤها:{' '}
              <span dir="ltr">{placeholders.map((name) => `{{${name}}}`).join('  ')}</span>
            </p>
          ) : null}
          {error !== null ? (
            <p className="notice" data-tone="bad" style={{ margin: 0 }}>
              {error}
            </p>
          ) : null}
          <div className="actions">
            <Button tone="primary" busy={busy} onClick={() => void save()}>
              حفظ
            </Button>
            <Button
              onClick={() => {
                setAr(row?.ar ?? shippedAr);
                setEn(row?.en ?? shippedEn);
                setError(null);
                setEditing(false);
              }}
            >
              إلغاء
            </Button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
