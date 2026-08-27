/**
 * Inspection report: types and public page renderer.
 *
 * Shares the discipline of the Habba report renderer — no JavaScript, no
 * external requests, Arabic RTL, print-optimised, escaped throughout — because
 * it is read in the same situation: on a phone, standing next to a car,
 * deciding whether to hand over money.
 *
 * The difference is who is reading. تقرير هبّة is a seller showing a history;
 * this is a BUYER reading an assessment they paid for. So the failures are
 * surfaced first rather than buried under a score.
 */

import { escapeHtml } from './render.js';

export type ItemRating = 'pass' | 'attention' | 'fail' | 'na';
export type Recommendation = 'buy' | 'negotiate' | 'avoid';

export interface InspectionTemplateItem {
  readonly key: string;
  readonly label_ar: string;
  readonly label_en?: string;
  readonly required?: boolean;
  readonly weight?: number;
}

export interface InspectionTemplateSection {
  readonly key: string;
  readonly title_ar: string;
  readonly title_en?: string;
  readonly weight?: number;
  readonly items: readonly InspectionTemplateItem[];
}

export interface InspectionResultEntry {
  readonly rating: ItemRating;
  readonly note?: string;
  readonly photos?: readonly string[];
}

export interface InspectionReport {
  readonly report_version: number;
  readonly completed_at: string;
  readonly subject: {
    readonly vin?: string;
    readonly plate?: string;
    readonly make_ar?: string;
    readonly model_ar?: string;
    readonly year?: number;
    readonly mileage?: number;
  };
  readonly overall_score: number | null;
  readonly recommendation: Recommendation | null;
  readonly template: {
    readonly key: string;
    readonly name_ar: string;
    readonly sections: readonly InspectionTemplateSection[];
  };
  readonly results: Readonly<Record<string, Record<string, InspectionResultEntry>>>;
}

const RATING_LABEL_AR: Record<ItemRating, string> = {
  pass: 'سليم',
  attention: 'يحتاج انتباه',
  fail: 'خلل',
  na: 'لا ينطبق',
};

const RECOMMENDATION_AR: Record<Recommendation, string> = {
  buy: 'مناسبة للشراء',
  negotiate: 'قابلة للتفاوض',
  avoid: 'يُنصح بتجنّبها',
};

/**
 * Findings that cost money, worst first.
 *
 * A buyer needs "what is wrong with this car" before "what did it score".
 * Leading with a number invites them to stop reading at a reassuring one.
 */
export function collectFindings(
  report: InspectionReport,
): Array<{ section: string; label: string; rating: ItemRating; note?: string }> {
  const findings: Array<{
    section: string;
    label: string;
    rating: ItemRating;
    note?: string;
    weight: number;
  }> = [];

  for (const section of report.template.sections) {
    const sectionResults = report.results[section.key] ?? {};
    for (const item of section.items) {
      const entry = sectionResults[item.key];
      if (entry === undefined) continue;
      if (entry.rating !== 'fail' && entry.rating !== 'attention') continue;

      findings.push({
        section: section.title_ar,
        label: item.label_ar,
        rating: entry.rating,
        ...(entry.note === undefined ? {} : { note: entry.note }),
        // Sorted by what it costs to fix, not by template order.
        weight: (item.weight ?? 1) * (section.weight ?? 1) * (entry.rating === 'fail' ? 2 : 1),
      });
    }
  }

  return findings.sort((a, b) => b.weight - a.weight).map(({ weight: _weight, ...rest }) => rest);
}

export function countByRating(report: InspectionReport): Record<ItemRating, number> {
  const counts: Record<ItemRating, number> = { pass: 0, attention: 0, fail: 0, na: 0 };

  for (const section of report.template.sections) {
    const sectionResults = report.results[section.key] ?? {};
    for (const item of section.items) {
      const entry = sectionResults[item.key];
      if (entry !== undefined) counts[entry.rating] += 1;
    }
  }

  return counts;
}

export interface InspectionRenderOptions {
  readonly publicUrl: string;
}

export function renderInspectionReport(
  report: InspectionReport,
  options: InspectionRenderOptions,
): string {
  const { subject } = report;
  const score = report.overall_score;
  const findings = collectFindings(report);
  const counts = countByRating(report);

  const title = [subject.make_ar, subject.model_ar, subject.year]
    .filter((part) => part !== undefined && part !== '')
    .join(' ');

  const recommendationTone =
    report.recommendation === 'buy'
      ? 'good'
      : report.recommendation === 'negotiate'
        ? 'warn'
        : 'bad';

  const identity = [
    subject.plate === undefined
      ? null
      : `<div><dt>اللوحة</dt><dd>${escapeHtml(subject.plate)}</dd></div>`,
    subject.vin === undefined
      ? null
      : `<div><dt>رقم الهيكل</dt><dd>${escapeHtml(subject.vin)}</dd></div>`,
    subject.mileage === undefined
      ? null
      : `<div><dt>العداد</dt><dd>${new Intl.NumberFormat('en-US').format(subject.mileage)} كم</dd></div>`,
  ]
    .filter((entry): entry is string => entry !== null)
    .join('');

  const findingsHtml =
    findings.length === 0
      ? '<p class="muted">لم يُسجَّل أي خلل أو ملاحظة.</p>'
      : `<ul class="findings">${findings
          .map(
            (finding) => `
        <li class="finding ${finding.rating}">
          <span class="chip chip-${finding.rating}">${escapeHtml(RATING_LABEL_AR[finding.rating])}</span>
          <b>${escapeHtml(finding.section)}</b> — ${escapeHtml(finding.label)}
          ${finding.note === undefined ? '' : `<p class="note">${escapeHtml(finding.note)}</p>`}
        </li>`,
          )
          .join('')}</ul>`;

  const sectionsHtml = report.template.sections
    .map((section) => {
      const sectionResults = report.results[section.key] ?? {};
      const rows = section.items
        .map((item) => {
          const entry = sectionResults[item.key];
          const rating = entry?.rating ?? 'na';
          return `<tr>
            <td>${escapeHtml(item.label_ar)}</td>
            <td><span class="chip chip-${rating}">${escapeHtml(RATING_LABEL_AR[rating])}</span></td>
          </tr>`;
        })
        .join('');

      return `<section class="card">
        <h3>${escapeHtml(section.title_ar)}</h3>
        <table>${rows}</table>
      </section>`;
    })
    .join('');

  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>تقرير فحص — ${escapeHtml(title)}</title>
<meta name="robots" content="noindex, nofollow">
<style>
  :root {
    --petrol:#0E4F4A; --petrol-50:#E6F2F0; --ink:#1A1917; --muted:#5C5952;
    --line:#DFDDD9; --bg:#F7F7F6; --surface:#fff;
    --good:#2E8B5A; --warn:#C07C12; --bad:#D2342B;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);
    font-family:"IBM Plex Sans Arabic","Tajawal",system-ui,sans-serif;
    line-height:1.7;font-size:16px}
  .wrap{max-width:720px;margin:0 auto;padding:16px}
  header{background:var(--petrol);color:#fff;border-radius:16px;padding:24px}
  header h1{margin:0 0 4px;font-size:26px;line-height:1.4}
  header .sub{opacity:.85;font-size:14px}
  .card{background:var(--surface);border:1px solid var(--line);
    border-radius:16px;padding:20px;margin-top:16px}
  h2{font-size:18px;margin:0 0 12px}
  h3{font-size:16px;margin:0 0 8px}
  dl{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:0}
  dt{font-size:13px;color:var(--muted);margin:0}
  dd{margin:0;font-weight:600}
  .verdict{display:flex;align-items:center;gap:16px;flex-wrap:wrap}
  .score{font-size:44px;font-weight:700}
  .verdict.good .score{color:var(--good)} .verdict.warn .score{color:var(--warn)}
  .verdict.bad .score{color:var(--bad)}
  .badge{padding:4px 14px;border-radius:99px;font-weight:600;font-size:14px}
  .good .badge{background:#E7F5EE;color:var(--good)}
  .warn .badge{background:#FBF0DC;color:var(--warn)}
  .bad .badge{background:#FBE7E6;color:var(--bad)}
  .counts{font-size:13px;color:var(--muted);margin-top:8px}
  ul.findings{list-style:none;margin:0;padding:0}
  .finding{border-top:1px solid var(--line);padding:12px 0}
  .finding:first-child{border-top:0}
  .note{margin:4px 0 0;font-size:14px;color:var(--muted)}
  .chip{font-size:12px;padding:2px 10px;border-radius:99px;margin-inline-end:8px;
    display:inline-block}
  .chip-pass{background:#E7F5EE;color:var(--good)}
  .chip-attention{background:#FBF0DC;color:var(--warn)}
  .chip-fail{background:#FBE7E6;color:var(--bad)}
  .chip-na{background:#EFEEEC;color:var(--muted)}
  table{width:100%;border-collapse:collapse}
  td{padding:6px 0;border-top:1px solid var(--line);font-size:14px}
  tr:first-child td{border-top:0}
  .muted{color:var(--muted);font-size:14px}
  code{word-break:break-all;font-size:12px}
  footer{color:var(--muted);font-size:12px;text-align:center;padding:24px 0}
  @media print{
    body{background:#fff;font-size:12px}
    .card,header{break-inside:avoid;border-radius:0}
    header{background:#fff!important;color:var(--ink);border-bottom:3px solid var(--petrol)}
  }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>${escapeHtml(title)}</h1>
    <div class="sub">${escapeHtml(report.template.name_ar)} — هبّة</div>
  </header>

  <section class="card">
    <h2>الخلاصة</h2>
    <div class="verdict ${recommendationTone}">
      <span class="score">${score === null ? '—' : `${score}%`}</span>
      ${
        report.recommendation === null
          ? ''
          : `<span class="badge">${escapeHtml(RECOMMENDATION_AR[report.recommendation])}</span>`
      }
    </div>
    <p class="counts">
      ${counts.pass} سليم · ${counts.attention} يحتاج انتباه · ${counts.fail} خلل
      ${counts.na > 0 ? `· ${counts.na} لا ينطبق` : ''}
    </p>
  </section>

  <section class="card">
    <h2>الملاحظات والأعطال</h2>
    ${findingsHtml}
  </section>

  <section class="card">
    <h2>بيانات السيارة</h2>
    <dl>${identity}</dl>
  </section>

  ${sectionsHtml}

  <section class="card">
    <h2>عن هذا التقرير</h2>
    <p class="muted">
      نفّذ هذا الفحص فنّي معتمد من هبّة بتاريخ ${escapeHtml(report.completed_at.slice(0, 10))}.
      يصف التقرير حالة السيارة وقت الفحص فقط، ولا يشمل أعطالاً قد تظهر لاحقاً.
    </p>
    <code>${escapeHtml(options.publicUrl)}</code>
  </section>

  <footer>هبّة</footer>
</div>
</body>
</html>`;
}
