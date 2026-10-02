/**
 * Money: what came in, what went back, and what Habba owes its providers.
 *
 * Two queues live here. Payment operations are what the payment provider has
 * to carry out — voids when an order is cancelled, refunds when a complaint
 * is resolved — written by the database, marked done here with the PSP's
 * reference. Payouts are what Habba transfers to providers, built per period
 * and marked paid with the bank reference.
 */

'use client';

import { useState } from 'react';
import { api } from '@/data/api';
import type { PaymentOperation, Payout, PayoutStatus } from '@/data/types';
import { dateTime, money, riyadhToday } from '@/lib/format';
import { label, PAYMENT_KIND, PAYMENT_OPERATION, PAYOUT_STATUS } from '../labels';
import { go } from '../router';
import {
  ActionButton,
  Badge,
  Button,
  DataTable,
  Field,
  LabelBadge,
  Loadable,
  PageHead,
  Stat,
  Tabs,
  useLoad,
} from '../ui';

type View = 'summary' | 'operations' | 'payouts';

export function FinanceSection() {
  const [view, setView] = useState<View>('summary');

  return (
    <>
      <PageHead
        title="المالية"
        description="الإيراد والاستردادات ومستحقات مقدّمي الخدمة. كل مبلغ هنا بالريال شاملاً الضريبة ما لم يُذكر غير ذلك."
      />
      <Tabs<View>
        tabs={[
          { value: 'summary', label: 'الملخّص' },
          { value: 'operations', label: 'عمليات الدفع' },
          { value: 'payouts', label: 'مستحقات مقدّمي الخدمة' },
        ]}
        value={view}
        onChange={setView}
      />
      {view === 'summary' ? <Summary /> : view === 'operations' ? <Operations /> : <Payouts />}
    </>
  );
}

function Summary() {
  const [from, setFrom] = useState(riyadhToday(-30));
  const [to, setTo] = useState(riyadhToday());
  const [range, setRange] = useState({ from, to });
  const state = useLoad(
    () => api.financeSummary(range.from, range.to),
    `${range.from}|${range.to}`,
  );

  return (
    <>
      <form
        className="toolbar"
        onSubmit={(event) => {
          event.preventDefault();
          setRange({ from, to });
        }}
      >
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
        <Button type="submit" tone="primary">
          عرض
        </Button>
      </form>
      <Loadable state={state}>
        {(summary) => (
          <div className="stats">
            <Stat label="طلبات محصّلة" value={summary.orders} />
            <Stat label="الإجمالي المحصّل" value={money(summary.gross)} />
            <Stat label="المسترد" value={money(summary.refunded)} />
            <Stat label="الصافي قبل الضريبة" value={money(summary.net_of_vat)} />
            <Stat label="ضريبة القيمة المضافة" value={money(summary.vat)} />
            <Stat label="عمولة هبّة (من الدفعات)" value={money(summary.commission)} />
            <Stat label="محجوز على بطاقات العملاء الآن" value={money(summary.held_authorised)} />
            <Stat label="مستحقات لم تُحوَّل" value={money(summary.payouts_pending)} />
            <Stat label="مستحقات حُوّلت في الفترة" value={money(summary.payouts_paid)} />
          </div>
        )}
      </Loadable>
    </>
  );
}

function Operations() {
  const [status, setStatus] = useState<'pending' | 'succeeded' | 'failed' | 'all'>('pending');
  const state = useLoad(() => api.paymentOperations(status === 'all' ? null : status), status);

  return (
    <>
      <p className="notice">
        إلى أن يُربط مزوّد الدفع آلياً: نفّذ العملية من لوحة مزوّد الدفع، ثم سجّلها هنا مع الرقم
        المرجعي.
      </p>
      <Tabs
        tabs={[
          { value: 'pending', label: 'بانتظار التنفيذ' },
          { value: 'failed', label: 'فشلت' },
          { value: 'succeeded', label: 'نُفّذت' },
          { value: 'all', label: 'الكل' },
        ]}
        value={status}
        onChange={setStatus}
      />
      <Loadable state={state}>
        {(rows) => (
          <DataTable<PaymentOperation>
            rows={rows}
            rowKey={(row) => row.id}
            empty="لا عمليات."
            columns={[
              { label: 'العملية', render: (row) => PAYMENT_KIND[row.kind] ?? row.kind },
              {
                label: 'المبلغ',
                numeric: true,
                render: (row) => <strong>{money(row.amount)}</strong>,
              },
              {
                label: 'الطلب',
                render: (row) => (
                  <button className="link numeric" onClick={() => go('orders', row.order_id)}>
                    {row.order_number ?? row.order_id}
                  </button>
                ),
              },
              { label: 'العميل', render: (row) => row.customer_name ?? '—' },
              {
                label: 'مرجع الدفع الأصلي',
                render: (row) => <span className="numeric">{row.payment_intent_id ?? '—'}</span>,
              },
              { label: 'السبب', render: (row) => row.reason },
              {
                label: 'الحالة',
                render: (row) => <LabelBadge value={label(PAYMENT_OPERATION, row.status)} />,
              },
              {
                label: 'طُلبت',
                render: (row) => <span className="numeric">{dateTime(row.created_at)}</span>,
              },
              {
                label: '',
                render: (row) =>
                  row.status === 'succeeded' ? (
                    <span className="subtle numeric">{row.psp_reference}</span>
                  ) : (
                    <RecordOperation operation={row} onDone={state.reload} />
                  ),
              },
            ]}
          />
        )}
      </Loadable>
    </>
  );
}

function RecordOperation({
  operation,
  onDone,
}: {
  readonly operation: PaymentOperation;
  readonly onDone: () => void;
}) {
  const [outcome, setOutcome] = useState<'succeeded' | 'failed'>('succeeded');
  const [reference, setReference] = useState('');

  return (
    <ActionButton
      label="تسجيل التنفيذ"
      size="small"
      tone="primary"
      reason={outcome === 'failed' ? 'required' : 'none'}
      reasonLabel="سبب الفشل"
      description={`${PAYMENT_KIND[operation.kind]} بمبلغ ${money(operation.amount)}`}
      fields={
        <>
          <Field label="النتيجة">
            <select
              className="input"
              value={outcome}
              onChange={(event) => setOutcome(event.target.value as 'succeeded' | 'failed')}
            >
              <option value="succeeded">نُفّذت</option>
              <option value="failed">فشلت</option>
            </select>
          </Field>
          <Field label="الرقم المرجعي من مزوّد الدفع">
            <input
              className="input numeric"
              value={reference}
              onChange={(event) => setReference(event.target.value)}
            />
          </Field>
        </>
      }
      onConfirm={(reason) =>
        api.recordPaymentOperation(
          operation.id,
          outcome,
          reference,
          outcome === 'failed' ? reason : null,
        )
      }
      onDone={onDone}
      success="سُجّلت العملية."
    />
  );
}

function Payouts() {
  const [status, setStatus] = useState<PayoutStatus | 'all'>('pending');
  const state = useLoad(() => api.payouts(status === 'all' ? null : status), status);

  return (
    <>
      <p className="notice">
        تُنشأ الدفعات من ملف مقدّم الخدمة. هنا تُعتمد، ثم تُسجَّل مدفوعة مع رقم التحويل البنكي —
        الدفعة المدفوعة نهائية.
      </p>
      <Tabs<PayoutStatus | 'all'>
        tabs={[
          { value: 'pending', label: 'بانتظار الاعتماد' },
          { value: 'approved', label: 'معتمدة للتحويل' },
          { value: 'paid', label: 'مدفوعة' },
          { value: 'failed', label: 'فشلت' },
          { value: 'all', label: 'الكل' },
        ]}
        value={status}
        onChange={setStatus}
      />
      <Loadable state={state}>
        {(rows) => (
          <DataTable<Payout>
            rows={rows}
            rowKey={(row) => row.id}
            empty="لا دفعات."
            columns={[
              {
                label: 'مقدّم الخدمة',
                render: (row) => (
                  <>
                    <button className="link" onClick={() => go('providers', row.provider_id)}>
                      {row.provider_name_ar}
                    </button>
                    {row.provider_has_iban === false ? (
                      <div>
                        <Badge tone="bad">لا آيبان</Badge>
                      </div>
                    ) : null}
                  </>
                ),
              },
              {
                label: 'الفترة',
                render: (row) => (
                  <span className="numeric">
                    {row.period_start} – {row.period_end}
                  </span>
                ),
              },
              { label: 'الطلبات', numeric: true, render: (row) => row.order_count },
              { label: 'الإجمالي', numeric: true, render: (row) => money(row.gross_amount) },
              { label: 'العمولة', numeric: true, render: (row) => money(row.commission) },
              {
                label: 'الصافي',
                numeric: true,
                render: (row) => <strong>{money(row.net_amount)}</strong>,
              },
              {
                label: 'الحالة',
                render: (row) => (
                  <>
                    <LabelBadge value={label(PAYOUT_STATUS, row.status)} />
                    {row.reference !== null ? (
                      <div className="subtle numeric">{row.reference}</div>
                    ) : null}
                  </>
                ),
              },
              {
                label: '',
                render: (row) =>
                  row.status === 'paid' ? null : (
                    <PayoutActions payout={row} onDone={state.reload} />
                  ),
              },
            ]}
          />
        )}
      </Loadable>
    </>
  );
}

function PayoutActions({
  payout,
  onDone,
}: {
  readonly payout: Payout;
  readonly onDone: () => void;
}) {
  const [reference, setReference] = useState('');
  return (
    <span className="actions">
      {payout.status === 'pending' ? (
        <ActionButton
          label="اعتماد"
          size="small"
          reason="none"
          description={`اعتماد تحويل ${money(payout.net_amount)} إلى ${payout.provider_name_ar ?? ''}.`}
          onConfirm={() => api.setPayoutStatus(payout.id, 'approved', null)}
          onDone={onDone}
          success="اعتُمدت الدفعة."
        />
      ) : null}
      <ActionButton
        label="تسجيل كمدفوعة"
        size="small"
        tone="primary"
        reason="none"
        description={`بعد تحويل ${money(payout.net_amount)} من البنك. لا يمكن التراجع.`}
        fields={
          <Field label="رقم التحويل البنكي">
            <input
              className="input numeric"
              value={reference}
              onChange={(event) => setReference(event.target.value)}
            />
          </Field>
        }
        onConfirm={() => api.setPayoutStatus(payout.id, 'paid', reference)}
        onDone={onDone}
        success="سُجّلت الدفعة مدفوعة."
      />
      <ActionButton
        label="فشل التحويل"
        size="small"
        tone="danger"
        reason="none"
        onConfirm={() => api.setPayoutStatus(payout.id, 'failed', null)}
        onDone={onDone}
        success="سُجّل الفشل."
      />
    </span>
  );
}
