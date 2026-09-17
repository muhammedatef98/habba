/**
 * Every `t('…')` in the app names a key that exists.
 *
 * `@habba/i18n` already tests that `ar` and `en` hold the same keys. That is
 * parity, and parity passes perfectly when a key is missing from *both* files —
 * which is how these two shipped:
 *
 *   - `quote.partsTotal`, on the tracking price breakdown. i18next falls back
 *     to echoing the key, so the parts line of the price a customer reads
 *     before paying rendered as the literal string "quote.partsTotal". The key
 *     it wanted, `quote.partsLabel`, was there the whole time.
 *   - `common.close`, the transfer sheet's backdrop label — invisible unless
 *     you use a screen reader, in which case the way out of a modal is
 *     announced as "common.close".
 *
 * The type that would prevent this exists — `TranslationKey` in `@habba/i18n` —
 * and nothing was using it: `t()` here takes any string. Augmenting i18next's
 * `CustomTypeOptions` is the stricter fix and is worth doing, but it cannot
 * type the nine `t(`…${}`)` call sites the app legitimately uses for
 * status-keyed copy, so it would need an escape hatch that this check does not.
 * A source scan is honest about that boundary: it asserts what can be asserted
 * statically and says out loud what it skips.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { resources } from '@habba/i18n';

// This file is `apps/mobile/src/features/shared/lib/` — four up is the app,
// six is the repo.
const APP_ROOT = fileURLToPath(new URL('../../../..', import.meta.url));
const REPO_ROOT = fileURLToPath(new URL('../../../../../..', import.meta.url));

/**
 * `t('some.key')` with a plain string literal.
 *
 * Template literals are deliberately not matched: `t(`job.status.${status}`)`
 * resolves at runtime and there is no honest static answer for it. They are
 * counted rather than ignored silently — see the last assertion.
 */
const STATIC_KEY = /\bt\(\s*['"]([a-zA-Z][\w.]*)['"]/g;
const DYNAMIC_KEY = /\bt\(\s*`/g;

function sourceFiles(dir: string): readonly string[] {
  const found: string[] = [];

  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      found.push(...sourceFiles(path));
      continue;
    }
    // Test files are allowed to name keys that do not exist — that is what
    // several of them are asserting.
    if (/\.tsx?$/.test(entry) && !entry.includes('.test.')) found.push(path);
  }

  return found;
}

/** True only for a leaf string — a key resolving to a nested object is not usable copy. */
function resolvesToString(tree: unknown, dotted: string): boolean {
  let node: unknown = tree;

  for (const part of dotted.split('.')) {
    if (typeof node !== 'object' || node === null || !(part in node)) return false;
    node = (node as Record<string, unknown>)[part];
  }

  return typeof node === 'string';
}

interface Usage {
  readonly key: string;
  readonly where: string;
}

const usages: Usage[] = [];
let dynamicCallSites = 0;

for (const file of sourceFiles(join(APP_ROOT, 'src'))) {
  const source = readFileSync(file, 'utf8');

  for (const match of source.matchAll(STATIC_KEY)) {
    const line = source.slice(0, match.index).split('\n').length;
    usages.push({
      key: match[1] as string,
      where: `${relative(REPO_ROOT, file)}:${line}`,
    });
  }

  dynamicCallSites += [...source.matchAll(DYNAMIC_KEY)].length;
}

describe('translation keys used by the app', () => {
  it('finds call sites to check at all', () => {
    // Without this the whole suite passes vacuously the day the regex, the
    // directory layout or the file extensions change.
    expect(usages.length).toBeGreaterThan(100);
  });

  it.each(['ar', 'en'] as const)('all exist in %s', (locale) => {
    const missing = usages
      .filter((usage) => !resolvesToString(resources[locale], usage.key))
      // The message is the point: a bare count sends the next person hunting.
      .map((usage) => `${usage.key} (${usage.where})`);

    expect(missing).toEqual([]);
  });

  it('records how much this check cannot see', () => {
    // Not an assertion about correctness — a marker. If this number climbs,
    // the share of the app's copy that no test verifies is climbing with it.
    expect(dynamicCallSites).toBeLessThanOrEqual(12);
  });
});
