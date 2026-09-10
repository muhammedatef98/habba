/**
 * Vitest owns the pure modules; Jest owns anything that renders.
 *
 * The split is not a preference — Vitest cannot load `react-native` at all (it
 * ships Flow syntax and fails to parse), which is why every test in this repo
 * was a pure-module test until the tab bar disappeared under a green build.
 * `*.render.test.tsx` is the boundary, and it is excluded here so the two
 * runners never fight over the same file.
 *
 * The aliases are the other half: tsconfig `paths` teaches the type-checker and
 * metro.config.js teaches the bundler, and neither reaches Vitest, which
 * resolves through Vite. Without them the data-layer suites fail to load the
 * moment a file imports `@/features/...`.
 */

import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: [
      // expo-constants reaches React Native, whose Flow-typed source Vitest
      // cannot parse. The stub supplies the only field the app reads from it.
      {
        find: /^expo-constants$/,
        replacement: path.resolve(__dirname, 'test/stubs/expo-constants.ts'),
      },
      // `.js` specifiers are correct for tsc's Node resolution but there is no
      // build step here, so map them back onto the TypeScript sources — the
      // same retry metro.config.js performs.
      { find: /^@\/(.*)\.js$/, replacement: path.resolve(__dirname, 'src/$1.ts') },
      { find: /^@\/(.*)$/, replacement: path.resolve(__dirname, 'src/$1') },
    ],
  },
  test: {
    exclude: ['**/node_modules/**', '**/*.render.test.tsx'],
  },
});
