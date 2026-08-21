// Flat config (ESLint 9). One root config for the whole monorepo — the
// workspaces share a TypeScript version and most conventions, so per-package
// configs would mostly duplicate each other.
//
// Deliberately NOT using eslint-config-next: it still peer-depends on ESLint
// <=8, and pinning the whole repo to ESLint 8 to get it is a bad trade. The
// rules that actually catch bugs in this codebase come from typescript-eslint
// and react-hooks, both of which support ESLint 9. Next's own build already
// surfaces the framework-specific warnings that config would add.
//
// Scope note: this lints source only. Build output, generated migrations and
// the mobile app (a separate install, not an npm workspace — see CLAUDE.md)
// are excluded.

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.next/**',
      '**/node_modules/**',
      'apps/mobile/**',
      '**/*.config.js',
      '**/*.config.mjs',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    rules: {
      // Surfaces genuinely dead code and typos rather than style opinions.
      // Leading-underscore args are the conventional "intentionally unused"
      // marker and are already used in this codebase.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      // `any` is load-bearing in a few places where TypeORM/pdf-parse types are
      // genuinely unavailable, and each is already commented. Warn so new ones
      // are visible in review without failing the build on existing ones.
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },

  // Web: React hook correctness. exhaustive-deps catches the stale-closure
  // bugs that are easy to introduce in the data-fetching screens.
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  },

  // Tests: expression-style assertions and non-null access on fixtures are
  // idiomatic here and not worth flagging. require() is load-bearing rather
  // than lazy — the mail and env specs call it inside
  // jest.isolateModulesAsync() specifically to re-evaluate a module under
  // different process.env, which a static import cannot do (see the
  // module-load-time `isProduction` note in CLAUDE.md).
  {
    files: ['**/*.spec.ts', '**/*.e2e-spec.ts', 'apps/api/test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
      '@typescript-eslint/no-require-imports': 'off',
    },
  },

  // Standalone Node scripts (the Playwright smoke driver) — plain ESM run
  // directly by node, so they get Node globals rather than browser ones.
  //
  // `document`/`window` are here too, and are not a mistake: the bodies of
  // page.evaluate() callbacks are serialised and executed inside the browser,
  // not in this process, so they legitimately reach browser globals that the
  // surrounding file cannot.
  {
    files: ['**/*.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        URL: 'readonly',
        document: 'readonly',
        window: 'readonly',
      },
    },
  },
);
