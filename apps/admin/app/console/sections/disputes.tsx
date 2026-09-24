/**
 * Complaints: every order a customer (or an operator on their behalf) has
 * disputed. Each is resolved from the order's own file, where the whole
 * history is in front of the operator making the decision.
 */

'use client';

import { useState } from 'react';
import { api } from '@/data/api';
import type { DisputeRow } from '@/data/types';
import { dateTime, money, since } from '@/lib/format';
import { RESOLUTION } from '../labels';
import { go } from '../router';
import { Badge, DataTable, Loadable, PageHead, Tabs, useLoad } from '../ui';

type View = 'open' | 'resolved';

export function DisputesSection() {
  const [view, setView] = useState<View>('open');
  const state = useLoad(() => api.disputes(view === 'open'), view);

  return (
    <>
      <PageHead
        title="الشكاوى"
        description="الطلبات المتنازع عليها. لا تُصرف مستحقات طلب في شكوى حتى تُحسم. افتح الطلب لحسمها: العمل سليم، أو استرداد جزئي، أو كامل."
      />
      <Tabs<View>
        tabs={[
          { value: 'open', label: 'مفتوحة' },
          { value: 'resolved', label: 'محسومة' },
        ]}
        value={view}
        onChange={setView}
      />
      <Loadable state={state}>
        {(rows) => (
          <DataTable<DisputeRow>
            rows={rows}
            rowKey={(row) => row.id}
            onRowClick={(row) => go('orders', row.order_id)}
            empty={view === 'open' ? 'لا شكاوى مفتوحة.' : 'لا شكاوى محسومة بعد.'}
            columns={[
              {
                label: 'الطلب',
                render: (row) => (
                  <>
                    <strong className="numeric">{row.order_number}</strong>
                    <div className="subtle">{row.service_name_ar}</div>
                  </>
                ),
              },
              { label: 'العميل', render: (row) => row.customer_name },
              { label: 'مقدّم الخدمة', render: (row) => row.provider_name_ar ?? '—' },
              { label: 'الشكوى', render: (row) => `«${row.reason}»` },
              { label: 'المبلغ', numeric: true, render: (row) => money(row.total_amount) },
              view === 'open'
                ? { label: 'مفتوحة منذ', render: (row) => since(row.opened_at) }
                : {
                    label: 'القرار',
                    render: (row) => (
                      <>
                        <Badge tone={row.resolution === 'upheld' ? 'neutral' : 'warn'}>
                          {RESOLUTION[row.resolution ?? ''] ?? '—'}
                        </Badge>
                        {row.refund_amount !== null && row.refund_amount > 0 ? (
                          <div className="subtle">{money(row.refund_amount)}</div>
                        ) : null}
                        <div className="subtle">{dateTime(row.resolved_at)}</div>
                      </>
                    ),
                  },
            ]}
          />
        )}
      </Loadable>
    </>
  );
}
