/**
 * The services Habba sells: what the customer sees, what it costs, and how
 * it is carried out.
 *
 * The screen an operator uses most in the catalogue, so it is not the generic
 * table editor. Prices show both ways (the base the provider's payout and the
 * commission come from, and what the customer pays with VAT); the icon is
 * picked from the glyphs the app actually draws; order is moved with arrows
 * rather than typed; a service is switched off in the list, and deleted — if
 * nothing points at it — only from inside its form. Prices can move by a
 * percentage across a category in one step (0094).
 */

'use client';

import { useMemo, useState } from 'react';
import { CATALOGUE_ICONS, SERVICE_CATEGORIES, catalogueGlyph } from '@habba/core/catalogue-icons';
import { api } from '@/data/api';
import type { Row } from '@/data/transport';
import { explain } from '@/data/transport';
import { money } from '@/lib/format';
import { Glyph } from '../../glyph';
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
import {
  ListToolbar,
  activeMatches,
  confirmDiscard,
  explainDelete,
  matches,
  useRefs,
  useVatRate,
  withVat,
  type ActiveFilter,
} from './common';

const MODES: readonly { readonly value: string; readonly text: string; readonly hint: string }[] = [
  { value: 'mobile_ondemand', text: 'طارئ', hint: 'فنّي يصل الآن' },
  { value: 'mobile_scheduled', text: 'موعد في موقع العميل', hint: 'فنّي متنقل بموعد' },
  { value: 'workshop', text: 'في الورشة', hint: 'يحضر العميل السيارة' },
];

const CATEGORY_TEXT = Object.fromEntries(
  SERVICE_CATEGORIES.map((category) => [category.value, category.labelAr]),
);

function byOrder(a: Row, b: Row): number {
  const order = Number(a['sort_order'] ?? 0) - Number(b['sort_order'] ?? 0);
  return order !== 0 ? order : String(a['name_ar']).localeCompare(String(b['name_ar']), 'ar');
}

export function ServicesEditor() {
  const state = useLoad(() => api.table<Row>('services', { order: 'sort_order' }), 'services');
  const vatRate = useVatRate();
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [active, setActive] = useState<ActiveFilter>('all');
  const [editing, setEditing] = useState<Row | 'new' | null>(null);
  const [draftFrom, setDraftFrom] = useState<Row | null>(null);
  const [bulk, setBulk] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ordered = useMemo(() => [...(state.data ?? [])].sort(byOrder), [state.data]);

  const run = async (id: string, work: () => Promise<unknown>, done: string) => {
    setBusyId(id);
    setError(null);
    try {
      await work();
      toast(done);
      state.reload();
    } catch (cause) {
      setError(explain(cause));
    } finally {
      setBusyId(null);
    }
  };

  /**
   * Swaps a service with its neighbour. The list is renumbered 1…n first, so
   * ties and gaps left by older edits cannot make an arrow do nothing; only
   * rows whose number actually changes are written.
   */
  const move = (row: Row, direction: -1 | 1) => {
    const list = [...ordered];
    const from = list.findIndex((entry) => entry['id'] === row['id']);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= list.length) return;
    [list[from], list[to]] = [list[to] as Row, list[from] as Row];
    const writes = list.flatMap((entry, index) =>
      Number(entry['sort_order']) === index + 1
        ? []
        : [api.updateRow('services', { id: entry['id'] }, { sort_order: index + 1 })],
    );
    void run(String(row['id']), () => Promise.all(writes), 'تغيّر الترتيب.');
  };

  const shown = ordered.filter(
    (row) =>
      matches(query, row['name_ar'], row['name_en'], row['description_ar']) &&
      (category === '' || row['category'] === category) &&
      activeMatches(active, row['is_active']),
  );

  return (
    <Card
      title="الخدمات والأسعار"
      actions={
        <>
          <Button onClick={() => setBulk(true)}>تعديل الأسعار بنسبة</Button>
          <Button tone="primary" onClick={() => setEditing('new')}>
            إضافة خدمة
          </Button>
        </>
      }
    >
      <p className="subtle" style={{ marginTop: 0 }}>
        ما يظهر للعميل في التطبيق وبكم. اضغط على أي خدمة لتعديلها. الخدمة المتوقفة تختفي من التطبيق
        ولا تُحذف، ولا يتأثر أي طلب سابق.
      </p>
      <ListToolbar
        query={query}
        onQuery={setQuery}
        active={active}
        onActive={setActive}
        count={shown.length}
      >
        <div className="chip-group" role="group" aria-label="الفئة">
          <button
            type="button"
            className="chip"
            aria-pressed={category === ''}
            onClick={() => setCategory('')}
          >
            كل الفئات
          </button>
          {SERVICE_CATEGORIES.map((entry) => (
            <button
              key={entry.value}
              type="button"
              className="chip"
              aria-pressed={category === entry.value}
              onClick={() => setCategory(entry.value)}
            >
              {entry.labelAr}
            </button>
          ))}
        </div>
      </ListToolbar>
      {error !== null ? (
        <p className="notice" data-tone="bad">
          {error}
        </p>
      ) : null}
      <Loadable state={state}>
        {() => (
          <DataTable<Row>
            rows={shown}
            rowKey={(row) => String(row['id'])}
            onRowClick={(row) => setEditing(row)}
            empty="لا خدمات تطابق البحث."
            columns={[
              {
                label: 'الترتيب',
                render: (row) => {
                  const index = ordered.findIndex((entry) => entry['id'] === row['id']);
                  return (
                    <span className="actions" onClick={(event) => event.stopPropagation()}>
                      <Button
                        size="small"
                        disabled={index <= 0 || busyId !== null}
                        onClick={() => move(row, -1)}
                      >
                        ↑
                      </Button>
                      <Button
                        size="small"
                        disabled={index >= ordered.length - 1 || busyId !== null}
                        onClick={() => move(row, 1)}
                      >
                        ↓
                      </Button>
                    </span>
                  );
                },
              },
              {
                label: 'الخدمة',
                render: (row) => (
                  <span className="service-cell">
                    <span className="service-glyph">
                      <Glyph name={catalogueGlyph(String(row['icon'] ?? '')) ?? 'alert'} />
                    </span>
                    <span>
                      <strong>{String(row['name_ar'])}</strong>
                      <div className="subtle" dir="ltr" style={{ textAlign: 'end' }}>
                        {String(row['name_en'])}
                      </div>
                    </span>
                  </span>
                ),
              },
              {
                label: 'الفئة',
                nowrap: true,
                render: (row) => (
                  <Badge>{CATEGORY_TEXT[String(row['category'])] ?? String(row['category'])}</Badge>
                ),
              },
              {
                label: 'السعر',
                nowrap: true,
                render: (row) =>
                  row['base_price'] === null ? (
                    <span className="muted">يحدّده مقدّم الخدمة</span>
                  ) : (
                    <>
                      <strong className="numeric">{money(Number(row['base_price']))}</strong>
                      <div className="subtle">
                        العميل يدفع{' '}
                        <span className="numeric">
                          {money(withVat(Number(row['base_price']), vatRate))}
                        </span>
                      </div>
                    </>
                  ),
              },
              {
                label: 'المدة',
                nowrap: true,
                render: (row) => <span className="numeric">{`${row['est_duration_min']} د`}</span>,
              },
              {
                label: 'طريقة التنفيذ',
                render: (row) => (
                  <span className="chip-group">
                    {(Array.isArray(row['supported_modes']) ? row['supported_modes'] : []).map(
                      (mode) => (
                        <Badge key={String(mode)} tone="info">
                          {MODES.find((entry) => entry.value === mode)?.text ?? String(mode)}
                        </Badge>
                      ),
                    )}
                  </span>
                ),
              },
              {
                label: 'في التطبيق',
                nowrap: true,
                render: (row) => (
                  <Switch
                    label={`${String(row['name_ar'])} في التطبيق`}
                    checked={row['is_active'] === true}
                    busy={busyId === row['id']}
                    onChange={(next) =>
                      void run(
                        String(row['id']),
                        () => api.updateRow('services', { id: row['id'] }, { is_active: next }),
                        next ? 'الخدمة ظاهرة في التطبيق.' : 'أُخفيت الخدمة من التطبيق.',
                      )
                    }
                  />
                ),
              },
            ]}
          />
        )}
      </Loadable>

      {editing !== null ? (
        <ServiceForm
          row={editing === 'new' ? draftFrom : editing}
          isNew={editing === 'new'}
          vatRate={vatRate}
          nextOrder={ordered.length + 1}
          onClose={() => {
            setEditing(null);
            setDraftFrom(null);
          }}
          onSaved={(message) => {
            setEditing(null);
            setDraftFrom(null);
            toast(message);
            state.reload();
          }}
          onDuplicate={(row) => {
            setDraftFrom({
              ...row,
              id: undefined,
              name_ar: `${String(row['name_ar'])} (نسخة)`,
              name_en: `${String(row['name_en'])} (copy)`,
              is_active: false,
            });
            setEditing('new');
          }}
        />
      ) : null}

      {bulk ? (
        <BulkPriceDialog
          services={ordered}
          vatRate={vatRate}
          onClose={() => setBulk(false)}
          onDone={(count) => {
            setBulk(false);
            toast(`تغيّر سعر ${count} خدمة.`);
            state.reload();
          }}
        />
      ) : null}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// The form
// ---------------------------------------------------------------------------

interface Values {
  name_ar: string;
  name_en: string;
  description_ar: string;
  category: string;
  icon: string;
  base_price: string;
  priced_by_provider: boolean;
  price_is_fixed: boolean;
  est_duration_min: string;
  supported_modes: string[];
  requires_vehicle: boolean;
  requires_lift: boolean;
  requires_completion_photos: boolean;
  requires_completion_mileage: boolean;
  inspection_template_key: string;
  is_active: boolean;
}

function valuesFrom(row: Row | null): Values {
  const text = (key: string) =>
    row?.[key] === null || row?.[key] === undefined ? '' : String(row[key]);
  return {
    name_ar: text('name_ar'),
    name_en: text('name_en'),
    description_ar: text('description_ar'),
    category: text('category') || 'periodic',
    icon: text('icon') || 'wrench',
    base_price: text('base_price'),
    priced_by_provider: row !== null && row['base_price'] === null,
    price_is_fixed: row?.['price_is_fixed'] === true,
    est_duration_min: text('est_duration_min') || '60',
    supported_modes: Array.isArray(row?.['supported_modes'])
      ? (row['supported_modes'] as unknown[]).map(String)
      : ['mobile_scheduled'],
    requires_vehicle: row === null ? true : row['requires_vehicle'] === true,
    requires_lift: row?.['requires_lift'] === true,
    requires_completion_photos: row === null ? true : row['requires_completion_photos'] !== false,
    requires_completion_mileage: row === null ? true : row['requires_completion_mileage'] !== false,
    inspection_template_key: text('inspection_template_key'),
    is_active: row === null ? true : row['is_active'] === true,
  };
}

function ServiceForm({
  row,
  isNew,
  vatRate,
  nextOrder,
  onClose,
  onSaved,
  onDuplicate,
}: {
  readonly row: Row | null;
  readonly isNew: boolean;
  readonly vatRate: number;
  readonly nextOrder: number;
  readonly onClose: () => void;
  readonly onSaved: (message: string) => void;
  readonly onDuplicate: (row: Row) => void;
}) {
  const initial = useMemo(() => valuesFrom(row), [row]);
  const [values, setValues] = useState<Values>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refs = useRefs([{ table: 'inspection_templates', label: 'name_ar', value: 'key' }]);
  const templates = refs['inspection_templates'] ?? [];
  const dirty = JSON.stringify(values) !== JSON.stringify(initial);

  const set = <K extends keyof Values>(key: K, value: Values[K]) =>
    setValues((current) => ({ ...current, [key]: value }));

  const close = () => {
    if (confirmDiscard(dirty)) onClose();
  };

  const price = Number(values.base_price);
  const priceValid = values.priced_by_provider || (values.base_price.trim() !== '' && price >= 0);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (values.name_ar.trim() === '' || values.name_en.trim() === '') {
      return setError('اكتب اسم الخدمة بالعربي والإنجليزي.');
    }
    if (!priceValid || !Number.isFinite(price))
      return setError('اكتب سعراً صحيحاً، مثل 150 أو 149.50.');
    const minutes = Number(values.est_duration_min);
    if (!Number.isInteger(minutes) || minutes <= 0) return setError('المدة بالدقائق، رقم صحيح.');
    if (values.supported_modes.length === 0) return setError('اختر طريقة تنفيذ واحدة على الأقل.');
    if (values.category === 'inspection' && values.inspection_template_key === '') {
      return setError('خدمة الفحص تحتاج نموذج فحص يملؤه الفنّي.');
    }

    const record: Row = {
      name_ar: values.name_ar.trim(),
      name_en: values.name_en.trim(),
      description_ar: values.description_ar.trim() === '' ? null : values.description_ar.trim(),
      category: values.category,
      icon: values.icon,
      base_price: values.priced_by_provider ? null : Math.round(price * 100) / 100,
      price_is_fixed: values.priced_by_provider ? false : values.price_is_fixed,
      est_duration_min: minutes,
      supported_modes: values.supported_modes,
      requires_vehicle: values.requires_vehicle,
      requires_lift: values.requires_lift,
      requires_completion_photos: values.requires_completion_photos,
      requires_completion_mileage: values.requires_completion_mileage,
      inspection_template_key:
        values.inspection_template_key === '' ? null : values.inspection_template_key,
      is_active: values.is_active,
    };

    setBusy(true);
    try {
      if (isNew) {
        await api.insertRow('services', { ...record, sort_order: nextOrder });
        onSaved('أُضيفت الخدمة.');
      } else {
        await api.updateRow('services', { id: row?.['id'] }, record);
        onSaved('حُفظت الخدمة.');
      }
    } catch (cause) {
      setError(explain(cause));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (row === null || isNew) return;
    if (
      !window.confirm(
        'حذف الخدمة نهائياً؟ إن كانت عليها طلبات فلن يُسمح بالحذف — أوقفها بدلاً من ذلك.',
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.deleteRow('services', { id: row['id'] });
      onSaved('حُذفت الخدمة.');
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '';
      setError(explainDelete(message) ?? explain(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={isNew ? 'خدمة جديدة' : `تعديل: ${String(row?.['name_ar'] ?? '')}`}
      onClose={close}
      wide
    >
      <form onSubmit={save} style={{ display: 'grid', gap: 'var(--space-md)' }}>
        <section className="form-section">
          <h3>الاسم والوصف</h3>
          <div className="two-col">
            <Field label="الاسم بالعربي *">
              <input
                className="input"
                value={values.name_ar}
                onChange={(event) => set('name_ar', event.target.value)}
              />
            </Field>
            <Field label="الاسم بالإنجليزي *">
              <input
                className="input"
                dir="ltr"
                value={values.name_en}
                onChange={(event) => set('name_en', event.target.value)}
              />
            </Field>
          </div>
          <Field label="وصف قصير يظهر تحت الاسم" hint="سطر أو سطران. اختياري.">
            <textarea
              className="input"
              rows={2}
              value={values.description_ar}
              onChange={(event) => set('description_ar', event.target.value)}
            />
          </Field>
        </section>

        <section className="form-section">
          <h3>الفئة والأيقونة</h3>
          <div className="chip-group" role="group" aria-label="الفئة">
            {SERVICE_CATEGORIES.map((entry) => (
              <button
                key={entry.value}
                type="button"
                className="chip"
                aria-pressed={values.category === entry.value}
                onClick={() => set('category', entry.value)}
              >
                {entry.labelAr}
              </button>
            ))}
          </div>
          <div className="icon-grid" role="group" aria-label="الأيقونة">
            {CATALOGUE_ICONS.map((icon) => (
              <button
                key={icon.name}
                type="button"
                className="icon-option"
                aria-pressed={values.icon === icon.name}
                onClick={() => set('icon', icon.name)}
              >
                <Glyph name={icon.glyph} size={24} />
                {icon.labelAr}
              </button>
            ))}
          </div>
        </section>

        <section className="form-section">
          <h3>السعر والمدة</h3>
          <label className="actions" style={{ alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={values.priced_by_provider}
              onChange={(event) => set('priced_by_provider', event.target.checked)}
            />
            بدون سعر ثابت من هبّة — يحدّده مقدّم الخدمة
          </label>
          <div className="two-col">
            {!values.priced_by_provider ? (
              <Field
                label="السعر قبل الضريبة (ر.س) *"
                hint={
                  values.base_price.trim() !== '' && Number.isFinite(price)
                    ? `يدفع العميل ${money(withVat(price, vatRate))} شامل ضريبة ${Math.round(vatRate * 100)}%`
                    : 'مثل 150 أو 149.50'
                }
              >
                <input
                  className="input numeric"
                  inputMode="decimal"
                  value={values.base_price}
                  onChange={(event) => set('base_price', event.target.value)}
                />
              </Field>
            ) : null}
            <Field label="المدة المتوقعة (دقيقة) *">
              <input
                className="input numeric"
                inputMode="numeric"
                value={values.est_duration_min}
                onChange={(event) => set('est_duration_min', event.target.value)}
              />
            </Field>
          </div>
          {!values.priced_by_provider ? (
            <label className="actions" style={{ alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={values.price_is_fixed}
                onChange={(event) => set('price_is_fixed', event.target.checked)}
              />
              سعر ثابت — لا يختلف بين مقدّمي الخدمة (قطع الغيار تُضاف بموافقة العميل)
            </label>
          ) : null}
        </section>

        <section className="form-section">
          <h3>طريقة التنفيذ</h3>
          <div className="chip-group" role="group" aria-label="طريقة التنفيذ">
            {MODES.map((mode) => {
              const on = values.supported_modes.includes(mode.value);
              return (
                <button
                  key={mode.value}
                  type="button"
                  className="chip"
                  aria-pressed={on}
                  title={mode.hint}
                  onClick={() =>
                    set(
                      'supported_modes',
                      on
                        ? values.supported_modes.filter((entry) => entry !== mode.value)
                        : [...values.supported_modes, mode.value],
                    )
                  }
                >
                  {mode.text}
                </button>
              );
            })}
          </div>
          <span className="subtle">اختر كل الطرق المتاحة لهذه الخدمة؛ يختار العميل منها.</span>
        </section>

        <section className="form-section">
          <h3>متطلبات</h3>
          {(
            [
              [
                'requires_vehicle',
                'تحتاج سيارة مسجّلة',
                'يُطلب من العميل اختيار سيارته، ويُسجَّل العمل في دفترها.',
              ],
              ['requires_lift', 'تحتاج رافعة', 'تُنفَّذ في الورشة فقط.'],
              ['requires_completion_photos', 'صور قبل وبعد إلزامية', 'لا يُسلَّم العمل قبل رفعها.'],
              [
                'requires_completion_mileage',
                'قراءة العداد إلزامية',
                'تُسجَّل في دفتر السيارة عند التسليم.',
              ],
            ] as const
          ).map(([key, text, hint]) => (
            <label key={key} className="actions" style={{ alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={values[key]}
                onChange={(event) => set(key, event.target.checked)}
              />
              <span>
                {text} <span className="subtle">— {hint}</span>
              </span>
            </label>
          ))}
          {values.category === 'inspection' || values.inspection_template_key !== '' ? (
            <Field
              label="نموذج الفحص"
              hint="البنود التي يملؤها الفنّي. لا يُسلَّم الطلب قبل تعبئتها."
            >
              <select
                className="input"
                value={values.inspection_template_key}
                onChange={(event) => set('inspection_template_key', event.target.value)}
              >
                <option value="">— بدون —</option>
                {templates.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.text}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
        </section>

        <section className="form-section">
          <h3>الظهور</h3>
          <Switch
            label="الخدمة في التطبيق"
            checked={values.is_active}
            onChange={(next) => set('is_active', next)}
            onText="ظاهرة في التطبيق"
            offText="مخفية من التطبيق"
          />
        </section>

        {error !== null ? (
          <p className="notice" data-tone="bad" style={{ margin: 0 }}>
            {error}
          </p>
        ) : null}
        <div className="actions">
          <Button type="submit" tone="primary" busy={busy}>
            حفظ
          </Button>
          <Button onClick={close}>إلغاء</Button>
          {!isNew && row !== null ? (
            <>
              <Button onClick={() => (confirmDiscard(dirty) ? onDuplicate(row) : undefined)}>
                نسخ كخدمة جديدة
              </Button>
              <span style={{ marginInlineStart: 'auto' }}>
                <Button tone="danger" busy={busy} onClick={() => void remove()}>
                  حذف نهائي
                </Button>
              </span>
            </>
          ) : null}
        </div>
      </form>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Prices by a percentage
// ---------------------------------------------------------------------------

function BulkPriceDialog({
  services,
  vatRate,
  onClose,
  onDone,
}: {
  readonly services: readonly Row[];
  readonly vatRate: number;
  readonly onClose: () => void;
  readonly onDone: (count: number) => void;
}) {
  const [category, setCategory] = useState('');
  const [percent, setPercent] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const change = Number(percent);
  const valid =
    percent.trim() !== '' &&
    Number.isFinite(change) &&
    change !== 0 &&
    change >= -50 &&
    change <= 100;
  const affected = services.filter(
    (row) => row['base_price'] !== null && (category === '' || row['category'] === category),
  );

  const apply = async () => {
    setError(null);
    if (!valid) return setError('اكتب نسبة بين -50 و100، مثل 10 للزيادة أو -5 للتخفيض.');
    if (reason.trim().length < 3) return setError('اكتب سبب التعديل؛ يُسجَّل في سجل التدقيق.');
    setBusy(true);
    try {
      onDone(
        await api.adjustServicePrices(category === '' ? null : category, change, reason.trim()),
      );
    } catch (cause) {
      setError(explain(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title="تعديل الأسعار بنسبة" onClose={onClose} wide>
      <p className="subtle" style={{ margin: 0 }}>
        يرفع أو يخفّض السعر الأساسي لكل خدمة في الفئة المختارة دفعة واحدة. الطلبات الحالية لا تتأثر.
      </p>
      <div className="two-col">
        <Field label="الفئة">
          <select
            className="input"
            value={category}
            onChange={(event) => setCategory(event.target.value)}
          >
            <option value="">كل الخدمات</option>
            {SERVICE_CATEGORIES.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.labelAr}
              </option>
            ))}
          </select>
        </Field>
        <Field label="النسبة (%)" hint="10 = زيادة 10٪، ‎-5 = تخفيض 5٪">
          <input
            className="input numeric"
            inputMode="decimal"
            dir="ltr"
            value={percent}
            onChange={(event) => setPercent(event.target.value)}
          />
        </Field>
      </div>
      <Field label="السبب *">
        <input
          className="input"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="مثال: ارتفاع أسعار الموردين"
        />
      </Field>
      {valid ? (
        <DataTable<Row>
          rows={affected}
          rowKey={(row) => String(row['id'])}
          empty="لا خدمات بسعر في هذه الفئة."
          columns={[
            { label: 'الخدمة', render: (row) => String(row['name_ar']) },
            {
              label: 'الآن',
              numeric: true,
              render: (row) => money(Number(row['base_price'])),
            },
            {
              label: 'بعد التعديل',
              numeric: true,
              render: (row) => {
                const next = Math.round(Number(row['base_price']) * (1 + change / 100) * 100) / 100;
                return (
                  <>
                    <strong>{money(next)}</strong>
                    <div className="subtle">للعميل {money(withVat(next, vatRate))}</div>
                  </>
                );
              },
            },
          ]}
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
          disabled={!valid || affected.length === 0}
          onClick={() => void apply()}
        >
          {valid ? `طبّق على ${affected.length} خدمة` : 'طبّق'}
        </Button>
        <Button onClick={onClose}>إلغاء</Button>
      </div>
    </Dialog>
  );
}
