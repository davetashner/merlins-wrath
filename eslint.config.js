// @ts-check
import eslintComments from '@eslint-community/eslint-plugin-eslint-comments';
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { layerConfigs } from './eslint/layers.js';

export default tseslint.config(
  {
    ignores: [
      'dist/',
      'coverage/',
      'playwright-report/',
      'test-results/',
      '.beads/',
      '.claude/',
      'assets/',
      'site/',
      // Throwaway engine spike (mw-e00.13): own pnpm workspace, lockfile and typecheck; not game code.
      'spikes/',
      'tests/toolchain/fixtures/',
      'tests/lint-fixtures/',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.ts'],
    extends: [tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: { globals: globals.node },
  },
  ...layerConfigs(eslintComments),
  prettier,
);
