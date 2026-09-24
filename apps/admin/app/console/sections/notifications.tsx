/**
 * Notifications: tell people something, and see what the platform has told
 * them.
 *
 * A broadcast goes to everyone in the chosen audience who has the app's
 * notifications on; suspended accounts are left out. The outbox log shows
 * every push the platform queued, whether it was delivered, and why not.
 */

'use client';

import { useState } from 'react';
import { api } from '@/data/api';
import type { Row } from '@/data/transport';
import { explain } from '@/data/transport';
import { count, dateTime } from '@/lib/format';
import {
  Badge,
  Button,
  Card,
  DataTable,
  Field,
  Loadable,
  PageHead,
  useLoad,
  useToast,
} from '../ui';

type Audience = 'all' | 'customers' | 'providers' | 'city';

const AUDIENCE: Readonly<Record<Audience, string>> = {
  all: 'الجميع',
  customers: 'العملاء فقط',
  providers: 'مقدّمو الخدمة المعتمدون',
  city: 'مدينة محددة',
};

export function NotificationsSection() {
  const broadcasts = useLoad(() => api.records<Row>('broadcasts'), 'broadcasts');
  const outbox = useLoad(() => api.records<Row>('notifications'), 'outbox');

  return (
    <>
      <PageHead
        title="الإشعارات"
        description="أرسل إشعاراً لشريحة من المستخدمين، وتابع كل إشعار أرسلته المنصّة."
      />
      <div className="grid main-side">
        <div className="grid">
          <Card title="الإشعارات الجماعية المرسلة">
            <Loadable state={broadcasts}>
              {(rows) => (
                <DataTable<Row>
                  rows={rows}
                  rowKey={(row) => String(row['id'])}
                  empty="لم يُرسل إشعار جماعي بعد."
                  columns={[
                    {
                      label: 'العنوان',
                      render: (row) => <strong>{String(row['title_ar'])}</strong>,
                    },
                    { label: 'النص', render: (row) => String(row['body_ar']) },
                    {
                      label: 'الجمهور',
                      render: (row) =>
                        AUDIENCE[row['audience'] as Audience] ?? String(row['audience']),
                    },
                    {
                      label: 'وصل إلى',
                      numeric: true,
                      render: (row) => count(Number(row['recipients'])),
                    },
                    { label: 'بواسطة', render: (row) => String(row['sent_by_name'] ?? '—') },
                    {
                      label: 'التاريخ',
                      render: (row) => (
                        <span className="numeric">{dateTime(String(row['created_at']))}</span>
                      ),
                    },
                  ]}
                />
              )}
            </Loadable>
          </Card>

          <Card title="سجل الإشعارات (آخر ٢٠٠)">
            <Loadable state={outbox}>
              {(rows) => (
                <DataTable<Row>
                  rows={rows}
                  rowKey={(row) => String(row['id'])}
                  empty="لا إشعارات."
                  columns={[
                    {
                      label: 'النوع',
                      render: (row) => <span className="numeric">{String(row['kind'])}</span>,
                    },
                    { label: 'العنوان', render: (row) => String(row['title_ar']) },
                    { label: 'إلى', render: (row) => String(row['user_name'] ?? '—') },
                    {
                      label: 'الحالة',
                      render: (row) =>
                        // Delivered is Apple's or Google's word, from the
                        // receipt (0072); sent is only Expo accepting it.
                        row['delivered_at'] !== null && row['delivered_at'] !== undefined ? (
                          <Badge tone="good">وصل</Badge>
                        ) : row['sent_at'] !== null &&
                          String(row['last_error'] ?? '').startsWith('receipt:') ? (
                          <Badge tone="bad">لم يصل</Badge>
                        ) : row['sent_at'] !== null ? (
                          <Badge tone="info">أُرسل</Badge>
                        ) : row['abandoned_at'] !== null ? (
                          <Badge tone="bad">لم يُرسل</Badge>
                        ) : (
                          <Badge tone="warn">في الانتظار</Badge>
                        ),
                    },
                    { label: 'المحاولات', numeric: true, render: (row) => String(row['attempts']) },
                    {
                      label: 'الخطأ',
                      render: (row) =>
                        row['last_error'] !== null ? String(row['last_error']) : '—',
                    },
                    {
                      label: 'التاريخ',
                      render: (row) => (
                        <span className="numeric">{dateTime(String(row['created_at']))}</span>
                      ),
                    },
                  ]}
                />
              )}
            </Loadable>
          </Card>
        </div>
        <BroadcastForm onSent={broadcasts.reload} />
      </div>
    </>
  );
}

function BroadcastForm({ onSent }: { readonly onSent: () => void }) {
  const [audience, setAudience] = useState<Audience>('all');
  const [cityId, setCityId] = useState('');
  const [titleAr, setTitleAr] = useState('');
  const [bodyAr, setBodyAr] = useState('');
  const [titleEn, setTitleEn] = useState('');
  const [bodyEn, setBodyEn] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cities = useLoad(
    () => api.table<Row>('cities', { columns: 'id, name_ar', order: 'name_ar' }),
    'cities',
  );
  const toast = useToast();

  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!window.confirm(`إرسال الإشعار إلى «${AUDIENCE[audience]}»؟ لا يمكن سحبه بعد الإرسال.`))
      return;
    setBusy(true);
    setError(null);
    try {
      const reached = await api.broadcast(
        audience,
        audience === 'city' ? cityId : null,
        titleAr,
        bodyAr,
        titleEn,
        bodyEn,
      );
      toast(`أُرسل إلى ${count(reached)} جهاز.`);
      setTitleAr('');
      setBodyAr('');
      setTitleEn('');
      setBodyEn('');
      onSent();
    } catch (cause) {
      setError(explain(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="إشعار جماعي جديد">
      <form onSubmit={send} style={{ display: 'grid', gap: 'var(--space-md)' }}>
        <Field label="الجمهور">
          <select
            className="input"
            value={audience}
            onChange={(event) => setAudience(event.target.value as Audience)}
          >
            {Object.entries(AUDIENCE).map(([value, text]) => (
              <option key={value} value={value}>
                {text}
              </option>
            ))}
          </select>
        </Field>
        {audience === 'city' ? (
          <Field label="المدينة">
            <select
              className="input"
              value={cityId}
              onChange={(event) => setCityId(event.target.value)}
              required
            >
              <option value="">— اختر —</option>
              {(cities.data ?? []).map((city) => (
                <option key={String(city['id'])} value={String(city['id'])}>
                  {String(city['name_ar'])}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
        <Field label="العنوان" hint="قصير وواضح — يظهر بخط عريض في الإشعار.">
          <input
            className="input"
            value={titleAr}
            onChange={(event) => setTitleAr(event.target.value)}
            required
            maxLength={60}
          />
        </Field>
        <Field label="النص">
          <textarea
            className="input"
            value={bodyAr}
            onChange={(event) => setBodyAr(event.target.value)}
            required
            rows={3}
            maxLength={180}
          />
        </Field>
        <Field
          label="العنوان بالإنجليزية"
          hint="لمن يستخدم التطبيق بالإنجليزية. يُستخدم العربي إن تُرك فارغاً."
        >
          <input
            className="input"
            dir="ltr"
            value={titleEn}
            onChange={(event) => setTitleEn(event.target.value)}
            maxLength={60}
          />
        </Field>
        <Field label="النص بالإنجليزية">
          <textarea
            className="input"
            dir="ltr"
            value={bodyEn}
            onChange={(event) => setBodyEn(event.target.value)}
            rows={3}
            maxLength={180}
          />
        </Field>
        {error !== null ? (
          <p className="notice" data-tone="bad" style={{ margin: 0 }}>
            {error}
          </p>
        ) : null}
        <Button
          type="submit"
          tone="primary"
          busy={busy}
          disabled={titleAr.trim() === '' || bodyAr.trim() === ''}
        >
          إرسال
        </Button>
        <p className="subtle" style={{ margin: 0 }}>
          لا تضع بيانات شخصية في الإشعارات — تظهر على شاشة القفل.
        </p>
      </form>
    </Card>
  );
}
