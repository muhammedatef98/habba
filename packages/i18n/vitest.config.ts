/**
 * Scopes Vitest to this package's own tests.
 *
 * Without a config here, Vitest walks up and finds the repo-root config (which
 * targets tests/rls.spec.ts only) and reports "no test files found" — a green
 * exit that ran nothing.
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['src/**/*.test.ts'] },
});
