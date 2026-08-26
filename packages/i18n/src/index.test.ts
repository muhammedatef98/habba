import { describe, expect, test } from 'vitest';
import ar from './locales/ar.json' with { type: 'json' };
import en from './locales/en.json' with { type: 'json' };
import {
  createTranslator,
  DEFAULT_LOCALE,
  directionOf,
  interpolate,
  isRtl,
  lookup,
  resolveLocale,
} from './index.js';

/** Collects every dotted leaf path in a resource tree. */
function leafKeys(node: unknown, prefix = ''): string[] {
  if (typeof node === 'string') return [prefix];
  if (typeof node !== 'object' || node === null) return [];
  return Object.entries(node).flatMap(([key, value]) =>
    leafKeys(value, prefix === '' ? key : `${prefix}.${key}`),
  );
}

describe('locale parity', () => {
  test('en has every key ar has, and no extras', () => {
    // Arabic is the source of truth (CLAUDE.md §2.1). A key present in one
    // file and missing from the other ships as a raw key path in the UI.
    const arKeys = leafKeys(ar).sort();
    const enKeys = leafKeys(en).sort();

    expect(enKeys.filter((k) => !arKeys.includes(k))).toEqual([]);
    expect(arKeys.filter((k) => !enKeys.includes(k))).toEqual([]);
  });

  test('no locale value is empty', () => {
    for (const [locale, resource] of Object.entries({ ar, en })) {
      for (const key of leafKeys(resource)) {
        expect(lookup(locale as 'ar' | 'en', key), `${locale}:${key}`).toBeTruthy();
      }
    }
  });

  test('interpolation placeholders match across locales', () => {
    // A placeholder present in one language and missing in the other renders a
    // sentence with a hole in it.
    const placeholders = (value: string) => (value.match(/\{\{(\w+)\}\}/g) ?? []).sort();

    for (const key of leafKeys(ar)) {
      const arValue = lookup('ar', key);
      const enValue = lookup('en', key);
      expect(placeholders(arValue ?? ''), key).toEqual(placeholders(enValue ?? ''));
    }
  });

  test('every timeline event type has copy in both locales', () => {
    // These keys are driven by the timeline_event_type enum in migration 0002.
    // A new enum value without copy renders as a raw key in the logbook — the
    // one screen the product cannot afford to look broken.
    const eventTypes = [
      'vehicle_registered',
      'service_completed',
      'inspection_completed',
      'parts_replaced',
      'mileage_recorded',
      'warranty_claimed',
      'ownership_transferred',
      'alert_raised',
      'alert_dismissed',
    ];

    for (const eventType of eventTypes) {
      expect(lookup('ar', `logbook.events.${eventType}`), eventType).toBeTruthy();
      expect(lookup('en', `logbook.events.${eventType}`), eventType).toBeTruthy();
    }
  });

  test('provenance badges are worded distinctly (ADR-0005)', () => {
    // The product must never use one word for "recorded" and "verified".
    const verified = lookup('ar', 'logbook.verifiedBadge');
    const selfReported = lookup('ar', 'logbook.selfReportedBadge');

    expect(verified).not.toEqual(selfReported);
    expect(verified).toContain('هبّة');
    expect(selfReported).toContain('المالك');
  });
});

describe('direction and locale resolution', () => {
  test('Arabic is the default and is RTL', () => {
    expect(DEFAULT_LOCALE).toBe('ar');
    expect(isRtl('ar')).toBe(true);
    expect(directionOf('ar')).toBe('rtl');
    expect(directionOf('en')).toBe('ltr');
  });

  test('resolves device locales, falling back to Arabic', () => {
    expect(resolveLocale('ar-SA')).toBe('ar');
    expect(resolveLocale('en-GB')).toBe('en');
    expect(resolveLocale(['fr-FR', 'en-US'])).toBe('en');
    expect(resolveLocale(['fr-FR'])).toBe('ar');
    expect(resolveLocale(undefined)).toBe('ar');
    expect(resolveLocale([])).toBe('ar');
  });
});

describe('translator', () => {
  test('interpolates parameters', () => {
    expect(interpolate('كود إلى {{phone}}', { phone: '0501234567' })).toBe('كود إلى 0501234567');
    expect(interpolate('no params')).toBe('no params');
    expect(interpolate('{{missing}} stays', {})).toBe('{{missing}} stays');
  });

  test('falls back to Arabic, then to the key itself', () => {
    const t = createTranslator('en');
    expect(t('common.appName')).toBe('Habba');
    expect(t('auth.otpSubtitle', { phone: '0501234567' })).toContain('0501234567');
  });
});
