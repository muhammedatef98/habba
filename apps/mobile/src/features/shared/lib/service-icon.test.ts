import { describe, expect, test } from 'vitest';
import { CATALOGUE_ICONS } from '@habba/core';
import { ICON_SHAPES } from '@habba/ui/icon-shapes';
import { serviceIcon } from './service-icon';

describe('serviceIcon', () => {
  test('every catalogue icon is drawn with a glyph the design system has', () => {
    for (const icon of CATALOGUE_ICONS) {
      const glyph = serviceIcon(icon.name);
      expect(glyph, icon.name).not.toBe('alert');
      expect(ICON_SHAPES[glyph], icon.name).toBeDefined();
    }
  });

  test('an unknown or missing name falls back to a visible glyph', () => {
    expect(serviceIcon('made-up')).toBe('alert');
    expect(serviceIcon(null)).toBe('alert');
  });
});
