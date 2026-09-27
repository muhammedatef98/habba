/**
 * The rest of the catalogue: cities, makes and models, the maintenance
 * schedule, commission, VAT and who issues invoices.
 *
 * One editor driven by a description of each table. What makes it quick to
 * use: a search box and an on/off filter on every list; the on/off switch in
 * the row itself; models filtered by make; the rate in force today marked;
 * a city's centre taken from a pasted Google Maps link; and delete only from
 * inside a row's form, after a warning, because switching off is almost
 * always what is meant. Every change lands in the audit log (0068).
 */

'use client';

import { useMemo, useState } from 'react';
import { SERVICE_CATEGORIES } from '@habba/core/catalogue-icons';
import { api } from '@/data/api';
import type { Row } from '@/data/transport';
import { explain } from '@/data/transport';
import { money } from '@/lib/format';
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
  parseCoordinate,
  pointText,
  useRefs,
  type ActiveFilter,
  type Option,
  type RefSpec,
  type Refs,
} from './common';

type Kind =
  'text' | 'longtext' | 'number' | 'money' | 'rate' | 'boolean' | 'date' | 'select' | 'point';

interface ColumnSpec {
  readonly key: string;
  readonly label: string;
  readonly kind: Kind;
  readonly required?: boolean;
  readonly options?: readonly Option[];
  readonly ref?: RefSpec;
  /** Set on creation only (a code other rows refer to). */
  readonly createOnly?: boolean;
  /** Shown in the form, not the list. */
  readonly formOnly?: boolean;
  readonly hint?: string;
  readonly ltr?: boolean;
}

export interface TableSpec {
  readonly table: string;
  readonly label: string;
  readonly description: string;
  readonly key: string;
  readonly order: string;
  readonly columns: readonly ColumnSpec[];
  readonly defaults?: Row;
  /** A select above the list that narrows it by one column (models by make). */
  readonly filterBy?: string;
  /** Rows valid from/to a date: the one in force today is marked. */
  readonly dated?: boolean;
}

const CATEGORY: readonly Option[] = SERVICE_CATEGORIES.map((entry) => ({
  value: entry.value,
  text: entry.labelAr,
}));

export const TABLE_SPECS: readonly TableSpec[] = [
  {
    table: 'cities',
    label: 'المدن',
    description: 'المدن التي تعمل فيها هبّة. المدينة المتوقفة لا تظهر لمقدّمي الخدمة عند التسجيل.',
    key: 'id',
    order: 'name_ar',
    defaults: { is_active: true },
    columns: [
      { key: 'name_ar', label: 'المدينة', kind: 'text', required: true },
      { key: 'name_en', label: 'بالإنجليزي', kind: 'text', required: true, ltr: true },
      { key: 'region_ar', label: 'المنطقة', kind: 'text', required: true },
      {
        key: 'region_en',
        label: 'المنطقة بالإنجليزي',
        kind: 'text',
        required: true,
        ltr: true,
        formOnly: true,
      },
      {
        key: 'centroid',
        label: 'مركز المدينة',
        kind: 'point',
        required: true,
        formOnly: true,
        hint: 'الصق رابط الموقع من خرائط Google، أو اكتب خط العرض ثم خط الطول مثل 26.4207, 50.1033',
      },
      { key: 'is_active', label: 'مفعّلة', kind: 'boolean' },
    ],
  },
  {
    table: 'vehicle_makes',
    label: 'الماركات',
    description: 'ماركات السيارات التي يختار منها العميل. الترتيب يحدد مكانها في القائمة.',
    key: 'id',
    order: 'sort_order',
    defaults: { is_active: true },
    columns: [
      { key: 'name_ar', label: 'الماركة', kind: 'text', required: true },
      { key: 'name_en', label: 'بالإنجليزي', kind: 'text', required: true, ltr: true },
      { key: 'logo_url', label: 'رابط الشعار', kind: 'text', formOnly: true, ltr: true },
      { key: 'sort_order', label: 'الترتيب', kind: 'number', hint: 'الأصغر أولاً' },
      { key: 'is_active', label: 'مفعّلة', kind: 'boolean' },
    ],
  },
  {
    table: 'vehicle_models',
    label: 'الموديلات',
    description: 'موديلات كل ماركة وسنوات إنتاجها.',
    key: 'id',
    order: 'name_en',
    filterBy: 'make_id',
    defaults: { is_active: true },
    columns: [
      {
        key: 'make_id',
        label: 'الماركة',
        kind: 'select',
        ref: { table: 'vehicle_makes', label: 'name_ar' },
        required: true,
      },
      { key: 'name_ar', label: 'الموديل', kind: 'text', required: true },
      { key: 'name_en', label: 'بالإنجليزي', kind: 'text', required: true, ltr: true },
      { key: 'year_from', label: 'من سنة', kind: 'number', required: true },
      {
        key: 'year_to',
        label: 'إلى سنة',
        kind: 'number',
        hint: 'اتركها فارغة إن كان ما زال يُصنع',
      },
      {
        key: 'body_type',
        label: 'نوع الهيكل',
        kind: 'text',
        formOnly: true,
        hint: 'مثل سيدان، دفع رباعي',
      },
      { key: 'is_active', label: 'مفعّل', kind: 'boolean' },
    ],
  },
  {
    table: 'maintenance_item_types',
    label: 'بنود الصيانة',
    description: 'ما يتابعه دفتر السيارة ويذكّر به (الزيت، الفرامل…) وكل كم تُستحق عادةً.',
    key: 'item_type',
    order: 'sort_order',
    defaults: { is_active: true },
    columns: [
      { key: 'name_ar', label: 'البند', kind: 'text', required: true },
      { key: 'name_en', label: 'بالإنجليزي', kind: 'text', required: true, ltr: true },
      {
        key: 'item_type',
        label: 'الرمز',
        kind: 'text',
        required: true,
        createOnly: true,
        formOnly: true,
        ltr: true,
        hint: 'بالإنجليزي بلا مسافات، مثل engine_oil. لا يتغيّر بعد الإنشاء.',
      },
      {
        key: 'service_id',
        label: 'الخدمة التي تُحجز له',
        kind: 'select',
        ref: { table: 'services', label: 'name_ar' },
      },
      { key: 'default_interval_km', label: 'كل (كم)', kind: 'number' },
      { key: 'default_interval_months', label: 'كل (شهر)', kind: 'number' },
      { key: 'sort_order', label: 'الترتيب', kind: 'number', formOnly: true },
      { key: 'is_active', label: 'مفعّل', kind: 'boolean' },
    ],
  },
  {
    table: 'maintenance_rules',
    label: 'قواعد الصيانة',
    description:
      'مواعيد خاصة بماركة أو موديل (مثل: تويوتا كامري تغيير زيت كل 10,000 كم). بلا ماركة = لكل السيارات. منها تُبنى التذكيرات.',
    key: 'id',
    order: 'name_en',
    defaults: { is_active: true, confidence: 'generic' },
    columns: [
      { key: 'name_ar', label: 'القاعدة', kind: 'text', required: true },
      {
        key: 'name_en',
        label: 'بالإنجليزي',
        kind: 'text',
        required: true,
        ltr: true,
        formOnly: true,
      },
      {
        key: 'service_id',
        label: 'الخدمة',
        kind: 'select',
        ref: { table: 'services', label: 'name_ar' },
        required: true,
      },
      {
        key: 'make_id',
        label: 'الماركة',
        kind: 'select',
        ref: { table: 'vehicle_makes', label: 'name_ar' },
      },
      {
        key: 'model_id',
        label: 'الموديل',
        kind: 'select',
        ref: { table: 'vehicle_models', label: 'name_ar' },
      },
      { key: 'due_every_km', label: 'كل (كم)', kind: 'number' },
      { key: 'due_every_months', label: 'كل (شهر)', kind: 'number' },
      { key: 'first_due_km', label: 'أول مرة عند (كم)', kind: 'number', formOnly: true },
      {
        key: 'confidence',
        label: 'المصدر',
        kind: 'select',
        options: [
          { value: 'generic', text: 'عام' },
          { value: 'oem', text: 'من دليل الصانع' },
        ],
      },
      { key: 'is_active', label: 'مفعّلة', kind: 'boolean' },
    ],
  },
  {
    table: 'commission_rates',
    label: 'العمولة',
    description:
      'نسبة هبّة من صافي كل طلب قبل الضريبة. بلا فئة = لكل الفئات. تسري من تاريخها، والأحدث يغلب. لتغيير النسبة أضف سطراً جديداً بتاريخ بدء بدل تعديل القديم.',
    key: 'id',
    order: 'valid_from',
    dated: true,
    columns: [
      { key: 'category', label: 'الفئة', kind: 'select', options: CATEGORY },
      { key: 'rate', label: 'النسبة', kind: 'rate', required: true, hint: 'مثل 20 تعني 20٪' },
      { key: 'valid_from', label: 'تسري من', kind: 'date', required: true },
      { key: 'valid_to', label: 'حتى', kind: 'date', hint: 'اتركها فارغة إن كانت مستمرة' },
    ],
  },
  {
    table: 'vat_rates',
    label: 'ضريبة القيمة المضافة',
    description:
      'النسبة المطبّقة على الفواتير حسب التاريخ. لا تغيّرها إلا بقرار رسمي من هيئة الزكاة والضريبة.',
    key: 'id',
    order: 'valid_from',
    dated: true,
    columns: [
      { key: 'rate', label: 'النسبة', kind: 'rate', required: true, hint: 'مثل 15 تعني 15٪' },
      { key: 'valid_from', label: 'تسري من', kind: 'date', required: true },
      { key: 'valid_to', label: 'حتى', kind: 'date' },
    ],
  },
  {
    table: 'invoice_sellers',
    label: 'جهات إصدار الفواتير',
    description:
      'البائع الذي تصدر الفاتورة الإلكترونية باسمه — هبّة أو مقدّم الخدمة، حسب نموذج الفوترة.',
    key: 'id',
    order: 'legal_name_ar',
    defaults: { is_active: true },
    columns: [
      { key: 'legal_name_ar', label: 'الاسم القانوني', kind: 'text', required: true },
      {
        key: 'vat_number',
        label: 'الرقم الضريبي',
        kind: 'text',
        required: true,
        ltr: true,
        hint: '15 رقماً، يبدأ وينتهي بـ 3',
      },
      { key: 'cr_number', label: 'السجل التجاري', kind: 'text', ltr: true },
      { key: 'is_active', label: 'مفعّل', kind: 'boolean' },
    ],
  },
];

/** Which dated row is in force today; for commission, the newest per category. */
function inForce(rows: readonly Row[]): ReadonlySet<unknown> {
  const today = new Date().toISOString().slice(0, 10);
  const winners = new Map<string, Row>();
  for (const row of rows) {
    const from = String(row['valid_from'] ?? '');
    const to =
      row['valid_to'] === null || row['valid_to'] === undefined ? null : String(row['valid_to']);
    if (from > today || (to !== null && to < today)) continue;
    const group = String(row['category'] ?? '*');
    const best = winners.get(group);
    if (best === undefined || String(best['valid_from']) < from) winners.set(group, row);
  }
  return new Set([...winners.values()].map((row) => row['id']));
}

export function TableEditor({ spec }: { readonly spec: TableSpec }) {
  const state = useLoad(
    () => api.table<Row>(spec.table, { order: spec.order, ascending: true }),
    spec.table,
  );
  const refs = useRefs(
    spec.columns.flatMap((column) => (column.ref !== undefined ? [column.ref] : [])),
  );
  const toast = useToast();
  const [editing, setEditing] = useState<Row | 'new' | null>(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState<ActiveFilter>('all');
  const [filter, setFilter] = useState('');
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const hasActive = spec.columns.some((column) => column.key === 'is_active');
  const listed = spec.columns.filter((column) => column.formOnly !== true);
  const filterColumn = spec.columns.find((column) => column.key === spec.filterBy);
  const current = useMemo(
    () => (spec.dated === true ? inForce(state.data ?? []) : new Set()),
    [spec, state.data],
  );

  const rows = (state.data ?? []).filter(
    (row) =>
      matches(
        query,
        ...spec.columns.filter((column) => column.kind === 'text').map((column) => row[column.key]),
      ) &&
      (!hasActive || activeMatches(active, row['is_active'])) &&
      (filterColumn === undefined || filter === '' || String(row[filterColumn.key]) === filter),
  );

  const toggle = async (row: Row, next: boolean) => {
    const id = String(row[spec.key]);
    setBusyKey(id);
    setError(null);
    try {
      await api.updateRow(spec.table, { [spec.key]: row[spec.key] }, { is_active: next });
      toast(next ? 'فُعّل.' : 'أُوقف.');
      state.reload();
    } catch (cause) {
      setError(explain(cause));
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <Card
      title={spec.label}
      actions={
        <Button tone="primary" onClick={() => setEditing('new')}>
          إضافة
        </Button>
      }
    >
      <p className="subtle" style={{ marginTop: 0 }}>
        {spec.description}
      </p>
      <ListToolbar
        query={query}
        onQuery={setQuery}
        active={hasActive ? active : undefined}
        onActive={hasActive ? setActive : undefined}
        count={rows.length}
      >
        {filterColumn !== undefined ? (
          <select
            className="input"
            style={{ maxWidth: 200 }}
            aria-label={filterColumn.label}
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          >
            <option value="">
              كل {filterColumn.label === 'الماركة' ? 'الماركات' : filterColumn.label}
            </option>
            {optionsFor(filterColumn, refs).map((option) => (
              <option key={option.value} value={option.value}>
                {option.text}
              </option>
            ))}
          </select>
        ) : null}
      </ListToolbar>
      {error !== null ? (
        <p className="notice" data-tone="bad">
          {error}
        </p>
      ) : null}
      <Loadable state={state}>
        {() => (
          <DataTable<Row>
            rows={rows}
            rowKey={(row) => String(row[spec.key])}
            onRowClick={(row) => setEditing(row)}
            empty="لا سجلات تطابق البحث."
            columns={[
              ...listed.map((column) => ({
                label: column.label,
                numeric: ['number', 'money', 'rate'].includes(column.kind),
                render: (row: Row) =>
                  column.key === 'is_active' ? (
                    <Switch
                      label={`${column.label}: ${String(row[listed[0]?.key ?? spec.key] ?? '')}`}
                      checked={row['is_active'] === true}
                      busy={busyKey === String(row[spec.key])}
                      onChange={(next) => void toggle(row, next)}
                    />
                  ) : (
                    display(column, row[column.key], refs)
                  ),
              })),
              ...(spec.dated === true
                ? [
                    {
                      label: '',
                      render: (row: Row) =>
                        current.has(row['id']) ? <Badge tone="good">سارية الآن</Badge> : null,
                    },
                  ]
                : []),
            ]}
          />
        )}
      </Loadable>
      {editing !== null ? (
        <RowForm
          spec={spec}
          row={editing === 'new' ? null : editing}
          refs={refs}
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

function optionsFor(column: ColumnSpec, refs: Refs): readonly Option[] {
  return column.ref !== undefined ? (refs[column.ref.table] ?? []) : (column.options ?? []);
}

function display(column: ColumnSpec, value: unknown, refs: Refs) {
  if (value === null || value === undefined || value === '') {
    return column.kind === 'select' && column.key !== 'service_id' ? (
      <span className="muted">الكل</span>
    ) : (
      <span className="muted">—</span>
    );
  }
  switch (column.kind) {
    case 'boolean':
      return value === true ? <Badge tone="good">نعم</Badge> : <Badge>لا</Badge>;
    case 'money':
      return money(Number(value));
    case 'rate':
      return `${Math.round(Number(value) * 10_000) / 100}%`;
    case 'number':
      return Number(value).toLocaleString('en-US');
    case 'select':
      return (
        optionsFor(column, refs).find((option) => option.value === String(value))?.text ??
        String(value)
      );
    default:
      return String(value);
  }
}

function toInput(column: ColumnSpec, value: unknown): string | boolean {
  switch (column.kind) {
    case 'boolean':
      return value === true;
    case 'rate':
      return value === null || value === undefined
        ? ''
        : String(Math.round(Number(value) * 10_000) / 100);
    case 'point':
      return pointText(value);
    default:
      return value === null || value === undefined ? '' : String(value);
  }
}

/** undefined: leave the column out. null: write null. */
function fromInput(column: ColumnSpec, value: string | boolean | undefined): unknown {
  if (value === undefined) return undefined;
  if (column.kind === 'boolean') return value === true;
  const text = String(value).trim();
  if (text === '') return null;
  switch (column.kind) {
    case 'point': {
      const point = parseCoordinate(text);
      if (point === null)
        throw new Error(`«${column.label}»: الصق رابط خرائط Google، أو اكتب خط العرض ثم خط الطول.`);
      return `SRID=4326;POINT(${point.lon} ${point.lat})`;
    }
    case 'number':
    case 'money': {
      const number = Number(text.replace(/,/g, ''));
      if (!Number.isFinite(number)) throw new Error(`«${column.label}» يجب أن يكون رقماً.`);
      return number;
    }
    case 'rate': {
      const number = Number(text.replace('%', ''));
      if (!Number.isFinite(number) || number < 0 || number > 100) {
        throw new Error(`«${column.label}» نسبة بين 0 و100.`);
      }
      return Math.round(number * 100) / 10_000;
    }
    default:
      return text;
  }
}

function RowForm({
  spec,
  row,
  refs,
  onClose,
  onSaved,
}: {
  readonly spec: TableSpec;
  readonly row: Row | null;
  readonly refs: Refs;
  readonly onClose: () => void;
  readonly onSaved: (message: string) => void;
}) {
  const initial = useMemo(() => {
    const values: Record<string, string | boolean> = {};
    for (const column of spec.columns) {
      values[column.key] = toInput(
        column,
        row !== null ? row[column.key] : spec.defaults?.[column.key],
      );
    }
    return values;
  }, [spec, row]);
  const [values, setValues] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = JSON.stringify(values) !== JSON.stringify(initial);

  const close = () => {
    if (confirmDiscard(dirty)) onClose();
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    const record: Row = {};
    try {
      for (const column of spec.columns) {
        if (row !== null && column.createOnly === true) continue;
        const parsed = fromInput(column, values[column.key]);
        if (parsed === undefined) continue;
        if (parsed === null && column.required === true)
          throw new Error(`«${column.label}» مطلوب.`);
        record[column.key] = parsed;
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'قيمة غير صحيحة.');
      return;
    }
    setBusy(true);
    try {
      if (row === null) await api.insertRow(spec.table, record);
      else await api.updateRow(spec.table, { [spec.key]: row[spec.key] }, record);
      onSaved(row === null ? 'أُضيف.' : 'حُفظ.');
    } catch (cause) {
      setError(explain(cause));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (row === null) return;
    if (
      !window.confirm(
        'حذف هذا السجل نهائياً؟ إن كان مستخدماً فلن يُسمح بالحذف — أوقفه بدلاً من ذلك.',
      )
    )
      return;
    setBusy(true);
    setError(null);
    try {
      await api.deleteRow(spec.table, { [spec.key]: row[spec.key] });
      onSaved('حُذف.');
    } catch (cause) {
      setError(explainDelete(cause instanceof Error ? cause.message : '') ?? explain(cause));
    } finally {
      setBusy(false);
    }
  };

  const point = spec.columns.find((column) => column.kind === 'point');
  const pointValue = point !== undefined ? parseCoordinate(String(values[point.key] ?? '')) : null;
  const wide = (column: ColumnSpec) => ['longtext', 'point', 'boolean'].includes(column.kind);

  return (
    <Dialog
      title={row === null ? `إضافة — ${spec.label}` : `تعديل — ${spec.label}`}
      onClose={close}
      wide
    >
      <form onSubmit={save} style={{ display: 'grid', gap: 'var(--space-md)' }}>
        <div className="two-col">
          {spec.columns
            .filter((column) => !(row !== null && column.createOnly === true) && !wide(column))
            .map((column) => (
              <FieldFor
                key={column.key}
                column={column}
                value={values[column.key]}
                refs={refs}
                onChange={(next) => setValues((current) => ({ ...current, [column.key]: next }))}
              />
            ))}
        </div>
        {spec.columns
          .filter((column) => !(row !== null && column.createOnly === true) && wide(column))
          .map((column) => (
            <FieldFor
              key={column.key}
              column={column}
              value={values[column.key]}
              refs={refs}
              onChange={(next) => setValues((current) => ({ ...current, [column.key]: next }))}
            />
          ))}
        {pointValue !== null ? (
          <a
            className="link"
            href={`https://www.google.com/maps?q=${pointValue.lat},${pointValue.lon}`}
            target="_blank"
            rel="noreferrer"
          >
            افتح الموقع على خرائط Google ↗
          </a>
        ) : null}
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
          {row !== null ? (
            <span style={{ marginInlineStart: 'auto' }}>
              <Button tone="danger" busy={busy} onClick={() => void remove()}>
                حذف نهائي
              </Button>
            </span>
          ) : null}
        </div>
      </form>
    </Dialog>
  );
}

function FieldFor({
  column,
  value,
  refs,
  onChange,
}: {
  readonly column: ColumnSpec;
  readonly value: string | boolean | undefined;
  readonly refs: Refs;
  readonly onChange: (next: string | boolean) => void;
}) {
  if (column.kind === 'boolean') {
    return (
      <Switch
        label={column.label}
        checked={value === true}
        onChange={onChange}
        onText={`${column.label}: نعم`}
        offText={`${column.label}: لا`}
      />
    );
  }
  const label = `${column.label}${column.required === true ? ' *' : ''}`;
  if (column.kind === 'select') {
    return (
      <Field label={label} hint={column.hint}>
        <select
          className="input"
          value={String(value ?? '')}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">{column.required === true ? '— اختر —' : '— الكل / بدون —'}</option>
          {optionsFor(column, refs).map((option) => (
            <option key={option.value} value={option.value}>
              {option.text}
            </option>
          ))}
        </select>
      </Field>
    );
  }
  if (column.kind === 'longtext') {
    return (
      <Field label={label} hint={column.hint}>
        <textarea
          className="input"
          rows={3}
          value={String(value ?? '')}
          onChange={(event) => onChange(event.target.value)}
        />
      </Field>
    );
  }
  const numeric = ['number', 'money', 'rate'].includes(column.kind);
  return (
    <Field label={label} hint={column.hint}>
      <input
        className={`input${numeric ? ' numeric' : ''}`}
        type={column.kind === 'date' ? 'date' : 'text'}
        inputMode={numeric ? 'decimal' : undefined}
        dir={column.ltr === true || column.kind === 'point' ? 'ltr' : undefined}
        value={String(value ?? '')}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  );
}
