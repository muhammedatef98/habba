/**
 * تقرير هبّة as a printable A4 document, generated on the device.
 *
 * ADR-0019: the public verified page is gone, and this replaces it. What a
 * seller hands a buyer is a PDF produced from the frozen payload
 * `generate_habba_report()` issued — not a link, not a live view.
 *
 * The layout is docs/design/report-pdf.md, approved before any of this was
 * written. Three sections, each starting on a fresh sheet:
 *
 *   1. The car, what Habba can stand behind, and the odometer over time.
 *   2. The service history, grouped by the year the work happened.
 *   3. Warranty status, inspection scores, and what this document is not.
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
import { carriesWarrantyAndScore, verifiedRatio } from './types.js';
import {
  ATTACHMENT_FORMS,
  DAY_FORMS,
  DETAIL_LABEL_AR,
  MONTH_FORMS,
  PROVENANCE_LABEL_AR,
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
const SUBTLE = '#66706E';
const LINE = '#E2DDD2';
const BAND = '#F0EBE1';
const TINT = '#EFF7F6';
const MID = '#6FB3AE';
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

/* -------------------------------------------------------------------------- */
/* Sheet 1                                                                     */
/* -------------------------------------------------------------------------- */

/** `value` is HTML: identity values are Latin runs and must arrive isolated. */
function renderIdentityField(label: string, value: string): string {
  return `<div class="field"><div class="field-label">${escapeHtml(label)}</div><div class="field-value">${value}</div></div>`;
}

function renderCoverage(report: HabbaReport): string {
  const { coverage } = report;
  const percent = Math.round(verifiedRatio(coverage) * 100);

  // Owner-entered-with-an-attachment is its own segment. Folding it into
  // "self reported" would hide the difference between a receipt and a memory,
  // which is most of what ADR-0005 is for.
  const documented = coverage.self_documented;
  const reported = coverage.self_reported + coverage.third_party;
  const total = Math.max(coverage.total, 1);

  const widths = {
    verified: (coverage.habba_verified / total) * 100,
    documented: (documented / total) * 100,
    reported: (reported / total) * 100,
  };

  const legend = [
    [coverage.habba_verified, PETROL, PROVENANCE_LABEL_AR.habba_verified],
    [documented, MID, PROVENANCE_LABEL_AR.self_documented],
    [reported, PALE, PROVENANCE_LABEL_AR.self_reported],
  ] as const;

  return `
  <section class="panel">
    <h2>ما الذي تضمنه هبّة</h2>
    <div class="ratio">
      <span class="ratio-value">${isolate(`${formatNumber(percent)}%`)}</span>
      <span class="ratio-caption">من السجلات موثّقة من هبّة</span>
    </div>
    <div class="bar">
      <span style="width:${widths.verified.toFixed(2)}%;background:${PETROL}"></span>
      <span style="width:${widths.documented.toFixed(2)}%;background:${MID}"></span>
      <span style="width:${widths.reported.toFixed(2)}%;background:${PALE}"></span>
    </div>
    <div class="legend">
      ${legend
        .map(
          ([count, colour, label]) =>
            `<span class="legend-item"><i style="background:${colour}"></i>${num(count)} ${escapeHtml(label)}</span>`,
        )
        .join('')}
    </div>
    <p class="panel-note">
      السجلات الموثّقة من هبّة نفّذها فنّي عبر التطبيق مع صور وقراءة عدّاد.
      السجلات المُدخلة من المالك أدخلها صاحب السيارة ولم تتحقّق منها هبّة.
    </p>
  </section>`;
}

/**
 * The odometer over time, running RIGHT TO LEFT — oldest reading at the right,
 * newest at the left, matching the direction the rest of the page is read in.
 *
 * Both ends are direct-labelled with their date and their reading, so the
 * direction cannot be misread even by someone who reads the chart left to
 * right out of habit. One series, one hue, no legend: the heading names it.
 */
function renderMileageChart(points: readonly ReportMileagePoint[]): string {
  if (points.length < 2) {
    return points.length === 0
      ? ''
      : `<section class="block"><h2>قراءات العدّاد</h2><p class="note">قراءة واحدة فقط حتى الآن — لا يمكن رسم تغيّر العدّاد بعد.</p></section>`;
  }

  const width = 698;
  const height = 190;
  const baseline = 152;
  const top = 22;
  const inset = 30;

  const mileages = points.map((point) => point.mileage);
  const min = Math.min(...mileages);
  const max = Math.max(...mileages);
  const span = max - min === 0 ? 1 : max - min;

  // index 0 is the OLDEST point and sits at the RIGHT edge.
  const x = (index: number): number =>
    width - inset - (index * (width - inset * 2)) / (points.length - 1);
  const y = (mileage: number): number =>
    baseline - 20 - ((mileage - min) / span) * (baseline - 20 - top);

  const coordinates = points.map((point, index) => ({
    x: x(index),
    y: y(point.mileage),
    point,
  }));

  const polyline = coordinates.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
  const dots = coordinates
    .map((c) => `<circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="4.5" fill="${PETROL}"/>`)
    .join('');

  const first = coordinates[0]!;
  const last = coordinates[coordinates.length - 1]!;

  return `
  <section class="block">
    <h2>قراءات العدّاد</h2>
    <svg viewBox="0 0 ${width} ${height}" class="chart" role="img"
         aria-label="تطور قراءة العدّاد من ${formatNumber(first.point.mileage)} إلى ${formatNumber(last.point.mileage)} كيلومتر">
      <line x1="8" y1="${baseline}" x2="${width - 8}" y2="${baseline}" stroke="${LINE}" stroke-width="1"/>
      <polyline points="${polyline}" fill="none" stroke="${PETROL}" stroke-width="2"
                stroke-linejoin="round" stroke-linecap="round"/>
      ${dots}
      <text x="${first.x.toFixed(1)}" y="${baseline}" dy="16" dir="ltr" text-anchor="middle" class="axis">${escapeHtml(first.point.occurred_at)}</text>
      <text x="${last.x.toFixed(1)}" y="${baseline}" dy="16" dir="ltr" text-anchor="middle" class="axis">${escapeHtml(last.point.occurred_at)}</text>
      <text x="${(first.x - 12).toFixed(1)}" y="${first.y.toFixed(1)}" dy="-10" text-anchor="end" class="point-label">${formatNumber(first.point.mileage)} كم</text>
      <text x="${(last.x + 12).toFixed(1)}" y="${last.y.toFixed(1)}" dy="-10" text-anchor="start" class="point-label point-label-latest">${formatNumber(last.point.mileage)} كم</text>
    </svg>
    <p class="note">العدّاد لا يرجع إلى الوراء في هبّة: قراءة أقل من المسجّلة تُرفض عند الإدخال.</p>
  </section>`;
}

/* -------------------------------------------------------------------------- */
/* Sheet 2 — the history                                                       */
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

function renderEvent(event: ReportEvent): string {
  const verified = event.provenance === 'habba_verified';

  const meta = [
    event.mileage === null ? null : `العدّاد ${num(event.mileage)} كم`,
    event.attachment_count > 0 ? counted(event.attachment_count, ATTACHMENT_FORMS) : null,
    // Where an entry was written materially later than the work happened, say
    // so (ADR-0012). A buyer deserves to know which entries were recorded at
    // the time and which were written from memory.
    new Date(event.recorded_at).getTime() - new Date(event.occurred_at).getTime() >
    7 * 24 * 60 * 60 * 1000
      ? `سُجّل لاحقاً في ${isolate(event.recorded_at)}`
      : null,
  ].filter((part): part is string => part !== null);

  return `
    <div class="event">
      <div class="event-date">${isolate(event.occurred_at)}</div>
      <div class="event-body ${verified ? 'is-verified' : 'is-self'}">
        <div class="event-head">
          <span class="event-title">${escapeHtml(event.summary_ar)}</span>
          <span class="badge ${verified ? 'badge-verified' : 'badge-self'}">${escapeHtml(
            PROVENANCE_LABEL_AR[event.provenance],
          )}</span>
        </div>
        ${meta.length === 0 ? '' : `<div class="event-meta">${meta.join(' · ')}</div>`}
        ${renderDetailChips(event.details)}
      </div>
    </div>`;
}

/**
 * Groups by the year the work HAPPENED, newest first — the same grouping the
 * logbook screen uses, so paper and app tell one story in one order.
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
  const verified = events.filter((event) => event.provenance === 'habba_verified').length;
  const summary =
    verified === 0
      ? `${counted(events.length, RECORD_FORMS)} · لا شيء موثّق من هبّة`
      : `${counted(events.length, RECORD_FORMS)} · ${num(verified)} موثّق من هبّة`;

  return `
    <div class="year">
      <div class="year-head">
        <span class="year-number">${isolate(year)}</span>
        <span class="year-summary">${summary}</span>
      </div>
      ${events.map(renderEvent).join('')}
    </div>`;
}

/* -------------------------------------------------------------------------- */
/* Sheet 3 — warranty, inspections, and what this document is not              */
/* -------------------------------------------------------------------------- */

function renderWarranties(warranties: readonly ReportWarranty[]): string {
  if (warranties.length === 0) {
    return `
  <section class="block">
    <h2>الضمانات</h2>
    <p class="note">لا يوجد عمل تحت الضمان على هذه السيارة. الأعمال المُدخلة من المالك لا ضمان لها من هبّة.</p>
  </section>`;
  }

  const rows = warranties
    .map((warranty) => {
      const active = warranty.status === 'active';
      const remaining =
        active && warranty.days_remaining !== null
          ? `<span class="warranty-remaining">يتبقّى ${counted(warranty.days_remaining, DAY_FORMS)}</span>`
          : '';
      const claim = warranty.has_open_claim
        ? '<span class="warranty-claim">مطالبة ضمان مفتوحة</span>'
        : '';

      return `
      <div class="table-row">
        <div>${escapeHtml(warranty.service_ar)}</div>
        <div class="muted">${isolate(warranty.completed_at)}</div>
        <div class="muted">${warranty.warranty_days === null ? '—' : counted(warranty.warranty_days, DAY_FORMS)}</div>
        <div class="warranty-status ${active ? 'is-active' : 'is-expired'}">
          <span>${escapeHtml(WARRANTY_STATUS_LABEL_AR[warranty.status])}</span>
          ${remaining}${claim}
        </div>
      </div>`;
    })
    .join('');

  return `
  <section class="block">
    <h2>الضمانات</h2>
    <div class="table">
      <div class="table-row table-head">
        <div>العمل</div><div>التاريخ</div><div>المدة</div><div>الحالة</div>
      </div>
      ${rows}
    </div>
    <p class="note">الضمان يغطي العمل الذي نفّذه فنّي هبّة. الأعمال المُدخلة من المالك لا ضمان لها من هبّة.</p>
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

  const cards = inspections
    .map((inspection) => {
      const meta = [
        inspection.mileage_at_inspection === null
          ? null
          : `العدّاد ${num(inspection.mileage_at_inspection)} كم`,
        'نفّذه فنّي معتمد من هبّة',
      ].filter((part): part is string => part !== null);

      // The scale is printed beside the score because "84" on its own is not
      // a fact. It comes from the payload rather than being assumed here, so
      // an old report keeps printing the scale it was actually scored on.
      return `
      <div class="inspection">
        <div class="score">
          <div class="score-value">${num(inspection.overall_score)}</div>
          <div class="score-scale">من ${num(inspection.score_scale)}</div>
        </div>
        <div class="inspection-body">
          <div class="inspection-title">${escapeHtml(inspection.template_ar)} — ${isolate(inspection.completed_at)}</div>
          <div class="muted">${meta.join(' · ')}</div>
          ${
            inspection.recommendation === null
              ? ''
              : `<div class="muted">التوصية: ${escapeHtml(RECOMMENDATION_LABEL_AR[inspection.recommendation])}</div>`
          }
        </div>
      </div>`;
    })
    .join('');

  return `
  <section class="block">
    <h2>الفحوصات</h2>
    ${cards}
  </section>`;
}

/**
 * Rendered only when the payload is a version that captured these at all.
 *
 * A version 1 report predates them (0046). Printing «لا يوجد ضمان» for a car
 * whose warranties were simply never captured would be a claim the data never
 * made — so the sheet says which it is instead.
 */
function renderWarrantyAndInspections(report: HabbaReport): string {
  if (!carriesWarrantyAndScore(report)) {
    return `
  <section class="block">
    <h2>الضمانات والفحوصات</h2>
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
  /* A4 with a real margin on both platforms. iOS honours @page; Android's
     print framework applies its own, and a document that also carried inner
     padding would end up with a margin twice as wide on one of them. */
  @page { size: A4; margin: 12mm; }

  * { box-sizing: border-box; }

  body {
    margin: 0;
    color: ${INK};
    background: #FFFFFF;
    /* No webfont: the PDF is generated on a phone, possibly offline, and a
       @font-face that fails to load silently reflows the whole document. Every
       platform in scope ships an Arabic face — iOS Geeza Pro, Android Noto
       Naskh — and the stack names them so the fallback is chosen rather than
       inherited. */
    font-family: "IBM Plex Sans Arabic", "Tajawal", "Geeza Pro", "Noto Naskh Arabic",
                 "Droid Arabic Naskh", system-ui, sans-serif;
    /* Arabic needs the taller rhythm — §8. */
    line-height: 1.7;
    font-size: 14.5px;
  }

  .sheet + .sheet { break-before: page; page-break-before: always; }
  .sheet { display: flex; flex-direction: column; gap: 20px; }

  h2 { font-size: 18px; font-weight: 700; margin: 0 0 10px; }
  .block, .panel { break-inside: avoid; page-break-inside: avoid; }
  .note { font-size: 13px; color: ${SUBTLE}; margin: 8px 0 0; }
  .muted { color: ${MUTED}; }

  /* Masthead: a rule, not a flood fill. A full-bleed dark band drinks ink on
     every copy anyone prints. */
  .masthead {
    display: flex; justify-content: space-between; align-items: flex-end;
    border-bottom: 3px solid ${PETROL}; padding-bottom: 12px;
  }
  .masthead-title { font-size: 27px; font-weight: 700; color: ${PETROL}; line-height: 1.3; }
  .masthead-sub { font-size: 15px; color: ${MUTED}; }
  .masthead-side { text-align: left; font-size: 13px; color: ${SUBTLE}; line-height: 1.6; }
  .running-head {
    display: flex; justify-content: space-between; align-items: flex-end;
    border-bottom: 3px solid ${PETROL}; padding-bottom: 12px;
  }
  .running-head h1 { font-size: 20px; font-weight: 700; color: ${PETROL}; margin: 0; }
  .running-head div { font-size: 13px; color: ${SUBTLE}; }

  .car-name { font-size: 34px; font-weight: 700; line-height: 1.35; }
  .fields { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; }
  .field-label { font-size: 13px; color: ${SUBTLE}; }
  .field-value { font-size: 17px; font-weight: 600; }

  .panel { border: 1px solid ${LINE}; background: #FCFBF8; padding: 20px; }
  .panel-note {
    font-size: 13.5px; color: ${MUTED}; border-top: 1px solid ${LINE};
    padding-top: 12px; margin: 12px 0 0;
  }
  .ratio { display: flex; align-items: baseline; gap: 10px; }
  .ratio-value { font-size: 44px; font-weight: 700; color: ${PETROL}; line-height: 1; }
  .ratio-caption { font-size: 15px; color: ${MUTED}; }
  .bar { display: flex; gap: 2px; height: 14px; width: 100%; margin: 14px 0; }
  .bar > span { display: block; }
  .legend { display: flex; gap: 22px; flex-wrap: wrap; font-size: 13.5px; color: ${MUTED}; }
  .legend-item { display: flex; align-items: center; gap: 7px; }
  .legend-item i { width: 11px; height: 11px; flex: none; }

  .chart { width: 100%; height: 190px; }
  .axis { font-size: 12.5px; fill: ${SUBTLE}; }
  .point-label { font-size: 13px; fill: ${MUTED}; }
  .point-label-latest { font-weight: 600; fill: ${INK}; }

  .year { margin-bottom: 18px; }
  .year-head {
    display: flex; align-items: baseline; gap: 10px;
    background: ${BAND}; padding: 7px 12px; margin-bottom: 14px;
    break-after: avoid; page-break-after: avoid;
  }
  .year-number { font-size: 16px; font-weight: 700; }
  .year-summary { font-size: 13px; color: ${MUTED}; }

  /* An entry split across a page boundary is a history a buyer has to
     reassemble by hand, so entries never break. */
  .event { display: flex; gap: 14px; margin-bottom: 14px; break-inside: avoid; page-break-inside: avoid; }
  .event-date { width: 84px; flex: none; font-size: 13px; color: ${SUBTLE}; padding-top: 2px; }
  .event-body { flex: 1 1 auto; border-right: 2px solid ${LINE}; padding-right: 14px; }
  .event-body.is-verified { border-right-color: ${PETROL}; }
  .event-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .event-title { font-size: 16.5px; font-weight: 600; }
  .event-meta { font-size: 13.5px; color: ${MUTED}; }
  .badge { font-size: 12px; padding: 1px 10px; }
  .badge-verified { font-weight: 600; color: ${PETROL}; border: 1px solid ${PETROL}; background: ${TINT}; }
  .badge-self { color: ${MUTED}; background: ${BAND}; }
  .chips { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 6px; }
  .chip {
    font-size: 12.5px; color: ${MUTED}; background: #F6F3ED;
    border: 1px solid ${LINE}; padding: 2px 9px;
  }

  .table { border: 1px solid ${LINE}; }
  .table-row {
    display: grid; grid-template-columns: 2.4fr 1.2fr 1fr 1.4fr; gap: 12px;
    padding: 12px 14px; border-top: 1px solid ${LINE}; align-items: center;
    break-inside: avoid; page-break-inside: avoid;
  }
  .table-head {
    background: ${BAND}; border-top: 0; padding: 10px 14px;
    font-size: 13px; color: ${MUTED}; font-weight: 600;
  }
  .warranty-status { display: flex; flex-direction: column; }
  .warranty-status.is-active > span:first-child { font-weight: 600; color: ${PETROL}; }
  .warranty-status.is-expired > span:first-child { color: ${MUTED}; }
  .warranty-remaining, .warranty-claim { font-size: 12.5px; color: ${SUBTLE}; }

  .inspection {
    border: 1px solid ${LINE}; padding: 18px; display: flex; gap: 22px;
    align-items: center; margin-bottom: 12px;
    break-inside: avoid; page-break-inside: avoid;
  }
  .score {
    flex: none; display: flex; flex-direction: column; align-items: center;
    border-left: 1px solid ${LINE}; padding-left: 22px;
  }
  .score-value { font-size: 40px; font-weight: 700; color: ${PETROL}; line-height: 1; }
  .score-scale { font-size: 12.5px; color: ${SUBTLE}; }
  .inspection-body { flex: 1 1 auto; font-size: 13.5px; }
  .inspection-title { font-size: 16px; font-weight: 600; }

  .verify { border: 1px solid ${PETROL}; background: ${TINT}; padding: 20px; break-inside: avoid; }
  .verify h2 { color: ${PETROL}; font-size: 17px; margin: 0 0 10px; }
  .verify p { margin: 0 0 10px; font-size: 14.5px; }
  .verify .caveat {
    font-size: 13px; color: ${MUTED}; border-top: 1px solid #A9D2CE;
    padding-top: 12px; margin: 0;
  }

  .foot {
    border-top: 1px solid ${LINE}; padding-top: 12px; margin-top: 8px;
    display: flex; justify-content: space-between; gap: 16px;
    font-size: 12px; color: ${SUBTLE};
  }
`;

export interface ReportPdfOptions {
  /**
   * Shown in the masthead. Defaults to the payload's own `generated_at`, which
   * is the only date that describes what the document actually says — a
   * "printed on" date would imply the contents are current when they are
   * frozen.
   */
  readonly issuedOn?: string;
}

export function renderHabbaReportPdf(report: HabbaReport, options: ReportPdfOptions = {}): string {
  const { vehicle, chain, coverage } = report;
  const issued = options.issuedOn ?? dateOnly(report.generated_at);
  // The year is a label, not a quantity: `formatNumber` would print «2,019».
  const carName = `${vehicle.make_ar} ${vehicle.model_ar} ${vehicle.year}`;
  const plate = vehicle.plate ?? '';

  const identity = [
    vehicle.plate === null ? null : renderIdentityField('رقم اللوحة', isolate(vehicle.plate)),
    vehicle.vin === null ? null : renderIdentityField('رقم الهيكل', isolate(vehicle.vin)),
    vehicle.colour === null ? null : renderIdentityField('اللون', escapeHtml(vehicle.colour)),
    renderIdentityField('قراءة العدّاد', `${num(vehicle.current_mileage)} كم`),
    renderIdentityField('على هبّة منذ', counted(report.ownership.months_on_habba, MONTH_FORMS)),
    renderIdentityField('عدد السجلات', counted(coverage.total, RECORD_FORMS)),
  ]
    .filter((field): field is string => field !== null)
    .join('');

  const history =
    report.events.length === 0
      ? '<p class="note">لا توجد سجلات في دفتر هذه السيارة بعد.</p>'
      : groupEventsByYear(report.events)
          .map((group) => renderYearGroup(group.year, group.events))
          .join('');

  const privacyLine =
    'لا يحتوي هذا التقرير على اسم المالك أو رقم جواله أو عنوانه. المعلومات المعروضة تخصّ السيارة وحدها.';

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
    <div>
      <div class="masthead-title">تقرير هبّة</div>
      <div class="masthead-sub">سجل صيانة السيارة</div>
    </div>
    <div class="masthead-side">صدر في ${isolate(issued)}</div>
  </div>

  <div class="block">
    <div class="car-name">${escapeHtml(carName)}</div>
    <div class="fields">${identity}</div>
  </div>

  ${renderCoverage(report)}
  ${renderMileageChart(report.mileage_history)}

  <div class="foot">
    <div>${escapeHtml(privacyLine)}</div>
    <div>هبّة</div>
  </div>
</div>

<div class="sheet">
  <div class="running-head">
    <h1>سجل الصيانة</h1>
    <div>${escapeHtml(carName)} · ${isolate(plate)}</div>
  </div>
  ${history}
  <div class="foot">
    <div>تقرير هبّة · صدر في ${isolate(issued)}</div>
    <div>هبّة</div>
  </div>
</div>

<div class="sheet">
  <div class="running-head">
    <h1>الضمان والفحوصات</h1>
    <div>${escapeHtml(carName)} · ${isolate(plate)}</div>
  </div>

  ${renderWarrantyAndInspections(report)}

  <section class="verify">
    <h2>${chain.is_valid ? 'سلسلة السجل مُتحقّق منها' : 'تعذّر التحقّق من سلسلة السجل'}</h2>
    <p>
      ${
        chain.is_valid
          ? `يحتوي هذا التقرير على ${counted(chain.length, RECORD_FORMS)} مترابطة بسلسلة تجزئة (hash chain). تحقّقت هبّة من السلسلة كاملة عند إصدار هذا الملف في ${isolate(issued)}، ولم يُعدَّل أو يُحذَف أي سجل منذ تدوينه.`
          : 'لم تتحقّق هبّة من سلسلة السجلات في هذا الملف.'
      }
    </p>
    <p class="caveat">
      هذا التحقّق يثبت أن السجلات لم تُعدَّل بعد إدخالها، ولا يثبت صحة ما أدخله المالك بنفسه.
      وهذا الملف نسخة مطبوعة من سجل داخل التطبيق: للتأكّد منه بشكل مستقل، اطلب من البائع
      فتح دفتر السيارة في تطبيق هبّة أمامك.
    </p>
  </section>

  <div class="foot">
    <div>${escapeHtml(privacyLine)}</div>
    <div>تقرير هبّة · ${isolate(issued)}</div>
  </div>
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
