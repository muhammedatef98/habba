/**
 * Cars and their logbooks.
 *
 * The logbook is append-only and hash-chained (ADR-0003/0004): nobody edits
 * an entry, an operator included. What an operator can do is add a
 * correction — a new entry, signed by Habba, beside the one it corrects — and
 * the report shows both. Everything else about a car (stuck transfers, a
 * shared report that must stop working, a duplicate registration) is here too.
 */

'use client';

import { useState } from 'react';
import { api } from '@/data/api';
import type { SearchHit, VehicleFile } from '@/data/types';
import { date, dateTime, hijri, money } from '@/lib/format';
import { label, ORDER_STATUS, PROVENANCE, TIMELINE_EVENT, TRANSFER_STATUS } from '../labels';
import { go, hrefFor } from '../router';
import {
  ActionButton,
  Badge,
  Button,
  Card,
  DataTable,
  Empty,
  Field,
  KeyValue,
  LabelBadge,
  Loadable,
  NotesCard,
  PageHead,
  useLoad,
} from '../ui';
import { explain } from '@/data/transport';

export function VehiclesSection({ id }: { readonly id: string | null }) {
  return id === null ? <VehicleSearch /> : <VehicleDetail id={id} />;
}

function VehicleSearch() {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<readonly SearchHit[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const search = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      setHits((await api.search(query)).filter((hit) => hit.kind === 'vehicle'));
    } catch (cause) {
      setError(explain(cause));
    }
  };

  return (
    <>
      <PageHead
        title="المركبات والدفتر"
        description="ابحث باللوحة (بالعربي أو بالإنجليزي) أو برقم الهيكل. يمكن أيضاً فتح السيارة من ملف صاحبها أو من أي طلب."
      />
      <form className="toolbar" onSubmit={search}>
        <Field label="اللوحة أو رقم الهيكل">
          <input
            className="input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="أ ب ج ١٢٣٤ أو ABJ1234 أو رقم الهيكل"
          />
        </Field>
        <Button type="submit" tone="primary">
          بحث
        </Button>
      </form>
      {error !== null ? (
        <p className="notice" data-tone="bad">
          {error}
        </p>
      ) : null}
      {hits === null ? null : hits.length === 0 ? (
        <Empty>لا سيارة بهذه البيانات.</Empty>
      ) : (
        <DataTable<SearchHit>
          rows={hits}
          rowKey={(hit) => hit.id}
          onRowClick={(hit) => go('vehicles', hit.id)}
          columns={[
            { label: 'اللوحة', render: (hit) => <strong>{hit.title}</strong> },
            { label: 'السيارة', render: (hit) => hit.subtitle },
            {
              label: 'الحالة',
              render: (hit) =>
                hit.status === 'active' ? 'نشطة' : <Badge tone="warn">موقوفة</Badge>,
            },
          ]}
        />
      )}
    </>
  );
}

function VehicleDetail({ id }: { readonly id: string }) {
  const state = useLoad(() => api.vehicle(id), id);
  return (
    <Loadable state={state}>
      {(file) => <VehicleFileView file={file} reload={state.reload} />}
    </Loadable>
  );
}

function VehicleFileView({
  file,
  reload,
}: {
  readonly file: VehicleFile;
  readonly reload: () => void;
}) {
  const { vehicle } = file;
  const verified = file.timeline.filter((entry) => entry.provenance === 'habba_verified').length;

  return (
    <>
      <PageHead
        back={{ label: 'المركبات', href: hrefFor('vehicles') }}
        title={
          <>
            {vehicle.plate_ar} · <span className="numeric">{vehicle.plate_en}</span>{' '}
            {vehicle.is_active ? null : <Badge tone="warn">موقوفة</Badge>}
          </>
        }
        description={`${vehicle.make_ar ?? ''} ${vehicle.model_ar ?? ''} ${vehicle.year}`}
        actions={
          <>
            <ActionButton
              label="إضافة ملاحظة تصحيح للدفتر"
              tone="primary"
              description="تُضاف كسجل جديد موقّع من هبّة ويظهر في تقرير السيارة. لا يُعدَّل ولا يُحذف أي سجل سابق."
              reasonLabel="نص الملاحظة"
              reasonHint="مثال: قراءة العداد في سجل ١٢ مارس خاطئة، الصحيح ٨٤٬١٥٠ كم."
              onConfirm={(note) => api.annotateVehicle(vehicle.id, note)}
              onDone={reload}
              success="أُضيفت الملاحظة إلى الدفتر."
            />
            <ActionButton
              label={vehicle.is_active ? 'إيقاف السيارة' : 'إعادة تفعيل السيارة'}
              tone={vehicle.is_active ? 'danger' : 'neutral'}
              description={
                vehicle.is_active
                  ? 'تختفي من حساب المالك ولا تُطلب لها خدمات. الدفتر يبقى كما هو.'
                  : 'تعود إلى حساب المالك.'
              }
              onConfirm={(reason) => api.setVehicleActive(vehicle.id, !vehicle.is_active, reason)}
              onDone={reload}
              success="حُفظ."
            />
          </>
        }
      />

      <div className="grid main-side">
        <div className="grid">
          <Card title={`دفتر السيارة (${file.timeline.length} سجل، ${verified} موثّق من هبّة)`}>
            {file.timeline.length === 0 ? (
              <p className="muted">لا سجلات.</p>
            ) : (
              <ul className="list">
                {file.timeline.map((entry) => (
                  <li
                    key={entry.id}
                    className="timeline-item"
                    data-tone={entry.provenance === 'habba_verified' ? 'brand' : undefined}
                  >
                    <div>
                      <strong>{TIMELINE_EVENT[entry.event_type] ?? entry.event_type}</strong> —{' '}
                      {entry.summary_ar}
                    </div>
                    <div className="subtle">
                      {dateTime(entry.occurred_at)} · {hijri(entry.occurred_at)}
                      {entry.mileage !== null ? ` · ${entry.mileage} كم` : ''}
                      {entry.attachments > 0 ? ` · ${entry.attachments} مرفق` : ''}
                    </div>
                    <div className="actions" style={{ marginTop: 4 }}>
                      <LabelBadge value={label(PROVENANCE, entry.provenance)} />
                      {entry.order_id !== null ? (
                        <a className="link" href={hrefFor('orders', entry.order_id)}>
                          الطلب
                        </a>
                      ) : null}
                      <span className="subtle numeric" title="بصمة السجل في السلسلة">
                        #{entry.seq} · {entry.row_hash.slice(0, 10)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

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

          <NotesCard table="vehicles" id={vehicle.id} notes={file.notes} onChanged={reload} />
        </div>

        <div className="grid">
          <Card title="السيارة">
            <KeyValue
              items={[
                [
                  'المالك',
                  file.owner !== null ? (
                    <a key="o" className="link" href={hrefFor('users', file.owner.id)}>
                      {file.owner.full_name}
                    </a>
                  ) : (
                    '—'
                  ),
                ],
                [
                  'رقم الهيكل',
                  <span key="v" className="numeric">
                    {vehicle.vin ?? '—'}
                  </span>,
                ],
                ['اللون', vehicle.colour ?? '—'],
                ['الاسم', vehicle.nickname ?? '—'],
                [
                  'العداد',
                  vehicle.current_mileage !== null ? `${vehicle.current_mileage} كم` : '—',
                ],
                ['سُجّلت', dateTime(vehicle.created_at)],
              ]}
            />
          </Card>

          <Card title="نقل الملكية">
            {file.transfers.length === 0 ? (
              <p className="muted">لا طلبات نقل.</p>
            ) : (
              <ul className="list">
                {file.transfers.map((transfer) => (
                  <li key={transfer.id} className="timeline-item">
                    إلى {transfer.to_phone ?? transfer.to_email ?? '—'}{' '}
                    <LabelBadge value={label(TRANSFER_STATUS, transfer.status)} />
                    <div className="subtle">
                      {dateTime(transfer.created_at)} · ينتهي {dateTime(transfer.expires_at)}
                      {transfer.failed_attempts > 0
                        ? ` · ${transfer.failed_attempts} محاولة خاطئة`
                        : ''}
                      {transfer.locked_at !== null ? ' · مقفل' : ''}
                    </div>
                    {transfer.status === 'pending' ? (
                      <ActionButton
                        label="إلغاء النقل"
                        size="small"
                        tone="danger"
                        onConfirm={(reason) => api.cancelTransfer(transfer.id, reason)}
                        onDone={reload}
                        success="أُلغي طلب النقل."
                      />
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="تقارير هبّة">
            {file.reports.length === 0 ? (
              <p className="muted">لم يُصدر تقرير.</p>
            ) : (
              <ul className="list">
                {file.reports.map((report) => (
                  <li key={report.id} className="timeline-item">
                    {dateTime(report.generated_at)}{' '}
                    {report.revoked_at !== null ? (
                      <Badge tone="neutral">ملغى</Badge>
                    ) : report.chain_valid ? (
                      <Badge tone="good">السلسلة سليمة</Badge>
                    ) : (
                      <Badge tone="bad">السلسلة غير سليمة</Badge>
                    )}
                    <div className="subtle">
                      {report.chain_length} سجل
                      {report.expires_at !== null ? ` · ينتهي ${date(report.expires_at)}` : ''}
                    </div>
                    {report.revoked_at === null ? (
                      <ActionButton
                        label="إلغاء التقرير"
                        size="small"
                        tone="danger"
                        description="يتوقف رابط التقرير ورمز QR عن العمل فوراً لكل من يملكه."
                        onConfirm={(reason) => api.revokeReport(report.id, reason)}
                        onDone={reload}
                        success="أُلغي التقرير."
                      />
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {file.documents.length > 0 ? (
            <Card title="الوثائق">
              <ul className="list">
                {file.documents.map((document) => (
                  <li key={document.id} className="timeline-item">
                    {document.doc_type} — ينتهي {date(document.expires_at)}
                    {document.note !== null ? <div className="subtle">{document.note}</div> : null}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
