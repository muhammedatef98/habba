import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import {
  fillLegalTemplate,
  LEGAL_DOCUMENT_KINDS,
  LEGAL_MISSING_VALUE,
  legalTemplateValues,
  parseLegalDocument,
} from './document.js';

const SETTINGS = {
  legal_company_name_ar: 'شركة هبّة لخدمات السيارات',
  legal_company_name_en: 'Habba Car Services Co.',
  legal_cr_number: '2050123456',
  legal_address_ar: 'الخبر',
  legal_address_en: 'Khobar',
  support_email: 'care@habba.sa',
  support_phone: '920000000',
  dispute_window_days: 14,
  auto_complete_after_hours: 24,
};

function published(kind: string, locale: 'ar' | 'en'): string {
  const url = new URL(`../../../../docs/legal/${kind}.${locale}.md`, import.meta.url);
  return readFileSync(fileURLToPath(url), 'utf8');
}

describe('fillLegalTemplate', () => {
  test('fills what it knows and dashes what it does not', () => {
    expect(
      fillLegalTemplate('{{company}} — {{ cr }} — {{unknown}} — {{email}}', {
        company: 'هبّة',
        cr: '1010',
        email: '  ',
      }),
    ).toBe(`هبّة — 1010 — ${LEGAL_MISSING_VALUE} — ${LEGAL_MISSING_VALUE}`);
  });

  test('takes the numbers the app enforces from the settings', () => {
    const values = legalTemplateValues(
      SETTINGS,
      { version: 3, publishedAt: '2026-10-01T09:00:00Z' },
      'ar',
    );
    expect(values).toMatchObject({
      company: 'شركة هبّة لخدمات السيارات',
      dispute_window_days: '14',
      auto_complete_hours: '24',
      version: '3',
      effective_date: '\u20662026-10-01\u2069',
    });
    expect(
      legalTemplateValues(SETTINGS, { version: 1, publishedAt: '2026-10-01' }, 'en')['company'],
    ).toBe('Habba Car Services Co.');
  });
});

describe('the published documents', () => {
  for (const kind of LEGAL_DOCUMENT_KINDS) {
    for (const locale of ['ar', 'en'] as const) {
      test(`${kind}.${locale} names only values the app supplies`, () => {
        const values = legalTemplateValues(
          SETTINGS,
          { version: 1, publishedAt: '2026-10-01' },
          locale,
        );
        const text = published(kind, locale);
        const named = [...text.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)].map((match) => match[1]);
        expect(named.length).toBeGreaterThan(0);
        for (const name of named) expect(values[name ?? ''], name).toBeTruthy();
        expect(fillLegalTemplate(text, values)).not.toContain('{{');
      });

      test(`${kind}.${locale} parses into a titled document`, () => {
        const blocks = parseLegalDocument(published(kind, locale));
        expect(blocks[0]?.type).toBe('title');
        expect(blocks.filter((block) => block.type === 'heading').length).toBeGreaterThan(5);
      });
    }
  }
});

describe('version 1', () => {
  test('the migration publishes exactly the reviewed copy in docs/legal', () => {
    const migration = readFileSync(
      fileURLToPath(
        new URL('../../../../supabase/migrations/0083_legal_documents.sql', import.meta.url),
      ),
      'utf8',
    );
    const bodies = migration.split('$legal$').filter((_, index) => index % 2 === 1);
    const expected = LEGAL_DOCUMENT_KINDS.flatMap((kind) => [
      published(kind, 'ar'),
      published(kind, 'en'),
    ]);
    expect(bodies).toEqual(expected);
  });
});

describe('parseLegalDocument', () => {
  test('reads the subset the documents are written in', () => {
    expect(
      parseLegalDocument(
        '# العنوان\n\nسطر أول\nيكمل الفقرة.\n\n## 1. قسم\n\n- بند **مهم** هنا\n\n_ترجمة_\n',
      ),
    ).toEqual([
      { type: 'title', text: 'العنوان' },
      { type: 'paragraph', runs: [{ text: 'سطر أول يكمل الفقرة.', bold: false }] },
      { type: 'heading', text: '1. قسم' },
      {
        type: 'bullet',
        runs: [
          { text: 'بند ', bold: false },
          { text: 'مهم', bold: true },
          { text: ' هنا', bold: false },
        ],
      },
      { type: 'note', text: 'ترجمة' },
    ]);
  });
});
