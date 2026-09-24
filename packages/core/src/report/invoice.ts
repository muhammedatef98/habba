/**
 * The tax invoice, as a document the customer can open and keep.
 *
 * `issue_zatca_invoice` (0030, issued at completion since 0074) records a
 * simplified tax invoice with its QR payload: the TLV of seller name, VAT
 * number, timestamp, total and VAT that ZATCA's Phase 1 requires be scannable
 * on the document. This renders that record as one A4 page, in Arabic, for
 * the in-app viewer and for the PDF the customer shares — the same HTML, so
 * what they see is what they send.
 *
 * Like the other renderers here it computes nothing: every figure is a field
 * of the issued invoice, so the page cannot disagree with the tax record.
 * The only derived values are the line nets, which the order already holds.
 */

import { escapeHtml, formatNumber } from './labels.js';
import { qrSvg } from './qr.js';

export interface InvoiceLine {
  readonly descriptionAr: string;
  readonly quantity: number;
  /** Before VAT, as a 2dp string from the database. */
  readonly net: string;
}

export interface InvoiceDocument {
  readonly invoiceNumber: string;
  readonly issuedAt: string;
  readonly invoiceType: 'simplified' | 'standard';
  readonly seller: {
    readonly legalNameAr: string;
    readonly vatNumber: string;
    readonly crNumber: string | null;
  };
  readonly orderNumber: string | null;
  readonly lines: readonly InvoiceLine[];
  readonly net: string;
  readonly vat: string;
  /** 0.15, not 15. */
  readonly vatRate: number;
  readonly total: string;
  /** The ZATCA TLV, base64 — scanned as-is by the authority's app. */
  readonly qrBase64: string;
}

const INK = '#14201F';
const PETROL = '#12514F';
const MUTED = '#4A5654';
const LINE = '#E2DDD2';
const BAND = '#F0EBE1';

function isolate(value: string): string {
  return `<bdi>${escapeHtml(value)}</bdi>`;
}

function money(value: string): string {
  return `${isolate(Number(value).toFixed(2))} ر.س`;
}

/** Date and time in Riyadh, Latin digits — a tax document states both. */
function issuedAtRiyadh(iso: string): string {
  const riyadh = new Date(new Date(iso).getTime() + 3 * 3_600_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${riyadh.getUTCFullYear()}-${pad(riyadh.getUTCMonth() + 1)}-${pad(riyadh.getUTCDate())} ` +
    `${pad(riyadh.getUTCHours())}:${pad(riyadh.getUTCMinutes())}`
  );
}

function qrBlock(payload: string): string {
  // The encoder carries 213 characters at most; a seller name long enough to
  // exceed that is refused by zatca_tlv before an invoice exists, so this is
  // a guard, not a path — but a document with the payload printed beats none.
  try {
    return qrSvg(payload, { title: 'رمز الفاتورة الضريبية' });
  } catch {
    return `<code class="qr-fallback">${escapeHtml(payload)}</code>`;
  }
}

export function renderInvoiceHtml(invoice: InvoiceDocument): string {
  const title = invoice.invoiceType === 'simplified' ? 'فاتورة ضريبية مبسطة' : 'فاتورة ضريبية';
  const rate = `${formatNumber(Math.round(invoice.vatRate * 100))}%`;

  const rows = invoice.lines
    .map(
      (line) => `<tr>
        <td>${escapeHtml(line.descriptionAr)}</td>
        <td class="num">${isolate(formatNumber(line.quantity))}</td>
        <td class="num">${money(line.net)}</td>
      </tr>`,
    )
    .join('');

  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)} ${escapeHtml(invoice.invoiceNumber)}</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 20px; color: ${INK};
    font-family: -apple-system, 'Segoe UI', 'Noto Sans Arabic', 'IBM Plex Sans Arabic', Tahoma, sans-serif;
    font-size: 14px; line-height: 1.6; background: #FFFFFF; }
  header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px;
    border-bottom: 2px solid ${PETROL}; padding-bottom: 12px; margin-bottom: 16px; }
  h1 { margin: 0; font-size: 22px; color: ${PETROL}; }
  .muted { color: ${MUTED}; font-size: 12px; }
  .brand { font-size: 20px; font-weight: 700; color: ${PETROL}; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 16px; margin-bottom: 16px; }
  .label { color: ${MUTED}; font-size: 12px; }
  .value { font-weight: 600; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
  th { text-align: start; font-size: 12px; color: ${MUTED}; font-weight: 500;
    background: ${BAND}; padding: 8px; }
  td { padding: 8px; border-bottom: 1px solid ${LINE}; vertical-align: top; }
  .num { white-space: nowrap; text-align: end; }
  .totals { margin-inline-start: auto; width: 60%; min-width: 240px; }
  .totals div { display: flex; justify-content: space-between; padding: 4px 0; }
  .totals .grand { border-top: 2px solid ${INK}; margin-top: 4px; padding-top: 8px;
    font-size: 17px; font-weight: 700; }
  .qr { display: flex; gap: 16px; align-items: center; margin-top: 20px;
    padding-top: 12px; border-top: 1px solid ${LINE}; }
  .qr svg { width: 120px; height: 120px; flex: none; }
  .qr-fallback { font-size: 10px; word-break: break-all; }
  bdi { unicode-bidi: isolate; }
</style>
</head>
<body>
  <header>
    <div>
      <h1>${escapeHtml(title)}</h1>
      <div class="muted">Simplified Tax Invoice</div>
    </div>
    <div class="brand">هبّة</div>
  </header>

  <section class="grid">
    <div><div class="label">رقم الفاتورة</div><div class="value">${isolate(invoice.invoiceNumber)}</div></div>
    <div><div class="label">تاريخ الإصدار (بتوقيت الرياض)</div><div class="value">${isolate(issuedAtRiyadh(invoice.issuedAt))}</div></div>
    <div><div class="label">البائع</div><div class="value">${escapeHtml(invoice.seller.legalNameAr)}</div></div>
    <div><div class="label">الرقم الضريبي</div><div class="value">${isolate(invoice.seller.vatNumber)}</div></div>
    ${invoice.seller.crNumber !== null ? `<div><div class="label">السجل التجاري</div><div class="value">${isolate(invoice.seller.crNumber)}</div></div>` : ''}
    ${invoice.orderNumber !== null ? `<div><div class="label">رقم الطلب</div><div class="value">${isolate(invoice.orderNumber)}</div></div>` : ''}
  </section>

  <table>
    <thead><tr><th>البيان</th><th class="num">الكمية</th><th class="num">المبلغ قبل الضريبة</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>

  <section class="totals">
    <div><span>الإجمالي قبل الضريبة</span><span>${money(invoice.net)}</span></div>
    <div><span>ضريبة القيمة المضافة (${isolate(rate)})</span><span>${money(invoice.vat)}</span></div>
    <div class="grand"><span>الإجمالي شامل الضريبة</span><span>${money(invoice.total)}</span></div>
  </section>

  <section class="qr">
    ${qrBlock(invoice.qrBase64)}
    <div class="muted">امسح الرمز بتطبيق هيئة الزكاة والضريبة والجمارك للتحقّق من الفاتورة.</div>
  </section>
</body>
</html>`;
}

/** «فاتورة-HB-INV-2026-000123.pdf» — what the share sheet and a downloads folder show. */
export function invoiceFileName(invoice: InvoiceDocument): string {
  return `فاتورة-${invoice.invoiceNumber}.pdf`;
}
