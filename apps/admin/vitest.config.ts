/**
 * The console's own Vitest config.
 *
 * ⚠️ Without this file `pnpm --filter @habba/admin test` inherits the ROOT
 * config, whose `include` is `tests/**‍/*.spec.ts` — the RLS suite. It found no
 * files here, `--passWithNoTests` swallowed that, and the package reported
 * success while running nothing. A green test command that runs zero tests is
 * worse than a red one.
 *
 * Only pure modules are covered. Anything that renders needs a DOM runner the
 * console does not have yet, and `ops-session.ts`'s boundary is `is_ops()` in
 * the database, exercised by `supabase/tests/`.
 */

import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: [
      // Mirrors the `@/*` paths in tsconfig.json; Vitest resolves through Vite
      // and does not read them.
      { find: /^@\/(.*)\.js$/, replacement: path.resolve(__dirname, 'src/$1.ts') },
      { find: /^@\/(.*)$/, replacement: path.resolve(__dirname, 'src/$1') },
    ],
  },
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['**/node_modules/**'],
  },
});
