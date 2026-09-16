/**
 * الدفعات — what providers are owed, and what has actually been sent.
 *
 * The most consequential screen in this console. Everything else decides who
 * may work; this decides who gets paid, and a mistake here is money that left
 * an account or a provider who did a month of work and was not settled.
 *
 * Three things it is careful about.
 *
 * **It does no arithmetic.** `build_payout` (0067) reads `payable_order_lines`,
 * takes the commission per line and writes gross, commission and net in one
 * transaction, against a CHECK constraint that refuses a row where they do not
 * reconcile. This screen shows those three numbers as the database holds them.
 * Recomputing the subtraction in a browser would be a second implementation of
 * the arithmetic that pays somebody, drifting the day the commission changes.
 *
 * **Building twice is refused, loudly.** `payouts_unique_period_idx` (0031)
 * exists precisely so that re-running a settlement does not pay a provider
 * twice. The refusal is surfaced as the sentence it is — an operator who saw
 * that fail silently would assume it worked and move on.
 *
 * **Marking paid demands the reference.** It is the only thing connecting a
 * row here to money that left a bank, and the first thing anyone asks for when
 * a provider says they were not paid. The server holds the matching rule —
 * `payouts_paid_consistent` refuses a row claiming to be paid with no
 * timestamp — and the form refuses an empty reference before it gets there.
 */

'use client';

import { useCallback, useEffect, useState } from 'react';
import { opsRepository } from '@/data/ops-repository';
import type { PayoutRow, PayoutStatus } from '@/data/types';

const STATUS_LABEL: Readonly<Record<PayoutStatus, string>> = {
  pending: 'بانتظار الصرف',
  approved: 'معتمدة',
  paid: 'مدفوعة',
  failed: 'فشل التحويل',
};

const STATUS_TONE: Readonly<Record<PayoutStatus, string>> = {
  pending: 'var(--color-text-muted)',
  approved: 'var(--color-info-fg)',
  paid: 'var(--color-success-fg)',
  failed: 'var(--color-emergency-fg)',
};

/** `YYYY-MM-DD` for a date input, in local time. */
function isoDay(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export function Payouts() {
  const [rows, setRows] = useState<readonly PayoutRow[] | null>(null);
  const [providers, setProviders] = useState<
    readonly { readonly id: string; readonly nameAr: string }[]
  >([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [providerId, setProviderId] = useState('');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [payingId, setPayingId] = useState<string | null>(null);
  const [reference, setReference] = useState('');

  const load = useCallback(async () => {
    try {
      const [payouts, payable] = await Promise.all([
        opsRepository.listPayouts(),
        opsRepository.listPayableProviders(),
      ]);
      setRows(payouts);
      setProviders(payable);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'تعذّر تحميل الدفعات');
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void load();
    // Default to the month just ended, which is what a settlement run almost
    // always covers — and a default that is nearly always right is one fewer
    // chance to type the wrong month onto somebody's payment.
    const now = new Date();
    setPeriodStart(isoDay(new Date(now.getFullYear(), now.getMonth() - 1, 1)));
    setPeriodEnd(isoDay(new Date(now.getFullYear(), now.getMonth(), 0)));
  }, [load]);

  const canBuild =
    providerId !== '' && periodStart !== '' && periodEnd !== '' && periodEnd >= periodStart;

  async function build() {
    setBusy(true);
    setNotice(null);
    setError(null);
    try {
      await opsRepository.buildPayout(providerId, periodStart, periodEnd);
      setNotice('أُنشئت الدفعة.');
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'تعذّر إنشاء الدفعة');
    } finally {
      setBusy(false);
    }
  }

  async function markPaid(id: string) {
    if (reference.trim() === '') {
      setError('رقم الحوالة مطلوب.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await opsRepository.markPayoutPaid(id, reference.trim());
      setPayingId(null);
      setReference('');
      setNotice('سُجّلت الدفعة كمدفوعة.');
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'تعذّر تسجيل الدفعة');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <header style={{ marginBottom: 'var(--space-lg)' }}>
        <h1 style={{ fontSize: 'var(--text-xl)', margin: 0 }}>الدفعات</h1>
        <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
          الأرقام كما تحسبها الخوادم. لا شيء هنا يعيد حساب العمولة أو الصافي.
        </p>
      </header>

      {error !== null ? <Banner tone="emergency" text={error} /> : null}
      {notice !== null ? <Banner tone="success" text={notice} /> : null}

      {/* Building a run. */}
      <div
        style={{
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-lg)',
          padding: 'var(--space-base)',
          marginBottom: 'var(--space-lg)',
          background: 'var(--color-surface)',
          display: 'flex',
          gap: 'var(--space-md)',
          flexWrap: 'wrap',
          alignItems: 'flex-end',
        }}
      >
        <Field label="مقدّم الخدمة">
          <select
            value={providerId}
            onChange={(event) => setProviderId(event.target.value)}
            style={inputStyle}
          >
            <option value="">اختر…</option>
            {providers.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.nameAr}
              </option>
            ))}
          </select>
        </Field>
        <Field label="من">
          <input
            type="date"
            value={periodStart}
            onChange={(event) => setPeriodStart(event.target.value)}
            style={inputStyle}
          />
        </Field>
        <Field label="إلى">
          <input
            type="date"
            value={periodEnd}
            onChange={(event) => setPeriodEnd(event.target.value)}
            style={inputStyle}
          />
        </Field>
        <button
          onClick={() => void build()}
          disabled={!canBuild || busy}
          style={{
            ...inputStyle,
            background: canBuild ? 'var(--color-primary)' : 'var(--color-surface-sunken)',
            color: canBuild ? 'var(--color-primary-text)' : 'var(--color-text-subtle)',
            border: 'none',
            fontWeight: 600,
            cursor: canBuild && !busy ? 'pointer' : 'default',
          }}
        >
          أنشئ الدفعة
        </button>
      </div>

      {rows === null ? (
        <p style={{ color: 'var(--color-text-muted)' }}>جارٍ التحميل…</p>
      ) : rows.length === 0 ? (
        <p style={{ color: 'var(--color-text-muted)' }}>لا توجد دفعات بعد.</p>
      ) : (
        <div style={{ display: 'grid', gap: 'var(--space-md)' }}>
          {rows.map((row) => (
            <article
              key={row.id}
              style={{
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-lg)',
                padding: 'var(--space-base)',
                background: 'var(--color-surface)',
                display: 'grid',
                gap: 'var(--space-sm)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 'var(--space-md)',
                  flexWrap: 'wrap',
                }}
              >
                <strong>{row.providerNameAr ?? row.providerId}</strong>
                <span style={{ color: STATUS_TONE[row.status], fontWeight: 600 }}>
                  {STATUS_LABEL[row.status]}
                </span>
              </div>

              <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
                {row.periodStart} — {row.periodEnd} · {row.orderCount} عمل
              </div>

              {/* All three, never two and a subtraction. See the note at the
                  top of this file. */}
              <div style={{ display: 'flex', gap: 'var(--space-lg)', flexWrap: 'wrap' }}>
                <Figure label="الإجمالي" value={row.gross} />
                <Figure label="عمولة هبّة" value={row.commission} />
                <Figure label="الصافي للمقدّم" value={row.net} strong />
              </div>

              {row.status === 'paid' ? (
                <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>
                  رقم الحوالة: <span dir="ltr">{row.reference ?? '—'}</span>
                </div>
              ) : payingId === row.id ? (
                <div style={{ display: 'flex', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
                  <input
                    value={reference}
                    onChange={(event) => setReference(event.target.value)}
                    placeholder="رقم الحوالة من البنك"
                    dir="ltr"
                    style={{ ...inputStyle, flex: 1, minWidth: 220 }}
                  />
                  <button
                    onClick={() => void markPaid(row.id)}
                    disabled={busy}
                    style={{
                      ...inputStyle,
                      background: 'var(--color-primary)',
                      color: 'var(--color-primary-text)',
                      border: 'none',
                      fontWeight: 600,
                    }}
                  >
                    تأكيد الدفع
                  </button>
                  <button
                    onClick={() => {
                      setPayingId(null);
                      setReference('');
                    }}
                    style={{ ...inputStyle, background: 'transparent', border: 'none' }}
                  >
                    تراجع
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => {
                    setPayingId(row.id);
                    setReference('');
                    setError(null);
                  }}
                  style={{
                    ...inputStyle,
                    justifySelf: 'start',
                    background: 'transparent',
                    border: '1px solid var(--color-border-strong)',
                    fontWeight: 600,
                  }}
                >
                  سجّل الدفع
                </button>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

const inputStyle = {
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

function Figure({
  label,
  value,
  strong,
}: {
  readonly label: string;
  readonly value: string;
  readonly strong?: boolean;
}) {
  return (
    <div style={{ display: 'grid', gap: 2 }}>
      <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>{label}</span>
      <span
        style={{
          fontFamily: 'var(--font-latin)',
          fontWeight: strong === true ? 700 : 500,
          color: strong === true ? 'var(--color-text)' : 'var(--color-text-muted)',
        }}
      >
        {value} ﷼
      </span>
    </div>
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
