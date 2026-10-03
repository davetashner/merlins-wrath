// Entry point: pnpm nav:bake / pnpm nav:check (mw-e11.4). The bake lives in src/ and uses Vite path
// aliases and extensionless imports that plain Node cannot load, so this loads src/tools/navmesh/cli.ts
// through Vite's module runner (same resolution as the app and Vitest).
import { runnerImport } from 'vite';
import type * as NavCli from '../src/tools/navmesh/cli.ts';

const { module } = await runnerImport<typeof NavCli>('./src/tools/navmesh/cli.ts', {
  configFile: false,
  resolve: { tsconfigPaths: true },
  logLevel: 'error',
});
process.exitCode = module.main(process.argv.slice(2));
