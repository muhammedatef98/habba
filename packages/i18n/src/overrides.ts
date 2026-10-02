/**
 * The operators' changes to the app's words (0093), laid over the shipped ones.
 *
 * A sentence in the app is a template: `{{amount}}` is filled in by the
 * screen, `<terms>…</terms>` becomes a link. A replacement that drops one of
 * those would show a bare «ر.س» with no number, or a link with nothing to tap —
 * so a replacement is used only if it keeps exactly the same placeholders and
 * tags as the sentence it replaces. The console checks this before saving; the
 * app checks it again before showing, because the console is not the only way
 * a row can reach the table.
 *
 * Pure, like the rest of this package: no i18next, no React.
 */

import type { Locale } from './index.js';

export interface CopyOverride {
  readonly key: string;
  readonly ar: string | null;
  readonly en: string | null;
}

export type CopyProblem = 'unknown_key' | 'empty' | 'placeholders' | 'tags';

type Tree = { readonly [key: string]: string | Tree };

const PLACEHOLDER = /\{\{\s*([\w.]+)\s*\}\}/g;
const TAG = /<\/?([a-z_]+)>/g;

function namesOf(text: string, pattern: RegExp): readonly string[] {
  return [...text.matchAll(pattern)].map((match) => match[1] ?? '').sort();
}

/** `{{amount}}`, `{{ count }}` → `['amount', 'count']`, sorted, with repeats. */
export function placeholdersOf(text: string): readonly string[] {
  return namesOf(text, PLACEHOLDER);
}

function sameNames(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((name, index) => name === b[index]);
}

/** Why `candidate` cannot replace `original`, or null if it can. */
export function copyProblem(original: string, candidate: string): CopyProblem | null {
  if (candidate.trim().length === 0) return 'empty';
  if (!sameNames(placeholdersOf(original), placeholdersOf(candidate))) return 'placeholders';
  if (!sameNames(namesOf(original, TAG), namesOf(candidate, TAG))) return 'tags';
  return null;
}

/** Every sentence in a resource tree, by dotted key. */
export function flattenCopy(tree: Tree, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix === '' ? key : `${prefix}.${key}`;
    if (typeof value === 'string') out.set(path, value);
    else for (const [inner, text] of flattenCopy(value, path)) out.set(inner, text);
  }
  return out;
}

function replaceAt(tree: Tree, path: readonly string[], text: string): Tree {
  const [head, ...rest] = path;
  if (head === undefined) return tree;
  const current = tree[head];
  if (rest.length === 0) return { ...tree, [head]: text };
  if (current === undefined || typeof current === 'string') return tree;
  return { ...tree, [head]: replaceAt(current, rest, text) };
}

/**
 * `base` with every usable replacement for `locale` applied. The shipped tree
 * is never mutated; a key the app does not have, or a replacement that fails
 * `copyProblem`, is skipped.
 */
export function withOverrides<T extends Tree>(
  base: T,
  overrides: readonly CopyOverride[],
  locale: Locale,
): T {
  const shipped = flattenCopy(base);
  let result: Tree = base;
  for (const override of overrides) {
    const text = override[locale];
    const original = shipped.get(override.key);
    if (text === null || original === undefined) continue;
    if (copyProblem(original, text) !== null) continue;
    result = replaceAt(result, override.key.split('.'), text);
  }
  return result as T;
}
