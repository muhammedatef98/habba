/**
 * Maps the catalogue's icon names onto the design system's icon set.
 *
 * `services.icon` is seeded with names chosen for the domain ("truck", "key",
 * "thermometer"), not for whatever the design happened to call its glyphs. The
 * mapping lives here rather than in the seed so the catalogue stays a
 * description of the service and the UI decides how to draw it — renaming a
 * glyph should never mean a database migration.
 */

import type { IconName } from '@habba/ui';

const BY_CATALOGUE_NAME: Readonly<Record<string, IconName>> = {
  truck: 'tow',
  battery: 'battery',
  tyre: 'tyre',
  key: 'lockout',
  fuel: 'fuel',
  thermometer: 'radiator',
  oil: 'oil',
  filter: 'wrench',
  brake: 'brake',
  snowflake: 'ac',
  wash: 'wash',
  inspection: 'inspection',
  wrench: 'wrench',
};

/**
 * Falls back to `alert` rather than rendering nothing: a card with no glyph
 * where its neighbours have one reads as a broken card, and a new catalogue
 * entry should look unfinished rather than invisible.
 */
export function serviceIcon(icon: string | null): IconName {
  if (icon === null) return 'alert';
  return BY_CATALOGUE_NAME[icon] ?? 'alert';
}
