/**
 * Orders: every order ever placed, and each one's whole file.
 *
 * The file is where an operator acts on an order: cancel it, give it to a
 * named technician, search again, confirm it for a customer who confirmed by
 * phone, open or resolve a complaint. Which of those appear depends on where
 * the order stands — the server decides whether each is allowed (0070); the
 * screen only avoids offering what would certainly be refused.
 */

'use client';

import { useState } from 'react';
import { api, PAGE_SIZE, type OrderFilter } from '@/data/api';
import type { OrderFile, OrderRow } from '@/data/types';
import { dateTime, hijri, money, phone } from '@/lib/format';
import {
  ESCROW,
  HOLD_KIND,
  HOLD_STATUS,
  label,
  MODE,
  ORDER_STATUS,
  ORDER_STATUS_FILTERS,
  PAYMENT_KIND,
  PAYMENT_OPERATION,
  RESOLUTION,
  VERIFICATION,
} from '../labels';
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
  useLoad,
} from '../ui';

export function OrdersSection({ id }: { readonly id: string | null }) {
  return id === null ? <OrderList /> : <OrderDetail id={id} />;
}

function OrderList() {
  const [draft, setDraft] = useState<OrderFilter>({ status: 'open' });
  const [filter, setFilter] = useState<OrderFilter>({ status: 'open' });
  const state = useLoad(() => api.orders(filter), JSON.stringify(filter));

  const apply = (event: React.FormEvent) => {
    event.preventDefault();
    setFilter({ ...draft, offset: 0 });
  };

  return (
    <>
      <PageHead
        title="الطلبات"
        description="كل طلب في هبّة. اضغط على طلب لفتح ملفه الكامل والتصرّف فيه."
      />

      <form className="toolbar" onSubmit={apply}>
        <Field label="بحث">
          <input
            className="input"
            value={draft.query ?? ''}
            onChange={(event) => setDraft({ ...draft, query: event.target.value })}
            placeholder="رقم الطلب، اسم العميل، الجوال، مقدّم الخدمة"
          />
        </Field>
        <Field label="الحالة">
          <select
            className="input"
            value={draft.status ?? ''}
            onChange={(event) => setDraft({ ...draft, status: event.target.value })}
          >
            {ORDER_STATUS_FILTERS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.text}
              </option>
            ))}
          </select>
        </Field>
        <Field label="النوع">
          <select
            className="input"
            value={draft.mode ?? ''}
            onChange={(event) => setDraft({ ...draft, mode: event.target.value })}
          >
            <option value="">الكل</option>
            {Object.entries(MODE).map(([value, text]) => (
              <option key={value} value={value}>
                {text}
              </option>
            ))}
          </select>
        </Field>
        <Field label="من">
          <input
            className="input"
            type="date"
            value={draft.from ?? ''}
            onChange={(event) => setDraft({ ...draft, from: event.target.value })}
          />
        </Field>
        <Field label="إلى">
          <input
            className="input"
            type="date"
            value={draft.to ?? ''}
            onChange={(event) => setDraft({ ...draft, to: event.target.value })}
          />
        </Field>
        <Button type="submit" tone="primary">
          تطبيق
        </Button>
      </form>

      <Loadable state={state}>
        {(rows) => (
          <>
            <DataTable<OrderRow>
              rows={rows}
              rowKey={(row) => row.id}
              onRowClick={(row) => go('orders', row.id)}
              empty="لا طلبات تطابق هذا البحث."
              columns={[
                {
                  label: 'الطلب',
                  render: (row) => (
                    <>
                      <strong className="numeric">{row.order_number}</strong>
                      <div className="subtle">{row.service_name_ar}</div>
                      {/* The kind of order under its service, rather than a
                          column of its own that squeezed every other one. */}
                      <div className="subtle">
                        {MODE[row.fulfilment_mode] ?? row.fulfilment_mode}
                      </div>
                    </>
                  ),
                },
                {
                  label: 'الحالة',
                  render: (row) => <LabelBadge value={label(ORDER_STATUS, row.status)} />,
                },
                {
                  label: 'العميل',
                  nowrap: true,
                  render: (row) => (
                    <>
                      {row.customer_name}
                      <div className="subtle numeric">{phone(row.customer_phone)}</div>
                    </>
                  ),
                },
                {
                  label: 'مقدّم الخدمة',
                  nowrap: true,
                  render: (row) => row.provider_name_ar ?? '—',
                },
                {
                  label: 'المبلغ',
                  numeric: true,
                  render: (row) => (
                    <>
                      {money(row.total_amount)}
                      {row.refunded_amount > 0 ? (
                        <div className="subtle">مسترد {money(row.refunded_amount)}</div>
                      ) : null}
                    </>
                  ),
                },
                {
                  label: 'الدفع',
                  render: (row) => <LabelBadge value={label(ESCROW, row.escrow_status)} />,
                },
                {
                  label: 'أُنشئ',
                  render: (row) => <span className="numeric">{dateTime(row.created_at)}</span>,
                },
              ]}
            />
            <Pager
              offset={filter.offset ?? 0}
              pageSize={PAGE_SIZE}
              total={rows[0]?.total_count ?? 0}
              onChange={(offset) => setFilter({ ...filter, offset })}
            />
          </>
        )}
      </Loadable>
    </>
  );
}

function OrderDetail({ id }: { readonly id: string }) {
  const state = useLoad(() => api.order(id), id);

  return (
    <Loadable state={state}>
      {(file) => <OrderFileView file={file} reload={state.reload} />}
    </Loadable>
  );
}

const OPEN = new Set([
  'draft',
  'searching',
  'quoted',
  'accepted',
  'checked_in',
  'en_route',
  'arrived',
  'in_progress',
  'awaiting_approval',
]);

function OrderFileView({
  file,
  reload,
}: {
  readonly file: OrderFile;
  readonly reload: () => void;
}) {
  const { order } = file;
  const openDispute = file.disputes.find((dispute) => dispute.resolved_at === null) ?? null;
  const mapHref =
    order.lat !== null && order.lon !== null
      ? `https://www.google.com/maps?q=${order.lat},${order.lon}`
      : null;

  return (
    <>
      <PageHead
        back={{ label: 'الطلبات', href: hrefFor('orders') }}
        title={
          <>
            <span className="numeric">{order.order_number}</span>{' '}
            <LabelBadge value={label(ORDER_STATUS, order.status)} />
          </>
        }
        description={`${file.service.name_ar} · ${MODE[order.fulfilment_mode] ?? order.fulfilment_mode}`}
        actions={<OrderActions file={file} reload={reload} />}
      />

      {openDispute !== null ? (
        <p className="notice" data-tone="bad">
          شكوى مفتوحة منذ {dateTime(openDispute.opened_at)}: «{openDispute.reason}»
        </p>
      ) : null}

      <div className="grid main-side">
        <div className="grid">
          <Card title="الطلب">
            <KeyValue
              items={[
                ['أُنشئ', `${dateTime(order.created_at)} · ${hijri(order.created_at)}`],
                ['الموعد', order.scheduled_for !== null ? dateTime(order.scheduled_for) : '—'],
                ['العنوان', order.service_address_ar ?? '—'],
                [
                  'الموقع',
                  mapHref !== null ? (
                    <a className="link" href={mapHref} target="_blank" rel="noreferrer">
                      فتح في الخريطة
                    </a>
                  ) : (
                    '—'
                  ),
                ],
                ['وصف المشكلة', order.problem_description ?? '—'],
                [
                  'العداد عند الطلب',
                  order.mileage_at_order !== null ? `${order.mileage_at_order} كم` : '—',
                ],
                [
                  'العداد عند الإنجاز',
                  order.completion_mileage !== null ? `${order.completion_mileage} كم` : '—',
                ],
                ['جولات البحث', String(order.dispatch_round)],
                ['اكتمل', dateTime(order.completed_at)],
                [
                  'أُلغي',
                  order.cancelled_at !== null
                    ? `${dateTime(order.cancelled_at)} — ${order.cancellation_reason ?? ''}`
                    : '—',
                ],
                [
                  'الضمان',
                  order.warranty_days !== null
                    ? `${order.warranty_days} يوماً${order.warranty_expires_at !== null ? ` — حتى ${dateTime(order.warranty_expires_at)}` : ''}`
                    : '—',
                ],
                [
                  'طلب أصلي',
                  file.parent_order !== null ? (
                    <a className="link" href={hrefFor('orders', file.parent_order.id)}>
                      {file.parent_order.order_number} (إعادة خدمة تحت الضمان)
                    </a>
                  ) : (
                    '—'
                  ),
                ],
              ]}
            />
          </Card>

          <Card title="المسار">
            <ul className="list">
              {file.events.map((event, index) => (
                <li key={index} className="timeline-item" data-tone="brand">
                  <div>
                    {event.from !== null ? `${label(ORDER_STATUS, event.from).text} ← ` : ''}
                    <strong>{label(ORDER_STATUS, event.to).text}</strong>
                  </div>
                  <div className="subtle">
                    {event.actor_name ?? 'النظام'} · {dateTime(event.at)}
                    {event.note !== null ? ` · ${event.note}` : ''}
                  </div>
                </li>
              ))}
            </ul>
          </Card>

          {file.parts.length > 0 ? (
            <Card title="قطع الغيار">
              <DataTable
                rows={file.parts}
                rowKey={(part) => part.id}
                columns={[
                  { label: 'القطعة', render: (part) => part.name_ar },
                  {
                    label: 'رقم القطعة',
                    render: (part) => <span className="numeric">{part.part_number ?? '—'}</span>,
                  },
                  { label: 'النوع', render: (part) => (part.is_oem ? 'أصلية' : 'تجارية') },
                  { label: 'الكمية', numeric: true, render: (part) => part.quantity },
                  { label: 'السعر', numeric: true, render: (part) => money(part.unit_price) },
                  {
                    label: 'العميل',
                    render: (part) =>
                      part.approved_by_customer ? (
                        <Badge tone="good">وافق</Badge>
                      ) : part.declined_at !== null ? (
                        <Badge tone="bad">رفض</Badge>
                      ) : (
                        <Badge tone="warn">لم يُجب</Badge>
                      ),
                  },
                ]}
              />
            </Card>
          ) : null}

          <Card title="العروض المرسلة">
            <DataTable
              rows={file.offers}
              rowKey={(offer) => `${offer.provider_id}-${offer.round}`}
              empty="لم يُرسل الطلب لأي فنّي."
              onRowClick={(offer) => go('providers', offer.provider_id)}
              columns={[
                { label: 'مقدّم الخدمة', render: (offer) => offer.provider_name_ar },
                { label: 'الجولة', numeric: true, render: (offer) => offer.round },
                {
                  label: 'النطاق',
                  numeric: true,
                  render: (offer) => `${Math.round(offer.radius_m / 1000)} كم`,
                },
                {
                  label: 'أُرسل',
                  render: (offer) => <span className="numeric">{dateTime(offer.sent_at)}</span>,
                },
                {
                  label: 'شوهد',
                  render: (offer) => <span className="numeric">{dateTime(offer.viewed_at)}</span>,
                },
                { label: 'النتيجة', render: (offer) => offer.outcome },
              ]}
            />
          </Card>

          {file.disputes.length > 0 ? (
            <Card title="الشكاوى">
              <ul className="list">
                {file.disputes.map((dispute) => (
                  <li key={dispute.id} className="timeline-item">
                    <div>«{dispute.reason}»</div>
                    <div className="subtle">فُتحت {dateTime(dispute.opened_at)}</div>
                    {dispute.resolved_at !== null ? (
                      <div>
                        <Badge tone="good">
                          {RESOLUTION[dispute.resolution ?? ''] ?? dispute.resolution}
                        </Badge>{' '}
                        {dispute.refund_amount !== null && dispute.refund_amount > 0
                          ? money(dispute.refund_amount)
                          : ''}
                        <div className="subtle">
                          {dispute.resolution_note} · {dateTime(dispute.resolved_at)}
                        </div>
                        {dispute.payout_already_built ? (
                          <div
                            className="notice"
                            data-tone="warn"
                            style={{ marginTop: 'var(--space-xs)' }}
                          >
                            كانت مستحقات هذا الطلب قد صُرفت لمقدّم الخدمة — يلزم استرجاع المبلغ منه.
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          <NotesCard table="orders" id={order.id} notes={file.notes} onChanged={reload} />
        </div>

        <div className="grid">
          <Card title="العميل">
            {file.customer !== null ? (
              <KeyValue
                items={[
                  [
                    'الاسم',
                    <a key="name" className="link" href={hrefFor('users', file.customer.id)}>
                      {file.customer.full_name}
                    </a>,
                  ],
                  [
                    'الجوال',
                    <span key="phone" className="numeric">
                      {phone(file.customer.phone)}
                    </span>,
                  ],
                  ['البريد', file.customer.email ?? '—'],
                  [
                    'الحساب',
                    file.customer.suspended ? (
                      <Badge key="s" tone="bad">
                        موقوف
                      </Badge>
                    ) : (
                      'نشط'
                    ),
                  ],
                ]}
              />
            ) : (
              '—'
            )}
          </Card>

          <Card title="مقدّم الخدمة">
            {file.provider !== null ? (
              <KeyValue
                items={[
                  [
                    'الاسم',
                    <a key="name" className="link" href={hrefFor('providers', file.provider.id)}>
                      {file.provider.business_name_ar}
                    </a>,
                  ],
                  [
                    'الجوال',
                    <span key="phone" className="numeric">
                      {phone(file.provider.phone)}
                    </span>,
                  ],
                  [
                    'الاعتماد',
                    <LabelBadge
                      key="v"
                      value={label(VERIFICATION, file.provider.verification_status)}
                    />,
                  ],
                  ['متصل الآن', file.provider.is_online ? 'نعم' : 'لا'],
                  ['التقييم', Number(file.provider.rating_avg).toFixed(2)],
                ]}
              />
            ) : (
              <p className="muted">لم يُسند بعد.</p>
            )}
          </Card>

          <Card title="السيارة">
            {file.vehicle !== null ? (
              <KeyValue
                items={[
                  [
                    'اللوحة',
                    <a key="plate" className="link" href={hrefFor('vehicles', file.vehicle.id)}>
                      {file.vehicle.plate_ar} · {file.vehicle.plate_en}
                    </a>,
                  ],
                  [
                    'السيارة',
                    `${file.vehicle.make_ar ?? ''} ${file.vehicle.model_ar ?? ''} ${file.vehicle.year}`,
                  ],
                  [
                    'رقم الهيكل',
                    <span key="vin" className="numeric">
                      {file.vehicle.vin ?? '—'}
                    </span>,
                  ],
                ]}
              />
            ) : (
              '—'
            )}
          </Card>

          <Card title="المبالغ">
            <KeyValue
              items={[
                ['السعر المعروض', money(order.quoted_amount)],
                ['الأجرة', money(order.labour_amount)],
                ['القطع', money(order.parts_amount)],
                ['الضريبة', money(order.vat_amount)],
                ['الإجمالي', <strong key="t">{money(order.total_amount)}</strong>],
                ['المسترد', money(order.refunded_amount)],
                ['حالة الدفع', <LabelBadge key="e" value={label(ESCROW, order.escrow_status)} />],
                [
                  'مرجع الدفع',
                  <span key="pi" className="numeric">
                    {order.payment_intent_id ?? '—'}
                  </span>,
                ],
                [
                  'المستحقات',
                  file.payout !== null ? `ضمن دفعة (${file.payout.status})` : 'لم تُصرف بعد',
                ],
              ]}
            />
            {file.payment_operations.length > 0 ? (
              <>
                <h3>عمليات الدفع</h3>
                <ul className="list">
                  {file.payment_operations.map((operation) => (
                    <li key={operation.id} className="timeline-item">
                      {PAYMENT_KIND[operation.kind]} {money(operation.amount)}{' '}
                      <LabelBadge value={label(PAYMENT_OPERATION, operation.status)} />
                      <div className="subtle">
                        {operation.reason} · {dateTime(operation.created_at)}
                        {operation.psp_reference !== null ? ` · ${operation.psp_reference}` : ''}
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            {file.payment_holds.length > 0 ? (
              <>
                <h3>الحجوزات على بطاقة العميل</h3>
                <ul className="list">
                  {file.payment_holds.map((hold) => (
                    <li key={hold.payment_id} className="timeline-item">
                      {HOLD_KIND[hold.kind]} {money(hold.amount)}{' '}
                      <LabelBadge value={label(HOLD_STATUS, hold.status)} />
                      <div className="subtle numeric">
                        {hold.payment_id} · {dateTime(hold.created_at)}
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            {file.invoices.length > 0 ? (
              <>
                <h3>الفواتير</h3>
                <ul className="list">
                  {file.invoices.map((invoice) => (
                    <li key={invoice.id} className="numeric">
                      {invoice.invoice_number} · {money(invoice.total_amount)} ·{' '}
                      {dateTime(invoice.issued_at)}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </Card>

          {file.rating !== null ? (
            <Card title="التقييم">
              <p style={{ margin: 0 }}>
                {'★'.repeat(file.rating.stars)}
                {'☆'.repeat(5 - file.rating.stars)}{' '}
                {file.rating.hidden_at !== null ? <Badge tone="warn">مخفي</Badge> : null}
              </p>
              {file.rating.comment !== null ? (
                <p className="muted">«{file.rating.comment}»</p>
              ) : null}
              <a className="link" href={hrefFor('ratings')}>
                إدارة التقييمات
              </a>
            </Card>
          ) : null}

          {file.handover !== null ? (
            <Card title="رمز التسليم">
              <KeyValue
                items={[
                  ['المحاولات', String(file.handover.attempts)],
                  ['تم التحقق', dateTime(file.handover.verified_at)],
                ]}
              />
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}

function OrderActions({ file, reload }: { readonly file: OrderFile; readonly reload: () => void }) {
  const { order } = file;
  const status = order.status;

  return (
    <>
      {status === 'searching' ? (
        <ActionButton
          label="بحث من جديد"
          description="يعيد إرسال الطلب من الجولة الأولى لمن أصبح متاحاً منذ آخر إرسال."
          reason="none"
          onConfirm={() => api.retryDispatch(order.id)}
          onDone={reload}
          success="أُعيد إرسال الطلب."
        />
      ) : null}

      {['searching', 'quoted', 'accepted'].includes(status) ? (
        <AssignProvider orderId={order.id} current={file.provider?.id ?? null} onDone={reload} />
      ) : null}

      {status === 'awaiting_approval' ? (
        <ActionButton
          label="تأكيد الإنجاز نيابةً عن العميل"
          tone="primary"
          description="استخدمه فقط إذا أكّد العميل الإنجاز بنفسه (هاتفياً مثلاً). سيُحصَّل المبلغ المحجوز."
          reasonLabel="كيف أكّد العميل؟"
          onConfirm={(reason) => api.confirmCompletion(order.id, reason)}
          onDone={reload}
          success="اكتمل الطلب وحُصِّل المبلغ."
        />
      ) : null}

      {status === 'completed' ? (
        <ActionButton
          label="فتح شكوى"
          description="يوقف صرف مستحقات هذا الطلب حتى تُحسم الشكوى."
          reasonLabel="ما شكوى العميل؟"
          onConfirm={(reason) => api.openDispute(order.id, reason)}
          onDone={reload}
          success="فُتحت الشكوى."
        />
      ) : null}

      {status === 'completed' && file.invoices.length === 0 && (order.total_amount ?? 0) > 0 ? (
        <ActionButton
          label="إصدار الفاتورة"
          description="اكتمل الطلب دون فاتورة لأن بيانات البائع لم تكن مُعدّة حينها. تُصدر الفاتورة الضريبية الآن بمبالغ الطلب كما حُصّلت."
          reason="none"
          onConfirm={() => api.issueInvoice(order.id)}
          onDone={reload}
          success="صدرت الفاتورة."
        />
      ) : null}

      {status === 'disputed' ? <ResolveDispute file={file} onDone={reload} /> : null}

      {OPEN.has(status) ? (
        <ActionButton
          label="إلغاء الطلب"
          tone="danger"
          description="يُبلَّغ العميل ومقدّم الخدمة، ويُطلب من مزوّد الدفع فكّ المبلغ المحجوز."
          onConfirm={(reason) => api.cancelOrder(order.id, reason)}
          onDone={reload}
          success="أُلغي الطلب."
        />
      ) : null}
    </>
  );
}

function AssignProvider({
  orderId,
  current,
  onDone,
}: {
  readonly orderId: string;
  readonly current: string | null;
  readonly onDone: () => void;
}) {
  const [providerId, setProviderId] = useState('');
  const providers = useLoad(() => api.providers('approved', '', null, 0), 'approved-providers');

  return (
    <ActionButton
      label={current === null ? 'إسناد لفنّي' : 'تغيير مقدّم الخدمة'}
      description="يُسند الطلب مباشرة ويُبلَّغ مقدّم الخدمة على جواله. يجب أن يكون معتمداً ويقدّم هذه الخدمة."
      fields={
        <Field label="مقدّم الخدمة">
          <select
            className="input"
            value={providerId}
            onChange={(event) => setProviderId(event.target.value)}
          >
            <option value="">— اختر —</option>
            {(providers.data ?? [])
              .filter((provider) => provider.id !== current && !provider.suspended)
              .map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.business_name_ar}
                  {provider.city_name_ar !== null ? ` — ${provider.city_name_ar}` : ''}
                  {provider.is_online ? ' (متصل)' : ''}
                </option>
              ))}
          </select>
        </Field>
      }
      onConfirm={(reason) => {
        if (providerId === '') return Promise.reject(new Error('اختر مقدّم الخدمة.'));
        return api.assignProvider(orderId, providerId, reason);
      }}
      onDone={onDone}
      success="أُسند الطلب."
    />
  );
}

function ResolveDispute({
  file,
  onDone,
}: {
  readonly file: OrderFile;
  readonly onDone: () => void;
}) {
  const [resolution, setResolution] = useState<'upheld' | 'partial_refund' | 'full_refund'>(
    'upheld',
  );
  const [amount, setAmount] = useState('');
  const remaining = (file.order.total_amount ?? 0) - file.order.refunded_amount;

  return (
    <ActionButton
      label="حسم الشكوى"
      tone="primary"
      description={`المدفوع ${money(remaining)}. الاسترداد يُسجَّل كعملية على مزوّد الدفع ويُبلَّغ العميل.`}
      reasonLabel="قرار الحسم وسببه"
      reasonHint="يُبلَّغ العميل بالنتيجة."
      fields={
        <>
          <Field label="القرار">
            <select
              className="input"
              value={resolution}
              onChange={(event) => setResolution(event.target.value as typeof resolution)}
            >
              {Object.entries(RESOLUTION).map(([value, text]) => (
                <option key={value} value={value}>
                  {text}
                </option>
              ))}
            </select>
          </Field>
          {resolution === 'partial_refund' ? (
            <Field label="مبلغ الاسترداد (ر.س)">
              <input
                className="input numeric"
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            </Field>
          ) : null}
        </>
      }
      onConfirm={(note) =>
        api.resolveDispute(
          file.order.id,
          resolution,
          resolution === 'partial_refund' ? Number(amount) : null,
          note,
        )
      }
      onDone={onDone}
      success="حُسمت الشكوى."
    />
  );
}
