/**
 * Every key the app asks for exists, in both languages.
 *
 * i18next renders a missing key as the key itself, so a typo or a key that
 * was never written ships as «quote.partsTotal» in the middle of a bill —
 * which is exactly how the completion screen showed it. Typecheck cannot
 * catch it (`t` is untyped here), so this reads every literal `t('…')` in
 * the app and looks each one up, plural forms included.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resources } from '@habba/i18n';

const ROOTS = [join(__dirname, '../../..'), join(__dirname, '../../../../app')];
const LITERAL_KEY = /\bt\(\s*['"]([a-zA-Z][\w]*(?:\.[\w]+)+)['"]/g;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'node_modules' ? [] : sources(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

function has(resource: unknown, key: string): boolean {
  const segments = key.split('.');
  const leaf = segments.pop() ?? '';
  let node: unknown = resource;
  for (const segment of segments) {
    if (typeof node !== 'object' || node === null) return false;
    node = (node as Record<string, unknown>)[segment];
  }
  if (typeof node !== 'object' || node === null) return false;
  const record = node as Record<string, unknown>;
  return typeof record[leaf] === 'string' || typeof record[`${leaf}_other`] === 'string';
}

describe('translation keys', () => {
  it('every literal key the app uses exists in Arabic and English', () => {
    const missing: string[] = [];
    let seen = 0;

    for (const root of ROOTS) {
      for (const file of sources(root)) {
        for (const match of readFileSync(file, 'utf8').matchAll(LITERAL_KEY)) {
          const key = match[1] ?? '';
          seen += 1;
          for (const locale of ['ar', 'en'] as const) {
            if (!has(resources[locale], key)) {
              missing.push(`${locale}:${key} (${relative(join(__dirname, '../../../..'), file)})`);
            }
          }
        }
      }
    }

    expect(seen).toBeGreaterThan(500);
    expect(missing).toEqual([]);
  });
});
