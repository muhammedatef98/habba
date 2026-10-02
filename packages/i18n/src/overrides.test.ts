import { describe, expect, test } from 'vitest';
import { resources } from './index.js';
import { copyProblem, flattenCopy, placeholdersOf, withOverrides } from './overrides.js';

describe('placeholdersOf', () => {
  test('finds every placeholder, sorted', () => {
    expect(placeholdersOf('{{verified}} من {{ total }}')).toEqual(['total', 'verified']);
    expect(placeholdersOf('لا شيء هنا')).toEqual([]);
  });
});

describe('copyProblem', () => {
  test('a plain rewording is fine', () => {
    expect(copyProblem('طلب طارئ', 'اطلب مساعدة')).toBeNull();
  });

  test('the same placeholders, in any order, are fine', () => {
    expect(copyProblem('{{a}} ثم {{b}}', 'أولاً {{b}} وبعدها {{a}}')).toBeNull();
  });

  test('a dropped or renamed placeholder is refused', () => {
    expect(copyProblem('{{amount}} ر.س', 'ر.س')).toBe('placeholders');
    expect(copyProblem('{{amount}} ر.س', '{{price}} ر.س')).toBe('placeholders');
  });

  test('a dropped link is refused', () => {
    expect(copyProblem('أوافق على <terms>الشروط</terms>', 'أوافق على الشروط')).toBe('tags');
  });

  test('an empty sentence is refused', () => {
    expect(copyProblem('طلب طارئ', '   ')).toBe('empty');
  });
});

describe('withOverrides', () => {
  const base = { home: { title: 'الرئيسية', price: 'من {{amount}} ر.س' }, common: { ok: 'تم' } };

  test('replaces what it may, and only in its own language', () => {
    const result = withOverrides(base, [{ key: 'home.title', ar: 'البداية', en: 'Start' }], 'ar');
    expect(result.home.title).toBe('البداية');
    expect(result.common.ok).toBe('تم');
    expect(base.home.title).toBe('الرئيسية');
  });

  test('a null language keeps the shipped sentence', () => {
    expect(
      withOverrides(base, [{ key: 'home.title', ar: null, en: 'Start' }], 'ar').home.title,
    ).toBe('الرئيسية');
  });

  test('skips unknown keys and broken templates', () => {
    const result = withOverrides(
      base,
      [
        { key: 'home.nothing', ar: 'x', en: null },
        { key: 'home.price', ar: 'مجاناً', en: null },
        { key: 'home', ar: 'x', en: null },
      ],
      'ar',
    );
    expect(result).toEqual(base);
  });

  test('the shipped Arabic and English trees have the same keys', () => {
    const ar = [...flattenCopy(resources.ar).keys()];
    const en = new Set(flattenCopy(resources.en).keys());
    const pluralSuffix = /_(zero|one|two|few|many|other)$/;
    const missing = ar.filter((key) => !en.has(key) && !pluralSuffix.test(key));
    expect(missing).toEqual([]);
  });
});
