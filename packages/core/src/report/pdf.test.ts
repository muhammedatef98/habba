import { describe, expect, test } from 'vitest';
import type { HabbaReport, ReportEvent } from './types.js';
import { renderHabbaReportPdf, reportFileName } from './pdf.js';

function event(overrides: Partial<ReportEvent> = {}): ReportEvent {
  return {
    occurred_at: '2026-01-05',
    recorded_at: '2026-01-05',
    event_type: 'service_completed',
    provenance: 'habba_verified',
    summary_ar: 'تغيير زيت وفلتر',
    summary_en: 'Oil and filter change',
    mileage: 61200,
    details: { oil_grade: '5W-30', filter_part_number: '90915-YZZE1' },
    attachment_count: 3,
    ...overrides,
  };
}

function report(overrides: Partial<HabbaReport> = {}): HabbaReport {
  return {
    report_version: 2,
    generated_at: '2026-09-06T09:30:00Z',
    vehicle: {
      make_ar: 'تويوتا',
      make_en: 'Toyota',
      model_ar: 'كامري',
      model_en: 'Camry',
      year: 2019,
      plate: 'أ ب ج 1234',
      vin: 'JTNBE46K073123456',
      colour: 'أبيض لؤلؤي',
      current_mileage: 61200,
    },
    ownership: { months_on_habba: 19 },
    chain: { is_valid: true, length: 8 },
    coverage: {
      total: 8,
      habba_verified: 3,
      self_documented: 2,
      self_reported: 3,
      third_party: 0,
    },
    mileage_history: [
      { occurred_at: '2023-04-10', mileage: 38400 },
      { occurred_at: '2024-02-18', mileage: 43900 },
      { occurred_at: '2025-05-02', mileage: 51100 },
      { occurred_at: '2026-01-05', mileage: 61200 },
    ],
    events: [event()],
    warranties: [
      {
        service_ar: 'تغيير زيت وفلتر',
        service_en: 'Oil and filter change',
        completed_at: '2026-01-05',
        expires_at: '2026-04-05',
        warranty_days: 90,
        status: 'active',
        days_remaining: 30,
        has_open_claim: false,
      },
      {
        service_ar: 'تغيير فحمات أمامية',
        service_en: 'Front brake pads',
        completed_at: '2025-08-14',
        expires_at: '2026-02-10',
        warranty_days: 180,
        status: 'expired',
        days_remaining: null,
        has_open_claim: false,
      },
    ],
    inspections: [
      {
        completed_at: '2025-05-02',
        template_ar: 'فحص دوري شامل',
        template_en: 'Periodic inspection',
        overall_score: 84,
        score_scale: 100,
        recommendation: 'buy',
        mileage_at_inspection: 51100,
      },
    ],
    ...overrides,
  };
}

describe('document shape', () => {
  test('is an Arabic RTL document in three sheets', () => {
    const html = renderHabbaReportPdf(report());

    expect(html).toContain('<html lang="ar" dir="rtl">');
    expect(html.match(/class="sheet"/g)).toHaveLength(3);
    expect(html).toContain('@page { size: A4; margin: 12mm; }');
  });

  test('carries no link and no QR anywhere — ADR-0019', () => {
    const html = renderHabbaReportPdf(report());

    expect(html).not.toContain('http://');
    // The one https:// that would be legitimate is a webfont, and there is
    // deliberately none: a @font-face that fails to load on a phone with no
    // signal silently reflows the whole document.
    expect(html).not.toContain('https://');
    expect(html).not.toContain('<a ');
    expect(html).not.toContain('habba.sa');
  });

  test('states the issue date from the payload, not from the clock', () => {
    // The report is frozen at generation (0014). A "printed on" date would
    // imply the contents are current when they are a statement about a moment.
    const html = renderHabbaReportPdf(report());
    expect(html).toContain('صدر في <bdi>2026-09-06</bdi>');
  });
});

describe('what it must never print', () => {
  test('escapes owner-typed text rather than rendering it as markup', () => {
    const html = renderHabbaReportPdf(
      report({ events: [event({ summary_ar: '<img src=x onerror=alert(1)>' })] }),
    );

    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  test('isolates every Latin run so bidi cannot reorder it', () => {
    // Without isolation the bidi algorithm resolves the neutral `-` against
    // the Arabic around it: `90915-YZZE1` prints as `YZZE1-90915` and
    // `2026-01-05` as `05-01-2026`. A reader cannot correct for that — it
    // reads as the wrong part number and the wrong date.
    const html = renderHabbaReportPdf(report());

    expect(html).toContain('<bdi>90915-YZZE1</bdi>');
    expect(html).toContain('<bdi>JTNBE46K073123456</bdi>');
    // Isolated, not forced left-to-right: a Saudi plate reads «أ ب ج ١٢٣٤»
    // right to left, so `<bdi>`'s auto direction is the only correct answer
    // for the plate and the part number at once.
    expect(html).toContain('<bdi>أ ب ج 1234</bdi>');
  });

  test('prints the model year as a year, not as a quantity', () => {
    const html = renderHabbaReportPdf(report());
    expect(html).toContain('تويوتا كامري 2019');
    expect(html).not.toContain('2,019');
  });

  test('says on paper that the owner is deliberately absent', () => {
    const html = renderHabbaReportPdf(report());
    expect(html).toContain('لا يحتوي هذا التقرير على اسم المالك');
  });
});

describe('the mileage chart', () => {
  test('runs right to left: the oldest reading is at the right edge', () => {
    const html = renderHabbaReportPdf(report());
    const points = /<polyline points="([^"]+)"/.exec(html)?.[1];
    expect(points).toBeDefined();

    const xs = points!.split(' ').map((pair) => Number(pair.split(',')[0]));
    // Strictly decreasing x as time advances — reading direction, matching the
    // rest of the page.
    for (let i = 1; i < xs.length; i += 1) expect(xs[i]!).toBeLessThan(xs[i - 1]!);
  });

  test('direct-labels both ends so the direction cannot be misread', () => {
    const html = renderHabbaReportPdf(report());
    expect(html).toContain('38,400 كم');
    expect(html).toContain('61,200 كم');
    expect(html).toContain('>2023-04-10<');
    expect(html).toContain('>2026-01-05<');
  });

  test('a single reading is not drawn as a trend', () => {
    const html = renderHabbaReportPdf(
      report({ mileage_history: [{ occurred_at: '2026-01-05', mileage: 61200 }] }),
    );
    expect(html).not.toContain('<polyline');
    expect(html).toContain('قراءة واحدة فقط');
  });

  test('a flat odometer does not divide by zero', () => {
    const html = renderHabbaReportPdf(
      report({
        mileage_history: [
          { occurred_at: '2025-01-01', mileage: 50000 },
          { occurred_at: '2026-01-01', mileage: 50000 },
        ],
      }),
    );
    expect(html).toContain('<polyline');
    expect(html).not.toContain('NaN');
  });
});

describe('the history', () => {
  test('groups by the year the work happened, newest first', () => {
    const html = renderHabbaReportPdf(
      report({
        events: [
          event({ occurred_at: '2024-02-18', summary_ar: 'تغيير بطارية' }),
          event({ occurred_at: '2026-01-05', summary_ar: 'تغيير زيت وفلتر' }),
          event({ occurred_at: '2025-08-14', summary_ar: 'تغيير فحمات أمامية' }),
        ],
      }),
    );

    const years = [...html.matchAll(/class="year-number"><bdi>(\d{4})</g)].map((match) => match[1]);
    expect(years).toEqual(['2026', '2025', '2024']);
  });

  test('counts what each year is worth to a buyer', () => {
    const html = renderHabbaReportPdf(
      report({
        events: [
          event({ occurred_at: '2026-01-05' }),
          event({ occurred_at: '2026-03-01', provenance: 'self_reported' }),
        ],
      }),
    );
    // «سجلان», not «٢ سجل» — the dual is not optional in Arabic, and this is
    // a document a seller hands to a buyer.
    expect(html).toContain('سجلان · <bdi>1</bdi> موثّق من هبّة');
  });

  test('a year with nothing verified says so rather than showing a bare count', () => {
    const html = renderHabbaReportPdf(report({ events: [event({ provenance: 'self_reported' })] }));
    expect(html).toContain('لا شيء موثّق من هبّة');
  });

  test('flags an entry written long after the work, per ADR-0012', () => {
    const html = renderHabbaReportPdf(
      report({ events: [event({ occurred_at: '2025-01-05', recorded_at: '2026-01-05' })] }),
    );
    expect(html).toContain('سُجّل لاحقاً في <bdi>2026-01-05</bdi>');
  });

  test('labels detail chips in Arabic and leaves unknown keys legible', () => {
    const html = renderHabbaReportPdf(
      report({ events: [event({ details: { oil_grade: '5W-30', gearbox_kind: 'CVT' } })] }),
    );
    expect(html).toContain('درجة الزيت: <bdi>5W-30</bdi>');
    expect(html).toContain('gearbox_kind: <bdi>CVT</bdi>');
  });

  test('an empty logbook is stated, not left blank', () => {
    const html = renderHabbaReportPdf(report({ events: [] }));
    expect(html).toContain('لا توجد سجلات');
  });
});

describe('warranty and inspections', () => {
  test('prints status, not just a duration', () => {
    const html = renderHabbaReportPdf(report());
    expect(html).toContain('ساري');
    expect(html).toContain('يتبقّى <bdi>30</bdi> يوماً');
    expect(html).toContain('منتهٍ');
  });

  test('an expired warranty is listed rather than hidden', () => {
    // A car whose cover ran out is a different car from one that never had
    // any, and a buyer must be able to tell them apart.
    const html = renderHabbaReportPdf(report());
    expect(html).toContain('تغيير فحمات أمامية');
    expect(html).toContain('<bdi>180</bdi> يوماً');
  });

  test('an open claim is surfaced', () => {
    const base = report();
    const html = renderHabbaReportPdf({
      ...base,
      warranties: [{ ...base.warranties![0]!, has_open_claim: true }],
    });
    expect(html).toContain('مطالبة ضمان مفتوحة');
  });

  test('the score is printed with the scale it was scored on', () => {
    const html = renderHabbaReportPdf(report());
    expect(html).toContain('>84</bdi>');
    expect(html).toContain('من <bdi>100</bdi>');
    expect(html).toContain('التوصية: صالحة للشراء');
  });

  test('a version 1 payload says it predates these, rather than claiming none exist', () => {
    // Printing "لا يوجد ضمان" for a car whose warranties were simply never
    // captured would be a claim the data never made.
    const { warranties: _w, inspections: _i, ...v1 } = report({ report_version: 1 });
    const html = renderHabbaReportPdf(v1);
    expect(html).toContain('صدر هذا التقرير قبل أن تُسجَّل حالة الضمان');
    expect(html).not.toContain('لا يوجد عمل تحت الضمان');
  });

  test('a version 2 payload with empty arrays states the real answer', () => {
    const html = renderHabbaReportPdf(report({ warranties: [], inspections: [] }));
    expect(html).toContain('لا يوجد عمل تحت الضمان');
    expect(html).toContain('لم يُسجَّل فحص');
  });
});

describe('the verification statement', () => {
  test('says what the chain proves and what it does not', () => {
    const html = renderHabbaReportPdf(report());
    expect(html).toContain('سلسلة السجل مُتحقّق منها');
    expect(html).toContain('<bdi>8</bdi> سجلات مترابطة');
    expect(html).toContain('ولا يثبت صحة ما أدخله المالك بنفسه');
  });

  test('tells the buyer how to verify without a link — ADR-0019', () => {
    const html = renderHabbaReportPdf(report());
    expect(html).toContain('اطلب من البائع');
  });

  test('a report over a broken chain does not claim verification', () => {
    // generate_habba_report refuses to issue one at all (0014), so this is a
    // belt-and-braces case — but the renderer must never assert what the
    // payload did not.
    const html = renderHabbaReportPdf(report({ chain: { is_valid: false, length: 0 } }));
    expect(html).toContain('تعذّر التحقّق');
    expect(html).not.toContain('سلسلة السجل مُتحقّق منها');
  });
});

describe('reportFileName', () => {
  test('names the car and the day, so the attachment is recognisable', () => {
    // A share sheet shows the file name, and so does the buyer's downloads
    // folder six weeks later. Expo's own `<random>.pdf` is what an attachment
    // nobody opens looks like.
    expect(reportFileName(report())).toBe('Habba-Report-Toyota-Camry-2019-2026-09-06.pdf');
  });

  test('is Latin even though the document is Arabic', () => {
    // The file passes through WhatsApp, an email client and a Windows
    // downloads folder; the Arabic is inside the document, where it renders.
    const base = report();
    const name = reportFileName({
      ...base,
      vehicle: { ...base.vehicle, make_en: 'مرسيدس', model_en: 'E 200' },
    });

    expect(name).toBe('Habba-Report-E-200-2019-2026-09-06.pdf');
    expect(name).toMatch(/^[A-Za-z0-9.-]+$/);
  });

  test('never produces runs of separators or a leading dash', () => {
    const base = report();
    const name = reportFileName({
      ...base,
      vehicle: { ...base.vehicle, make_en: '  ', model_en: '///' },
    });

    expect(name).toBe('Habba-Report-2019-2026-09-06.pdf');
  });
});
