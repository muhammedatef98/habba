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
    // Scripts and configs are allowed to talk to the terminal.
    files: ['**/*.config.{js,mjs,ts}', '**/scripts/**/*.{js,mjs,ts}'],
    rules: { 'no-console': 'off' },
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
