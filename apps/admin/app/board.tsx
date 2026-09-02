/**
 * The dispatch board.
 *
 * What an operator sits in front of during a shift. Ordered by trouble rather
 * than by time (0046): a shift has one operator and one screen, and sorting
 * newest-first buries the customer who has waited eleven minutes under six who
 * have waited one.
 *
 * ⚠️ No customer coordinates, deliberately. Ops can read `service_location`
 * through RLS, so this is not a boundary — it is a decision about what belongs
 * on a board left open on a screen in a room all shift. The district and the
 * dispatch state are what an operator reasons with; the exact position of a
 * stranded customer is not.
 */

'use client';

import { useCallback, useEffect, useState } from 'react';
import { opsRepository } from '@/data/ops-repository';
import type { Attention, BoardOrder } from '@/data/types';

/** Refreshed rather than streamed: a board is read, not watched frame by frame. */
const REFRESH_MS = 10_000;

const ATTENTION: Record<Attention, { label: string; bg: string; fg: string } | null> = {
  none: null,
  search_stuck: {
    label: 'لا أحد متاح',
    bg: 'var(--color-emergency-subtle)',
    fg: 'var(--color-emergency-fg)',
  },
  search_slow: {
    label: 'البحث طويل',
    bg: 'var(--color-warning-subtle)',
    fg: 'var(--color-warning-fg)',
  },
  awaiting_customer: {
    label: 'بانتظار تأكيد العميل',
    bg: 'var(--color-warning-subtle)',
    fg: 'var(--color-warning-fg)',
  },
  disputed: {
    label: 'نزاع',
    bg: 'var(--color-emergency-subtle)',
    fg: 'var(--color-emergency-fg)',
  },
};

const STATUS_AR: Record<string, string> = {
  searching: 'جارٍ البحث',
  quoted: 'بانتظار القبول',
  accepted: 'مقبول',
  checked_in: 'السيارة مستلمة',
  en_route: 'في الطريق',
  arrived: 'وصل الفنّي',
  in_progress: 'جارٍ العمل',
  awaiting_approval: 'بانتظار اعتماد العميل',
  disputed: 'نزاع',
};

/**
 * The counts an operator reads before reading any single row.
 *
 * A board sorted by trouble already puts the worst case first, which answers
 * "what do I do next". It does not answer "how bad is it" — and the difference
 * between one stuck search and six is the difference between handling it and
 * escalating. Derived rather than fetched: the board rows already carry
 * everything, and a second query could disagree with the list under it.
 */
function summarise(orders: readonly BoardOrder[]) {
  return {
    active: orders.length,
    attention: orders.filter((order) => order.attention !== 'none').length,
    searching: orders.filter((order) => order.status === 'searching').length,
    awaitingCustomer: orders.filter((order) => order.status === 'awaiting_approval').length,
  };
}

/** Minutes and seconds — the unit an operator thinks in during a shift. */
function age(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = Math.floor(seconds % 60);
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

export function Board() {
  const [orders, setOrders] = useState<readonly BoardOrder[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setOrders(await opsRepository.listBoard());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'تعذّر تحميل اللوحة');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  if (loading) return <p style={{ color: 'var(--color-text-muted)' }}>جارٍ التحميل…</p>;
  if (error !== null) return <p style={{ color: 'var(--color-emergency-fg)' }}>{error}</p>;

  if (orders.length === 0) {
    return (
      <div
        style={{
          padding: 'var(--space-2xl)',
          textAlign: 'center',
          color: 'var(--color-text-muted)',
          border: '1px dashed var(--color-border-strong)',
          borderRadius: 'var(--radius-lg)',
        }}
      >
        لا توجد طلبات نشطة الآن.
      </div>
    );
  }

  const totals = summarise(orders);

  return (
    <>
      <div className="board-summary">
        <Stat label="طلبات نشطة" value={totals.active} />
        <Stat
          label="تحتاج تدخّل"
          value={totals.attention}
          tone={totals.attention > 0 ? 'var(--color-emergency-fg)' : undefined}
        />
        <Stat label="جارٍ البحث" value={totals.searching} />
        <Stat label="بانتظار العميل" value={totals.awaitingCustomer} />
      </div>

      {/* Column headings. The row carries three unlabelled numbers — the
          dispatch round, the open-over-total offers, and the age — and an
          operator should not have to learn what each position means by
          watching it change. */}
      <div className="board-head" aria-hidden="true">
        <span>الطلب</span>
        <span>الحالة</span>
        <span style={{ textAlign: 'center', minWidth: 88 }}>الإرسال</span>
        <span style={{ textAlign: 'end' }}>منذ</span>
      </div>

      <ul
        style={{
          listStyle: 'none',
          margin: 0,
          padding: 0,
          display: 'grid',
          gap: 'var(--space-sm)',
        }}
      >
        {orders.map((order) => {
          const flag = ATTENTION[order.attention];
          return (
            <li
              key={order.orderId}
              className="board-row"
              style={{
                padding: 'var(--space-md) var(--space-base)',
                border: '1px solid var(--color-border)',
                // A left edge in the flag colour rather than a tinted row: the
                // board is scanned down its start edge, and a fully coloured row
                // makes the text underneath it harder to read at a glance.
                borderInlineStartWidth: flag === null ? 1 : 4,
                borderInlineStartColor: flag === null ? 'var(--color-border)' : flag.fg,
                borderRadius: 'var(--radius-md)',
                background: 'var(--color-surface)',
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>{order.serviceNameAr}</div>
                <div
                  className="numeric"
                  style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-subtle)' }}
                >
                  {order.orderNumber}
                  {order.cityNameAr !== null ? ` · ${order.cityNameAr}` : ''}
                </div>
              </div>

              <div
                style={{
                  fontSize: 'var(--text-sm)',
                  color: 'var(--color-text-muted)',
                  minWidth: 0,
                }}
              >
                {STATUS_AR[order.status] ?? order.status}
                {order.providerNameAr !== null ? (
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-subtle)' }}>
                    {order.providerNameAr}
                  </div>
                ) : null}
              </div>

              {/* Dispatch state only while it means something. On an accepted job
                "round 1, 3 offers" is history the operator does not need. */}
              <div
                className="numeric"
                style={{
                  fontSize: 'var(--text-xs)',
                  color: 'var(--color-text-subtle)',
                  textAlign: 'center',
                  minWidth: 88,
                }}
              >
                {order.status === 'searching'
                  ? `جولة ${order.dispatchRound} · ${order.offersOpen}/${order.offersTotal}`
                  : ''}
              </div>

              <div className="board-signals">
                {flag !== null ? (
                  <span
                    style={{
                      fontSize: 'var(--text-xs)',
                      padding: '4px var(--space-sm)',
                      borderRadius: 'var(--radius-full)',
                      background: flag.bg,
                      color: flag.fg,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {flag.label}
                  </span>
                ) : null}
                <span
                  className="numeric"
                  style={{
                    fontSize: 'var(--text-sm)',
                    fontWeight: 600,
                    color: flag === null ? 'var(--color-text-muted)' : flag.fg,
                    minWidth: 48,
                    textAlign: 'end',
                  }}
                >
                  {age(order.statusAgeSeconds)}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  readonly label: string;
  readonly value: number;
  readonly tone?: string | undefined;
}) {
  return (
    <div className="board-stat">
      <div
        className="numeric"
        style={{
          fontSize: 'var(--text-xl)',
          fontWeight: 600,
          color: tone ?? 'var(--color-text)',
          lineHeight: 1.2,
        }}
      >
        {value}
      </div>
      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-subtle)' }}>{label}</div>
    </div>
  );
}
