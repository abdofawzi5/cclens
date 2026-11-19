// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

/**
 * Layer rule (see docs/ARCHITECTURE.md): interfaces -> app -> core <- adapters.
 * core: no I/O, no outer layers. app: only core. adapters: never interfaces/app.
 */
const layer = (files, patterns, message) => ({
  files,
  rules: {
    'no-restricted-imports': ['error', { patterns: [{ group: patterns, message }] }],
  },
});

export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
    },
  },
  { files: ['**/*.js', '**/*.mjs'], ...tseslint.configs.disableTypeChecked },
  { files: ['**/*.js', '**/*.mjs'], languageOptions: { globals: globals.node } },
  layer(
    ['src/core/**'],
    [
      '**/app/**',
      '**/adapters/**',
      '**/interfaces/**',
      'node:*',
      'fs',
      'path',
      'ccusage*',
      'commander',
      'picocolors',
      'cli-table3',
    ],
    'core must stay pure: no I/O and no outer layers.',
  ),
  layer(
    ['src/app/**'],
    ['**/adapters/**', '**/interfaces/**', 'node:fs*', 'ccusage*'],
    'app depends on core ports only.',
  ),
  layer(
    ['src/adapters/**'],
    ['**/app/**', '**/interfaces/**'],
    'adapters implement core ports; they never depend on app or interfaces.',
  ),
  prettier,
);
