/**
 * Reviews: read them all, and take down the ones that break the rules.
 *
 * A hidden review stops counting towards the provider's rating and stops
 * showing to anyone but the person who wrote it (0069). It is never deleted:
 * hiding is a decision, recorded with its reason, and can be undone.
 */

'use client';

import { useState } from 'react';
import { api } from '@/data/api';
import type { RatingRow } from '@/data/types';
import { dateTime } from '@/lib/format';
import { go } from '../router';
import { ActionButton, Badge, DataTable, Loadable, PageHead, Tabs, useLoad } from '../ui';

type View = 'all' | 'hidden';

export function RatingsSection() {
  const [view, setView] = useState<View>('all');
  const state = useLoad(() => api.ratings(view === 'hidden'), view);

  return (
    <>
      <PageHead
        title="التقييمات"
        description="تقييمات العملاء لمقدّمي الخدمة. أخفِ ما يخالف السياسة (إساءة، بيانات شخصية، ادعاء غير صحيح) — يبقى محفوظاً ويمكن إظهاره."
      />
      <Tabs<View>
        tabs={[
          { value: 'all', label: 'الكل' },
          { value: 'hidden', label: 'المخفية' },
        ]}
        value={view}
        onChange={setView}
      />
      <Loadable state={state}>
        {(rows) => (
          <DataTable<RatingRow>
            rows={rows}
            rowKey={(row) => row.id}
            empty="لا تقييمات."
            columns={[
              {
                label: 'التقييم',
                render: (row) => (
                  <span style={{ color: row.stars <= 2 ? 'var(--color-emergency-fg)' : undefined }}>
                    {'★'.repeat(row.stars)}
                    {'☆'.repeat(5 - row.stars)}
                  </span>
                ),
              },
              {
                label: 'التعليق',
                render: (row) => (
                  <>
                    {row.comment !== null ? (
                      `«${row.comment}»`
                    ) : (
                      <span className="muted">بلا تعليق</span>
                    )}
                    {row.hidden_at !== null ? (
                      <div>
                        <Badge tone="warn">مخفي: {row.hidden_reason}</Badge>
                      </div>
                    ) : null}
                  </>
                ),
              },
              { label: 'العميل', render: (row) => row.rater_name },
              {
                label: 'مقدّم الخدمة',
                render: (row) =>
                  row.provider_id !== null ? (
                    <button className="link" onClick={() => go('providers', row.provider_id)}>
                      {row.provider_name_ar}
                    </button>
                  ) : (
                    '—'
                  ),
              },
              {
                label: 'الطلب',
                render: (row) => (
                  <button className="link numeric" onClick={() => go('orders', row.order_id)}>
                    {row.order_number}
                  </button>
                ),
              },
              {
                label: 'التاريخ',
                render: (row) => <span className="numeric">{dateTime(row.created_at)}</span>,
              },
              {
                label: '',
                render: (row) =>
                  row.hidden_at === null ? (
                    <ActionButton
                      label="إخفاء"
                      size="small"
                      tone="danger"
                      description="يتوقف احتسابه في تقييم مقدّم الخدمة ويختفي عن الجميع عدا كاتبه."
                      onConfirm={(reason) => api.setRatingHidden(row.id, true, reason)}
                      onDone={state.reload}
                      success="أُخفي التقييم."
                    />
                  ) : (
                    <ActionButton
                      label="إظهار"
                      size="small"
                      reason="none"
                      description="يعود التقييم للظهور ويُحتسب من جديد."
                      onConfirm={() => api.setRatingHidden(row.id, false, null)}
                      onDone={state.reload}
                      success="ظهر التقييم."
                    />
                  ),
              },
            ]}
          />
        )}
      </Loadable>
    </>
  );
}
