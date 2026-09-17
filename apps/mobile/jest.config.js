/**
 * Component tests.
 *
 * A second runner alongside Vitest, and worth the cost of being a second
 * runner: Vitest cannot load `react-native` — it ships Flow syntax and fails
 * to parse — which is why every existing test in this repo tests a pure
 * module, and why nothing has ever rendered a screen. That gap is how a tab
 * bar disappeared with 56 unit tests, a typecheck and a lint all green.
 *
 * Vitest keeps the pure modules: it is faster, and those tests outnumber these
 * by an order of magnitude. This runs only what has to be rendered.
 */

module.exports = {
  preset: 'jest-expo',
  testMatch: ['**/*.render.test.tsx'],
  moduleNameMapper: {
    // The workspace packages import their own modules with a `.js` suffix,
    // which is what TypeScript's Node resolution requires and what `tsc`
    // emits. Metro is taught to retry those extensionless in metro.config.js;
    // this is the same instruction for Jest. Without it every `@habba/*`
    // import fails at the package's own index.
    '^(\\.{1,2}/.*)\\.js$': '$1',
    // The app's own alias, as configured in tsconfig and babel.
    '^@/(.*)$': '<rootDir>/src/$1',
    // One copy of safe-area-context, not two.
    //
    // pnpm gives `apps/mobile` and `packages/ui` each their own resolution of
    // it, so a `jest.mock('react-native-safe-area-context')` in a test here
    // patched the app's instance while a design-system component went on
    // importing the other one — and reported "No safe area value available"
    // from a hook the test had just mocked. Metro dedupes this through the
    // monorepo resolver in metro.config.js; Jest needs telling separately.
    //
    // It matters beyond the mock: `Screen` reads insets on every screen in the
    // app, so any render test that mounts one lands here.
    '^react-native-safe-area-context$': require.resolve('react-native-safe-area-context'),
  },
  transformIgnorePatterns: [
    // The RN ecosystem ships untranspiled source; the preset's own list plus
    // this repo's workspace packages, which are TypeScript on disk.
    'node_modules/(?!(?:.pnpm/)?((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sentry/react-native|native-base|react-native-svg|@habba/.*))',
  ],
};
