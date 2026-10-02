/**
 * People: every account, and each one's whole file.
 *
 * From the file an operator can rename, suspend or reinstate, and — for the
 * person's own data rights (PDPL) — export everything Habba holds about them
 * or erase it. Opening a file is itself recorded (0070): reading a person's
 * whole record is an act, not a glance.
 */

'use client';

import { useState } from 'react';
import { api, PAGE_SIZE } from '@/data/api';
import type { UserFile, UserRow } from '@/data/types';
import { dateTime, hijri, money, phone } from '@/lib/format';
import { label, ORDER_STATUS, ROLE, TRANSFER_STATUS, VERIFICATION } from '../labels';
import { go, hrefFor } from '../router';
import { useOperator } from '../shell';
import {
  ActionButton,
  Badge,
  Button,
  Card,
  DataTable,
  Field,
  KeyValue,
  LabelBadge,
  Loadable,
  NotesCard,
  PageHead,
  Pager,
  Tabs,
  useLoad,
  useToast,
} from '../ui';

type Filter = 'all' | 'customers' | 'providers' | 'staff' | 'suspended' | 'guests';

export function UsersSection({ id }: { readonly id: string | null }) {
  return id === null ? <UserList /> : <UserDetail id={id} />;
}

function UserList() {
  const [filter, setFilter] = useState<Filter>('all');
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const state = useLoad(() => api.users(query, filter, offset), `${filter}|${query}|${offset}`);

  return (
    <>
      <PageHead title="المستخدمون" description="كل الحسابات: العملاء، مقدّمو الخدمة، والفريق." />
      <Tabs<Filter>
        tabs={[
          { value: 'all', label: 'الكل' },
          { value: 'customers', label: 'عملاء' },
          { value: 'providers', label: 'مقدّمو خدمة' },
          { value: 'staff', label: 'الفريق' },
          { value: 'suspended', label: 'موقوفون' },
          { value: 'guests', label: 'زوّار' },
        ]}
        value={filter}
        onChange={(value) => {
          setFilter(value);
          setOffset(0);
        }}
      />
      <form
        className="toolbar"
        onSubmit={(event) => {
          event.preventDefault();
          setQuery(draft);
          setOffset(0);
        }}
      >
        <Field label="بحث">
          <input
            className="input"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="الاسم، الجوال (05…)، البريد"
          />
        </Field>
        <Button type="submit" tone="primary">
          بحث
        </Button>
      </form>
      <Loadable state={state}>
        {(rows) => (
          <>
            <DataTable<UserRow>
              rows={rows}
              rowKey={(row) => row.id}
              onRowClick={(row) => go('users', row.id)}
              empty="لا حسابات تطابق هذا البحث."
              columns={[
                {
                  label: 'الاسم',
                  render: (row) => (
                    <>
                      <strong>{row.full_name}</strong>
                      {row.suspended ? (
                        <>
                          {' '}
                          <Badge tone="bad">موقوف</Badge>
                        </>
                      ) : null}
                    </>
                  ),
                },
                {
                  label: 'الجوال',
                  render: (row) => <span className="numeric">{phone(row.phone)}</span>,
                },
                { label: 'البريد', render: (row) => row.email ?? '—' },
                {
                  label: 'الصلاحيات',
                  render: (row) => (
                    <span className="actions">
                      {row.roles.map((role) => (
                        <Badge
                          key={role}
                          tone={role === 'ops' || role === 'super_admin' ? 'brand' : 'neutral'}
                        >
                          {ROLE[role] ?? role}
                        </Badge>
                      ))}
                    </span>
                  ),
                },
                { label: 'الطلبات', numeric: true, render: (row) => row.orders_count },
                {
                  label: 'انضم',
                  render: (row) => <span className="numeric">{dateTime(row.created_at)}</span>,
                },
              ]}
            />
            <Pager
              offset={offset}
              pageSize={PAGE_SIZE}
              total={rows[0]?.total_count ?? 0}
              onChange={setOffset}
            />
          </>
        )}
      </Loadable>
    </>
  );
}

function UserDetail({ id }: { readonly id: string }) {
  const state = useLoad(() => api.user(id), id);
  return (
    <Loadable state={state}>
      {(file) => <UserFileView file={file} reload={state.reload} />}
    </Loadable>
  );
}

function UserFileView({ file, reload }: { readonly file: UserFile; readonly reload: () => void }) {
  const { profile } = file;
  const operator = useOperator();
  const isSuper = operator.role === 'super_admin';
  const activeSuspension =
    file.suspensions.find((suspension) => suspension.lifted_at === null) ?? null;
  const [name, setName] = useState(profile.full_name);

  return (
    <>
      <PageHead
        back={{ label: 'المستخدمون', href: hrefFor('users') }}
        title={
          <>
            {profile.full_name} {file.suspended ? <Badge tone="bad">موقوف</Badge> : null}
          </>
        }
        description={`انضم ${dateTime(profile.created_at)} · ${hijri(profile.created_at)}`}
        actions={
          <>
            <ActionButton
              label="تعديل الاسم"
              reason="none"
              fields={
                <Field label="الاسم الكامل">
                  <input
                    className="input"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                </Field>
              }
              onConfirm={() => api.rename(profile.id, name)}
              onDone={reload}
              success="حُدّث الاسم."
            />
            {file.suspended ? (
              <ActionButton
                label="إعادة تفعيل الحساب"
                tone="primary"
                reasonLabel="سبب إعادة التفعيل"
                onConfirm={(reason) => api.setSuspension(profile.id, false, reason)}
                onDone={reload}
                success="أُعيد تفعيل الحساب."
              />
            ) : (
              <ActionButton
                label="إيقاف الحساب"
                tone="danger"
                description="لن يستطيع إرسال طلبات، ولا استقبال أعمال أو الاتصال كفنّي، ويُمنع من تسجيل الدخول. الطلبات الجارية لا تُلغى تلقائياً."
                reasonHint="يظهر السبب للشخص في التطبيق."
                onConfirm={(reason) => api.setSuspension(profile.id, true, reason)}
                onDone={reload}
                success="أُوقف الحساب."
              />
            )}
          </>
        }
      />

      {activeSuspension !== null ? (
        <p className="notice" data-tone="bad">
          موقوف منذ {dateTime(activeSuspension.suspended_at)} بواسطة{' '}
          {activeSuspension.suspended_by_name ?? '—'}: «{activeSuspension.reason}»
        </p>
      ) : null}

      <div className="grid main-side">
        <div className="grid">
          <Card title="الطلبات">
            <DataTable
              rows={file.orders}
              rowKey={(order) => order.id}
              onRowClick={(order) => go('orders', order.id)}
              empty="لا طلبات."
              columns={[
                {
                  label: 'الطلب',
                  render: (order) => <span className="numeric">{order.order_number}</span>,
                },
                { label: 'الخدمة', render: (order) => order.service_name_ar },
                {
                  label: 'الحالة',
                  render: (order) => <LabelBadge value={label(ORDER_STATUS, order.status)} />,
                },
                { label: 'المبلغ', numeric: true, render: (order) => money(order.amount) },
                {
                  label: 'التاريخ',
                  render: (order) => <span className="numeric">{dateTime(order.created_at)}</span>,
                },
              ]}
            />
          </Card>

          <Card title="السيارات">
            <DataTable
              rows={file.vehicles}
              rowKey={(vehicle) => vehicle.id}
              onRowClick={(vehicle) => go('vehicles', vehicle.id)}
              empty="لا سيارات."
              columns={[
                {
                  label: 'اللوحة',
                  render: (vehicle) => `${vehicle.plate_ar} · ${vehicle.plate_en}`,
                },
                {
                  label: 'السيارة',
                  render: (vehicle) =>
                    `${vehicle.make_ar ?? ''} ${vehicle.model_ar ?? ''} ${vehicle.year}`,
                },
                {
                  label: 'العداد',
                  numeric: true,
                  render: (vehicle) =>
                    vehicle.current_mileage !== null ? `${vehicle.current_mileage} كم` : '—',
                },
                {
                  label: 'الحالة',
                  render: (vehicle) =>
                    vehicle.is_active ? 'نشطة' : <Badge tone="warn">موقوفة</Badge>,
                },
              ]}
            />
          </Card>

          {file.transfers.length > 0 ? (
            <Card title="نقل الملكية">
              <ul className="list">
                {file.transfers.map((transfer) => (
                  <li key={transfer.id} className="timeline-item">
                    <a className="link" href={hrefFor('vehicles', transfer.vehicle_id)}>
                      {transfer.direction === 'out' ? 'نقل إلى شخص آخر' : 'نقل إليه'}
                    </a>{' '}
                    <LabelBadge value={label(TRANSFER_STATUS, transfer.status)} />
                    <div className="subtle">{dateTime(transfer.created_at)}</div>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          <NotesCard table="profiles" id={profile.id} notes={file.notes} onChanged={reload} />
        </div>

        <div className="grid">
          <Card title="الحساب">
            <KeyValue
              items={[
                [
                  'الجوال',
                  <span key="p" className="numeric">
                    {phone(profile.phone)}
                  </span>,
                ],
                ['البريد', profile.email ?? '—'],
                ['اللغة', profile.preferred_locale === 'en' ? 'الإنجليزية' : 'العربية'],
                ['نوع الحساب', profile.is_guest ? 'زائر' : 'مسجّل'],
                ['تقييمات كتبها', String(file.ratings_given)],
                [
                  'الأجهزة',
                  file.devices.length === 0
                    ? 'لا إشعارات مفعّلة'
                    : file.devices
                        .map(
                          (device) =>
                            `${device.platform}${device.disabled_at !== null ? ' (متوقف)' : ''}`,
                        )
                        .join('، '),
                ],
              ]}
            />
          </Card>

          <Card title="الصلاحيات">
            <ul className="list">
              {file.roles.map((role) => (
                <li key={`${role.role}-${role.granted_at}`} className="timeline-item">
                  <Badge tone={role.revoked_at === null ? 'good' : 'neutral'}>
                    {ROLE[role.role] ?? role.role}
                  </Badge>{' '}
                  {role.revoked_at !== null ? (
                    <span className="subtle">سُحبت {dateTime(role.revoked_at)}</span>
                  ) : null}
                  <div className="subtle">
                    مُنحت {dateTime(role.granted_at)}
                    {role.granted_by_name !== null ? ` بواسطة ${role.granted_by_name}` : ''}
                  </div>
                </li>
              ))}
            </ul>
            {file.provider !== null ? (
              <p style={{ marginBottom: 0 }}>
                <a className="link" href={hrefFor('providers', file.provider.id)}>
                  ملف مقدّم الخدمة: {file.provider.business_name_ar}
                </a>{' '}
                <LabelBadge value={label(VERIFICATION, file.provider.verification_status)} />
              </p>
            ) : null}
            <p className="subtle" style={{ marginBottom: 0 }}>
              صلاحيات الفنّي والورشة تتبع اعتماد ملف مقدّم الخدمة. صلاحيات الفريق من قسم «الفريق».
            </p>
          </Card>

          {file.suspensions.length > 0 ? (
            <Card title="سجل الإيقاف">
              <ul className="list">
                {file.suspensions.map((suspension) => (
                  <li key={suspension.id} className="timeline-item">
                    «{suspension.reason}»
                    <div className="subtle">
                      {dateTime(suspension.suspended_at)} · {suspension.suspended_by_name ?? '—'}
                    </div>
                    {suspension.lifted_at !== null ? (
                      <div className="subtle">
                        رُفع {dateTime(suspension.lifted_at)}: {suspension.lift_note}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          <Card title="بيانات الشخص (نظام حماية البيانات)">
            <p className="subtle" style={{ marginTop: 0 }}>
              حق الاطلاع وحق الحذف. كل طلب يُسجَّل مع سببه ومن نفّذه.
            </p>
            <div className="actions">
              <ExportData userId={profile.id} fullName={profile.full_name} onDone={reload} />
              {isSuper ? (
                <ActionButton
                  label="حذف بيانات الحساب"
                  tone="danger"
                  description="يُزال الاسم والجوال والبريد والعناوين والأجهزة، ويُوقف الحساب نهائياً. تبقى الفواتير (نظام الفوترة يوجب حفظها) ويبقى دفتر السيارة مع السيارة. لا يمكن التراجع."
                  reasonLabel="كيف وصل الطلب ومتى؟"
                  confirmLabel="حذف نهائي"
                  onConfirm={(reason) => api.anonymiseUser(profile.id, reason)}
                  onDone={reload}
                  success="حُذفت بيانات الحساب."
                />
              ) : null}
            </div>
            {file.data_requests.length > 0 ? (
              <ul className="list" style={{ marginTop: 'var(--space-md)' }}>
                {file.data_requests.map((request, index) => (
                  <li key={index} className="timeline-item">
                    {request.kind === 'export' ? 'تصدير' : 'حذف'} — {request.reason}
                    <div className="subtle">{dateTime(request.handled_at)}</div>
                  </li>
                ))}
              </ul>
            ) : null}
          </Card>
        </div>
      </div>
    </>
  );
}

function ExportData({
  userId,
  fullName,
  onDone,
}: {
  readonly userId: string;
  readonly fullName: string;
  readonly onDone: () => void;
}) {
  const toast = useToast();
  return (
    <ActionButton
      label="تصدير كل بياناته"
      description="ملف JSON بكل ما تحفظه هبّة عن هذا الشخص، لتسليمه له."
      reasonLabel="من طلب النسخة وكيف؟"
      onConfirm={async (reason) => {
        const data = await api.exportUserData(userId, reason);
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `habba-data-${fullName.replace(/\s+/g, '-')}-${new Date().toISOString().slice(0, 10)}.json`;
        link.click();
        URL.revokeObjectURL(url);
        toast('نُزّل الملف.');
      }}
      onDone={onDone}
      success="صُدّرت البيانات."
    />
  );
}
