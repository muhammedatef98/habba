import { describe, expect, test } from 'vitest';
import { CATALOGUE_ICONS, catalogueGlyph } from './icons';
import {
  keyFrom,
  parseTemplate,
  templateProblems,
  type TemplateSection,
} from './inspection-template';

describe('catalogue icons', () => {
  test('names are unique and every seeded name is known', () => {
    const names = CATALOGUE_ICONS.map((icon) => icon.name);
    expect(new Set(names).size).toBe(names.length);
    // The names the hosted catalogue used on 2026-09-28.
    for (const seeded of [
      'battery',
      'brake',
      'brush',
      'clipboard',
      'cpu',
      'droplet',
      'filter',
      'fuel',
      'hammer',
      'key',
      'oil',
      'search',
      'seat',
      'shield',
      'snowflake',
      'sparkle',
      'spray',
      'thermometer',
      'truck',
      'tyre',
      'window',
    ]) {
      expect(catalogueGlyph(seeded)).not.toBeNull();
    }
    expect(catalogueGlyph('made-up')).toBeNull();
    expect(catalogueGlyph(null)).toBeNull();
  });
});

const sound = (): TemplateSection[] => [
  {
    key: 'engine',
    title_ar: 'المحرك',
    title_en: 'Engine',
    weight: 3,
    items: [
      { key: 'oil', type: 'rating', label_ar: 'زيت', label_en: 'Oil', weight: 2, required: true },
      { key: 'belts', type: 'rating', label_ar: 'السيور', label_en: 'Belts' },
    ],
  },
];

describe('templateProblems', () => {
  test('a sound template has none', () => {
    expect(templateProblems(sound())).toEqual([]);
  });

  test('names each problem where it is', () => {
    const broken = sound();
    broken[0]!.items[1]!.label_ar = ' ';
    broken[0]!.items[1]!.key = 'oil';
    broken[0]!.weight = 9;
    broken.push({ key: 'empty', title_ar: '', title_en: 'Empty', items: [] });
    expect(templateProblems(broken)).toEqual([
      { code: 'weight', section: 0 },
      { code: 'item_label', section: 0, item: 1 },
      { code: 'duplicate_key', section: 0, item: 1 },
      { code: 'section_title', section: 1 },
      { code: 'no_items', section: 1 },
    ]);
    expect(templateProblems([])).toEqual([{ code: 'no_sections' }]);
  });
});

describe('keyFrom', () => {
  test('a readable, unique key from the English name', () => {
    expect(keyFrom('Brake fluid', new Set())).toBe('brake_fluid');
    expect(keyFrom('Brake fluid', new Set(['brake_fluid']))).toBe('brake_fluid_2');
    expect(keyFrom('  4x4 system!', new Set())).toBe('x4_system');
    expect(keyFrom('فرامل', new Set(), 'item')).toBe('item');
  });
});

describe('parseTemplate', () => {
  test('reads a stored template and drops what it cannot', () => {
    expect(parseTemplate(sound())).toEqual([
      {
        ...sound()[0],
        items: [{ ...sound()[0]!.items[0] }, { ...sound()[0]!.items[1], required: false }],
      },
    ]);
    expect(parseTemplate('nonsense')).toEqual([]);
    expect(parseTemplate([null, 3])).toEqual([]);
  });
});
