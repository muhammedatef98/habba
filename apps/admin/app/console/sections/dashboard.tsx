/**
 * The first screen of a shift: how the business is doing, and what is
 * waiting on someone at Habba.
 */

'use client';

import { api } from '@/data/api';
import type { Dashboard } from '@/data/types';
import { count, money } from '@/lib/format';
import { hrefFor } from '../router';
import { Card, Loadable, PageHead, Stat, useLoad } from '../ui';

export function DashboardSection() {
  const state = useLoad(() => api.dashboard(), 'dashboard');

  return (
    <>
      <PageHead
        title="الرئيسية"
        description="ما يحدث الآن، وما ينتظر أحداً من الفريق. الأرقام بتوقيت الرياض."
      />
      <Loadable state={state}>{(data) => <Overview data={data} />}</Loadable>
    </>
  );
}

function Overview({ data }: { readonly data: Dashboard }) {
  const cancelRate =
    data.orders_7d > 0 ? Math.round((data.cancelled_7d / data.orders_7d) * 100) : 0;

  return (
    <>
      <h2 style={{ fontSize: 'var(--text-lg)', margin: '0 0 var(--space-sm)' }}>ينتظر إجراءً</h2>
      <div className="stats">
        <Stat
          label="شكاوى مفتوحة"
          value={count(data.disputes_open)}
          tone={data.disputes_open > 0 ? 'alert' : undefined}
          href={hrefFor('disputes')}
        />
        <Stat
          label="مقدّمو خدمة بانتظار المراجعة"
          value={count(data.pending_verifications)}
          tone={data.pending_verifications > 0 ? 'alert' : undefined}
          href={hrefFor('providers')}
        />
        <Stat
          label="عمليات دفع بانتظار التنفيذ"
          value={count(data.pending_payment_operations)}
          tone={data.pending_payment_operations > 0 ? 'alert' : undefined}
          href={hrefFor('finance')}
        />
        <Stat
          label="طلبات تبحث عن فنّي الآن"
          value={count(data.searching_now)}
          href={hrefFor('board')}
        />
      </div>

      <h2 style={{ fontSize: 'var(--text-lg)', margin: '0 0 var(--space-sm)' }}>اليوم</h2>
      <div className="stats">
        <Stat label="طلبات اليوم" value={count(data.orders_today)} href={hrefFor('orders')} />
        <Stat label="مكتملة اليوم" value={count(data.completed_today)} />
        <Stat label="جارية الآن" value={count(data.active_now)} href={hrefFor('board')} />
        <Stat label="إيراد اليوم (شامل الضريبة)" value={money(data.gmv_today)} />
        <Stat label="فنّيون متصلون" value={count(data.providers_online)} />
      </div>

      <h2 style={{ fontSize: 'var(--text-lg)', margin: '0 0 var(--space-sm)' }}>النمو</h2>
      <div className="stats">
        <Stat label="إيراد 7 أيام" value={money(data.gmv_7d)} />
        <Stat label="إيراد 30 يوماً" value={money(data.gmv_30d)} />
        <Stat label="طلبات 7 أيام" value={count(data.orders_7d)} />
        <Stat label="نسبة الإلغاء 7 أيام" value={`${cancelRate}%`} />
        <Stat label="العملاء" value={count(data.customers_total)} href={hrefFor('users')} />
        <Stat label="عملاء جدد 7 أيام" value={count(data.customers_new_7d)} />
        <Stat label="السيارات في هبّة" value={count(data.vehicles_total)} />
        <Stat label="مقدّمو خدمة معتمدون" value={count(data.providers_approved)} />
        <Stat
          label="متوسط التقييم 30 يوماً"
          value={data.avg_rating_30d === null ? '—' : data.avg_rating_30d.toFixed(2)}
          href={hrefFor('ratings')}
        />
        <Stat
          label="حسابات موقوفة"
          value={count(data.suspended_accounts)}
          href={hrefFor('users')}
        />
      </div>

      <div className="grid two">
        <Card title="الطلبات — آخر 14 يوماً">
          <Bars
            values={data.by_day.map((day) => ({
              key: day.day,
              value: day.orders,
              label: day.day.slice(8),
            }))}
          />
        </Card>
        <Card title="الإيراد — آخر 14 يوماً">
          <Bars
            values={data.by_day.map((day) => ({
              key: day.day,
              value: day.gmv,
              label: day.day.slice(8),
            }))}
            format={money}
          />
        </Card>
      </div>
    </>
  );
}

function Bars({
  values,
  format = count,
}: {
  readonly values: readonly {
    readonly key: string;
    readonly value: number;
    readonly label: string;
  }[];
  readonly format?: (value: number) => string;
}) {
  const max = Math.max(1, ...values.map((entry) => Number(entry.value)));
  return (
    <>
      <div className="bars" role="img" aria-label="رسم بياني">
        {values.map((entry) => (
          <div
            key={entry.key}
            className="bar"
            title={`${entry.key}: ${format(Number(entry.value))}`}
            style={{ height: `${(Number(entry.value) / max) * 100}%` }}
          />
        ))}
      </div>
      <div className="bar-labels">
        {values.map((entry) => (
          <span key={entry.key}>{entry.label}</span>
        ))}
      </div>
    </>
  );
}
