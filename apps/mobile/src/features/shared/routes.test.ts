/**
 * Standing audit: every route can be reached, and no two routes collide.
 *
 * `/inspection-report` shipped as a finished screen — a full report, findings
 * sorted by repair cost, a conversion card — with nothing anywhere in the app
 * linking to it. A buyer paid for a pre-purchase inspection and had no way to
 * read the result. Nothing failed: it typechecked, it linted, it bundled, and
 * every test passed, because a screen nobody opens still compiles.
 *
 * That is not a one-off. It is the same shape as the three other features found
 * dead this month (GPS that never broadcast, evidence photos that were
 * fabricated references, a triage clip unreachable before acceptance): the
 * pieces existed and the seam between them did not. This file checks the seam
 * that a router provides.
 *
 * Two properties:
 *
 *   1. **Reachable.** Every route file is either a tab, the entry point, or is
 *      named by a `router.push` / `router.replace` / `<Redirect>` / `href`
 *      somewhere in the app.
 *   2. **Unambiguous.** No two route files claim the same path unless every
 *      navigation to it names its group. `(customer)/quote.tsx` and
 *      `(provider)/quote.tsx` both resolve to `/quote`, and a bare push asks
 *      the router to choose between the screen where a customer APPROVES a
 *      price and the one where a technician BUILDS it.
 *
 * ⚠️ Source-level, like provider-access.test.ts, because this repo has no React
 * Native test renderer. It cannot prove a link is reachable in practice — the
 * button may be behind a condition that is never true — so it is a floor, not a
 * ceiling. What it guarantees is that no screen ships with no way in at all.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';
import { describe, expect, test } from 'vitest';

const MOBILE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const APP_DIR = join(MOBILE, 'app');
const SRC_DIR = join(MOBILE, 'src');

function walk(dir: string, match: (path: string) => boolean): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      found.push(...walk(path, match));
    } else if (match(path)) {
      found.push(path);
    }
  }
  return found;
}

/**
 * The URL a route file answers on: group segments in parentheses vanish, and
 * `index` collapses into its parent. Exactly Expo Router's own rule.
 */
function routePathOf(file: string): string {
  const parts = relative(APP_DIR, file)
    .replace(/\.tsx$/, '')
    .split(sep);
  const kept = parts.filter((part) => !part.startsWith('('));
  if (kept[kept.length - 1] === 'index') kept.pop();
  return `/${kept.join('/')}`;
}

/** The groups a route file sits inside, outermost first. */
function groupsOf(file: string): string[] {
  return relative(APP_DIR, file)
    .split(sep)
    .filter((part) => part.startsWith('('))
    .map((part) => part.slice(1, -1));
}

const routeFiles = walk(APP_DIR, (path) => path.endsWith('.tsx')).filter(
  (path) => !path.endsWith(`${sep}_layout.tsx`),
);

/**
 * Every line of app source that could name a route.
 *
 * Route files themselves are included: a route can legitimately be linked from
 * another route file rather than from a screen.
 */
const sources = [
  ...walk(SRC_DIR, (path) => /\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path)),
  ...walk(APP_DIR, (path) => path.endsWith('.tsx')),
].map((path) => readFileSync(path, 'utf8'));

const allSource = sources.join('\n');

/**
 * Every route this app actually navigates to.
 *
 * ⚠️ Matched in navigation POSITION, not as any quoted string that looks like a
 * path. The first draft of this file matched `'/quote'` anywhere and failed on
 * the comment explaining why `/quote` needs its group named — an audit that
 * reads prose is an audit that gets prose rewritten to appease it.
 *
 * The forms, all of them the ones this app uses:
 *
 *     router.push('/logbook')          router.replace({ pathname: '/logbook' })
 *     <Redirect href="/vehicles" />    href={{ pathname: '/event' }}
 */
const NAVIGATION = [
  /\b(?:pathname|href)\s*[:=]\s*['"`]([^'"`]+)['"`]/g,
  /\brouter\.(?:push|replace|navigate)\(\s*['"`]([^'"`]+)['"`]/g,
  /\bhref=\{?\s*['"`]([^'"`]+)['"`]/g,
];

const navigatedTo = new Set<string>();
for (const pattern of NAVIGATION) {
  for (const match of allSource.matchAll(pattern)) {
    const target = match[1];
    if (target !== undefined) navigatedTo.add(target);
  }
}

/** `/(customer)/logbook` and `/logbook` are the same destination. */
function withoutGroups(target: string): string {
  return target.replace(/\/\([a-z]+\)/g, '');
}

const reachedRoutes = new Set([...navigatedTo].map(withoutGroups));

/**
 * Reachable without anybody linking to it.
 *
 * Kept short and each entry argued, because "add it to the exemption list" is
 * how an audit stops being one.
 */
const ENTRY_POINTS = new Set<string>([
  // The app's own entry. Expo Router opens it; nothing pushes it.
  '/',
  // Tab bars mount their screens by file name, not by href.
  '/vehicles',
  '/orders',
  '/account',
  '/shift',
  '/my-jobs',
  '/earnings',
  '/schedule',
]);

describe('every screen has a way in', () => {
  test.each(routeFiles.map((file) => [routePathOf(file), file] as const))(
    '%s is reachable',
    (route) => {
      if (ENTRY_POINTS.has(route)) return;

      expect(
        reachedRoutes.has(route),
        `${route} is a route nothing navigates to. Either link it or delete it — ` +
          'a screen with no way in is a feature that does not exist.',
      ).toBe(true);
    },
  );

  test('the tab entry points are really tabs', () => {
    // Otherwise the exemption list above quietly becomes a place to hide an
    // orphan: moving a screen out of `(tabs)` must break this, not pass it.
    for (const route of ENTRY_POINTS) {
      if (route === '/') continue;
      const file = routeFiles.find((candidate) => routePathOf(candidate) === route);
      expect(file, `${route} is exempted but no longer exists`).toBeDefined();
      expect(
        groupsOf(file as string),
        `${route} is exempted as a tab but is not in (tabs)`,
      ).toContain('tabs');
    }
  });
});

describe('no route is ambiguous', () => {
  const byRoute = new Map<string, string[]>();
  for (const file of routeFiles) {
    const route = routePathOf(file);
    byRoute.set(route, [...(byRoute.get(route) ?? []), file]);
  }

  const collisions = [...byRoute.entries()].filter(([, files]) => files.length > 1);

  test('a path claimed by two route files is always navigated to by group', () => {
    for (const [route, files] of collisions) {
      const groups = files.map((file) => groupsOf(file)[0]);

      // A bare `/quote` would leave the router to pick one of them.
      expect(
        navigatedTo.has(route),
        `${route} is claimed by ${files.length} route files (${groups.join(', ')}) and something ` +
          `navigates to it without naming a group. Use '/(${groups[0]})${route}'.`,
      ).toBe(false);

      // And each claimant is actually reached, so a collision is never resolved
      // by one half being dead.
      for (const group of groups) {
        expect(
          navigatedTo.has(`/(${group})${route}`),
          `/(${group})${route} exists but nothing navigates to it.`,
        ).toBe(true);
      }
    }
  });
});
