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
  PLURAL_FORMS,
  pluralBase,
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
    // Plural forms differ by language (six in Arabic, two in English), so
    // they are compared by the key the code calls.
    const arKeys = [...new Set(leafKeys(ar).map(pluralBase))].sort();
    const enKeys = [...new Set(leafKeys(en).map(pluralBase))].sort();

    expect(enKeys.filter((k) => !arKeys.includes(k))).toEqual([]);
    expect(arKeys.filter((k) => !enKeys.includes(k))).toEqual([]);
  });

  test('a counted phrase has every plural form its language needs, and only those', () => {
    for (const [locale, resource] of Object.entries({ ar, en }) as ['ar' | 'en', unknown][]) {
      const keys = leafKeys(resource);
      const bases = new Set(keys.filter((k) => pluralBase(k) !== k).map(pluralBase));
      for (const base of bases) {
        const forms = keys
          .filter((k) => pluralBase(k) === base && k !== base)
          .map((k) => k.slice(base.length + 1));
        expect(forms.sort(), `${locale}:${base}`).toEqual([...PLURAL_FORMS[locale]].sort());
      }
    }
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
    // sentence with a hole in it. `count` is exempt inside plural forms: «سيارتان»
    // says the number without writing it.
    const placeholders = (locale: 'ar' | 'en', resource: unknown) => {
      const byBase = new Map<string, Set<string>>();
      for (const key of leafKeys(resource)) {
        const base = pluralBase(key);
        const names = (lookup(locale, key) ?? '').match(/\{\{(\w+)\}\}/g) ?? [];
        const set = byBase.get(base) ?? new Set<string>();
        for (const name of names) if (base === key || name !== '{{count}}') set.add(name);
        byBase.set(base, set);
      }
      return byBase;
    };
    const arNames = placeholders('ar', ar);
    const enNames = placeholders('en', en);

    for (const [base, names] of arNames) {
      expect([...names].sort(), base).toEqual([...(enNames.get(base) ?? [])].sort());
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
      'record_annotated',
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

  test('counts in Arabic the way Arabic counts', () => {
    const t = createTranslator('ar');
    expect(t('settings.vehiclesCount', { count: 0 })).toBe('لا سيارات');
    expect(t('settings.vehiclesCount', { count: 1 })).toBe('سيارة واحدة');
    expect(t('settings.vehiclesCount', { count: 2 })).toBe('سيارتان');
    expect(t('settings.vehiclesCount', { count: 3 })).toBe('3 سيارات');
    expect(t('settings.vehiclesCount', { count: 11 })).toBe('11 سيارةً');
    expect(t('settings.vehiclesCount', { count: 100 })).toBe('100 سيارة');
    expect(t('vehicle.lastOilMonths', { count: 1 })).toBe('قبل شهر');
    expect(t('vehicle.lastOilMonths', { count: 6 })).toBe('قبل 6 أشهر');
    expect(t('vehicle.lastOilMonths', { count: 12 })).toBe('قبل 12 شهراً');

    const en = createTranslator('en');
    expect(en('settings.vehiclesCount', { count: 1 })).toBe('1 vehicle');
    expect(en('settings.vehiclesCount', { count: 4 })).toBe('4 vehicles');
  });

  test('falls back to Arabic, then to the key itself', () => {
    const t = createTranslator('en');
    expect(t('common.appName')).toBe('Habba');
    expect(t('auth.otpSubtitle', { phone: '0501234567' })).toContain('0501234567');
  });
});
