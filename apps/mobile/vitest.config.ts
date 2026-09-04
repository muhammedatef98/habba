/**
 * Vitest needs the same `@/` alias that tsc and Metro already have.
 *
 * tsconfig `paths` teaches the type-checker, and metro.config.js teaches the
 * bundler; neither reaches Vitest, which resolves through Vite. Without this
 * the data-layer suites fail to load the moment a file imports `@/features/...`
 * — which is what happened when the app moved to feature folders.
 */

import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: [
      // `.js` specifiers are correct for tsc's Node resolution but there is no
      // build step here, so map them back onto the TypeScript sources — the
      // same retry metro.config.js performs.
      { find: /^@\/(.*)\.js$/, replacement: path.resolve(__dirname, 'src/$1.ts') },
      { find: /^@\/(.*)$/, replacement: path.resolve(__dirname, 'src/$1') },
    ],
  },
});
