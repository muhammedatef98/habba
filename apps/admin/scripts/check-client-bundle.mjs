/**
 * Fails the build if a secret key can reach the browser (CLAUDE.md §5.1.6).
 *
 * Run after `next build`. Scans everything under .next/static — the files a
 * browser downloads — for:
 *
 *   - the names of the server-only variables, which only appear in a client
 *     chunk if client code reads them;
 *   - a new-style secret key (`sb_secret_…`);
 *   - any JWT whose payload says `"role":"service_role"`, which is what a
 *     legacy service key is;
 *   - the literal value of SUPABASE_SERVICE_ROLE_KEY, if it is set in the
 *     environment the build ran in.
 *
 * And every source file, for a NEXT_PUBLIC_ variable whose name says SERVICE,
 * SECRET or PRIVATE: Next inlines NEXT_PUBLIC_* into the client bundle by
 * design, so naming a secret that way ships it no matter who reads it.
 *
 * A role check is not a boundary; a bundle is. This makes the bundle one.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { URL, fileURLToPath } from 'node:url';

const FORBIDDEN_NAMES = ['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEYS'];

/** Every leak in one file's text. Exported for the unit test. */
export function findLeaks(text, literalSecrets = []) {
  const leaks = [];

  for (const name of FORBIDDEN_NAMES) {
    if (text.includes(name)) leaks.push(`references ${name}`);
  }

  if (/sb_secret_[A-Za-z0-9_-]{10,}/.test(text)) leaks.push('contains an sb_secret_ key');

  for (const match of text.matchAll(/eyJ[A-Za-z0-9_-]+\.(eyJ[A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+/g)) {
    try {
      const payload = JSON.parse(Buffer.from(match[1], 'base64url').toString('utf8'));
      if (payload.role === 'service_role') leaks.push('contains a service_role JWT');
    } catch {
      // Not a JWT after all.
    }
  }

  for (const secret of literalSecrets) {
    if (secret.length >= 20 && text.includes(secret)) leaks.push('contains the service key itself');
  }

  return leaks;
}

/** A NEXT_PUBLIC_ variable named like a secret, anywhere in source. */
export function findPublicSecretNames(text) {
  return [...text.matchAll(/NEXT_PUBLIC_[A-Z0-9_]*(SERVICE|SECRET|PRIVATE)[A-Z0-9_]*/g)].map(
    (match) => `declares ${match[0]} — NEXT_PUBLIC_ variables are shipped to every browser`,
  );
}

function* walk(dir, skip = new Set()) {
  for (const entry of readdirSync(dir)) {
    if (skip.has(entry)) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* walk(path, skip);
    else yield path;
  }
}

function main() {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const staticDir = join(root, '.next', 'static');
  const literal = [process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''].filter((value) => value !== '');
  const problems = [];

  let scanned = 0;
  try {
    for (const file of walk(staticDir)) {
      scanned += 1;
      for (const leak of findLeaks(readFileSync(file, 'utf8'), literal)) {
        problems.push(`${relative(root, file)}: ${leak}`);
      }
    }
  } catch {
    console.error('check-client-bundle: no .next/static — run `next build` first.');
    process.exit(1);
  }

  for (const file of walk(root, new Set(['node_modules', '.next', 'scripts']))) {
    if (!/\.(ts|tsx|js|mjs|json)$/.test(file) || file.endsWith('.tsbuildinfo')) continue;
    for (const leak of findPublicSecretNames(readFileSync(file, 'utf8'))) {
      problems.push(`${relative(root, file)}: ${leak}`);
    }
  }

  if (problems.length > 0) {
    console.error('✗ A secret can reach the browser:');
    for (const problem of problems) console.error(`  ${problem}`);
    process.exit(1);
  }

  console.log(`✓ no secret key in the admin client bundle (${scanned} files scanned)`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
