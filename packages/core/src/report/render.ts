/**
 * Renders تقرير هبّة as a self-contained Arabic RTL HTML page.
 *
 * Build prompt §7.3: "the public page must work without login and be
 * mobile-first". It is also the page a buyer opens while standing next to a
 * car they are deciding whether to buy — on their phone, possibly on mobile
 * data, in daylight.
 *
 * So: no JavaScript, no external requests, inline CSS, and a print stylesheet
 * that produces a usable PDF via the browser's own print-to-PDF. That last
 * point is deliberate — see the PDF note in the Phase 2 section of
 * docs/adr/0016-habba-report-delivery.md.
 *
 * Pure string in, string out, so it is unit-testable without a browser or a
 * deployed function.
 */

import type { HabbaReport, ReportEvent, ReportProvenance } from './types.js';
import { verifiedRatio } from './types.js';

/**
 * Escapes text for HTML.
 *
 * The report renders owner-typed strings (service descriptions) into a public
 * page. Without escaping, an owner could inject markup into a page a buyer
 * trusts — the exact XSS the security rules forbid.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const PROVENANCE_LABEL_AR: Record<ReportProvenance, string> = {
  habba_verified: 'موثّق من هبّة',
  self_documented: 'مُدخل من المالك مع مرفق',
  self_reported: 'مُدخل من المالك',
  third_party: 'من جهة خارجية',
};

const DETAIL_LABEL_AR: Record<string, string> = {
  oil_grade: 'درجة الزيت',
  oil_quantity_l: 'كمية الزيت (لتر)',
  filter_part_number: 'رقم الفلتر',
  part_number: 'رقم القطعة',
  is_oem: 'قطعة أصلية',
  warranty_days: 'الضمان (يوم)',
  labour_hours: 'ساعات العمل',
  service_kind: 'نوع الخدمة',
  inspection_score: 'نتيجة الفحص',
  obd_codes: 'أكواد الكمبيوتر',
  tyre_size: 'مقاس الإطار',
  battery_capacity_ah: 'سعة البطارية',
  brake_pad_position: 'موضع الفحمات',
  notes_public: 'ملاحظات',
};

function formatNumber(value: number): string {
  // Latin numerals: §8 notes Saudi users prefer 1234 over ١٢٣٤ on screen.
  return new Intl.NumberFormat('en-US').format(value);
}

function formatDetailValue(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'نعم' : 'لا';
  if (typeof value === 'number') return formatNumber(value);
  if (Array.isArray(value)) return value.map((entry) => String(entry)).join('، ');
  return String(value);
}

function renderDetails(details: Readonly<Record<string, unknown>>): string {
  const entries = Object.entries(details).filter(([, value]) => value !== null && value !== '');
  if (entries.length === 0) return '';

  const items = entries
    .map(([key, value]) => {
      const label = DETAIL_LABEL_AR[key] ?? key;
      return `<span class="detail"><b>${escapeHtml(label)}:</b> ${escapeHtml(
        formatDetailValue(value),
      )}</span>`;
    })
    .join('');

  return `<div class="details">${items}</div>`;
}

function renderEvent(event: ReportEvent): string {
  const verified = event.provenance === 'habba_verified';
  const label = PROVENANCE_LABEL_AR[event.provenance];

  // Where an event was recorded materially later than it happened, say so
  // (ADR-0012). A buyer reading a history deserves to know which entries were
  // written at the time and which were written from memory.
  const lag =
    new Date(event.recorded_at).getTime() - new Date(event.occurred_at).getTime() >
    7 * 24 * 60 * 60 * 1000
      ? `<span class="lag">سُجّل لاحقاً في ${escapeHtml(event.recorded_at)}</span>`
      : '';

  const mileage =
    event.mileage === null ? '' : `<span class="km">${formatNumber(event.mileage)} كم</span>`;

  const attachments =
    event.attachment_count > 0
      ? `<span class="attach">${formatNumber(event.attachment_count)} مرفق</span>`
      : '';

  return `
    <li class="event ${verified ? 'is-verified' : 'is-self'}">
      <div class="event-head">
        <span class="badge ${verified ? 'badge-verified' : 'badge-self'}">${escapeHtml(label)}</span>
        <time>${escapeHtml(event.occurred_at)}</time>
      </div>
      <p class="summary">${escapeHtml(event.summary_ar)}</p>
      <div class="meta">${mileage}${attachments}${lag}</div>
      ${renderDetails(event.details)}
    </li>`;
}

export interface RenderOptions {
  /** Absolute URL of this report, shown as the verification target. */
  readonly publicUrl: string;
}

export function renderHabbaReport(report: HabbaReport, options: RenderOptions): string {
  const { vehicle, coverage, chain } = report;
  const ratio = Math.round(verifiedRatio(coverage) * 100);

  const title = `${vehicle.make_ar} ${vehicle.model_ar} ${vehicle.year}`;

  const identity = [
    vehicle.plate === null
      ? null
      : `<div><dt>اللوحة</dt><dd>${escapeHtml(vehicle.plate)}</dd></div>`,
    vehicle.vin === null
      ? null
      : `<div><dt>رقم الهيكل</dt><dd>${escapeHtml(vehicle.vin)}</dd></div>`,
    vehicle.colour === null
      ? null
      : `<div><dt>اللون</dt><dd>${escapeHtml(vehicle.colour)}</dd></div>`,
    `<div><dt>العداد</dt><dd>${formatNumber(vehicle.current_mileage)} كم</dd></div>`,
  ]
    .filter((entry): entry is string => entry !== null)
    .join('');

  const events = report.events.map(renderEvent).join('');

  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>تقرير هبّة — ${escapeHtml(title)}</title>
<meta name="robots" content="noindex, nofollow">
<style>
  :root {
    --petrol: #0E4F4A; --petrol-50: #E6F2F0; --sand: #C98B2B;
    --ink: #1A1917; --muted: #5C5952; --line: #DFDDD9; --bg: #F7F7F6;
    --surface: #FFFFFF;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--ink);
    font-family: "IBM Plex Sans Arabic", "Tajawal", system-ui, -apple-system, sans-serif;
    /* Arabic needs the taller rhythm — §8. */
    line-height: 1.7; font-size: 16px;
  }
  .wrap { max-width: 720px; margin: 0 auto; padding: 16px; }
  header { background: var(--petrol); color: #fff; border-radius: 16px; padding: 24px; }
  header h1 { margin: 0 0 4px; font-size: 26px; line-height: 1.4; }
  header .sub { opacity: .85; font-size: 14px; }
  .card {
    background: var(--surface); border: 1px solid var(--line);
    border-radius: 16px; padding: 20px; margin-top: 16px;
  }
  h2 { font-size: 18px; margin: 0 0 12px; }
  dl { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 0; }
  dt { font-size: 13px; color: var(--muted); margin: 0; }
  dd { margin: 0; font-weight: 600; }
  .ratio { display: flex; align-items: baseline; gap: 8px; }
  .ratio b { font-size: 34px; color: var(--petrol); }
  .bar { height: 10px; border-radius: 99px; background: var(--line); overflow: hidden; margin: 12px 0 8px; }
  .bar > i { display: block; height: 100%; background: var(--petrol); }
  .legend { font-size: 13px; color: var(--muted); }
  ul.events { list-style: none; margin: 0; padding: 0; }
  .event { border-top: 1px solid var(--line); padding: 16px 0; }
  .event:first-child { border-top: 0; }
  .event-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  time { color: var(--muted); font-size: 13px; }
  .badge { font-size: 12px; padding: 2px 10px; border-radius: 99px; }
  .badge-verified { background: var(--petrol-50); color: var(--petrol); border: 1px solid var(--petrol); font-weight: 600; }
  .badge-self { background: #EFEEEC; color: #5C5952; }
  .summary { margin: 8px 0 4px; font-weight: 600; }
  .meta { display: flex; gap: 12px; flex-wrap: wrap; font-size: 13px; color: var(--muted); }
  .details { margin-top: 8px; font-size: 13px; color: var(--muted); display: flex; gap: 12px; flex-wrap: wrap; }
  .verify { background: var(--petrol-50); border-color: var(--petrol); }
  .verify code { word-break: break-all; font-size: 12px; }
  footer { color: var(--muted); font-size: 12px; text-align: center; padding: 24px 0; }
  /* Print-to-PDF is the delivery mechanism for now — ADR-0016. */
  @media print {
    body { background: #fff; font-size: 12px; }
    .card, header { break-inside: avoid; border-radius: 0; }
    header { background: #fff !important; color: var(--ink); border-bottom: 3px solid var(--petrol); }
    .no-print { display: none; }
  }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>${escapeHtml(title)}</h1>
    <div class="sub">تقرير هبّة — سجل الصيانة الموثّق</div>
  </header>

  <section class="card">
    <h2>بيانات السيارة</h2>
    <dl>${identity}</dl>
  </section>

  <section class="card">
    <h2>نسبة التوثيق</h2>
    <div class="ratio"><b>${formatNumber(ratio)}%</b><span>من السجلات موثّقة من هبّة</span></div>
    <div class="bar"><i style="width:${ratio}%"></i></div>
    <p class="legend">
      ${formatNumber(coverage.habba_verified)} سجل موثّق من هبّة ·
      ${formatNumber(coverage.self_documented + coverage.self_reported)} سجل مُدخل من المالك ·
      ${formatNumber(coverage.total)} إجمالي
    </p>
    <p class="legend">
      السجلات الموثّقة من هبّة نفّذها فنّي عبر التطبيق مع صور وقراءة عداد.
      السجلات المُدخلة من المالك أدخلها صاحب السيارة ولم تتحقّق منها هبّة.
    </p>
  </section>

  <section class="card">
    <h2>سجل الصيانة</h2>
    <ul class="events">${events}</ul>
  </section>

  <section class="card verify">
    <h2>التحقّق</h2>
    <p class="legend">
      ${
        chain.is_valid
          ? `تم التحقّق من سلسلة السجلات (${formatNumber(chain.length)} سجل) ولم تتعرّض للتعديل منذ تسجيلها.`
          : 'تعذّر التحقّق من سلسلة السجلات.'
      }
    </p>
    <p class="legend">
      هذا التحقّق يثبت أن السجلات لم تُعدَّل بعد إدخالها. ولا يثبت صحة السجلات
      التي أدخلها المالك بنفسه.
    </p>
    <code>${escapeHtml(options.publicUrl)}</code>
  </section>

  <footer>
    صدر بتاريخ ${escapeHtml(report.generated_at)} · هبّة
  </footer>
</div>
</body>
</html>`;
}
