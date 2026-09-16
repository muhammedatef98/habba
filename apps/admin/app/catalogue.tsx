/**
 * الخدمات — the catalogue every price in the app is quoted from.
 *
 * ⚠️ Editing a price here changes what the NEXT customer is quoted and nothing
 * about an order already placed.
 *
 * `orders` carries its own `quoted_amount`, captured when the order was made,
 * and the state machine's escrow gate reads that column rather than the
 * catalogue. That is the property that makes this screen safe to have at all:
 * a correction typed at 2am can never silently re-price work somebody already
 * agreed to, and an operator fixing a wrong number does not have to wonder
 * whether they have just changed what a customer owes.
 *
 * **Nothing is deleted, and there is no delete.** `orders.service_id` is a
 * foreign key, so removing a service would orphan every order that ever used
 * it — and the logbook entries those orders wrote are the product (§1).
 * `is_active = false` takes it off the customer's menu (`services_read`, 0022)
 * and leaves the history standing.
 *
 * **A null price is a state, not a gap.** 0017 uses null for quote-only work:
 * bodywork, a tow of unknown distance — things a provider prices per job
 * because nobody can know up front. It renders as «بحسب المعاينة». Showing it
 * as `0.00` would be the console advertising free labour.
 */

'use client';

import { useCallback, useEffect, useState } from 'react';
import { opsRepository } from '@/data/ops-repository';
import type { ServiceRow } from '@/data/types';

const CATEGORY_LABEL: Readonly<Record<string, string>> = {
  emergency: 'طوارئ',
  periodic: 'صيانة دورية',
  inspection: 'فحص',
  wash: 'غسيل',
  bodywork: 'سمكرة ودهان',
};

const MODE_LABEL: Readonly<Record<string, string>> = {
  mobile_ondemand: 'فورية',
  mobile_scheduled: 'مجدولة',
  workshop: 'ورشة',
};

/** Exactly two decimals, or null. The same shape `numeric(12,2)` accepts. */
function parsePrice(
  raw: string,
): { readonly ok: true; readonly value: string | null } | { readonly ok: false } {
  const trimmed = raw.trim();
  if (trimmed === '') return { ok: true, value: null };
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(trimmed)) return { ok: false };
  return { ok: true, value: Number(trimmed).toFixed(2) };
}

export function Catalogue() {
  const [rows, setRows] = useState<readonly ServiceRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setRows(await opsRepository.listServices());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'تعذّر تحميل الخدمات');
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function savePrice(serviceId: string) {
    const parsed = parsePrice(draft);
    if (!parsed.ok) {
      setError(
        'السعر يُكتب بالأرقام، بمنزلتين عشريتين على الأكثر. اتركه فارغاً لخدمة تُسعَّر بالمعاينة.',
      );
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await opsRepository.setServicePrice(serviceId, parsed.value);
      setEditing(null);
      setNotice(
        parsed.value === null
          ? 'صارت الخدمة تُسعَّر بالمعاينة. الطلبات السابقة لم تتغيّر.'
          : 'حُدّث السعر. يسري على الطلبات الجديدة فقط.',
      );
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'تعذّر حفظ السعر');
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(row: ServiceRow) {
    setBusy(true);
    setError(null);
    try {
      await opsRepository.setServiceActive(row.id, !row.isActive);
      setNotice(
        row.isActive
          ? 'أُخفيت الخدمة عن العملاء. سجلّها وطلباتها السابقة كما هي.'
          : 'عادت الخدمة للظهور للعملاء.',
      );
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'تعذّر تغيير حالة الخدمة');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <header style={{ marginBottom: 'var(--space-lg)' }}>
        <h1 style={{ fontSize: 'var(--text-xl)', margin: 0 }}>الخدمات</h1>
        <p style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
          الأسعار هنا تُسعّر الطلبات الجديدة فقط. أي طلب سابق يحمل السعر المتفق عليه وقت إنشائه ولا
          يتأثر بأي تعديل هنا.
        </p>
      </header>

      {error !== null ? <Banner tone="emergency" text={error} /> : null}
      {notice !== null ? <Banner tone="success" text={notice} /> : null}

      {rows === null ? (
        <p style={{ color: 'var(--color-text-muted)' }}>جارٍ التحميل…</p>
      ) : rows.length === 0 ? (
        <p style={{ color: 'var(--color-text-muted)' }}>لا توجد خدمات في الكتالوج.</p>
      ) : (
        <div style={{ display: 'grid', gap: 'var(--space-sm)' }}>
          {rows.map((row) => (
            <article
              key={row.id}
              style={{
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-lg)',
                padding: 'var(--space-base)',
                // A retired service is dimmed, not hidden: finding one to put
                // back is the reason ops can see them at all.
                background: row.isActive ? 'var(--color-surface)' : 'var(--color-surface-sunken)',
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
                  alignItems: 'baseline',
                }}
              >
                <strong>{row.nameAr}</strong>
                <span
                  style={{
                    fontSize: 'var(--text-xs)',
                    color: row.isActive ? 'var(--color-success-fg)' : 'var(--color-text-subtle)',
                    fontWeight: 600,
                  }}
                >
                  {row.isActive ? 'معروضة للعملاء' : 'مخفيّة'}
                </span>
              </div>

              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                {CATEGORY_LABEL[row.category] ?? row.category} · {row.estDurationMin} دقيقة ·{' '}
                {row.supportedModes.map((mode) => MODE_LABEL[mode] ?? mode).join('، ')}
              </div>

              {editing === row.id ? (
                <div style={{ display: 'flex', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
                  <input
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    placeholder="اتركه فارغاً للتسعير بالمعاينة"
                    dir="ltr"
                    inputMode="decimal"
                    style={{ ...inputStyle, flex: 1, minWidth: 200 }}
                  />
                  <button
                    onClick={() => void savePrice(row.id)}
                    disabled={busy}
                    style={{
                      ...inputStyle,
                      background: 'var(--color-primary)',
                      color: 'var(--color-primary-text)',
                      border: 'none',
                      fontWeight: 600,
                    }}
                  >
                    احفظ
                  </button>
                  <button
                    onClick={() => setEditing(null)}
                    style={{ ...inputStyle, background: 'transparent', border: 'none' }}
                  >
                    تراجع
                  </button>
                </div>
              ) : (
                <div
                  style={{
                    display: 'flex',
                    gap: 'var(--space-md)',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                  }}
                >
                  <span style={{ fontFamily: 'var(--font-latin)', fontWeight: 600 }}>
                    {row.basePrice === null ? (
                      <span style={{ fontFamily: 'var(--font-arabic)', fontWeight: 500 }}>
                        بحسب المعاينة
                      </span>
                    ) : (
                      `${row.basePrice} ﷼`
                    )}
                  </span>
                  <button
                    onClick={() => {
                      setEditing(row.id);
                      setDraft(row.basePrice ?? '');
                      setError(null);
                      setNotice(null);
                    }}
                    style={{
                      ...inputStyle,
                      background: 'transparent',
                      border: '1px solid var(--color-border-strong)',
                      fontWeight: 600,
                    }}
                  >
                    عدّل السعر
                  </button>
                  <button
                    onClick={() => void toggleActive(row)}
                    disabled={busy}
                    style={{
                      ...inputStyle,
                      background: 'transparent',
                      border: 'none',
                      fontWeight: 600,
                    }}
                  >
                    {row.isActive ? 'أخفِ عن العملاء' : 'أعد العرض'}
                  </button>
                </div>
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
