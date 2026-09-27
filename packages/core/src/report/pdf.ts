/**
 * تقرير هبّة as a printable A4 document, generated on the device.
 *
 * ADR-0019: the public verified page is gone, and this replaces it. What a
 * seller hands a buyer is a PDF produced from the frozen payload
 * `generate_habba_report()` issued — not a link, not a live view.
 *
 * Written for someone who has never heard of a logbook: a buyer standing
 * next to the car, or the owner opening it in the app. The same page is read
 * on a phone and printed on A4, so it is one column that reads top to bottom:
 *
 *   1. The car.
 *   2. The answer, in plain words: how much of this history Habba did itself,
 *      how much the owner wrote down, and what the odometer did.
 *   3. The service history, newest first, one line of meaning per job.
 *   4. Warranty and inspections, when the payload carries them.
 *   5. Can I trust this? — what is guaranteed and what is not, plainly.
 *
 * No percentages, no charts, no technical terms: "hash chain" became "saved
 * and cannot be edited", and the odometer is two readings in a sentence.
 *
 * Pure string in, string out. It runs in `expo-print` on a phone, but nothing
 * here touches a browser, a network or a file system, so the whole document is
 * unit-testable in Node.
 *
 * Two things it deliberately does NOT do:
 *
 * - **Compute anything.** Every value is a field of the payload. The document
 *   and the database cannot drift, and a buyer reading the paper is reading
 *   the same statement the database made at `generated_at`.
 * - **Name the owner.** There is nothing to omit: the payload has no owner
 *   fields, and `redact_timeline_details` is an allowlist. Both the first and
 *   the last sheet say so in Arabic, because a buyer should be able to see
 *   that the absence is deliberate rather than an oversight.
 */

import type {
  HabbaReport,
  ReportEvent,
  ReportInspection,
  ReportMileagePoint,
  ReportWarranty,
} from './types.js';
import { carriesWarrantyAndScore } from './types.js';
import {
  ATTACHMENT_FORMS,
  DAY_FORMS,
  DETAIL_LABEL_AR,
  MONTH_FORMS,
  RECOMMENDATION_LABEL_AR,
  RECORD_FORMS,
  WARRANTY_STATUS_LABEL_AR,
  arabicCount,
  escapeHtml,
  formatDetailValue,
  formatNumber,
} from './labels.js';

/** Petrol, sand and the neutrals — the same values as `packages/ui` tokens. */
const INK = '#14201F';
const PETROL = '#12514F';
const MUTED = '#4A5654';
const SUBTLE = '#5F6967';
const LINE = '#E2DDD2';
const BAND = '#F0EBE1';
const TINT = '#EFF7F6';
const PALE = '#D9EBE9';

function dateOnly(timestamp: string): string {
  return timestamp.slice(0, 10);
}

/**
 * Isolates a run of text from the bidi direction around it.
 *
 * Without this the Unicode bidi algorithm resolves the neutral characters in
 * `90915-YZZE1` and `2026-01-05` against the Arabic around them, and they print
 * as `YZZE1-90915` and `05-01-2026`. A reader cannot correct for that: it looks
 * like the report holds the wrong part number and the wrong date. `<bdi>` marks
 * the span as its own run without affecting the sentence around it — the HTML
 * equivalent of `ltrIsolate()` in `text/bidi.ts`.
 *
 * `<bdi>` rather than `dir="ltr"`, deliberately: a Saudi plate reads «أ ب ج
 * ١٢٣٤» right to left, and forcing LTR on it would fix the part numbers by
 * breaking the plates. `<bdi>` defaults to `auto`, so a span starting with a
 * Latin character goes LTR, one starting with an Arabic letter goes RTL, and a
 * span of digits and dashes — a date — goes LTR. Every case is right, and none
 * of them leaks into the sentence.
 */
function isolate(value: string): string {
  return `<bdi>${escapeHtml(value)}</bdi>`;
}

function num(value: number): string {
  return isolate(formatNumber(value));
}

/** A count and its Arabic noun, with the number isolated. */
function counted(count: number, forms: Parameters<typeof arabicCount>[1]): string {
  const text = arabicCount(count, forms);
  const digits = formatNumber(count);
  return text.startsWith(digits)
    ? `${num(count)}${escapeHtml(text.slice(digits.length))}`
    : escapeHtml(text);
}

function yearOf(date: string): string {
  return date.slice(0, 4);
}

const MONTHS_AR = [
  'يناير',
  'فبراير',
  'مارس',
  'أبريل',
  'مايو',
  'يونيو',
  'يوليو',
  'أغسطس',
  'سبتمبر',
  'أكتوبر',
  'نوفمبر',
  'ديسمبر',
] as const;

/** "2026-05-01" → «مايو 2026». Falls back to the raw date if it is not one. */
function monthYear(date: string): string {
  const match = /^(\d{4})-(\d{2})/.exec(date);
  const month = match === null ? undefined : MONTHS_AR[Number(match[2]) - 1];
  return match === null || month === undefined ? isolate(date) : `${month} ${isolate(match[1]!)}`;
}

/** "2026-09-06" → «6 سبتمبر 2026». */
function dayMonthYear(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  const month = match === null ? undefined : MONTHS_AR[Number(match[2]) - 1];
  return match === null || month === undefined
    ? isolate(date)
    : `${isolate(String(Number(match[3])))} ${month} ${isolate(match[1]!)}`;
}

/** `value` is HTML: identity values are Latin runs and must arrive isolated. */
function renderIdentityField(label: string, value: string, wide = false): string {
  return `<div class="field${wide ? ' field-wide' : ''}"><div class="field-label">${escapeHtml(label)}</div><div class="field-value">${value}</div></div>`;
}

/* -------------------------------------------------------------------------- */
/* The answer                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * What a buyer wants to know first, in three short lines. Counts, not a
 * percentage: «2 نفّذتها هبّة» is something anyone can check against the list
 * below; «33%» is a number they have to trust.
 */
function renderSummary(report: HabbaReport): string {
  const { coverage } = report;
  const documented = coverage.self_documented;
  const byOwner = coverage.self_documented + coverage.self_reported + coverage.third_party;

  const tiles = `
    <div class="tiles">
      <div class="tile tile-habba">
        <div class="tile-number">${num(coverage.habba_verified)}</div>
        <div class="tile-label">نفّذتها هبّة بنفسها</div>
        <div class="tile-hint">فنّي هبّة سجّلها من التطبيق مع صور وقراءة العدّاد</div>
      </div>
      <div class="tile">
        <div class="tile-number">${num(byOwner)}</div>
        <div class="tile-label">سجّلها صاحب السيارة</div>
        <div class="tile-hint">${
          documented > 0
            ? `منها ${num(documented)} بإيصال أو صورة. لم تتحقّق منها هبّة`
            : 'لم تتحقّق منها هبّة'
        }</div>
      </div>
    </div>`;

  return `
  <section class="block">
    <h2>الخلاصة</h2>
    ${tiles}
    ${renderOdometer(report.mileage_history)}
  </section>`;
}

/** The odometer, as a sentence: where it started, where it is now. */
function renderOdometer(points: readonly ReportMileagePoint[]): string {
  if (points.length === 0) return '';
  const first = points[0]!;
  const last = points[points.length - 1]!;
  if (points.length === 1) {
    return `<p class="line">العدّاد: قراءة واحدة حتى الآن — ${num(first.mileage)} كم في ${monthYear(first.occurred_at)}.</p>`;
  }
  return `<p class="line">العدّاد: من ${num(first.mileage)} كم في ${monthYear(first.occurred_at)} إلى ${num(last.mileage)} كم في ${monthYear(last.occurred_at)}. عدّاد السيارة في هبّة لا يمكن إرجاعه للخلف.</p>`;
}

/* -------------------------------------------------------------------------- */
/* The history                                                                 */
/* -------------------------------------------------------------------------- */

function renderDetailChips(details: Readonly<Record<string, unknown>>): string {
  const entries = Object.entries(details).filter(
    ([, value]) => value !== null && value !== undefined && value !== '',
  );
  if (entries.length === 0) return '';

  return `<div class="chips">${entries
    .map(([key, value]) => {
      const label = DETAIL_LABEL_AR[key] ?? key;
      return `<span class="chip">${escapeHtml(label)}: ${isolate(formatDetailValue(value))}</span>`;
    })
    .join('')}</div>`;
}

const WHO_DID_IT: Readonly<Record<ReportEvent['provenance'], string>> = {
  habba_verified: 'نفّذتها هبّة ✓',
  self_documented: 'سجّلها المالك بإيصال',
  self_reported: 'سجّلها المالك',
  third_party: 'من جهة خارجية',
};

function renderEvent(event: ReportEvent): string {
  const verified = event.provenance === 'habba_verified';

  const meta = [
    monthYear(event.occurred_at),
    event.mileage === null ? null : `${num(event.mileage)} كم`,
    event.attachment_count > 0 ? counted(event.attachment_count, ATTACHMENT_FORMS) : null,
    // Written materially later than the work happened (ADR-0012): a buyer
    // should know which entries were recorded at the time.
    new Date(event.recorded_at).getTime() - new Date(event.occurred_at).getTime() >
    7 * 24 * 60 * 60 * 1000
      ? `سُجّلت لاحقاً في ${monthYear(event.recorded_at)}`
      : null,
  ].filter((part): part is string => part !== null);

  return `
    <div class="event ${verified ? 'is-verified' : 'is-self'}">
      <div class="event-head">
        <span class="event-title">${escapeHtml(event.summary_ar)}</span>
        <span class="badge ${verified ? 'badge-verified' : 'badge-self'}">${escapeHtml(
          WHO_DID_IT[event.provenance],
        )}</span>
      </div>
      <div class="event-meta">${meta.join(' · ')}</div>
      ${renderDetailChips(event.details)}
    </div>`;
}

/**
 * Newest year first — the same grouping the logbook screen uses, so paper and
 * app tell one story in one order.
 */
function groupEventsByYear(
  events: readonly ReportEvent[],
): readonly { year: string; events: readonly ReportEvent[] }[] {
  const byYear = new Map<string, ReportEvent[]>();

  for (const event of events) {
    const year = yearOf(event.occurred_at);
    const bucket = byYear.get(year);
    if (bucket === undefined) byYear.set(year, [event]);
    else bucket.push(event);
  }

  return [...byYear.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([year, yearEvents]) => ({ year, events: yearEvents }));
}

function renderYearGroup(year: string, events: readonly ReportEvent[]): string {
  return `
    <div class="year">
      <div class="year-head">${isolate(year)}</div>
      ${events.map(renderEvent).join('')}
    </div>`;
}

/* -------------------------------------------------------------------------- */
/* Warranty and inspections                                                    */
/* -------------------------------------------------------------------------- */

function renderWarranties(warranties: readonly ReportWarranty[]): string {
  if (warranties.length === 0) {
    return `
  <section class="block">
    <h2>الضمان</h2>
    <p class="note">لا يوجد عمل تحت الضمان على هذه السيارة. الضمان يكون على ما نفّذته هبّة فقط.</p>
  </section>`;
  }

  const rows = warranties
    .map((warranty) => {
      const active = warranty.status === 'active';
      const state = [
        escapeHtml(WARRANTY_STATUS_LABEL_AR[warranty.status]),
        active && warranty.days_remaining !== null
          ? `يتبقّى ${counted(warranty.days_remaining, DAY_FORMS)}`
          : null,
        warranty.has_open_claim ? 'مطالبة ضمان مفتوحة' : null,
      ].filter((part): part is string => part !== null);

      return `
      <div class="row">
        <div>
          <div class="row-title">${escapeHtml(warranty.service_ar)}</div>
          <div class="muted">${dayMonthYear(warranty.completed_at)}${
            warranty.warranty_days === null
              ? ''
              : ` · ضمان ${counted(warranty.warranty_days, DAY_FORMS)}`
          }</div>
        </div>
        <div class="state ${active ? 'is-active' : 'is-expired'}">${state.join(' · ')}</div>
      </div>`;
    })
    .join('');

  return `
  <section class="block">
    <h2>الضمان</h2>
    ${rows}
    <p class="note">الضمان يغطي العمل الذي نفّذه فنّي هبّة، وليس ما سجّله المالك.</p>
  </section>`;
}

function renderInspections(inspections: readonly ReportInspection[]): string {
  if (inspections.length === 0) {
    return `
  <section class="block">
    <h2>الفحوصات</h2>
    <p class="note">لم يُسجَّل فحص لهذه السيارة عبر هبّة.</p>
  </section>`;
  }

  const rows = inspections
    .map((inspection) => {
      const meta = [
        dayMonthYear(inspection.completed_at),
        inspection.mileage_at_inspection === null
          ? null
          : `${num(inspection.mileage_at_inspection)} كم`,
      ].filter((part): part is string => part !== null);

      // The scale is printed beside the score because "84" on its own is not
      // a fact. It comes from the payload, so an old report keeps its scale.
      return `
      <div class="row">
        <div>
          <div class="row-title">${escapeHtml(inspection.template_ar)}</div>
          <div class="muted">${meta.join(' · ')}</div>
          ${
            inspection.recommendation === null
              ? ''
              : `<div class="muted">التوصية: ${escapeHtml(RECOMMENDATION_LABEL_AR[inspection.recommendation])}</div>`
          }
        </div>
        <div class="score"><span class="score-value">${num(inspection.overall_score)}</span> <span class="muted">من ${num(inspection.score_scale)}</span></div>
      </div>`;
    })
    .join('');

  return `
  <section class="block">
    <h2>الفحوصات</h2>
    ${rows}
  </section>`;
}

/**
 * A version 1 payload predates warranty and inspection capture (0046).
 * Printing «لا يوجد ضمان» for it would be a claim the data never made.
 */
function renderWarrantyAndInspections(report: HabbaReport): string {
  if (!carriesWarrantyAndScore(report)) {
    return `
  <section class="block">
    <h2>الضمان والفحوصات</h2>
    <p class="note">
      صدر هذا التقرير قبل أن تُسجَّل حالة الضمان ونتائج الفحص في التقارير، فلا يمكنه
      عرضها. أصدر تقريراً جديداً من التطبيق لتظهر.
    </p>
  </section>`;
  }

  return `${renderWarranties(report.warranties ?? [])}
  ${renderInspections(report.inspections ?? [])}`;
}

/* -------------------------------------------------------------------------- */

const STYLE = `
  /* A4 with a real margin when printed; on a phone it is the viewer's width. */
  @page { size: A4; margin: 12mm; }

  * { box-sizing: border-box; }

  body {
    margin: 0 auto;
    max-width: 760px;
    padding: 16px;
    color: ${INK};
    background: #FFFFFF;
    /* No webfont: generated on a phone, possibly offline. Every platform in
       scope ships an Arabic face, and the stack names them. */
    font-family: "IBM Plex Sans Arabic", "Tajawal", "Geeza Pro", "Noto Naskh Arabic",
                 "Droid Arabic Naskh", system-ui, sans-serif;
    line-height: 1.75;
    font-size: 15px;
  }
  @media print { body { padding: 0; max-width: none; } }

  .sheet { display: flex; flex-direction: column; gap: 22px; }

  h2 { font-size: 19px; font-weight: 700; margin: 0 0 12px; }
  .block { break-inside: avoid; page-break-inside: avoid; }
  .note { font-size: 13.5px; color: ${SUBTLE}; margin: 10px 0 0; }
  .muted { color: ${MUTED}; font-size: 13.5px; }
  .line { font-size: 14.5px; color: ${INK}; margin: 14px 0 0; }

  .masthead { border-bottom: 3px solid ${PETROL}; padding-bottom: 10px; }
  .masthead-title { font-size: 24px; font-weight: 700; color: ${PETROL}; line-height: 1.3; }
  .masthead-sub { font-size: 14px; color: ${MUTED}; }

  .car { border: 1px solid ${LINE}; border-radius: 14px; padding: 18px; background: #FCFBF8; }
  .car-name { font-size: 26px; font-weight: 700; line-height: 1.35; margin-bottom: 12px; }
  .fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px 16px; }
  .field-label { font-size: 12.5px; color: ${SUBTLE}; }
  .field-value { font-size: 16px; font-weight: 600; overflow-wrap: anywhere; }
  .field-wide { grid-column: 1 / -1; }

  .tiles { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
  .tile { border: 1px solid ${LINE}; border-radius: 14px; padding: 14px; background: ${BAND}; }
  .tile-habba { background: ${TINT}; border-color: ${PETROL}; }
  .tile-number { font-size: 34px; font-weight: 700; line-height: 1.1; color: ${INK}; }
  .tile-habba .tile-number { color: ${PETROL}; }
  .tile-label { font-size: 15px; font-weight: 600; }
  .tile-hint { font-size: 12.5px; color: ${MUTED}; line-height: 1.6; margin-top: 4px; }

  .year { margin-bottom: 8px; }
  .year-head {
    font-size: 15px; font-weight: 700; color: ${MUTED};
    border-bottom: 1px solid ${LINE}; padding-bottom: 4px; margin-bottom: 10px;
    break-after: avoid; page-break-after: avoid;
  }
  /* An entry split across a page boundary is a history a buyer has to
     reassemble by hand, so entries never break. */
  .event {
    border-right: 3px solid ${LINE}; padding: 2px 12px 2px 0; margin-bottom: 14px;
    break-inside: avoid; page-break-inside: avoid;
  }
  .event.is-verified { border-right-color: ${PETROL}; }
  .event-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .event-title { font-size: 16px; font-weight: 600; }
  .event-meta { font-size: 13.5px; color: ${MUTED}; }
  .badge { font-size: 12px; padding: 1px 10px; border-radius: 99px; white-space: nowrap; }
  .badge-verified { font-weight: 600; color: ${PETROL}; background: ${TINT}; border: 1px solid ${PETROL}; }
  .badge-self { color: ${MUTED}; background: ${BAND}; }
  .chips { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px; }
  .chip {
    font-size: 12px; color: ${MUTED}; background: #F6F3ED;
    border: 1px solid ${LINE}; padding: 1px 8px; border-radius: 8px;
  }

  .row {
    display: flex; justify-content: space-between; align-items: center; gap: 12px;
    border-top: 1px solid ${LINE}; padding: 12px 0;
    break-inside: avoid; page-break-inside: avoid;
  }
  .row-title { font-size: 15.5px; font-weight: 600; }
  .state { font-size: 13.5px; text-align: left; }
  .state.is-active { color: ${PETROL}; font-weight: 600; }
  .state.is-expired { color: ${MUTED}; }
  .score { white-space: nowrap; }
  .score-value { font-size: 28px; font-weight: 700; color: ${PETROL}; }

  .trust { border-radius: 14px; background: ${TINT}; border: 1px solid ${PALE}; padding: 18px; break-inside: avoid; }
  .trust h2 { color: ${PETROL}; }
  .trust ul { margin: 0; padding: 0 18px 0 0; }
  .trust li { margin-bottom: 8px; }
  .trust .warn { color: #8A4B08; font-weight: 600; }

  .foot { border-top: 1px solid ${LINE}; padding-top: 10px; font-size: 12px; color: ${SUBTLE}; }
`;

export interface ReportPdfOptions {
  /**
   * The issue date. Defaults to the payload's own `generated_at` — the only
   * date that describes what the document says. A "printed on" date would
   * imply the contents are current when they are frozen.
   */
  readonly issuedOn?: string;
}

export function renderHabbaReportPdf(report: HabbaReport, options: ReportPdfOptions = {}): string {
  const { vehicle, chain } = report;
  const issued = options.issuedOn ?? dateOnly(report.generated_at);
  // The year is a label, not a quantity: `formatNumber` would print «2,019».
  const carName = `${vehicle.make_ar} ${vehicle.model_ar} ${vehicle.year}`;

  const identity = [
    vehicle.plate === null ? null : renderIdentityField('رقم اللوحة', isolate(vehicle.plate)),
    renderIdentityField('العدّاد الآن', `${num(vehicle.current_mileage)} كم`),
    vehicle.colour === null ? null : renderIdentityField('اللون', escapeHtml(vehicle.colour)),
    renderIdentityField('في هبّة منذ', counted(report.ownership.months_on_habba, MONTH_FORMS)),
    vehicle.vin === null ? null : renderIdentityField('رقم الهيكل', isolate(vehicle.vin), true),
  ]
    .filter((field): field is string => field !== null)
    .join('');

  const history =
    report.events.length === 0
      ? '<p class="note">لا توجد سجلات في دفتر هذه السيارة بعد.</p>'
      : groupEventsByYear(report.events)
          .map((group) => renderYearGroup(group.year, group.events))
          .join('');

  const trust = chain.is_valid
    ? `<li>كل ${counted(chain.length, RECORD_FORMS)} في هذا التقرير محفوظة كما كُتبت أول مرة، ولا يمكن تعديلها أو حذفها. تأكّدنا من ذلك يوم ${dayMonthYear(issued)}.</li>`
    : '<li class="warn">تعذّر التأكّد من سلامة السجلات في هذا التقرير. لا تعتمد عليه، واطلب من البائع إصدار تقرير جديد.</li>';

  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>تقرير هبّة — ${escapeHtml(carName)}</title>
<style>${STYLE}</style>
</head>
<body>
<div class="sheet">
  <div class="masthead">
    <div class="masthead-title">تقرير هبّة</div>
    <div class="masthead-sub">سجل صيانة السيارة · صدر في ${dayMonthYear(issued)}</div>
  </div>

  <div class="car block">
    <div class="car-name">${escapeHtml(carName)}</div>
    <div class="fields">${identity}</div>
  </div>

  ${renderSummary(report)}

  <section>
    <h2>سجل الصيانة</h2>
    ${history}
  </section>

  ${renderWarrantyAndInspections(report)}

  <section class="trust">
    <h2>هل أثق في هذا التقرير؟</h2>
    <ul>
      ${trust}
      <li>ما كُتب عليه «نفّذتها هبّة» أدخله فنّي هبّة من التطبيق وقت العمل. أما ما سجّله المالك فلم تتحقّق منه هبّة.</li>
      <li>للتأكّد بنفسك، اطلب من البائع أن يفتح دفتر السيارة في تطبيق هبّة أمامك.</li>
    </ul>
  </section>

  <div class="foot">لا يحتوي هذا التقرير على اسم المالك أو رقم جواله أو عنوانه. المعلومات المعروضة تخصّ السيارة وحدها.</div>
</div>
</body>
</html>`;
}

/**
 * A file name that survives every filesystem the file will pass through.
 *
 * Deliberately Latin: the name travels through WhatsApp, an email client, a
 * Windows downloads folder and possibly a print spooler, and an Arabic
 * filename is mangled by at least one of them often enough that it is not
 * worth the risk on the artefact the sale depends on. The Arabic is inside
 * the document, where it renders.
 */
export function reportFileName(report: HabbaReport): string {
  const { vehicle } = report;
  const parts = [
    'Habba-Report',
    vehicle.make_en,
    vehicle.model_en,
    String(vehicle.year),
    report.generated_at.slice(0, 10),
  ];

  return `${parts
    .join('-')
    .replace(/[^A-Za-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')}.pdf`;
}
