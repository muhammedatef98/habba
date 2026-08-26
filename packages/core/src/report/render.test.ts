import { describe, expect, test } from 'vitest';
import { escapeHtml, renderHabbaReport } from './render.js';
import { verifiedRatio, type HabbaReport } from './types.js';

const BASE: HabbaReport = {
  report_version: 1,
  generated_at: '2026-08-27T09:00:00Z',
  vehicle: {
    make_ar: 'تويوتا',
    make_en: 'Toyota',
    model_ar: 'كامري',
    model_en: 'Camry',
    year: 2019,
    plate: 'ABJ1234',
    vin: '1HGBH41JXMN109186',
    colour: 'أبيض',
    current_mileage: 84500,
  },
  ownership: { months_on_habba: 14 },
  chain: { is_valid: true, length: 6 },
  coverage: {
    total: 6,
    habba_verified: 2,
    self_documented: 1,
    self_reported: 3,
    third_party: 0,
  },
  mileage_history: [
    { occurred_at: '2025-07-01', mileage: 62000 },
    { occurred_at: '2026-08-01', mileage: 84500 },
  ],
  events: [
    {
      occurred_at: '2026-05-01',
      recorded_at: '2026-05-01',
      event_type: 'service_completed',
      provenance: 'habba_verified',
      summary_ar: 'تغيير زيت وفلتر',
      summary_en: 'Oil and filter change',
      mileage: 78000,
      details: { oil_grade: '5W-30', is_oem: true },
      attachment_count: 2,
    },
    {
      occurred_at: '2025-07-01',
      recorded_at: '2026-08-20',
      event_type: 'service_completed',
      provenance: 'self_reported',
      summary_ar: 'تبديل فحمات',
      summary_en: 'Brake pads',
      mileage: 62000,
      details: {},
      attachment_count: 0,
    },
  ],
};

const OPTIONS = { publicUrl: 'https://habba.sa/r/abc123' };

describe('escapeHtml', () => {
  test('neutralises markup an owner could type into a service description', () => {
    // The report renders owner-typed text into a page a buyer trusts. Without
    // escaping this is stored XSS on a public URL.
    const injected = escapeHtml('<script>alert(1)</script>');
    expect(injected).not.toContain('<script>');
    expect(injected).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  test('escapes quotes and ampersands', () => {
    expect(escapeHtml(`"x" & 'y'`)).toBe('&quot;x&quot; &amp; &#39;y&#39;');
  });
});

describe('renderHabbaReport', () => {
  const html = renderHabbaReport(BASE, OPTIONS);

  test('is a complete RTL Arabic document', () => {
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('lang="ar"');
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('<meta name="viewport"');
  });

  test('needs no JavaScript and no external requests', () => {
    // The buyer is on a phone, on mobile data, standing next to the car.
    // It also means the page cannot leak a referrer or be broken by a CDN.
    expect(html).not.toContain('<script');
    expect(html).not.toMatch(/<link[^>]+href="http/);
    expect(html).not.toMatch(/src="http/);
  });

  test('is excluded from search engines', () => {
    // A shareable vehicle history must not become an indexed corpus of Saudi
    // cars. The token is unguessable, but robots directives are the cheap
    // second layer.
    expect(html).toContain('noindex');
  });

  test('leads with the verified ratio, not a single blended count', () => {
    // ADR-0005: 2 of 6 verified is 33%.
    expect(html).toContain('33%');
    expect(html).toContain('موثّق من هبّة');
    expect(html).toContain('مُدخل من المالك');
  });

  test('states plainly what verification does and does not prove', () => {
    // The sentence that keeps the product honest. If this disappears, the page
    // starts implying the owner's own claims were checked by Habba.
    expect(html).toContain('لم تُعدَّل بعد إدخالها');
    expect(html).toContain('ولا يثبت صحة السجلات');
  });

  test('shows the car identity a buyer verifies against', () => {
    expect(html).toContain('ABJ1234');
    expect(html).toContain('1HGBH41JXMN109186');
    expect(html).toContain('84,500');
  });

  test('never renders owner identity', () => {
    const withOwnerish = renderHabbaReport(BASE, OPTIONS);
    expect(withOwnerish).not.toContain('owner_id');
    expect(withOwnerish).not.toContain('+9665');
  });

  test('marks entries recorded long after they happened', () => {
    // ADR-0012: the second fixture event happened in 2025 and was recorded in
    // 2026. A buyer should see that.
    expect(html).toContain('سُجّل لاحقاً');
  });

  test('distinguishes verified and self-reported entries structurally', () => {
    // Not just colour — a class hook, so the distinction survives a restyle
    // and is available to assistive technology via the badge text.
    expect(html).toContain('is-verified');
    expect(html).toContain('is-self');
    expect(html).toContain('badge-verified');
    expect(html).toContain('badge-self');
  });

  test('renders allowlisted detail keys with Arabic labels', () => {
    expect(html).toContain('درجة الزيت');
    expect(html).toContain('5W-30');
  });

  test('carries a print stylesheet, since print-to-PDF is the delivery path', () => {
    expect(html).toContain('@media print');
  });

  test('escapes injected markup end to end', () => {
    const hostile: HabbaReport = {
      ...BASE,
      events: [
        {
          ...BASE.events[0]!,
          summary_ar: '<img src=x onerror=alert(1)>',
          details: { notes_public: '</style><script>steal()</script>' },
        },
      ],
    };

    const rendered = renderHabbaReport(hostile, OPTIONS);
    expect(rendered).not.toContain('<img src=x');
    expect(rendered).not.toContain('<script>steal()');
    expect(rendered).toContain('&lt;img src=x');
  });

  test('handles an empty history without breaking', () => {
    const empty: HabbaReport = {
      ...BASE,
      coverage: {
        total: 0,
        habba_verified: 0,
        self_documented: 0,
        self_reported: 0,
        third_party: 0,
      },
      events: [],
      mileage_history: [],
    };

    const rendered = renderHabbaReport(empty, OPTIONS);
    expect(rendered).toContain('0%');
    expect(rendered).not.toContain('NaN');
  });
});

describe('verifiedRatio', () => {
  test('is zero for an empty logbook rather than NaN', () => {
    expect(
      verifiedRatio({
        total: 0,
        habba_verified: 0,
        self_documented: 0,
        self_reported: 0,
        third_party: 0,
      }),
    ).toBe(0);
  });

  test('counts only habba_verified toward the ratio', () => {
    // self_documented has an attachment but Habba still did not perform or
    // witness the work, so it does not count as verified.
    expect(
      verifiedRatio({
        total: 4,
        habba_verified: 1,
        self_documented: 2,
        self_reported: 1,
        third_party: 0,
      }),
    ).toBe(0.25);
  });
});
