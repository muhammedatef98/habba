// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      // Next's build output. Generated bundles are not source and lint them
      // reports on webpack's own emitted require() calls.
      '**/.next/**',
      '**/build/**',
      '**/.expo/**',
      '**/coverage/**',
      '**/*.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // CLAUDE.md 2.8 — no `any`, no unexplained suppressions.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/ban-ts-comment': [
        'error',
        {
          'ts-ignore': true, // never; use ts-expect-error with a reason
          'ts-expect-error': { descriptionFormat: '^: .{10,}$' },
          'ts-nocheck': true,
          'ts-check': false,
        },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-console': ['error', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
    },
  },
  {
    // Scripts and configs are allowed to talk to the terminal, and run on Node
    // rather than in a bundle — so `process`, `fetch` and `Buffer` are globals
    // here in a way they deliberately are not in app code.
    files: ['**/*.config.{js,mjs,ts}', '**/scripts/**/*.{js,mjs,ts}'],
    languageOptions: {
      globals: {
        process: 'readonly',
        fetch: 'readonly',
        Buffer: 'readonly',
        console: 'readonly',
      },
    },
    rules: { 'no-console': 'off' },
  },
  {
    // Edge Functions are servers: stdout IS their operational log, and a
    // successful delivery is information rather than a warning. `no-console`
    // exists to keep debug noise out of the APP bundle, which these are not
    // part of.
    //
    // What still applies here, and is not enforceable by a linter, is WHAT may
    // be logged: never an OTP, never a message body (ADR-0018).
    files: ['supabase/functions/**/*.ts'],
    rules: { 'no-console': 'off' },
  },

  // -------------------------------------------------------------------------
  // Feature boundaries inside the single mobile app (CLAUDE.md §5.1.5)
  // -------------------------------------------------------------------------
  // One app is a shipping decision, not an architectural excuse. Customer and
  // provider code must not reach into each other; anything genuinely common
  // moves to shared/ deliberately, rather than by whoever imported it first.
  //
  // Written with no-restricted-imports rather than eslint-plugin-boundaries:
  // the rule is two lines of path patterns, and it is an error (not a warning),
  // so `pnpm lint` — and therefore CI — fails on a cross-import.
  {
    files: [
      'apps/mobile/src/features/customer/**/*.{ts,tsx}',
      'apps/mobile/app/(customer)/**/*.{ts,tsx}',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/features/provider/*', '@/features/provider/**', '**/features/provider/**'],
              message:
                'Customer code must not import provider code (§5.1.5). Move what both need into features/shared.',
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      'apps/mobile/src/features/provider/**/*.{ts,tsx}',
      'apps/mobile/app/(provider)/**/*.{ts,tsx}',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/features/customer/*', '@/features/customer/**', '**/features/customer/**'],
              message:
                'Provider code must not import customer code (§5.1.5). Move what both need into features/shared.',
            },
          ],
        },
      ],
    },
  },
  {
    // shared/ is imported by both, so it may depend on neither. Without this
    // the rule above is trivially defeated: customer → shared → provider.
    files: ['apps/mobile/src/features/shared/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@/features/customer/*',
                '@/features/customer/**',
                '@/features/provider/*',
                '@/features/provider/**',
                '**/features/customer/**',
                '**/features/provider/**',
              ],
              message:
                'shared/ is the common floor (§5.1.5). It must not depend on customer or provider code.',
            },
          ],
        },
      ],
    },
  },
  // -------------------------------------------------------------------------
  // RTL: rows are resolved against two directions, never one (CLAUDE.md §6)
  // -------------------------------------------------------------------------
  // `flexDirection: 'row'` is laid out by Yoga against `I18nManager.isRTL`,
  // which `forceRTL` only changes on the NEXT process start. So on a first
  // Arabic launch, and for one session after any language switch, every
  // hand-written row runs the wrong way — and this is not a theoretical state,
  // it is the state after install. `<Row>` and `rowDirectionFor` resolve
  // against the locale and the platform together (packages/ui/src/direction.ts).
  //
  // The rule was written down in CLAUDE.md and enforced by nobody, so three
  // violations accumulated — one of them in `ListRow`, which put the leading
  // icon on the wrong side of every list in the app. A convention that only
  // lives in a document is a convention that is already being broken; this
  // makes it fail CI like the boundaries rule above.
  {
    files: ['apps/**/*.{ts,tsx}', 'packages/**/*.{ts,tsx}'],
    ignores: ['packages/ui/src/Row.tsx', 'packages/ui/src/direction.ts', '**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          // Two selectors, because `{ flexDirection: 'row' }` and
          // `{ flexDirection: 'row' as const }` are different trees — the
          // second wraps the literal in a TSAsExpression, and a rule that only
          // matched the first would be bypassed by the annotation people reach
          // for precisely when they are writing a typed ViewStyle.
          selector: [
            "Property[key.name='flexDirection'] > Literal[value=/^row(-reverse)?$/]",
            "Property[key.name='flexDirection'] > TSAsExpression > Literal[value=/^row(-reverse)?$/]",
          ].join(', '),
          message:
            'Use <Row> (or rowDirectionFor) instead of a literal flexDirection. Yoga resolves `row` against I18nManager.isRTL, which lags the locale by one process start — so a hand-written row is mirrored for the whole of a first Arabic launch (CLAUDE.md §6).',
        },
      ],
    },
  },

  {
    // Metro reads its config with `require`, so these files are CommonJS and
    // run in Node — not app code. `require`, `module` and `__dirname` are
    // correct here rather than something to work around.
    files: ['**/metro.config.js', '**/babel.config.js', '**/jest.config.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { require: 'readonly', module: 'writable', __dirname: 'readonly' },
    },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
);
