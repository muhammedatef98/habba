/**
 * Privacy and compliance: the record of every data request, and the
 * platform-wide lists (ownership transfers, shared reports) that an operator
 * answering a legal or privacy question needs in one place.
 *
 * Also states, in plain words, what this console deliberately cannot do and
 * why — so "can the operator see X?" has an answer on the screen, not only in
 * a migration.
 */

'use client';

import { useState } from 'react';
import { api } from '@/data/api';
import type { Row } from '@/data/transport';
import { dateTime } from '@/lib/format';
import { label, TRANSFER_STATUS } from '../labels';
import { go, hrefFor } from '../router';
import {
  ActionButton,
  Badge,
  Card,
  DataTable,
  LabelBadge,
  Loadable,
  PageHead,
  Tabs,
  useLoad,
} from '../ui';

type View = 'requests' | 'transfers' | 'reports' | 'limits';

export function ComplianceSection() {
  const [view, setView] = useState<View>('requests');

  return (
    <>
      <PageHead
        title="الخصوصية والامتثال"
        description="طلبات الأشخاص على بياناتهم (نظام حماية البيانات الشخصية)، ونقل الملكية، والتقارير المشاركة، وحدود ما تصل إليه هذه اللوحة."
      />
      <Tabs<View>
        tabs={[
          { value: 'requests', label: 'طلبات البيانات' },
          { value: 'transfers', label: 'نقل الملكية' },
          { value: 'reports', label: 'تقارير هبّة' },
          { value: 'limits', label: 'ما لا تصل إليه اللوحة' },
        ]}
        value={view}
        onChange={setView}
      />
      {view === 'requests' ? (
        <DataRequests />
      ) : view === 'transfers' ? (
        <Transfers />
      ) : view === 'reports' ? (
        <Reports />
      ) : (
        <Limits />
      )}
    </>
  );
}

function DataRequests() {
  const state = useLoad(() => api.records<Row>('data_requests'), 'data_requests');
  return (
    <Card title="سجل طلبات البيانات">
      <p className="subtle" style={{ marginTop: 0 }}>
        يُنفَّذ الطلب من ملف الشخص في قسم المستخدمين: «تصدير كل بياناته» أو «حذف بيانات الحساب»
        (للمشرف العام).
      </p>
      <Loadable state={state}>
        {(rows) => (
          <DataTable<Row>
            rows={rows}
            rowKey={(row) => String(row['id'])}
            onRowClick={(row) => go('users', String(row['user_id']))}
            empty="لا طلبات بعد."
            columns={[
              {
                label: 'النوع',
                render: (row) =>
                  row['kind'] === 'erasure' ? (
                    <Badge tone="bad">حذف</Badge>
                  ) : (
                    <Badge tone="info">تصدير</Badge>
                  ),
              },
              { label: 'الشخص', render: (row) => String(row['user_name'] ?? row['user_id']) },
              { label: 'السبب', render: (row) => String(row['reason']) },
              { label: 'نفّذه', render: (row) => String(row['handled_by_name'] ?? '—') },
              {
                label: 'التاريخ',
                render: (row) => (
                  <span className="numeric">{dateTime(String(row['handled_at']))}</span>
                ),
              },
            ]}
          />
        )}
      </Loadable>
    </Card>
  );
}

function Transfers() {
  const state = useLoad(() => api.records<Row>('transfers'), 'transfers');
  return (
    <Card title="طلبات نقل الملكية">
      <Loadable state={state}>
        {(rows) => (
          <DataTable<Row>
            rows={rows}
            rowKey={(row) => String(row['id'])}
            empty="لا طلبات نقل."
            columns={[
              {
                label: 'السيارة',
                render: (row) => (
                  <a className="link" href={hrefFor('vehicles', String(row['vehicle_id']))}>
                    {String(row['plate_ar'])}
                  </a>
                ),
              },
              { label: 'من', render: (row) => String(row['from_name']) },
              { label: 'إلى', render: (row) => String(row['to_name'] ?? '—') },
              {
                label: 'الحالة',
                render: (row) => (
                  <LabelBadge value={label(TRANSFER_STATUS, String(row['status']))} />
                ),
              },
              {
                label: 'محاولات خاطئة',
                numeric: true,
                render: (row) => (
                  <>
                    {String(row['failed_attempts'])}
                    {row['locked_at'] !== null ? (
                      <>
                        {' '}
                        <Badge tone="bad">مقفل</Badge>
                      </>
                    ) : null}
                  </>
                ),
              },
              {
                label: 'أُنشئ',
                render: (row) => (
                  <span className="numeric">{dateTime(String(row['created_at']))}</span>
                ),
              },
              {
                label: '',
                render: (row) =>
                  row['status'] === 'pending' ? (
                    <ActionButton
                      label="إلغاء"
                      size="small"
                      tone="danger"
                      onConfirm={(reason) => api.cancelTransfer(String(row['id']), reason)}
                      onDone={state.reload}
                      success="أُلغي طلب النقل."
                    />
                  ) : null,
              },
            ]}
          />
        )}
      </Loadable>
    </Card>
  );
}

function Reports() {
  const state = useLoad(() => api.records<Row>('reports'), 'reports');
  return (
    <Card title="تقارير هبّة الصادرة">
      <p className="subtle" style={{ marginTop: 0 }}>
        التقرير رابط عام برمز QR. إلغاؤه يوقف الرابط فوراً — مثلاً إن نُشر بلا إذن المالك.
      </p>
      <Loadable state={state}>
        {(rows) => (
          <DataTable<Row>
            rows={rows}
            rowKey={(row) => String(row['id'])}
            empty="لا تقارير."
            columns={[
              {
                label: 'السيارة',
                render: (row) => (
                  <a className="link" href={hrefFor('vehicles', String(row['vehicle_id']))}>
                    {String(row['plate_ar'])}
                  </a>
                ),
              },
              {
                label: 'صدر',
                render: (row) => (
                  <span className="numeric">{dateTime(String(row['generated_at']))}</span>
                ),
              },
              {
                label: 'الحالة',
                render: (row) =>
                  row['revoked_at'] !== null ? (
                    <Badge>ملغى</Badge>
                  ) : row['chain_valid'] === true ? (
                    <Badge tone="good">سليم</Badge>
                  ) : (
                    <Badge tone="bad">السلسلة غير سليمة</Badge>
                  ),
              },
              { label: 'السجلات', numeric: true, render: (row) => String(row['chain_length']) },
              {
                label: '',
                render: (row) =>
                  row['revoked_at'] === null ? (
                    <ActionButton
                      label="إلغاء"
                      size="small"
                      tone="danger"
                      onConfirm={(reason) => api.revokeReport(String(row['id']), reason)}
                      onDone={state.reload}
                      success="أُلغي التقرير."
                    />
                  ) : null,
              },
            ]}
          />
        )}
      </Loadable>
    </Card>
  );
}

function Limits() {
  const items: readonly (readonly [string, string])[] = [
    [
      'تعديل أو حذف سجلات دفتر السيارة',
      'الدفتر سجل غير قابل للتعديل ومتسلسل بالبصمات — هذا ما يجعل تقرير هبّة موثوقاً عند البيع. التصحيح يُضاف كسجل جديد موقّع من هبّة من ملف السيارة.',
    ],
    ['تعديل أو حذف سجل التدقيق', 'لا يستطيعه أحد، ولا مالك قاعدة البيانات. هو دليل المساءلة.'],
    [
      'رقم الهوية والآيبان لمقدّمي الخدمة',
      'مخزّنة مشفّرة ولا تُقرأ من أي واجهة. التحقق من الهوية يتم عبر نفاذ، والتحويل البنكي من نظام المدفوعات.',
    ],
    ['أرقام البطاقات', 'لا تصل إلى هبّة أصلاً — يحتفظ بها مزوّد الدفع.'],
    ['كلمات المرور ورموز الدخول', 'تُحفظ مجزّأة (hash) فقط ولا يمكن قراءتها.'],
    [
      'الدخول كأحد المستخدمين',
      'غير متاح عمداً: كل إجراء يُسجَّل باسم من نفّذه فعلاً. كل ما يراه المستخدم تراه اللوحة من ملفه، وكل ما يلزم فعله متاح كإجراء باسمك.',
    ],
    [
      'تعديل حالة الدفع مباشرة',
      'يمرّ فقط عبر الإلغاء أو حسم الشكوى، لتُسجَّل العملية لمزوّد الدفع ولا يُعلَن طلب مدفوعاً أو مسترداً بلا أثر.',
    ],
  ];

  return (
    <Card title="ما لا تصل إليه اللوحة، ولماذا">
      <p className="muted" style={{ marginTop: 0 }}>
        كل ما عدا ذلك في التطبيق تتحكّم فيه من هنا. هذه الاستثناءات مقصودة: بعضها يحمي ثقة العملاء
        في الدفتر، وبعضها تفرضه الأنظمة أو معايير أمن المدفوعات، وكلها تحميك أنت من اتهام بتعديل لم
        تفعله.
      </p>
      <ul className="list">
        {items.map(([title, why]) => (
          <li key={title} className="timeline-item">
            <strong>{title}</strong>
            <div className="muted">{why}</div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
