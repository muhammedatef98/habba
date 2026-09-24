/**
 * Providers: the verification queue, every technician and workshop, and each
 * one's file.
 *
 * Approval is what makes someone a provider (CLAUDE.md §5.1.1) — the role
 * follows the record, and match_providers will not consider anyone who is not
 * approved. So the queue is the first tab. Every decision goes through
 * set_provider_verification (0052), which writes the status and the reason in
 * one transaction and refuses a rejection with no stated reason.
 */

'use client';

import { useState } from 'react';
import { api, PAGE_SIZE } from '@/data/api';
import type { ProviderFile, ProviderRow, VerificationStatus } from '@/data/types';
import { date, dateTime, hijri, money, phone, riyadhToday, since } from '@/lib/format';
import { label, ORDER_STATUS, PAYOUT_STATUS, VERIFICATION } from '../labels';
import { go, hrefFor } from '../router';
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
  Stat,
  Tabs,
  useLoad,
  useToast,
} from '../ui';
import { explain } from '@/data/transport';

type View = VerificationStatus | 'all';

export function ProvidersSection({ id }: { readonly id: string | null }) {
  return id === null ? <ProviderList /> : <ProviderDetail id={id} />;
}

function ProviderList() {
  const [view, setView] = useState<View>('pending');
  const [draft, setDraft] = useState('');
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const state = useLoad(
    () => api.providers(view === 'all' ? '' : view, query, null, offset),
    `${view}|${query}|${offset}`,
  );

  return (
    <>
      <PageHead
        title="مقدّمو الخدمة"
        description="الاعتماد يعني أن هبّة تضمن هذا الشخص أمام عميل ينتظره على الطريق. كل قرار يُسجَّل باسم من اتخذه."
      />
      <Tabs<View>
        tabs={[
          { value: 'pending', label: 'بانتظار المراجعة' },
          { value: 'in_review', label: 'قيد المراجعة' },
          { value: 'approved', label: 'معتمدون' },
          { value: 'rejected', label: 'مرفوضون' },
          { value: 'suspended', label: 'موقوفون' },
          { value: 'all', label: 'الكل' },
        ]}
        value={view}
        onChange={(value) => {
          setView(value);
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
            placeholder="الاسم التجاري، السجل التجاري، الجوال"
          />
        </Field>
        <Button type="submit" tone="primary">
          بحث
        </Button>
      </form>
      <Loadable state={state}>
        {(rows) => (
          <>
            <DataTable<ProviderRow>
              rows={rows}
              rowKey={(row) => row.id}
              onRowClick={(row) => go('providers', row.id)}
              empty="لا أحد في هذه القائمة."
              columns={[
                {
                  label: 'الاسم',
                  render: (row) => (
                    <>
                      <strong>{row.business_name_ar}</strong>
                      <div className="subtle">
                        {row.provider_type === 'workshop' ? 'ورشة' : 'فنّي'}
                        {row.city_name_ar !== null ? ` · ${row.city_name_ar}` : ''}
                      </div>
                    </>
                  ),
                },
                {
                  label: 'الاعتماد',
                  render: (row) => (
                    <LabelBadge value={label(VERIFICATION, row.verification_status)} />
                  ),
                },
                {
                  label: 'نفاذ',
                  render: (row) =>
                    row.nafath_verified_at !== null ? (
                      <Badge tone="good">موثّق</Badge>
                    ) : (
                      <Badge tone="warn">غير موثّق</Badge>
                    ),
                },
                {
                  label: 'الجوال',
                  render: (row) => <span className="numeric">{phone(row.owner_phone)}</span>,
                },
                {
                  label: 'الحالة',
                  render: (row) =>
                    row.suspended ? (
                      <Badge tone="bad">حساب موقوف</Badge>
                    ) : row.is_online ? (
                      <Badge tone="good">متصل</Badge>
                    ) : (
                      <Badge>غير متصل</Badge>
                    ),
                },
                {
                  label: 'التقييم',
                  numeric: true,
                  render: (row) =>
                    row.rating_count > 0
                      ? `${Number(row.rating_avg).toFixed(2)} (${row.rating_count})`
                      : '—',
                },
                { label: 'أعمال', numeric: true, render: (row) => row.jobs_completed },
                { label: 'تقدّم منذ', render: (row) => since(row.created_at) },
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

function ProviderDetail({ id }: { readonly id: string }) {
  const state = useLoad(() => api.provider(id), id);
  return (
    <Loadable state={state}>
      {(file) => <ProviderFileView file={file} reload={state.reload} />}
    </Loadable>
  );
}

const DECISIONS: readonly {
  readonly status: VerificationStatus;
  readonly label: string;
  readonly tone: 'primary' | 'neutral' | 'danger';
}[] = [
  { status: 'approved', label: 'اعتماد', tone: 'primary' },
  { status: 'in_review', label: 'قيد المراجعة', tone: 'neutral' },
  { status: 'rejected', label: 'رفض', tone: 'danger' },
  { status: 'suspended', label: 'إيقاف الاعتماد', tone: 'danger' },
];

function ProviderFileView({
  file,
  reload,
}: {
  readonly file: ProviderFile;
  readonly reload: () => void;
}) {
  const { provider, owner, stats } = file;
  const acceptance =
    stats.offers_sent > 0
      ? `${Math.round((stats.offers_accepted / stats.offers_sent) * 100)}%`
      : '—';

  return (
    <>
      <PageHead
        back={{ label: 'مقدّمو الخدمة', href: hrefFor('providers') }}
        title={
          <>
            {provider.business_name_ar}{' '}
            <LabelBadge value={label(VERIFICATION, provider.verification_status)} />
          </>
        }
        description={`${provider.provider_type === 'workshop' ? 'ورشة' : 'فنّي متنقل'}${file.city !== null ? ` · ${file.city.name_ar}` : ''} · تقدّم ${dateTime(provider.created_at)}`}
        actions={
          <>
            {DECISIONS.filter((decision) => decision.status !== provider.verification_status).map(
              (decision) => (
                <ActionButton
                  key={decision.status}
                  label={decision.label}
                  tone={decision.tone}
                  reason={
                    decision.status === 'rejected' || decision.status === 'suspended'
                      ? 'required'
                      : 'optional'
                  }
                  reasonLabel={
                    decision.status === 'rejected' || decision.status === 'suspended'
                      ? 'السبب'
                      : 'ملاحظة (اختيارية)'
                  }
                  reasonHint={
                    decision.status === 'rejected' || decision.status === 'suspended'
                      ? 'يُعرض على مقدّم الخدمة وله حق الاعتراض.'
                      : 'تُحفظ في سجل الاعتماد.'
                  }
                  description={
                    decision.status === 'approved' && provider.nafath_verified_at === null
                      ? 'تنبيه: هويته غير موثّقة عبر نفاذ. الاعتماد بدونها قرار تتحمّله باسمك.'
                      : undefined
                  }
                  onConfirm={(note) =>
                    api.setVerification(provider.id, decision.status, note === '' ? null : note)
                  }
                  onDone={reload}
                  success="حُفظ القرار."
                />
              ),
            )}
            {provider.is_online ? (
              <ActionButton
                label="قطع الاتصال"
                description="يُخرجه من الخدمة الآن فلا تصله عروض، حتى يتصل من جديد."
                onConfirm={(reason) => api.forceOffline(provider.id, reason)}
                onDone={reload}
                success="قُطع اتصاله."
              />
            ) : null}
          </>
        }
      />

      {owner.suspended ? (
        <p className="notice" data-tone="bad">
          حساب صاحب هذا الملف موقوف.{' '}
          <a className="link" href={hrefFor('users', owner.id)}>
            فتح الحساب
          </a>
        </p>
      ) : null}

      <div className="stats">
        <Stat label="أعمال مكتملة" value={stats.completed} />
        <Stat label="ملغاة" value={stats.cancelled} />
        <Stat
          label="شكاوى"
          value={stats.disputed}
          tone={stats.disputed > 0 ? 'alert' : undefined}
        />
        <Stat label="قبول العروض" value={acceptance} />
        <Stat
          label="التقييم"
          value={provider.rating_count > 0 ? Number(provider.rating_avg).toFixed(2) : '—'}
        />
        <Stat label="إجمالي الأعمال المحصّلة" value={money(stats.earned)} />
      </div>

      <div className="grid main-side">
        <div className="grid">
          <ServicesCard file={file} onChanged={reload} />

          <Card title="آخر الأعمال">
            <DataTable
              rows={file.orders}
              rowKey={(order) => order.id}
              onRowClick={(order) => go('orders', order.id)}
              empty="لا أعمال بعد."
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

          <PayoutsCard file={file} onChanged={reload} />

          <Card title="التقييمات">
            {file.ratings.length === 0 ? (
              <p className="muted">لا تقييمات.</p>
            ) : (
              <ul className="list">
                {file.ratings.map((rating) => (
                  <li key={rating.id} className="timeline-item">
                    {'★'.repeat(rating.stars)}
                    {'☆'.repeat(5 - rating.stars)}{' '}
                    {rating.hidden_at !== null ? (
                      <Badge tone="warn">مخفي: {rating.hidden_reason}</Badge>
                    ) : null}
                    {rating.comment !== null ? <div>«{rating.comment}»</div> : null}
                    <div className="subtle">{dateTime(rating.created_at)}</div>
                  </li>
                ))}
              </ul>
            )}
            <a className="link" href={hrefFor('ratings')}>
              إخفاء أو إظهار تقييم
            </a>
          </Card>

          <NotesCard table="providers" id={provider.id} notes={file.notes} onChanged={reload} />
        </div>

        <div className="grid">
          <Card title="الهوية والبيانات">
            <KeyValue
              items={[
                [
                  'صاحب الحساب',
                  <a key="o" className="link" href={hrefFor('users', owner.id)}>
                    {owner.full_name}
                  </a>,
                ],
                [
                  'الجوال',
                  <span key="p" className="numeric">
                    {phone(owner.phone)}
                  </span>,
                ],
                ['البريد', owner.email ?? '—'],
                [
                  'نفاذ',
                  provider.nafath_verified_at !== null ? (
                    <Badge key="n" tone="good">
                      موثّق {date(provider.nafath_verified_at)}
                    </Badge>
                  ) : (
                    <Badge key="n" tone="warn">
                      غير موثّق
                    </Badge>
                  ),
                ],
                ['الهوية/الإقامة', provider.has_national_id ? 'محفوظة (مشفّرة)' : 'لم تُقدَّم'],
                ['الآيبان', provider.has_iban ? 'محفوظ (مشفّر)' : 'لم يُقدَّم'],
                [
                  'السجل التجاري',
                  <span key="cr" className="numeric">
                    {provider.cr_number ?? '—'}
                  </span>,
                ],
                [
                  'الرقم الضريبي',
                  <span key="vat" className="numeric">
                    {provider.vat_number ?? '—'}
                  </span>,
                ],
                ['الاسم بالإنجليزية', provider.business_name_en ?? '—'],
              ]}
            />
            <p className="subtle" style={{ marginBottom: 0 }}>
              رقم الهوية والآيبان مشفّران ولا يظهران في اللوحة لأحد. التحقق من الهوية يتم عبر نفاذ.
            </p>
          </Card>

          <Card title="الموقع والتشغيل">
            <KeyValue
              items={[
                ['متصل الآن', provider.is_online ? 'نعم' : 'لا'],
                [
                  'آخر موقع',
                  file.location !== null ? (
                    <a
                      key="l"
                      className="link"
                      href={`https://www.google.com/maps?q=${file.location.lat},${file.location.lon}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      قبل {since(file.location.updated_at)}
                    </a>
                  ) : (
                    '—'
                  ),
                ],
                [
                  'نسبة القبول المسجّلة',
                  provider.acceptance_rate !== null ? `${provider.acceptance_rate}%` : '—',
                ],
                ...(file.workshop !== null
                  ? ([
                      ['عنوان الورشة', file.workshop.address_ar],
                      ['عدد المداخل', String(file.workshop.bay_count)],
                    ] as const)
                  : []),
              ]}
            />
          </Card>

          <Card title="سجل الاعتماد">
            {file.verification_events.length === 0 ? (
              <p className="muted">لا قرارات بعد.</p>
            ) : (
              <ul className="list">
                {file.verification_events.map((event, index) => (
                  <li key={index} className="timeline-item" data-tone="brand">
                    {event.from !== null ? `${label(VERIFICATION, event.from).text} ← ` : ''}
                    <strong>{label(VERIFICATION, event.to).text}</strong>
                    {event.note !== null ? <div>«{event.note}»</div> : null}
                    <div className="subtle">
                      {event.actor_name ?? '—'} · {dateTime(event.at)} · {hijri(event.at)}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

function ServicesCard({
  file,
  onChanged,
}: {
  readonly file: ProviderFile;
  readonly onChanged: () => void;
}) {
  const toast = useToast();
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = async (serviceId: string, offered: boolean, price: string) => {
    setBusy(serviceId);
    setError(null);
    try {
      await api.setProviderService(
        file.provider.id,
        serviceId,
        offered,
        price.trim() === '' ? null : Number(price),
      );
      toast('حُفظت الخدمة.');
      onChanged();
    } catch (cause) {
      setError(explain(cause));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card title="الخدمات والأسعار">
      <p className="subtle" style={{ marginTop: 0 }}>
        السعر الخاص يحلّ محل سعر الكتالوج لهذا المقدّم فقط. اتركه فارغاً لاستخدام سعر الكتالوج.
      </p>
      {error !== null ? (
        <p className="notice" data-tone="bad">
          {error}
        </p>
      ) : null}
      <DataTable
        rows={file.services}
        rowKey={(service) => service.service_id}
        columns={[
          { label: 'الخدمة', render: (service) => service.name_ar },
          { label: 'سعر الكتالوج', numeric: true, render: (service) => money(service.base_price) },
          {
            label: 'السعر الخاص',
            render: (service) => (
              <input
                className="input numeric"
                style={{ maxWidth: 120 }}
                inputMode="decimal"
                value={
                  prices[service.service_id] ??
                  (service.custom_price !== null ? String(service.custom_price) : '')
                }
                onChange={(event) =>
                  setPrices({ ...prices, [service.service_id]: event.target.value })
                }
                disabled={!service.offered}
              />
            ),
          },
          {
            label: '',
            render: (service) => (
              <span className="actions">
                {service.offered ? (
                  <>
                    <Button
                      size="small"
                      busy={busy === service.service_id}
                      onClick={() =>
                        void save(
                          service.service_id,
                          true,
                          prices[service.service_id] ??
                            (service.custom_price !== null ? String(service.custom_price) : ''),
                        )
                      }
                    >
                      حفظ السعر
                    </Button>
                    <Button
                      size="small"
                      tone="danger"
                      onClick={() => void save(service.service_id, false, '')}
                    >
                      إيقاف الخدمة
                    </Button>
                  </>
                ) : (
                  <Button
                    size="small"
                    tone="primary"
                    onClick={() => void save(service.service_id, true, '')}
                  >
                    تفعيل
                  </Button>
                )}
              </span>
            ),
          },
        ]}
      />
    </Card>
  );
}

function PayoutsCard({
  file,
  onChanged,
}: {
  readonly file: ProviderFile;
  readonly onChanged: () => void;
}) {
  const [from, setFrom] = useState(riyadhToday(-14));
  const [to, setTo] = useState(riyadhToday(-1));

  return (
    <Card
      title="المستحقات"
      actions={
        <ActionButton
          label="إنشاء دفعة مستحقات"
          size="small"
          reason="none"
          description="تجمع الطلبات المكتملة المحصّلة في الفترة، غير المصروفة سابقاً، وتخصم العمولة من الصافي قبل الضريبة وبعد أي استرداد."
          fields={
            <>
              <Field label="من">
                <input
                  className="input"
                  type="date"
                  value={from}
                  onChange={(event) => setFrom(event.target.value)}
                />
              </Field>
              <Field label="إلى">
                <input
                  className="input"
                  type="date"
                  value={to}
                  onChange={(event) => setTo(event.target.value)}
                />
              </Field>
            </>
          }
          onConfirm={() => api.buildPayout(file.provider.id, from, to)}
          onDone={onChanged}
          success="أُنشئت الدفعة — راجعها في قسم المالية."
        />
      }
    >
      <DataTable
        rows={file.payouts}
        rowKey={(payout) => payout.id}
        empty="لا دفعات بعد."
        columns={[
          {
            label: 'الفترة',
            render: (payout) => (
              <span className="numeric">
                {payout.period_start} – {payout.period_end}
              </span>
            ),
          },
          { label: 'الطلبات', numeric: true, render: (payout) => payout.order_count },
          { label: 'الإجمالي', numeric: true, render: (payout) => money(payout.gross_amount) },
          { label: 'العمولة', numeric: true, render: (payout) => money(payout.commission) },
          {
            label: 'الصافي',
            numeric: true,
            render: (payout) => <strong>{money(payout.net_amount)}</strong>,
          },
          {
            label: 'الحالة',
            render: (payout) => <LabelBadge value={label(PAYOUT_STATUS, payout.status)} />,
          },
        ]}
      />
      <p className="subtle" style={{ marginBottom: 0 }}>
        اعتماد الدفعات وتسجيل التحويل من{' '}
        <a className="link" href={hrefFor('finance')}>
          قسم المالية
        </a>
        .
      </p>
    </Card>
  );
}
