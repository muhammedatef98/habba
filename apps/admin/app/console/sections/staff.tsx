/**
 * The team: who can open this console, and with what powers.
 *
 * Only a super admin grants or removes staff roles (0070), and never their
 * own super-admin role — so there is always one left. Each person still needs
 * their own two-factor sign-in (0068); being made an operator gives nothing
 * until they have enrolled.
 */

'use client';

import { useState } from 'react';
import { api } from '@/data/api';
import type { StaffMember, StaffRole, UserRow } from '@/data/types';
import { explain } from '@/data/transport';
import { dateTime, phone } from '@/lib/format';
import { hrefFor } from '../router';
import { useOperator } from '../shell';
import {
  ActionButton,
  Badge,
  Button,
  Card,
  DataTable,
  Field,
  Loadable,
  PageHead,
  useLoad,
} from '../ui';

export function StaffSection() {
  const operator = useOperator();
  const isSuper = operator.role === 'super_admin';
  const state = useLoad(() => api.staff(), 'staff');

  return (
    <>
      <PageHead
        title="الفريق"
        description="من يستطيع فتح لوحة التشغيل. المشغّل يدير العمليات اليومية؛ المشرف العام يدير الفريق ويحذف بيانات الحسابات."
      />
      {!isSuper ? <p className="notice">إضافة أعضاء الفريق وإزالتهم للمشرف العام فقط.</p> : null}
      <div className="grid main-side">
        <Card title="أعضاء الفريق">
          <Loadable state={state}>
            {(rows) => (
              <DataTable<StaffMember>
                rows={rows}
                rowKey={(row) => `${row.user_id}-${row.role}`}
                empty="لا أحد."
                columns={[
                  {
                    label: 'الاسم',
                    render: (row) => (
                      <a className="link" href={hrefFor('users', row.user_id)}>
                        {row.full_name}
                      </a>
                    ),
                  },
                  { label: 'البريد', render: (row) => row.email ?? '—' },
                  {
                    label: 'الجوال',
                    render: (row) => <span className="numeric">{phone(row.phone)}</span>,
                  },
                  {
                    label: 'الدور',
                    render: (row) => (
                      <Badge tone={row.role === 'super_admin' ? 'brand' : 'neutral'}>
                        {row.role === 'super_admin' ? 'مشرف عام' : 'مشغّل'}
                      </Badge>
                    ),
                  },
                  {
                    label: 'منذ',
                    render: (row) => (
                      <>
                        <span className="numeric">{dateTime(row.granted_at)}</span>
                        {row.granted_by_name !== null ? (
                          <div className="subtle">بواسطة {row.granted_by_name}</div>
                        ) : null}
                      </>
                    ),
                  },
                  {
                    label: '',
                    render: (row) =>
                      isSuper && !(row.user_id === operator.id && row.role === 'super_admin') ? (
                        <ActionButton
                          label="إزالة"
                          size="small"
                          tone="danger"
                          reason="none"
                          description={`سحب دور «${row.role === 'super_admin' ? 'مشرف عام' : 'مشغّل'}» من ${row.full_name}. يفقد الوصول فوراً.`}
                          onConfirm={() => api.setStaffRole(row.user_id, row.role, false)}
                          onDone={state.reload}
                          success="أُزيل الدور."
                        />
                      ) : null,
                  },
                ]}
              />
            )}
          </Loadable>
        </Card>
        {isSuper ? <AddStaff onAdded={state.reload} /> : null}
      </div>
    </>
  );
}

function AddStaff({ onAdded }: { readonly onAdded: () => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<readonly UserRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState<StaffRole>('ops');

  const search = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      setResults(await api.users(query, 'all', 0));
    } catch (cause) {
      setError(explain(cause));
    }
  };

  return (
    <Card title="إضافة عضو">
      <p className="subtle" style={{ marginTop: 0 }}>
        يجب أن يكون لديه حساب في هبّة أولاً. بعد إضافته يسجّل الدخول ويُعدّ التحقق بخطوتين بنفسه.
      </p>
      <form onSubmit={search} style={{ display: 'grid', gap: 'var(--space-sm)' }}>
        <Field label="ابحث عن الحساب">
          <input
            className="input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="الاسم، الجوال، البريد"
          />
        </Field>
        <Field label="الدور">
          <select
            className="input"
            value={role}
            onChange={(event) => setRole(event.target.value as StaffRole)}
          >
            <option value="ops">مشغّل</option>
            <option value="super_admin">مشرف عام</option>
          </select>
        </Field>
        <Button type="submit">بحث</Button>
      </form>
      {error !== null ? (
        <p className="notice" data-tone="bad">
          {error}
        </p>
      ) : null}
      <ul className="list" style={{ marginTop: 'var(--space-md)' }}>
        {results.map((user) => (
          <li key={user.id} className="timeline-item">
            <strong>{user.full_name}</strong>{' '}
            <span className="subtle numeric">{phone(user.phone)}</span>
            {user.suspended ? <Badge tone="bad">موقوف</Badge> : null}
            <div>
              <ActionButton
                label={`تعيين ${role === 'super_admin' ? 'مشرفاً عاماً' : 'مشغّلاً'}`}
                size="small"
                tone="primary"
                reason="none"
                description={`${user.full_name} سيتمكّن من فتح لوحة التشغيل بعد إعداد التحقق بخطوتين.`}
                onConfirm={() => api.setStaffRole(user.id, role, true)}
                onDone={onAdded}
                success="أُضيف إلى الفريق."
              />
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
