import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// The console against the local database harness: run by the root
// `test:integration`, after the database is reset and PostgREST is up.
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    include: ['src/**/*.integration.test.ts'],
  },
});
