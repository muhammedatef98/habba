import { defineConfig } from 'vitest/config';

/**
 * Vitest owns the pure modules; Jest owns anything that renders.
 *
 * The split is not a preference — Vitest cannot load `react-native` at all (it
 * ships Flow syntax and fails to parse), which is why every test in this repo
 * was a pure-module test until the tab bar disappeared under a green build.
 * `*.render.test.tsx` is the boundary, and it is excluded here so the two
 * runners never fight over the same file.
 */
export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', '**/*.render.test.tsx'],
  },
});
