/**
 * The names a catalogue service may use for its icon, and the glyph each is
 * drawn with.
 *
 * `services.icon` holds a word chosen for the domain ("truck", "key"), and the
 * app draws it with one of the design system's glyphs. The list used to live
 * only in the app, so the console took any text and the seed used names the
 * app did not know — «cpu», «shield», «seat» and nine others rendered as a
 * warning sign. One list, read by both, closes that: the console offers only
 * these, and the app draws every one of them.
 *
 * `glyph` is a design-system icon name (@habba/ui IconName); the app's test
 * checks each one exists. Plain strings here keep core free of the UI.
 */

export interface CatalogueIcon {
  readonly name: string;
  readonly labelAr: string;
  readonly glyph: string;
}

export const CATALOGUE_ICONS: readonly CatalogueIcon[] = [
  { name: 'truck', labelAr: 'ونش', glyph: 'tow' },
  { name: 'battery', labelAr: 'بطارية', glyph: 'battery' },
  { name: 'tyre', labelAr: 'إطار', glyph: 'tyre' },
  { name: 'key', labelAr: 'مفتاح', glyph: 'lockout' },
  { name: 'fuel', labelAr: 'وقود', glyph: 'fuel' },
  { name: 'thermometer', labelAr: 'حرارة', glyph: 'radiator' },
  { name: 'oil', labelAr: 'زيت', glyph: 'oil' },
  { name: 'droplet', labelAr: 'سوائل', glyph: 'oil' },
  { name: 'filter', labelAr: 'فلتر', glyph: 'wrench' },
  { name: 'brake', labelAr: 'فرامل', glyph: 'brake' },
  { name: 'snowflake', labelAr: 'تكييف', glyph: 'ac' },
  { name: 'wash', labelAr: 'غسيل', glyph: 'wash' },
  { name: 'sparkle', labelAr: 'تلميع', glyph: 'wash' },
  { name: 'spray', labelAr: 'رش', glyph: 'wash' },
  { name: 'brush', labelAr: 'فرشاة', glyph: 'wash' },
  { name: 'seat', labelAr: 'مقاعد', glyph: 'wash' },
  { name: 'window', labelAr: 'زجاج', glyph: 'wash' },
  { name: 'inspection', labelAr: 'فحص', glyph: 'inspection' },
  { name: 'clipboard', labelAr: 'تقرير', glyph: 'inspection' },
  { name: 'cpu', labelAr: 'كمبيوتر', glyph: 'inspection' },
  { name: 'shield', labelAr: 'حماية', glyph: 'inspection' },
  { name: 'search', labelAr: 'بحث', glyph: 'search' },
  { name: 'wrench', labelAr: 'صيانة', glyph: 'wrench' },
  { name: 'hammer', labelAr: 'سمكرة', glyph: 'wrench' },
];

const BY_NAME = new Map(CATALOGUE_ICONS.map((icon) => [icon.name, icon]));

/** The glyph for a catalogue icon name, or null for a name nobody chose from the list. */
export function catalogueGlyph(name: string | null | undefined): string | null {
  if (name === null || name === undefined) return null;
  return BY_NAME.get(name)?.glyph ?? null;
}

/** The service categories (enum service_category), with their Arabic names. */
export const SERVICE_CATEGORIES: readonly { readonly value: string; readonly labelAr: string }[] = [
  { value: 'emergency', labelAr: 'طوارئ' },
  { value: 'periodic', labelAr: 'صيانة دورية' },
  { value: 'inspection', labelAr: 'فحص' },
  { value: 'wash', labelAr: 'غسيل' },
  { value: 'bodywork', labelAr: 'سمكرة ودهان' },
];
