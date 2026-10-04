import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { build } from 'vite';
import { afterAll, describe, expect, it } from 'vitest';

const run = promisify(execFile);
const root = fileURLToPath(new URL('../..', import.meta.url));
const LAYERS = ['sim', 'content', 'game', 'render', 'audio', 'ui', 'tools'];

const tmpDirs: string[] = [];
function tmp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), `vesper-${prefix}-`));
  tmpDirs.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
});

interface PackageJson {
  engines: { node: string };
  packageManager: string;
}
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as PackageJson;

describe('repo scaffold', () => {
  it('AC-1: vite build produces index.html', { timeout: 60_000 }, async () => {
    const outDir = tmp('dist');
    await build({ root, logLevel: 'silent', build: { outDir, emptyOutDir: true } });
    expect(existsSync(join(outDir, 'index.html'))).toBe(true);
  });

  it.each(LAYERS)('AC-2: src/%s has a module and at least one test', (layer) => {
    const files = readdirSync(join(root, 'src', layer));
    expect(files.some((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))).toBe(true);
    expect(files.some((f) => f.endsWith('.test.ts'))).toBe(true);
  });

  it(
    'AC-4: test:coverage writes coverage-summary.json and lcov.info',
    // The child run covers all of src/sim while the outer suite is running on the same CI runner,
    // and src/sim keeps growing: 60 s timed out on PRs #224 and #226 (mw-cge).
    { timeout: 180_000 },
    async () => {
      const reports = tmp('coverage');
      // Child run over the sim layer only (tests and coverage scope), so it does not recurse into
      // itself or trip the other layers' thresholds.
      await run(
        'pnpm',
        [
          'exec',
          'vitest',
          'run',
          'src/sim',
          '--coverage',
          '--coverage.include=src/sim/**',
          `--coverage.reportsDirectory=${reports}`,
        ],
        { cwd: root },
      );
      expect(existsSync(join(reports, 'coverage-summary.json'))).toBe(true);
      expect(existsSync(join(reports, 'lcov.info'))).toBe(true);
    },
  );

  it('AC-6: the pinned Node major matches .node-version', () => {
    const pinned = readFileSync(join(root, '.node-version'), 'utf8').trim();
    expect(pkg.engines.node).toBe(`>=${pinned}.11.0 <${String(Number(pinned) + 1)}`);
    expect(pkg.packageManager).toMatch(/^pnpm@\d+\.\d+\.\d+\+sha512\./);
  });

  it(
    'AC-6: install on a Node outside engines fails with an engine mismatch',
    { timeout: 60_000 },
    async () => {
      // We can't swap the running Node, so pin engines to a range that excludes it instead.
      const dir = tmp('engines');
      // No packageManager: an --offline pnpm would otherwise fail resolving itself before the engine check.
      const excluded = { name: 'engine-probe', private: true, engines: { node: '<1' } };
      writeFileSync(join(dir, 'package.json'), JSON.stringify(excluded));
      writeFileSync(
        join(dir, 'pnpm-workspace.yaml'),
        readFileSync(join(root, 'pnpm-workspace.yaml')),
      );

      const failure: unknown = await run('pnpm', ['install', '--offline'], { cwd: dir }).then(
        () => null,
        (err: unknown) => err,
      );

      const { stdout, stderr } = failure as { stdout: string; stderr: string };
      expect(`${stdout}${stderr}`).toContain('ERR_PNPM_UNSUPPORTED_ENGINE');
    },
  );
});
