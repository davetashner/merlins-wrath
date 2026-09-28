// Entry point: pnpm save:fixture / pnpm save:check (mw-e30.3). The save-fixture tools live in src/
// and use Vite path aliases and extensionless imports that plain Node cannot load, so this loads
// src/tools/save-fixtures/cli.ts through Vite's module runner (same resolution as the app and Vitest).
import { runnerImport } from 'vite';
import type * as SaveFixtureCli from '../src/tools/save-fixtures/cli.ts';

const { module } = await runnerImport<typeof SaveFixtureCli>('./src/tools/save-fixtures/cli.ts', {
  configFile: false,
  resolve: { tsconfigPaths: true },
  logLevel: 'error',
});
process.exitCode = module.main(process.argv.slice(2));
