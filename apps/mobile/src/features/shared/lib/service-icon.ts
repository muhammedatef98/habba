/**
 * Maps the catalogue's icon names onto the design system's icon set.
 *
 * `services.icon` is seeded with names chosen for the domain ("truck", "key",
 * "thermometer"), not for whatever the design happened to call its glyphs. The
 * list lives in @habba/core (catalogue/icons.ts) so the console offers exactly
 * the names drawn here — renaming a glyph should never mean a migration.
 */

import { catalogueGlyph } from '@habba/core';
import type { IconName } from '@habba/ui';

/**
 * Falls back to `alert` rather than rendering nothing: a card with no glyph
 * where its neighbours have one reads as a broken card, and a new catalogue
 * entry should look unfinished rather than invisible.
 */
export function serviceIcon(icon: string | null): IconName {
  return (catalogueGlyph(icon) as IconName | null) ?? 'alert';
}
