/**
 * The terms, privacy policy and provider terms (0083), as the app and the
 * public web page show them.
 *
 * The published text is a small Markdown subset with {{placeholders}} for what
 * lives in platform settings (the company's name, the complaint window…), so
 * a document never disagrees with what the app actually does. Both surfaces
 * fill and parse it here, and so show the same words.
 */

export type LegalDocumentKind = 'terms' | 'privacy' | 'provider_terms';

export const LEGAL_DOCUMENT_KINDS: readonly LegalDocumentKind[] = [
  'terms',
  'privacy',
  'provider_terms',
];

export interface LegalRun {
  readonly text: string;
  readonly bold: boolean;
}

export type LegalBlock =
  | { readonly type: 'title'; readonly text: string }
  | { readonly type: 'heading'; readonly text: string }
  | { readonly type: 'paragraph'; readonly runs: readonly LegalRun[] }
  | { readonly type: 'bullet'; readonly runs: readonly LegalRun[] }
  | { readonly type: 'note'; readonly text: string };

/** Shown where a setting the text names has not been filled in yet. */
export const LEGAL_MISSING_VALUE = '—';

/** Replaces each {{name}} with its value; an unknown or empty one with a dash. */
export function fillLegalTemplate(body: string, values: Readonly<Record<string, string>>): string {
  return body.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, name: string) => {
    const value = values[name];
    return value === undefined || value.trim() === '' ? LEGAL_MISSING_VALUE : value.trim();
  });
}

/**
 * The values a document names, from the public settings (get_public_settings)
 * and the version being shown. Email and phone are the support contacts: the
 * address a person writes to about their data is the one they already know.
 */
export function legalTemplateValues(
  settings: Readonly<Record<string, unknown>>,
  document: { readonly version: number; readonly publishedAt: string },
  locale: 'ar' | 'en',
): Record<string, string> {
  const text = (key: string): string => {
    const value = settings[key];
    return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';
  };
  return {
    company: text(locale === 'ar' ? 'legal_company_name_ar' : 'legal_company_name_en'),
    address: text(locale === 'ar' ? 'legal_address_ar' : 'legal_address_en'),
    cr: text('legal_cr_number'),
    email: text('support_email'),
    phone: text('support_phone'),
    dispute_window_days: text('dispute_window_days'),
    auto_complete_hours: text('auto_complete_after_hours'),
    version: String(document.version),
    // Isolated left-to-right: inside Arabic text the hyphens are neutral, and
    // 2026-10-01 would otherwise read back as 01-10-2026.
    effective_date: `\u2066${document.publishedAt.slice(0, 10)}\u2069`,
  };
}

/** `**bold**` inside a line; everything else is plain text. */
function runsOf(line: string): LegalRun[] {
  const runs: LegalRun[] = [];
  const pattern = /\*\*(.+?)\*\*/g;
  let last = 0;
  for (const match of line.matchAll(pattern)) {
    if (match.index > last) runs.push({ text: line.slice(last, match.index), bold: false });
    runs.push({ text: match[1] ?? '', bold: true });
    last = match.index + match[0].length;
  }
  if (last < line.length) runs.push({ text: line.slice(last), bold: false });
  return runs;
}

/**
 * Blocks from the Markdown subset the documents are written in: `#` title,
 * `##` heading, `- ` bullet, a line wrapped in `_…_` as a note, and paragraphs
 * (consecutive lines join). Anything else is read as paragraph text, so a
 * stray character shows as itself rather than breaking the page.
 */
export function parseLegalDocument(markdown: string): LegalBlock[] {
  const blocks: LegalBlock[] = [];
  let paragraph: string[] = [];

  const flush = () => {
    if (paragraph.length > 0) {
      blocks.push({ type: 'paragraph', runs: runsOf(paragraph.join(' ')) });
      paragraph = [];
    }
  };

  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '') {
      flush();
    } else if (line.startsWith('## ')) {
      flush();
      blocks.push({ type: 'heading', text: line.slice(3).trim() });
    } else if (line.startsWith('# ')) {
      flush();
      blocks.push({ type: 'title', text: line.slice(2).trim() });
    } else if (line.startsWith('- ')) {
      flush();
      blocks.push({ type: 'bullet', runs: runsOf(line.slice(2).trim()) });
    } else if (/^_.+_$/.test(line)) {
      flush();
      blocks.push({ type: 'note', text: line.slice(1, -1) });
    } else {
      paragraph.push(line);
    }
  }
  flush();
  return blocks;
}
