import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Without its own config this package inherited the repository root's, which
// only looks for tests/**/*.spec.ts — so `pnpm test` here ran nothing and
// passed. `@/` mirrors the tsconfig path so tests import what the app imports.
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
  },
});
