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
  },
  transformIgnorePatterns: [
    // The RN ecosystem ships untranspiled source; the preset's own list plus
    // this repo's workspace packages, which are TypeScript on disk.
    'node_modules/(?!(?:.pnpm/)?((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sentry/react-native|native-base|react-native-svg|@habba/.*))',
  ],
};
