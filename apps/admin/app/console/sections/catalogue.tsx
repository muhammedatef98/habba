/**
 * The catalogue: the services Habba sells and at what price, the cities it
 * works in, the cars it knows, the maintenance schedule it predicts from,
 * the commission it takes, the VAT it charges, and who issues its invoices.
 *
 * These tables are open to operators by RLS (and to nobody else for writing),
 * so the editor writes them directly; every change lands in the audit log
 * (0068, 0069). Rows that orders point at are deactivated rather than
 * deleted — the database refuses the delete, and the screen says so.
 */

'use client';

import { useMemo, useState } from 'react';
import { api } from '@/data/api';
import type { Row } from '@/data/transport';
import { explain } from '@/data/transport';
import { money } from '@/lib/format';
import { MODE } from '../labels';
import {
  Badge,
  Button,
  Card,
  DataTable,
  Dialog,
  Field,
  Loadable,
  PageHead,
  Tabs,
  useLoad,
  useToast,
} from '../ui';

type Kind =
  | 'text'
  | 'longtext'
  | 'number'
  | 'money'
  | 'rate'
  | 'boolean'
  | 'date'
  | 'select'
  | 'modes'
  | 'json'
  | 'point';

interface ColumnSpec {
  readonly key: string;
  readonly label: string;
  readonly kind: Kind;
  readonly required?: boolean;
  readonly options?: readonly { readonly value: string; readonly text: string }[];
  /**
   * Options loaded from another catalogue table. `value` is the column the
   * foreign key points at — `id` unless the key is a natural one.
   */
  readonly ref?: { readonly table: string; readonly label: string; readonly value?: string };
  readonly nullable?: boolean;
  /** Set on creation only (a key, a code). */
  readonly createOnly?: boolean;
  /** Shown in the form, not the table. */
  readonly formOnly?: boolean;
  readonly hint?: string;
}

interface TableSpec {
  readonly table: string;
  readonly label: string;
  readonly description: string;
  readonly key: string;
  readonly order: string;
  readonly columns: readonly ColumnSpec[];
  readonly defaults?: Row;
}

const CATEGORY = [
  { value: 'emergency', text: 'طوارئ' },
  { value: 'periodic', text: 'صيانة دورية' },
  { value: 'inspection', text: 'فحص' },
  { value: 'wash', text: 'غسيل' },
  { value: 'bodywork', text: 'سمكرة ودهان' },
];

const SPECS: readonly TableSpec[] = [
  {
    table: 'services',
    label: 'الخدمات والأسعار',
    description:
      'ما يظهر للعميل في التطبيق وسعره الأساسي. الخدمة المعطّلة تختفي من التطبيق ولا تُحذف.',
    key: 'id',
    order: 'sort_order',
    defaults: {
      is_active: true,
      price_is_fixed: false,
      requires_vehicle: true,
      icon: 'wrench',
      supported_modes: ['mobile_ondemand'],
    },
    columns: [
      { key: 'name_ar', label: 'الاسم', kind: 'text', required: true },
      { key: 'name_en', label: 'الاسم بالإنجليزية', kind: 'text', required: true },
      { key: 'category', label: 'الفئة', kind: 'select', options: CATEGORY, required: true },
      { key: 'base_price', label: 'السعر الأساسي (قبل الضريبة)', kind: 'money', nullable: true },
      { key: 'price_is_fixed', label: 'سعر ثابت', kind: 'boolean' },
      { key: 'est_duration_min', label: 'المدة (دقيقة)', kind: 'number', required: true },
      { key: 'supported_modes', label: 'طرق التنفيذ', kind: 'modes', required: true },
      { key: 'description_ar', label: 'الوصف', kind: 'longtext', nullable: true, formOnly: true },
      { key: 'icon', label: 'الأيقونة', kind: 'text', required: true, formOnly: true },
      { key: 'requires_vehicle', label: 'تتطلب سيارة', kind: 'boolean', formOnly: true },
      { key: 'requires_lift', label: 'تتطلب رافعة', kind: 'boolean', formOnly: true },
      {
        key: 'requires_completion_photos',
        label: 'صور الإنجاز إلزامية',
        kind: 'boolean',
        formOnly: true,
      },
      {
        key: 'requires_completion_mileage',
        label: 'قراءة العداد إلزامية',
        kind: 'boolean',
        formOnly: true,
      },
      {
        key: 'inspection_template_key',
        label: 'نموذج الفحص',
        kind: 'select',
        ref: { table: 'inspection_templates', label: 'name_ar', value: 'key' },
        nullable: true,
        hint: 'للخدمات التي تنتج تقرير فحص فقط. لا يُسلَّم الطلب قبل تعبئة التقرير.',
      },
      { key: 'sort_order', label: 'الترتيب', kind: 'number' },
      { key: 'is_active', label: 'مفعّلة', kind: 'boolean' },
    ],
  },
  {
    table: 'cities',
    label: 'المدن',
    description: 'المدن التي تعمل فيها هبّة. المدينة المعطّلة لا تظهر للتسجيل.',
    key: 'id',
    order: 'name_ar',
    defaults: { is_active: true },
    columns: [
      { key: 'name_ar', label: 'المدينة', kind: 'text', required: true },
      { key: 'name_en', label: 'بالإنجليزية', kind: 'text', required: true },
      { key: 'region_ar', label: 'المنطقة', kind: 'text', required: true },
      { key: 'region_en', label: 'المنطقة بالإنجليزية', kind: 'text', required: true },
      {
        key: 'centroid',
        label: 'مركز المدينة',
        kind: 'point',
        required: true,
        formOnly: true,
        createOnly: true,
        hint: 'خط العرض ثم خط الطول، مثل 26.4207, 50.1033',
      },
      { key: 'is_active', label: 'مفعّلة', kind: 'boolean' },
    ],
  },
  {
    table: 'vehicle_makes',
    label: 'الماركات',
    description: 'ماركات السيارات التي يختار منها العميل.',
    key: 'id',
    order: 'sort_order',
    defaults: { is_active: true },
    columns: [
      { key: 'name_ar', label: 'الماركة', kind: 'text', required: true },
      { key: 'name_en', label: 'بالإنجليزية', kind: 'text', required: true },
      { key: 'logo_url', label: 'رابط الشعار', kind: 'text', nullable: true, formOnly: true },
      { key: 'sort_order', label: 'الترتيب', kind: 'number' },
      { key: 'is_active', label: 'مفعّلة', kind: 'boolean' },
    ],
  },
  {
    table: 'vehicle_models',
    label: 'الطرازات',
    description: 'طرازات كل ماركة وسنوات إنتاجها.',
    key: 'id',
    order: 'name_en',
    defaults: { is_active: true },
    columns: [
      {
        key: 'make_id',
        label: 'الماركة',
        kind: 'select',
        ref: { table: 'vehicle_makes', label: 'name_ar' },
        required: true,
      },
      { key: 'name_ar', label: 'الطراز', kind: 'text', required: true },
      { key: 'name_en', label: 'بالإنجليزية', kind: 'text', required: true },
      { key: 'year_from', label: 'من سنة', kind: 'number', required: true },
      { key: 'year_to', label: 'إلى سنة', kind: 'number', nullable: true },
      { key: 'body_type', label: 'الهيكل', kind: 'text', nullable: true, formOnly: true },
      { key: 'is_active', label: 'مفعّل', kind: 'boolean' },
    ],
  },
  {
    table: 'maintenance_item_types',
    label: 'بنود الصيانة',
    description: 'البنود التي يتابعها دفتر السيارة ويذكّر بها (زيت، فرامل…) وفتراتها الافتراضية.',
    key: 'item_type',
    order: 'sort_order',
    defaults: { is_active: true },
    columns: [
      {
        key: 'item_type',
        label: 'الرمز',
        kind: 'text',
        required: true,
        createOnly: true,
        hint: 'بالإنجليزية بلا مسافات، مثل engine_oil',
      },
      { key: 'name_ar', label: 'البند', kind: 'text', required: true },
      { key: 'name_en', label: 'بالإنجليزية', kind: 'text', required: true },
      {
        key: 'service_id',
        label: 'الخدمة المرتبطة',
        kind: 'select',
        ref: { table: 'services', label: 'name_ar' },
        nullable: true,
      },
      { key: 'default_interval_km', label: 'كل (كم)', kind: 'number', nullable: true },
      { key: 'default_interval_months', label: 'كل (شهر)', kind: 'number', nullable: true },
      { key: 'sort_order', label: 'الترتيب', kind: 'number' },
      { key: 'is_active', label: 'مفعّل', kind: 'boolean' },
    ],
  },
  {
    table: 'maintenance_rules',
    label: 'قواعد الصيانة',
    description: 'متى تُستحق خدمة لماركة أو طراز محدد. منها تُبنى التنبيهات التنبؤية.',
    key: 'id',
    order: 'name_en',
    defaults: { is_active: true, confidence: 'generic' },
    columns: [
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
        nullable: true,
      },
      {
        key: 'model_id',
        label: 'الطراز',
        kind: 'select',
        ref: { table: 'vehicle_models', label: 'name_ar' },
        nullable: true,
      },
      { key: 'name_ar', label: 'القاعدة', kind: 'text', required: true },
      { key: 'name_en', label: 'بالإنجليزية', kind: 'text', required: true },
      { key: 'due_every_km', label: 'كل (كم)', kind: 'number', nullable: true },
      { key: 'due_every_months', label: 'كل (شهر)', kind: 'number', nullable: true },
      {
        key: 'first_due_km',
        label: 'أول مرة عند (كم)',
        kind: 'number',
        nullable: true,
        formOnly: true,
      },
      {
        key: 'confidence',
        label: 'المصدر',
        kind: 'select',
        options: [
          { value: 'generic', text: 'عام' },
          { value: 'oem', text: 'من الصانع' },
        ],
      },
      { key: 'is_active', label: 'مفعّلة', kind: 'boolean' },
    ],
  },
  {
    table: 'commission_rates',
    label: 'العمولة',
    description:
      'نسبة هبّة من صافي كل طلب (قبل الضريبة). بلا فئة = لكل الفئات. تسري النسبة من تاريخها، والأحدث يغلب.',
    key: 'id',
    order: 'valid_from',
    columns: [
      { key: 'category', label: 'الفئة', kind: 'select', options: CATEGORY, nullable: true },
      { key: 'rate', label: 'النسبة', kind: 'rate', required: true, hint: 'مثل 20 تعني 20%' },
      { key: 'valid_from', label: 'تسري من', kind: 'date', required: true },
      { key: 'valid_to', label: 'حتى', kind: 'date', nullable: true },
    ],
  },
  {
    table: 'vat_rates',
    label: 'ضريبة القيمة المضافة',
    description: 'النسبة المطبّقة على الفواتير بحسب التاريخ. لا تغيّرها إلا بقرار رسمي.',
    key: 'id',
    order: 'valid_from',
    columns: [
      { key: 'rate', label: 'النسبة', kind: 'rate', required: true, hint: 'مثل 15 تعني 15%' },
      { key: 'valid_from', label: 'تسري من', kind: 'date', required: true },
      { key: 'valid_to', label: 'حتى', kind: 'date', nullable: true },
    ],
  },
  {
    table: 'invoice_sellers',
    label: 'جهات إصدار الفواتير',
    description:
      'البائع الذي تصدر الفاتورة الإلكترونية باسمه (هبّة أو مقدّم الخدمة) — بحسب قرار نموذج الفوترة.',
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
        hint: '15 رقماً يبدأ وينتهي بـ 3',
      },
      { key: 'cr_number', label: 'السجل التجاري', kind: 'text', nullable: true },
      { key: 'is_active', label: 'مفعّل', kind: 'boolean' },
    ],
  },
  {
    table: 'inspection_templates',
    label: 'نماذج الفحص',
    description: 'أقسام الفحص وبنوده كما يراها الفنّي. البنية JSON كما يقرؤها التطبيق.',
    key: 'id',
    order: 'key',
    defaults: { is_active: true, sections: [] },
    columns: [
      { key: 'key', label: 'الرمز', kind: 'text', required: true, createOnly: true },
      { key: 'name_ar', label: 'النموذج', kind: 'text', required: true },
      { key: 'name_en', label: 'بالإنجليزية', kind: 'text', required: true },
      { key: 'sections', label: 'الأقسام (JSON)', kind: 'json', required: true, formOnly: true },
      { key: 'is_active', label: 'مفعّل', kind: 'boolean' },
    ],
  },
];

export function CatalogueSection() {
  const [table, setTable] = useState(SPECS[0]?.table ?? 'services');
  const spec = SPECS.find((candidate) => candidate.table === table) ?? (SPECS[0] as TableSpec);

  return (
    <>
      <PageHead
        title="الكتالوج"
        description="ما تبيعه هبّة وأين وبكم. كل تعديل يُسجَّل في سجل التدقيق."
      />
      <Tabs
        tabs={SPECS.map((entry) => ({ value: entry.table, label: entry.label }))}
        value={table}
        onChange={setTable}
      />
      <TableEditor key={spec.table} spec={spec} />
    </>
  );
}

function TableEditor({ spec }: { readonly spec: TableSpec }) {
  const state = useLoad(
    () => api.table<Row>(spec.table, { order: spec.order, ascending: true }),
    spec.table,
  );
  const refs = useRefs(spec);
  const [editing, setEditing] = useState<Row | 'new' | null>(null);
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);

  const listed = spec.columns.filter((column) => column.formOnly !== true);

  const remove = async (row: Row) => {
    if (!window.confirm('حذف هذا السجل؟ يُفضّل التعطيل إن كان مستخدماً.')) return;
    setError(null);
    try {
      await api.deleteRow(spec.table, { [spec.key]: row[spec.key] });
      toast('حُذف.');
      state.reload();
    } catch (cause) {
      setError(
        /foreign key|violates/i.test(cause instanceof Error ? cause.message : '')
          ? 'لا يمكن الحذف لأن سجلات أخرى تعتمد عليه — عطّله بدلاً من ذلك.'
          : explain(cause),
      );
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
      {error !== null ? (
        <p className="notice" data-tone="bad">
          {error}
        </p>
      ) : null}
      <Loadable state={state}>
        {(rows) => (
          <DataTable<Row>
            rows={rows}
            rowKey={(row) => String(row[spec.key])}
            onRowClick={(row) => setEditing(row)}
            empty="لا سجلات بعد."
            columns={[
              ...listed.map((column) => ({
                label: column.label,
                numeric: ['number', 'money', 'rate'].includes(column.kind),
                render: (row: Row) => display(column, row[column.key], refs),
              })),
              {
                label: '',
                render: (row: Row) => (
                  <span onClick={(event) => event.stopPropagation()}>
                    <Button size="small" tone="danger" onClick={() => void remove(row)}>
                      حذف
                    </Button>
                  </span>
                ),
              },
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
          onSaved={() => {
            setEditing(null);
            toast('حُفظ.');
            state.reload();
          }}
        />
      ) : null}
    </Card>
  );
}

type Refs = Readonly<Record<string, readonly { readonly value: string; readonly text: string }[]>>;

function useRefs(spec: TableSpec): Refs {
  const tables = useMemo(
    () => [
      ...new Set(
        spec.columns.flatMap((column) => (column.ref !== undefined ? [column.ref.table] : [])),
      ),
    ],
    [spec],
  );
  const state = useLoad(
    async () => {
      const entries = await Promise.all(
        tables.map(async (table) => {
          const column = spec.columns.find((candidate) => candidate.ref?.table === table);
          const labelKey = column?.ref?.label ?? 'name_ar';
          const valueKey = column?.ref?.value ?? 'id';
          const rows = await api.table<Row>(table, { columns: `${valueKey}, ${labelKey}` });
          return [
            table,
            rows.map((row) => ({ value: String(row[valueKey]), text: String(row[labelKey]) })),
          ] as const;
        }),
      );
      return Object.fromEntries(entries) as Refs;
    },
    `refs:${tables.join(',')}`,
  );
  return state.data ?? {};
}

function display(column: ColumnSpec, value: unknown, refs: Refs) {
  if (value === null || value === undefined || value === '')
    return <span className="muted">—</span>;
  switch (column.kind) {
    case 'boolean':
      return value === true ? <Badge tone="good">نعم</Badge> : <Badge>لا</Badge>;
    case 'money':
      return money(Number(value));
    case 'rate':
      return `${Math.round(Number(value) * 10_000) / 100}%`;
    case 'modes':
      return Array.isArray(value)
        ? value.map((mode) => MODE[String(mode)] ?? mode).join('، ')
        : String(value);
    case 'select': {
      const options =
        column.ref !== undefined ? (refs[column.ref.table] ?? []) : (column.options ?? []);
      return options.find((option) => option.value === String(value))?.text ?? String(value);
    }
    case 'json':
      return 'JSON';
    default:
      return String(value);
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
  readonly onSaved: () => void;
}) {
  const [values, setValues] = useState<Record<string, string | boolean | string[]>>(() => {
    const initial: Record<string, string | boolean | string[]> = {};
    for (const column of spec.columns) {
      const value = row !== null ? row[column.key] : spec.defaults?.[column.key];
      initial[column.key] = toInput(column, value);
    }
    return initial;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      onSaved();
    } catch (cause) {
      setError(explain(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={row === null ? `إضافة — ${spec.label}` : `تعديل — ${spec.label}`}
      onClose={onClose}
    >
      <form onSubmit={save} style={{ display: 'grid', gap: 'var(--space-md)' }}>
        {spec.columns.map((column) => {
          if (row !== null && column.createOnly === true) return null;
          const value = values[column.key];
          const set = (next: string | boolean | string[]) =>
            setValues({ ...values, [column.key]: next });
          const options =
            column.ref !== undefined ? (refs[column.ref.table] ?? []) : (column.options ?? []);
          return (
            <Field
              key={column.key}
              label={`${column.label}${column.required === true ? ' *' : ''}`}
              hint={column.hint}
            >
              {column.kind === 'boolean' ? (
                <input
                  type="checkbox"
                  checked={value === true}
                  onChange={(event) => set(event.target.checked)}
                />
              ) : column.kind === 'select' ? (
                <select
                  className="input"
                  value={String(value)}
                  onChange={(event) => set(event.target.value)}
                >
                  <option value="">{column.required === true ? '— اختر —' : '— لا شيء —'}</option>
                  {options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.text}
                    </option>
                  ))}
                </select>
              ) : column.kind === 'modes' ? (
                <span className="actions">
                  {Object.entries(MODE).map(([mode, text]) => {
                    const selected = Array.isArray(value) ? value : [];
                    return (
                      <label key={mode} className="actions" style={{ alignItems: 'center' }}>
                        <input
                          type="checkbox"
                          checked={selected.includes(mode)}
                          onChange={(event) =>
                            set(
                              event.target.checked
                                ? [...selected, mode]
                                : selected.filter((entry) => entry !== mode),
                            )
                          }
                        />
                        {text}
                      </label>
                    );
                  })}
                </span>
              ) : column.kind === 'longtext' || column.kind === 'json' ? (
                <textarea
                  className="input"
                  dir={column.kind === 'json' ? 'ltr' : undefined}
                  rows={column.kind === 'json' ? 10 : 3}
                  value={String(value)}
                  onChange={(event) => set(event.target.value)}
                />
              ) : (
                <input
                  className={`input${['number', 'money', 'rate', 'point'].includes(column.kind) ? ' numeric' : ''}`}
                  type={column.kind === 'date' ? 'date' : 'text'}
                  inputMode={
                    ['number', 'money', 'rate'].includes(column.kind) ? 'decimal' : undefined
                  }
                  value={String(value)}
                  onChange={(event) => set(event.target.value)}
                />
              )}
            </Field>
          );
        })}
        {error !== null ? (
          <p className="notice" data-tone="bad" style={{ margin: 0 }}>
            {error}
          </p>
        ) : null}
        <div className="actions">
          <Button type="submit" tone="primary" busy={busy}>
            حفظ
          </Button>
          <Button onClick={onClose}>تراجع</Button>
        </div>
      </form>
    </Dialog>
  );
}

function toInput(column: ColumnSpec, value: unknown): string | boolean | string[] {
  switch (column.kind) {
    case 'boolean':
      return value === true;
    case 'modes':
      return Array.isArray(value) ? value.map(String) : [];
    case 'json':
      return JSON.stringify(value ?? [], null, 2);
    case 'rate':
      return value === null || value === undefined
        ? ''
        : String(Math.round(Number(value) * 10_000) / 100);
    case 'point':
      return '';
    default:
      return value === null || value === undefined ? '' : String(value);
  }
}

/** undefined: leave the column out. null: write null. */
function fromInput(column: ColumnSpec, value: string | boolean | string[] | undefined): unknown {
  if (value === undefined) return undefined;
  switch (column.kind) {
    case 'boolean':
      return value === true;
    case 'modes':
      return Array.isArray(value) && value.length > 0 ? value : null;
    case 'json': {
      try {
        return JSON.parse(String(value)) as unknown;
      } catch {
        throw new Error(`«${column.label}»: JSON غير صالح.`);
      }
    }
    case 'point': {
      const text = String(value).trim();
      if (text === '') return null;
      const [lat, lon] = text.split(/[,\s]+/).map(Number);
      if (
        lat === undefined ||
        lon === undefined ||
        !Number.isFinite(lat) ||
        !Number.isFinite(lon)
      ) {
        throw new Error(`«${column.label}»: اكتب خط العرض ثم خط الطول.`);
      }
      return `SRID=4326;POINT(${lon} ${lat})`;
    }
    default: {
      const text = String(value).trim();
      if (text === '') return null;
      if (column.kind === 'number' || column.kind === 'money') {
        const number = Number(text);
        if (!Number.isFinite(number)) throw new Error(`«${column.label}» يجب أن يكون رقماً.`);
        return number;
      }
      if (column.kind === 'rate') {
        const number = Number(text);
        if (!Number.isFinite(number) || number < 0 || number > 100) {
          throw new Error(`«${column.label}» نسبة بين 0 و100.`);
        }
        return Math.round(number * 100) / 10_000;
      }
      return text;
    }
  }
}
