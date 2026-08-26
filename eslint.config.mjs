// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
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
);
