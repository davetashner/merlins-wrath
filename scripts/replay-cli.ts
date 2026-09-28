// Entry point: pnpm replay:record / pnpm replay:rebless (mw-e00.17). The replay tools live in src/ and
// use Vite path aliases and extensionless imports that plain Node cannot load, so this loads
// src/tools/replay/cli.ts through Vite's module runner (same resolution as the app and Vitest).
import { runnerImport } from 'vite';
import type * as ReplayCli from '../src/tools/replay/cli.ts';

const { module } = await runnerImport<typeof ReplayCli>('./src/tools/replay/cli.ts', {
  configFile: false,
  resolve: { tsconfigPaths: true },
  logLevel: 'error',
});
process.exitCode = module.main(process.argv.slice(2));
