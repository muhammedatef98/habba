/**
 * An inspection template's shape, as the scorer (0026) reads it and as the
 * database now checks it (0094): sections of rated items, each with a key and
 * both names, weights from 1 to 5.
 *
 * The console edits templates visually; these are the rules its editor keeps
 * so an operator hears about a problem while typing rather than from the
 * database after pressing save. The database remains the rule.
 */

export interface TemplateItem {
  key: string;
  type: 'rating';
  label_ar: string;
  label_en: string;
  weight?: number;
  required?: boolean;
  critical?: boolean;
}

export interface TemplateSection {
  key: string;
  title_ar: string;
  title_en: string;
  weight?: number;
  items: TemplateItem[];
}

export const MIN_WEIGHT = 1;
export const MAX_WEIGHT = 5;

export type TemplateProblem =
  | { readonly code: 'no_sections' }
  | { readonly code: 'section_title'; readonly section: number }
  | { readonly code: 'no_items'; readonly section: number }
  | { readonly code: 'item_label'; readonly section: number; readonly item: number }
  | { readonly code: 'weight'; readonly section: number; readonly item?: number }
  | { readonly code: 'duplicate_key'; readonly section: number; readonly item?: number };

const KEY = /^[a-z][a-z0-9_]*$/;

function weightOk(weight: number | undefined): boolean {
  return (
    weight === undefined ||
    (Number.isFinite(weight) && weight >= MIN_WEIGHT && weight <= MAX_WEIGHT)
  );
}

/** Every problem with a template, in reading order; empty when it will save. */
export function templateProblems(sections: readonly TemplateSection[]): readonly TemplateProblem[] {
  const problems: TemplateProblem[] = [];
  if (sections.length === 0) return [{ code: 'no_sections' }];

  const sectionKeys = new Set<string>();
  sections.forEach((section, s) => {
    if (section.title_ar.trim() === '' || section.title_en.trim() === '') {
      problems.push({ code: 'section_title', section: s });
    }
    if (!KEY.test(section.key) || sectionKeys.has(section.key)) {
      problems.push({ code: 'duplicate_key', section: s });
    }
    sectionKeys.add(section.key);
    if (!weightOk(section.weight)) problems.push({ code: 'weight', section: s });
    if (section.items.length === 0) problems.push({ code: 'no_items', section: s });

    const itemKeys = new Set<string>();
    section.items.forEach((item, i) => {
      if (item.label_ar.trim() === '' || item.label_en.trim() === '') {
        problems.push({ code: 'item_label', section: s, item: i });
      }
      if (!KEY.test(item.key) || itemKeys.has(item.key)) {
        problems.push({ code: 'duplicate_key', section: s, item: i });
      }
      itemKeys.add(item.key);
      if (!weightOk(item.weight)) problems.push({ code: 'weight', section: s, item: i });
    });
  });
  return problems;
}

/**
 * A key for a new section or item, from its English name: «Brake fluid» →
 * `brake_fluid`, made unique among `taken`. Keys are what filed reports store
 * answers under, so an existing key is never regenerated — only new entries
 * get one.
 */
export function keyFrom(english: string, taken: ReadonlySet<string>, fallback = 'item'): string {
  const base =
    english
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .replace(/^[0-9_]+/, '')
      .slice(0, 40) || fallback;
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}

/** Reads a stored template, keeping only what the editor understands. */
export function parseTemplate(value: unknown): TemplateSection[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw): TemplateSection[] => {
    if (typeof raw !== 'object' || raw === null) return [];
    const section = raw as Record<string, unknown>;
    const items = Array.isArray(section['items']) ? section['items'] : [];
    return [
      {
        key: String(section['key'] ?? ''),
        title_ar: String(section['title_ar'] ?? ''),
        title_en: String(section['title_en'] ?? ''),
        ...(typeof section['weight'] === 'number' ? { weight: section['weight'] } : {}),
        items: items.flatMap((rawItem): TemplateItem[] => {
          if (typeof rawItem !== 'object' || rawItem === null) return [];
          const item = rawItem as Record<string, unknown>;
          return [
            {
              key: String(item['key'] ?? ''),
              type: 'rating',
              label_ar: String(item['label_ar'] ?? ''),
              label_en: String(item['label_en'] ?? ''),
              ...(typeof item['weight'] === 'number' ? { weight: item['weight'] } : {}),
              ...(item['required'] === true ? { required: true } : { required: false }),
              ...(item['critical'] === true ? { critical: true } : {}),
            },
          ];
        }),
      },
    ];
  });
}
