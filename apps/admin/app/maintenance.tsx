/**
 * قواعد الصيانة — what Habba is allowed to predict about a customer's car.
 *
 * This is the engine behind §1's fourth differentiator: "your timing belt is
 * due in ~1,400 km", the thing that turns a one-off emergency user into a
 * recurring one. The rules have existed since 0028 and the scan since 0029; no
 * human could read or change either.
 *
 * Two things about this table are invisible from a row, and both decide
 * whether a rule does anything at all.
 *
 * **⚠️ Only one rule per service ever fires.** `applicable_rules` (0029) is
 * `distinct on (service_id)`, ordered model-rule, then make-rule, then generic,
 * then by `created_at`. So a second rule at the same specificity for the same
 * service NEVER runs — and being newer does not help it, it hurts: the older
 * row wins the tiebreak. An operator who "corrects" an interval by adding a
 * rule next to the old one has changed nothing, and nothing would have told
 * them. This screen marks every shadowed rule and says which row beat it.
 *
 * **⚠️ `confidence` is a truth claim, not a label.** 0028 says a generic
 * interval must not masquerade as manufacturer guidance, and the value changes
 * what the alert is permitted to say. Marking an invented interval `oem` makes
 * Habba tell somebody their manufacturer requires work no manufacturer asked
 * for — so the form states that where the choice is made, not in a doc.
 *
 * Nothing deletes. `maintenance_alerts.rule_id` is `on delete cascade` (0028),
 * so removing a rule would erase every alert it ever raised, including the ones
 * a customer acted on — which §1 counts as part of the logbook.
 */

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { opsRepository } from '@/data/ops-repository';
// The shadowing rule lives in `src/lib` and is unit-tested against 0029's
// ORDER BY. This screen draws a red border from it; see the notes there for
// what it deliberately does not report.
import { shadowedRules } from '@/lib/maintenance-shadow';
import type {
  MaintenanceConfidence,
  MaintenanceRuleRow,
  ServiceRow,
  VehicleMakeRow,
  VehicleModelRow,
} from '@/data/types';

const CONFIDENCE_LABEL: Readonly<Record<MaintenanceConfidence, string>> = {
  generic: 'تقديري (متعارف عليه)',
  oem: 'من الشركة المصنّعة',
};

export function MaintenanceRules() {
  const [rules, setRules] = useState<readonly MaintenanceRuleRow[] | null>(null);
  const [services, setServices] = useState<readonly ServiceRow[]>([]);
  const [makes, setMakes] = useState<readonly VehicleMakeRow[]>([]);
  const [models, setModels] = useState<readonly VehicleModelRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [form, setForm] = useState({
    serviceId: '',
    makeId: '',
    modelId: '',
    nameAr: '',
    nameEn: '',
    dueEveryKm: '',
    dueEveryMonths: '',
    firstDueKm: '',
    confidence: 'generic' as MaintenanceConfidence,
  });

  const load = useCallback(async () => {
    try {
      const [r, s, mk, md] = await Promise.all([
        opsRepository.listMaintenanceRules(),
        opsRepository.listServices(),
        opsRepository.listMakes(),
        opsRepository.listModels(),
      ]);
      setRules(r);
      setServices(s);
      setMakes(mk);
      setModels(md);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'تعذّر تحميل القواعد');
      setRules([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const shadowed = useMemo(() => shadowedRules(rules ?? []), [rules]);

  const asInt = (raw: string): number | null => {
    const trimmed = raw.trim();
    if (trimmed === '') return null;
    const value = Number(trimmed);
    return Number.isInteger(value) && value > 0 ? value : Number.NaN;
  };

  const km = asInt(form.dueEveryKm);
  const months = asInt(form.dueEveryMonths);
  const firstKm = asInt(form.firstDueKm);

  const numbersOk = !Number.isNaN(km) && !Number.isNaN(months) && !Number.isNaN(firstKm);
  // `maintenance_rules_has_interval`: with neither figure the rule can never
  // fire. Blocked here so an operator is told what is wrong rather than shown
  // a constraint name.
  const hasInterval = km !== null || months !== null;
  const complete =
    form.serviceId !== '' &&
    form.nameAr.trim() !== '' &&
    form.nameEn.trim() !== '' &&
    numbersOk &&
    hasInterval;

  // What the rule being typed would compete with, shown before it is created —
  // the whole point being that afterwards nothing would say so.
  const wouldBeShadowed = useMemo(() => {
    if (form.serviceId === '' || rules === null) return null;
    return (
      rules.find(
        (rule) =>
          rule.isActive &&
          rule.serviceId === form.serviceId &&
          (rule.makeId ?? '') === form.makeId &&
          (rule.modelId ?? '') === form.modelId,
      ) ?? null
    );
  }, [form.serviceId, form.makeId, form.modelId, rules]);

  async function add() {
    setBusy(true);
    setError(null);
    try {
      await opsRepository.createMaintenanceRule({
        serviceId: form.serviceId,
        makeId: form.makeId === '' ? null : form.makeId,
        modelId: form.modelId === '' ? null : form.modelId,
        nameAr: form.nameAr.trim(),
        nameEn: form.nameEn.trim(),
        dueEveryKm: km,
        dueEveryMonths: months,
        firstDueKm: firstKm,
        confidence: form.confidence,
      });
      setNotice('أُضيفت القاعدة. تسري على الفحص التالي.');
      setForm({
        ...form,
        nameAr: '',
        nameEn: '',
        dueEveryKm: '',
        dueEveryMonths: '',
        firstDueKm: '',
      });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'تعذّر إنشاء القاعدة');
    } finally {
      setBusy(false);
    }
  }

  async function toggle(rule: MaintenanceRuleRow) {
    setBusy(true);
    setError(null);
    try {
      await opsRepository.setMaintenanceRuleActive(rule.id, !rule.isActive);
      setNotice(
        rule.isActive
          ? 'أُوقفت القاعدة. التنبيهات السابقة كما هي.'
          : 'عادت القاعدة للعمل من الفحص التالي.',
      );
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'تعذّر تغيير حالة القاعدة');
    } finally {
      setBusy(false);
    }
  }

  const scopeLabel = (rule: MaintenanceRuleRow): string => {
    if (rule.modelId !== null) {
      const model = models.find((row) => row.id === rule.modelId);
      const make = makes.find((row) => row.id === rule.makeId);
      return `${make?.nameAr ?? ''} ${model?.nameAr ?? rule.modelId}`.trim();
    }
    if (rule.makeId !== null) {
      return makes.find((row) => row.id === rule.makeId)?.nameAr ?? rule.makeId;
    }
    return 'كل السيارات';
  };

  const modelsOfMake = models.filter((model) => model.makeId === form.makeId);

  return (
    <section>
      <header style={{ marginBottom: 'var(--space-base)' }}>
        <h1 style={{ fontSize: 'var(--text-xl)', margin: 0 }}>قواعد الصيانة</h1>
        <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
          ما يحقّ للتطبيق أن يتوقّعه عن سيارة العميل. لكل خدمة تعمل قاعدة واحدة فقط: الأخصّ، ثم
          الأقدم. أي قاعدة أخرى بنفس النطاق لا تعمل أبداً.
        </p>
      </header>

      {error !== null ? <Banner tone="emergency" text={error} /> : null}
      {notice !== null ? <Banner tone="success" text={notice} /> : null}

      {/* Add a rule ------------------------------------------------------ */}
      <div
        style={{
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-lg)',
          padding: 'var(--space-base)',
          marginBottom: 'var(--space-lg)',
          background: 'var(--color-surface)',
        }}
      >
        <h2 style={{ fontSize: 'var(--text-base)', margin: 0, marginBottom: 'var(--space-sm)' }}>
          أضف قاعدة
        </h2>

        <div
          style={{
            display: 'flex',
            gap: 'var(--space-md)',
            flexWrap: 'wrap',
            alignItems: 'flex-end',
          }}
        >
          <Field label="الخدمة">
            <select
              data-testid="rule-service"
              value={form.serviceId}
              onChange={(event) => setForm({ ...form, serviceId: event.target.value })}
              style={controlStyle}
            >
              <option value="">اختر…</option>
              {services.map((service) => (
                <option key={service.id} value={service.id}>
                  {service.nameAr}
                </option>
              ))}
            </select>
          </Field>

          <Field label="الماركة (فارغ = كل السيارات)">
            <select
              data-testid="rule-make"
              value={form.makeId}
              onChange={(event) =>
                // ⚠️ Clearing the model with the make is not tidiness. 0028's
                // `maintenance_rules_model_needs_make` refuses a model without
                // its make, and a model left behind from a previous make would
                // be a rule about a car that does not exist.
                setForm({ ...form, makeId: event.target.value, modelId: '' })
              }
              style={controlStyle}
            >
              <option value="">كل السيارات</option>
              {makes.map((make) => (
                <option key={make.id} value={make.id}>
                  {make.nameAr}
                </option>
              ))}
            </select>
          </Field>

          <Field label="الموديل (اختياري)">
            <select
              data-testid="rule-model"
              value={form.modelId}
              onChange={(event) => setForm({ ...form, modelId: event.target.value })}
              disabled={form.makeId === ''}
              style={controlStyle}
            >
              <option value="">كل موديلات الماركة</option>
              {modelsOfMake.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.nameAr}
                </option>
              ))}
            </select>
          </Field>

          <Field label="الاسم بالعربية">
            <input
              data-testid="rule-name-ar"
              value={form.nameAr}
              onChange={(event) => setForm({ ...form, nameAr: event.target.value })}
              style={controlStyle}
            />
          </Field>

          <Field label="الاسم بالإنجليزية">
            <input
              data-testid="rule-name-en"
              value={form.nameEn}
              onChange={(event) => setForm({ ...form, nameEn: event.target.value })}
              dir="ltr"
              style={controlStyle}
            />
          </Field>

          <Field label="كل كم كيلومتر">
            <input
              data-testid="rule-km"
              value={form.dueEveryKm}
              onChange={(event) => setForm({ ...form, dueEveryKm: event.target.value })}
              dir="ltr"
              inputMode="numeric"
              placeholder="10000"
              style={controlStyle}
            />
          </Field>

          <Field label="كل كم شهر">
            <input
              data-testid="rule-months"
              value={form.dueEveryMonths}
              onChange={(event) => setForm({ ...form, dueEveryMonths: event.target.value })}
              dir="ltr"
              inputMode="numeric"
              placeholder="6"
              style={controlStyle}
            />
          </Field>

          <Field label="أول مرة عند (اختياري)">
            <input
              data-testid="rule-first-km"
              value={form.firstDueKm}
              onChange={(event) => setForm({ ...form, firstDueKm: event.target.value })}
              dir="ltr"
              inputMode="numeric"
              placeholder="90000"
              style={controlStyle}
            />
          </Field>

          <Field label="مصدر المدّة">
            <select
              data-testid="rule-confidence"
              value={form.confidence}
              onChange={(event) =>
                setForm({ ...form, confidence: event.target.value as MaintenanceConfidence })
              }
              style={controlStyle}
            >
              <option value="generic">{CONFIDENCE_LABEL.generic}</option>
              <option value="oem">{CONFIDENCE_LABEL.oem}</option>
            </select>
          </Field>

          <button
            data-testid="rule-add"
            onClick={() => void add()}
            disabled={!complete || busy}
            style={{
              ...controlStyle,
              border: 'none',
              fontWeight: 600,
              background:
                !complete || busy ? 'var(--color-surface-sunken)' : 'var(--color-primary)',
              color: !complete || busy ? 'var(--color-text-subtle)' : 'var(--color-primary-text)',
              cursor: !complete || busy ? 'default' : 'pointer',
            }}
          >
            أضف
          </button>
        </div>

        {/* The two warnings that make this screen worth having. */}
        {form.serviceId !== '' && !hasInterval ? (
          <Note testId="rule-no-interval" tone="emergency">
            لا بدّ من مدّة: بالكيلومترات أو بالأشهر أو بكليهما. قاعدة بلا مدّة لا تُنبّه أحداً
            أبداً.
          </Note>
        ) : null}

        {form.confidence === 'oem' ? (
          <Note testId="rule-oem-warning" tone="emergency">
            «من الشركة المصنّعة» يغيّر ما يقوله التنبيه للعميل. لا تختره إلا إذا كانت المدّة من دليل
            الصيانة فعلاً — وإلا فالتطبيق يخبر صاحب السيارة أن المصنّع يطلب عملاً لم يطلبه.
          </Note>
        ) : null}

        {wouldBeShadowed !== null ? (
          <Note testId="rule-would-shadow" tone="emergency">
            توجد قاعدة فعّالة بنفس الخدمة والنطاق: «{wouldBeShadowed.nameAr}». القاعدة الجديدة لن
            تعمل أبداً — الأقدم تفوز. أوقف القديمة أولاً إن كنت تصحّحها.
          </Note>
        ) : null}
      </div>

      {/* The rules ------------------------------------------------------- */}
      {rules === null ? (
        <p style={{ color: 'var(--color-text-muted)' }}>جارٍ التحميل…</p>
      ) : rules.length === 0 ? (
        <p style={{ color: 'var(--color-text-muted)' }}>لا توجد قواعد.</p>
      ) : (
        <div style={{ display: 'grid', gap: 'var(--space-sm)' }}>
          {rules.map((rule) => {
            const beatenBy = shadowed.get(rule.id);
            return (
              <article
                key={rule.id}
                data-testid={`rule-${rule.id}`}
                style={{
                  border:
                    beatenBy !== undefined
                      ? '1px solid var(--color-emergency-fg)'
                      : '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)',
                  padding: 'var(--space-md)',
                  background: rule.isActive
                    ? 'var(--color-surface)'
                    : 'var(--color-surface-sunken)',
                  display: 'grid',
                  gap: 4,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 'var(--space-md)',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                  }}
                >
                  <strong style={{ fontSize: 'var(--text-sm)' }}>{rule.nameAr}</strong>
                  <button
                    onClick={() => void toggle(rule)}
                    disabled={busy}
                    style={{
                      ...controlStyle,
                      minHeight: 36,
                      background: 'transparent',
                      border: 'none',
                      fontWeight: 600,
                      color: rule.isActive ? 'var(--color-text-muted)' : 'var(--color-success-fg)',
                    }}
                  >
                    {rule.isActive ? 'أوقف' : 'فعّل'}
                  </button>
                </div>

                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                  {rule.serviceNameAr} · {scopeLabel(rule)} ·{' '}
                  <span
                    style={{
                      fontWeight: 600,
                      color:
                        rule.confidence === 'oem' ? 'var(--color-text)' : 'var(--color-text-muted)',
                    }}
                  >
                    {CONFIDENCE_LABEL[rule.confidence]}
                  </span>
                </div>

                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                  {rule.dueEveryKm !== null ? (
                    <span dir="ltr">{rule.dueEveryKm.toLocaleString('en')} km</span>
                  ) : null}
                  {rule.dueEveryKm !== null && rule.dueEveryMonths !== null ? ' أو ' : ''}
                  {rule.dueEveryMonths !== null ? `${rule.dueEveryMonths} شهر` : ''}
                  {rule.firstDueKm !== null ? (
                    <>
                      {' · أول مرة عند '}
                      <span dir="ltr">{rule.firstDueKm.toLocaleString('en')} km</span>
                    </>
                  ) : null}
                </div>

                {/* ⚠️ The finding this screen exists for. */}
                {beatenBy !== undefined ? (
                  <div
                    data-testid="rule-shadowed"
                    style={{
                      fontSize: 'var(--text-xs)',
                      color: 'var(--color-emergency-fg)',
                      fontWeight: 600,
                    }}
                  >
                    لا تعمل: «{beatenBy}» تسبقها بنفس النطاق وتفوز عليها.
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

const controlStyle = {
  padding: 'var(--space-sm) var(--space-md)',
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--color-border-strong)',
  background: 'var(--color-surface)',
  color: 'var(--color-text)',
  fontSize: 'var(--text-sm)',
  minHeight: 44,
} as const;

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

function Note({
  tone,
  testId,
  children,
}: {
  readonly tone: 'emergency' | 'success';
  readonly testId: string;
  readonly children: React.ReactNode;
}) {
  return (
    <p
      data-testid={testId}
      style={{
        marginTop: 'var(--space-md)',
        marginBottom: 0,
        fontSize: 'var(--text-xs)',
        color: `var(--color-${tone}-fg)`,
        fontWeight: 600,
      }}
    >
      {children}
    </p>
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
