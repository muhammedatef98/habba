/**
 * البيانات المرجعية — cities, makes and models.
 *
 * ⚠️ These are the only tables in the product whose absence is SILENT.
 *
 * A missing service shows an operator a short menu and somebody notices. A
 * missing make shows a customer a picker their car is not in — and because
 * `vehicles.model_id` is not nullable, they cannot add the vehicle at all. No
 * vehicle means no logbook, and the logbook is the product (§1). They do not
 * file a bug; they close the app. Until this screen existed the only way to add
 * a make was psql against production, which made the answer to "my car isn't
 * listed" a deployment.
 *
 * Cities gate the same thing one level up: `providers.city_id` is not
 * nullable, so a city that does not exist is a region Habba cannot onboard
 * anybody in.
 *
 * **Nothing deletes, and nothing here can.** 0006 declares `on delete
 * restrict` on `vehicle_models.make_id`, and `vehicles.model_id` and
 * `providers.city_id` are foreign keys too. Deactivating takes a row off the
 * customer's picker — every mobile read filters `is_active` — and leaves every
 * vehicle that already names it standing, with its logbook intact.
 *
 * **On the coordinate.** `cities.centroid` is `not null` and, today, read by
 * nothing: matching measures from the provider's own location to the order's,
 * never from a city's centre. The form says exactly that instead of implying
 * the number steers dispatch, because an operator who believed it did would
 * hesitate over a city they could not place precisely — and the honest answer
 * is that an approximate centre is fine.
 */

'use client';

import { useCallback, useEffect, useState } from 'react';
import { opsRepository } from '@/data/ops-repository';
import type { CityRow, VehicleMakeRow, VehicleModelRow } from '@/data/types';

type Tab = 'cities' | 'makes' | 'models';

const TABS: readonly { readonly id: Tab; readonly label: string }[] = [
  { id: 'cities', label: 'المدن' },
  { id: 'makes', label: 'الماركات' },
  { id: 'models', label: 'الموديلات' },
];

const BODY_TYPES: readonly { readonly value: string; readonly label: string }[] = [
  { value: '', label: 'غير محدّد' },
  { value: 'sedan', label: 'سيدان' },
  { value: 'suv', label: 'دفع رباعي' },
  { value: 'pickup', label: 'ونيت' },
  { value: 'van', label: 'فان' },
];

export function ReferenceData() {
  const [tab, setTab] = useState<Tab>('cities');
  const [cities, setCities] = useState<readonly CityRow[] | null>(null);
  const [makes, setMakes] = useState<readonly VehicleMakeRow[] | null>(null);
  const [models, setModels] = useState<readonly VehicleModelRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [c, mk, md] = await Promise.all([
        opsRepository.listCities(),
        opsRepository.listMakes(),
        opsRepository.listModels(),
      ]);
      setCities(c);
      setMakes(mk);
      setModels(md);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'تعذّر تحميل البيانات المرجعية');
      setCities([]);
      setMakes([]);
      setModels([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** One wrapper so every write reports the same way and always reloads. */
  const run = useCallback(
    async (action: () => Promise<void>, success: string) => {
      setBusy(true);
      setError(null);
      try {
        await action();
        setNotice(success);
        await load();
        return true;
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'تعذّرت العملية');
        return false;
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  return (
    <section>
      <header style={{ marginBottom: 'var(--space-base)' }}>
        <h1 style={{ fontSize: 'var(--text-xl)', margin: 0 }}>البيانات المرجعية</h1>
        <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
          القوائم التي يختار منها العميل قبل أن يستطيع استخدام أي شيء آخر. ماركة ناقصة تعني عميلاً
          لا يستطيع إضافة سيارته أصلاً — ولا يفتح له دفتر سيارة.
        </p>
      </header>

      <div
        role="tablist"
        style={{ display: 'flex', gap: 'var(--space-sm)', marginBottom: 'var(--space-base)' }}
      >
        {TABS.map((entry) => (
          <button
            key={entry.id}
            role="tab"
            aria-selected={tab === entry.id}
            data-testid={`ref-tab-${entry.id}`}
            onClick={() => {
              setTab(entry.id);
              setError(null);
              setNotice(null);
            }}
            style={{
              ...controlStyle,
              fontWeight: 600,
              background: tab === entry.id ? 'var(--color-primary)' : 'transparent',
              color: tab === entry.id ? 'var(--color-primary-text)' : 'var(--color-text)',
              border: tab === entry.id ? 'none' : '1px solid var(--color-border-strong)',
            }}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {error !== null ? <Banner tone="emergency" text={error} /> : null}
      {notice !== null ? <Banner tone="success" text={notice} /> : null}

      {tab === 'cities' ? (
        <Cities rows={cities} busy={busy} run={run} />
      ) : tab === 'makes' ? (
        <Makes rows={makes} busy={busy} run={run} />
      ) : (
        <Models rows={models} makes={makes ?? []} busy={busy} run={run} />
      )}
    </section>
  );
}

type Run = (action: () => Promise<void>, success: string) => Promise<boolean>;

// المدن ---------------------------------------------------------------------

function Cities({
  rows,
  busy,
  run,
}: {
  readonly rows: readonly CityRow[] | null;
  readonly busy: boolean;
  readonly run: Run;
}) {
  const [form, setForm] = useState({
    nameAr: '',
    nameEn: '',
    regionAr: '',
    regionEn: '',
    lat: '',
    lng: '',
  });

  const lat = Number(form.lat);
  const lng = Number(form.lng);
  const coordsOk =
    form.lat.trim() !== '' &&
    form.lng.trim() !== '' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180;

  const complete =
    form.nameAr.trim() !== '' &&
    form.nameEn.trim() !== '' &&
    form.regionAr.trim() !== '' &&
    form.regionEn.trim() !== '' &&
    coordsOk;

  async function add() {
    const ok = await run(
      () =>
        opsRepository.createCity({
          nameAr: form.nameAr.trim(),
          nameEn: form.nameEn.trim(),
          regionAr: form.regionAr.trim(),
          regionEn: form.regionEn.trim(),
          lat,
          lng,
        }),
      'أُضيفت المدينة.',
    );
    if (ok) setForm({ nameAr: '', nameEn: '', regionAr: '', regionEn: '', lat: '', lng: '' });
  }

  return (
    <>
      <AddBox title="أضف مدينة" onAdd={() => void add()} disabled={!complete || busy}>
        <Field label="الاسم بالعربية">
          <input
            data-testid="city-name-ar"
            value={form.nameAr}
            onChange={(event) => setForm({ ...form, nameAr: event.target.value })}
            style={controlStyle}
          />
        </Field>
        <Field label="الاسم بالإنجليزية">
          <input
            data-testid="city-name-en"
            value={form.nameEn}
            onChange={(event) => setForm({ ...form, nameEn: event.target.value })}
            dir="ltr"
            style={controlStyle}
          />
        </Field>
        <Field label="المنطقة بالعربية">
          <input
            data-testid="city-region-ar"
            value={form.regionAr}
            onChange={(event) => setForm({ ...form, regionAr: event.target.value })}
            style={controlStyle}
          />
        </Field>
        <Field label="المنطقة بالإنجليزية">
          <input
            data-testid="city-region-en"
            value={form.regionEn}
            onChange={(event) => setForm({ ...form, regionEn: event.target.value })}
            dir="ltr"
            style={controlStyle}
          />
        </Field>
        <Field label="خط العرض (lat)">
          <input
            data-testid="city-lat"
            value={form.lat}
            onChange={(event) => setForm({ ...form, lat: event.target.value })}
            dir="ltr"
            inputMode="decimal"
            placeholder="24.7136"
            style={controlStyle}
          />
        </Field>
        <Field label="خط الطول (lng)">
          <input
            data-testid="city-lng"
            value={form.lng}
            onChange={(event) => setForm({ ...form, lng: event.target.value })}
            dir="ltr"
            inputMode="decimal"
            placeholder="46.6753"
            style={controlStyle}
          />
        </Field>
      </AddBox>

      {/* The honest note. See the header of this file. */}
      <p
        style={{
          color: 'var(--color-text-muted)',
          fontSize: 'var(--text-xs)',
          marginTop: 0,
          marginBottom: 'var(--space-base)',
        }}
      >
        الإحداثيات مركز تقريبي للمدينة فقط. التوزيع على الفنّيين يقيس من موقع الفنّي إلى موقع
        العميل، لا من مركز المدينة — فمركز تقريبي كافٍ ولا يؤثّر على من يصل للطلب.
      </p>

      <Rows
        rows={rows}
        empty="لا توجد مدن."
        render={(city) => (
          <Card key={city.id} active={city.isActive}>
            <Head
              title={`${city.nameAr} — ${city.regionAr}`}
              active={city.isActive}
              onToggle={() =>
                void run(
                  () => opsRepository.setCityActive(city.id, !city.isActive),
                  city.isActive ? 'أُخفيت المدينة.' : 'عادت المدينة.',
                )
              }
              busy={busy}
            />
            <Meta>
              <span dir="ltr">
                {city.nameEn} · {city.lat.toFixed(4)}, {city.lng.toFixed(4)}
              </span>
            </Meta>
          </Card>
        )}
      />
    </>
  );
}

// الماركات -------------------------------------------------------------------

function Makes({
  rows,
  busy,
  run,
}: {
  readonly rows: readonly VehicleMakeRow[] | null;
  readonly busy: boolean;
  readonly run: Run;
}) {
  const [form, setForm] = useState({ nameAr: '', nameEn: '', sortOrder: '' });

  const order = form.sortOrder.trim() === '' ? 0 : Number(form.sortOrder);
  const complete =
    form.nameAr.trim() !== '' && form.nameEn.trim() !== '' && Number.isInteger(order);

  async function add() {
    const ok = await run(
      () => opsRepository.createMake(form.nameAr.trim(), form.nameEn.trim(), order),
      'أُضيفت الماركة. أضف لها موديلاً واحداً على الأقل حتى يستطيع العميل اختيارها.',
    );
    if (ok) setForm({ nameAr: '', nameEn: '', sortOrder: '' });
  }

  return (
    <>
      <AddBox title="أضف ماركة" onAdd={() => void add()} disabled={!complete || busy}>
        <Field label="الاسم بالعربية">
          <input
            data-testid="make-name-ar"
            value={form.nameAr}
            onChange={(event) => setForm({ ...form, nameAr: event.target.value })}
            style={controlStyle}
          />
        </Field>
        <Field label="الاسم بالإنجليزية">
          <input
            data-testid="make-name-en"
            value={form.nameEn}
            onChange={(event) => setForm({ ...form, nameEn: event.target.value })}
            dir="ltr"
            style={controlStyle}
          />
        </Field>
        <Field label="الترتيب">
          <input
            value={form.sortOrder}
            onChange={(event) => setForm({ ...form, sortOrder: event.target.value })}
            dir="ltr"
            inputMode="numeric"
            placeholder="0"
            style={controlStyle}
          />
        </Field>
      </AddBox>

      <Rows
        rows={rows}
        empty="لا توجد ماركات."
        render={(make) => (
          <Card key={make.id} active={make.isActive}>
            <Head
              title={make.nameAr}
              active={make.isActive}
              onToggle={() =>
                void run(
                  () => opsRepository.setMakeActive(make.id, !make.isActive),
                  make.isActive ? 'أُخفيت الماركة عن العملاء.' : 'عادت الماركة.',
                )
              }
              busy={busy}
            />
            <Meta>
              <span dir="ltr">{make.nameEn}</span>
              {' · '}
              {/* ⚠️ A make with no models is invisible to a customer even while
                  it is active: the picker asks for a model next, and there is
                  nothing to pick. Saying so here is the difference between an
                  operator adding a make and an operator adding a make that
                  works. */}
              {make.modelCount === 0 ? (
                <span style={{ color: 'var(--color-emergency-fg)', fontWeight: 600 }}>
                  لا موديلات — لن يستطيع العميل اختيارها
                </span>
              ) : (
                `${make.modelCount} موديل`
              )}
              {' · '}
              <span dir="ltr">ترتيب {make.sortOrder}</span>
            </Meta>
          </Card>
        )}
      />
    </>
  );
}

// الموديلات ------------------------------------------------------------------

function Models({
  rows,
  makes,
  busy,
  run,
}: {
  readonly rows: readonly VehicleModelRow[] | null;
  readonly makes: readonly VehicleMakeRow[];
  readonly busy: boolean;
  readonly run: Run;
}) {
  const [form, setForm] = useState({
    makeId: '',
    nameAr: '',
    nameEn: '',
    yearFrom: '',
    yearTo: '',
    bodyType: '',
  });

  const yearFrom = Number(form.yearFrom);
  const yearTo = form.yearTo.trim() === '' ? null : Number(form.yearTo);

  // Mirrors 0006's two CHECKs, so an operator is told before they submit
  // rather than by a constraint error afterwards.
  const yearsOk =
    Number.isInteger(yearFrom) &&
    yearFrom >= 1900 &&
    yearFrom <= 2200 &&
    (yearTo === null || (Number.isInteger(yearTo) && yearTo >= yearFrom));

  const complete =
    form.makeId !== '' && form.nameAr.trim() !== '' && form.nameEn.trim() !== '' && yearsOk;

  const makeName = (id: string) => makes.find((make) => make.id === id)?.nameAr ?? id;

  async function add() {
    const ok = await run(
      () =>
        opsRepository.createModel({
          makeId: form.makeId,
          nameAr: form.nameAr.trim(),
          nameEn: form.nameEn.trim(),
          yearFrom,
          yearTo,
          bodyType: form.bodyType === '' ? null : form.bodyType,
        }),
      'أُضيف الموديل.',
    );
    if (ok) {
      setForm({ ...form, nameAr: '', nameEn: '', yearFrom: '', yearTo: '', bodyType: '' });
    }
  }

  return (
    <>
      <AddBox title="أضف موديلاً" onAdd={() => void add()} disabled={!complete || busy}>
        <Field label="الماركة">
          <select
            data-testid="model-make"
            value={form.makeId}
            onChange={(event) => setForm({ ...form, makeId: event.target.value })}
            style={controlStyle}
          >
            <option value="">اختر…</option>
            {makes.map((make) => (
              <option key={make.id} value={make.id}>
                {make.nameAr}
              </option>
            ))}
          </select>
        </Field>
        <Field label="الاسم بالعربية">
          <input
            data-testid="model-name-ar"
            value={form.nameAr}
            onChange={(event) => setForm({ ...form, nameAr: event.target.value })}
            style={controlStyle}
          />
        </Field>
        <Field label="الاسم بالإنجليزية">
          <input
            data-testid="model-name-en"
            value={form.nameEn}
            onChange={(event) => setForm({ ...form, nameEn: event.target.value })}
            dir="ltr"
            style={controlStyle}
          />
        </Field>
        <Field label="من سنة">
          <input
            data-testid="model-year-from"
            value={form.yearFrom}
            onChange={(event) => setForm({ ...form, yearFrom: event.target.value })}
            dir="ltr"
            inputMode="numeric"
            placeholder="2015"
            style={controlStyle}
          />
        </Field>
        <Field label="إلى سنة (فارغ = ما زال يُنتج)">
          <input
            data-testid="model-year-to"
            value={form.yearTo}
            onChange={(event) => setForm({ ...form, yearTo: event.target.value })}
            dir="ltr"
            inputMode="numeric"
            style={controlStyle}
          />
        </Field>
        <Field label="الهيكل">
          <select
            value={form.bodyType}
            onChange={(event) => setForm({ ...form, bodyType: event.target.value })}
            style={controlStyle}
          >
            {BODY_TYPES.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </select>
        </Field>
      </AddBox>

      <Rows
        rows={rows}
        empty="لا توجد موديلات."
        render={(model) => (
          <Card key={model.id} active={model.isActive}>
            <Head
              title={`${makeName(model.makeId)} ${model.nameAr}`}
              active={model.isActive}
              onToggle={() =>
                void run(
                  () => opsRepository.setModelActive(model.id, !model.isActive),
                  model.isActive ? 'أُخفي الموديل عن العملاء.' : 'عاد الموديل.',
                )
              }
              busy={busy}
            />
            <Meta>
              <span dir="ltr">{model.nameEn}</span>
              {' · '}
              <span dir="ltr">
                {model.yearFrom}–{model.yearTo ?? 'الآن'}
              </span>
              {model.bodyType !== null
                ? ` · ${BODY_TYPES.find((type) => type.value === model.bodyType)?.label ?? model.bodyType}`
                : ''}
            </Meta>
          </Card>
        )}
      />
    </>
  );
}

// Shared pieces ---------------------------------------------------------------

const controlStyle = {
  padding: 'var(--space-sm) var(--space-md)',
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--color-border-strong)',
  background: 'var(--color-surface)',
  color: 'var(--color-text)',
  fontSize: 'var(--text-sm)',
  minHeight: 44,
} as const;

function AddBox({
  title,
  onAdd,
  disabled,
  children,
}: {
  readonly title: string;
  readonly onAdd: () => void;
  readonly disabled: boolean;
  readonly children: React.ReactNode;
}) {
  return (
    <div
      style={{
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)',
        padding: 'var(--space-base)',
        marginBottom: 'var(--space-base)',
        background: 'var(--color-surface)',
      }}
    >
      <h2 style={{ fontSize: 'var(--text-base)', margin: 0, marginBottom: 'var(--space-sm)' }}>
        {title}
      </h2>
      <div
        style={{
          display: 'flex',
          gap: 'var(--space-md)',
          flexWrap: 'wrap',
          alignItems: 'flex-end',
        }}
      >
        {children}
        <button
          data-testid="ref-add"
          onClick={onAdd}
          disabled={disabled}
          style={{
            ...controlStyle,
            border: 'none',
            fontWeight: 600,
            background: disabled ? 'var(--color-surface-sunken)' : 'var(--color-primary)',
            color: disabled ? 'var(--color-text-subtle)' : 'var(--color-primary-text)',
            cursor: disabled ? 'default' : 'pointer',
          }}
        >
          أضف
        </button>
      </div>
    </div>
  );
}

function Rows<T>({
  rows,
  empty,
  render,
}: {
  readonly rows: readonly T[] | null;
  readonly empty: string;
  readonly render: (row: T) => React.ReactNode;
}) {
  if (rows === null) return <p style={{ color: 'var(--color-text-muted)' }}>جارٍ التحميل…</p>;
  if (rows.length === 0) return <p style={{ color: 'var(--color-text-muted)' }}>{empty}</p>;
  return <div style={{ display: 'grid', gap: 'var(--space-sm)' }}>{rows.map(render)}</div>;
}

function Card({
  active,
  children,
}: {
  readonly active: boolean;
  readonly children: React.ReactNode;
}) {
  return (
    <article
      style={{
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        padding: 'var(--space-md)',
        // Dimmed, not hidden: finding a row somebody retired is the reason ops
        // can see inactive rows at all.
        background: active ? 'var(--color-surface)' : 'var(--color-surface-sunken)',
        display: 'grid',
        gap: 4,
      }}
    >
      {children}
    </article>
  );
}

function Head({
  title,
  active,
  onToggle,
  busy,
}: {
  readonly title: string;
  readonly active: boolean;
  readonly onToggle: () => void;
  readonly busy: boolean;
}) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: 'var(--space-md)',
        flexWrap: 'wrap',
        alignItems: 'center',
      }}
    >
      <strong style={{ fontSize: 'var(--text-sm)' }}>{title}</strong>
      <button
        onClick={onToggle}
        disabled={busy}
        style={{
          ...controlStyle,
          minHeight: 36,
          background: 'transparent',
          border: 'none',
          fontWeight: 600,
          color: active ? 'var(--color-text-muted)' : 'var(--color-success-fg)',
        }}
      >
        {active ? 'أخفِ عن العملاء' : 'أعد العرض'}
      </button>
    </div>
  );
}

function Meta({ children }: { readonly children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>{children}</div>
  );
}

function Field({
  label,
  children,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
}) {
  return (
    <label style={{ display: 'grid', gap: 4 }}>
      <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>{label}</span>
      {children}
    </label>
  );
}

function Banner({ tone, text }: { readonly tone: 'emergency' | 'success'; readonly text: string }) {
  return (
    <p
      role="alert"
      style={{
        padding: 'var(--space-md)',
        borderRadius: 'var(--radius-md)',
        marginBottom: 'var(--space-base)',
        background: `var(--color-${tone}-subtle)`,
        color: `var(--color-${tone}-fg)`,
        fontSize: 'var(--text-sm)',
      }}
    >
      {text}
    </p>
  );
}
