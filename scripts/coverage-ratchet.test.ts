import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Layers } from './coverage-layers.ts';
import {
  aggregate,
  compare,
  main,
  normalize,
  renderTable,
  type CoverageSummary,
  type FileSummary,
  type Io,
} from './coverage-ratchet.ts';

/** A file summary where every metric has `covered` of `total`. */
const file = (covered: number, total = 100): FileSummary => ({
  lines: { total, covered },
  branches: { total, covered },
  functions: { total, covered },
  statements: { total, covered },
});

/** A summary whose total has the given branch percentage (other metrics 100%). */
const withBranches = (branchPct: number): CoverageSummary => ({
  total: { ...file(100, 100), branches: { total: 10000, covered: Math.round(branchPct * 100) } },
});

const layers: Layers = {
  sim: { globs: ['src/sim/**'], thresholds: { lines: 100 }, perFile: true },
  ui: { globs: ['src/ui/**'], thresholds: { lines: 90 }, perFile: false },
};

function memoryIo(
  files: Record<string, string>,
): Io & { out: string[]; written: Record<string, string> } {
  const out: string[] = [];
  const written: Record<string, string> = {};
  return {
    out,
    written,
    readFile: (path) => files[path] ?? null,
    writeFile: (path, text) => {
      written[path] = text;
    },
    appendFile: (path, text) => {
      written[path] = (written[path] ?? '') + text;
    },
    log: (line) => out.push(line),
  };
}

describe('aggregate and normalize', () => {
  it('sums files matching a layer glob and treats an empty metric as 100%', () => {
    const summary: CoverageSummary = {
      total: file(0, 0),
      'src/sim/a.ts': file(10, 10),
      'src/sim/b.ts': file(0, 10),
      'src/ui/x.ts': file(0, 10),
    };
    expect(aggregate(summary, ['src/sim/**'])?.lines).toBe(50);
    expect(aggregate(summary, null)?.lines).toBe(100);
    expect(aggregate(summary, ['src/audio/**'])).toBeNull();
    expect(aggregate({}, null)).toBeNull();
  });

  it('makes absolute file keys repo-relative and leaves others alone', () => {
    expect(
      Object.keys(
        normalize(
          { total: file(1), '/repo/src/sim/a.ts': file(1), 'src/ui/b.ts': file(1) },
          '/repo',
        ),
      ),
    ).toEqual(['total', 'src/sim/a.ts', 'src/ui/b.ts']);
  });
});

describe('compare', () => {
  it('AC-3: global branches falling from 95.20% to 95.10% fails', () => {
    const rows = compare(withBranches(95.2), withBranches(95.1), layers);
    const failed = rows.filter((r) => !r.ok);
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ scope: 'global', metric: 'branches', ok: false });
    expect(failed[0]?.base).toBeCloseTo(95.2, 6);
    expect(failed[0]?.current).toBeCloseTo(95.1, 6);
  });

  it('AC-5: equal to baseline within 0.01 pp passes', () => {
    const base: CoverageSummary = { total: { ...file(100), branches: { total: 3, covered: 2 } } };
    const current: CoverageSummary = {
      total: { ...file(100), branches: { total: 300000, covered: 199998 } }, // 66.666% vs 66.667%
    };
    expect(compare(base, current, layers).every((r) => r.ok)).toBe(true);
  });

  it('compares each layer and skips layers missing from either side', () => {
    const base: CoverageSummary = {
      total: file(90),
      'src/sim/a.ts': file(100),
      'src/ui/x.ts': file(95),
    };
    const current: CoverageSummary = { total: file(90), 'src/sim/a.ts': file(99) };
    const rows = compare(base, current, layers);
    expect(new Set(rows.map((r) => r.scope))).toEqual(new Set(['global', 'sim']));
    expect(rows.filter((r) => !r.ok).map((r) => `${r.scope}:${r.metric}`)).toEqual([
      'sim:lines',
      'sim:branches',
      'sim:functions',
      'sim:statements',
    ]);
  });

  it('renders a markdown table with signed deltas', () => {
    const table = renderTable([
      { scope: 'global', metric: 'lines', base: 90, current: 91.5, ok: true },
      { scope: 'sim', metric: 'branches', base: 100, current: 99, ok: false },
    ]);
    expect(table).toContain('| global | lines | 90.00% | 91.50% | +1.50 | ✅ |');
    expect(table).toContain('| sim | branches | 100.00% | 99.00% | -1.00 | ❌ |');
  });
});

describe('main', () => {
  const root = '/repo';
  const layersJson = JSON.stringify({ layers });
  const base = JSON.stringify(withBranches(95.2));

  it('AC-3: exits non-zero and prints the metric, layer, old and new values', () => {
    const io = memoryIo({
      '/repo/coverage-layers.json': layersJson,
      '/repo/baseline/coverage-summary.json': base,
      '/repo/coverage/coverage-summary.json': JSON.stringify(withBranches(95.1)),
    });
    expect(main([], {}, io, root)).toBe(1);
    expect(io.out).toContain(
      '::error title=Coverage ratchet::global branches coverage fell from 95.20% to 95.10%.',
    );
  });

  it('AC-4: without a main artifact it warns and uses the committed baseline', () => {
    const io = memoryIo({
      '/repo/coverage-layers.json': layersJson,
      '/repo/coverage-baseline.json': base,
      '/repo/coverage/coverage-summary.json': base,
    });
    expect(main([], {}, io, root)).toBe(0);
    expect(io.out[0]).toMatch(
      /^::warning title=Coverage ratchet::No main-branch coverage artifact/,
    );
  });

  it('AC-4: with no baseline at all it fails instead of silently passing', () => {
    const io = memoryIo({ '/repo/coverage/coverage-summary.json': base });
    expect(main([], {}, io, root)).toBe(2);
    expect(io.out.at(-1)).toMatch(/No baseline to compare against/);
  });

  it('passes and writes the table to the GitHub job summary', () => {
    const io = memoryIo({
      '/repo/layers.json': layersJson,
      '/repo/main.json': base,
      '/repo/pr.json': base,
    });
    const args = ['--layers', 'layers.json', '--baseline', 'main.json', '--current', 'pr.json'];
    expect(main(args, { GITHUB_STEP_SUMMARY: '/tmp/summary.md' }, io, root)).toBe(0);
    expect(io.written['/tmp/summary.md']).toMatch(/^## Coverage vs main\n\n\| Scope \|/);
  });

  it('fails when the layer definitions are missing', () => {
    const io = memoryIo({
      '/repo/coverage-baseline.json': base,
      '/repo/coverage/coverage-summary.json': base,
    });
    expect(main([], {}, io, root)).toBe(2);
    expect(io.out.at(-1)).toMatch(/No layer definitions at coverage-layers.json/);
  });

  it('fails when this run has no coverage summary', () => {
    const io = memoryIo({});
    expect(main([], {}, io, root)).toBe(2);
    expect(io.out[0]).toMatch(/run pnpm test:coverage first/);
  });

  it('--write-baseline stores the current summary with repo-relative paths', () => {
    const io = memoryIo({
      '/repo/coverage/coverage-summary.json': JSON.stringify({
        total: file(1),
        '/repo/src/sim/a.ts': file(1),
      }),
    });
    expect(main(['--write-baseline', '--fallback', 'out.json'], {}, io, root)).toBe(0);
    expect(Object.keys(JSON.parse(io.written['/repo/out.json'] ?? '{}') as object)).toEqual([
      'total',
      'src/sim/a.ts',
    ]);
  });

  it.each([
    [['--help'], 0, /^Usage:/],
    [['--bogus'], 2, /unknown option --bogus/],
    [['--current'], 2, /--current needs a value/],
  ])('%j exits %i', (argv, code, output) => {
    const io = memoryIo({});
    expect(main(argv, {}, io, root)).toBe(code);
    expect(io.out[0]).toMatch(output);
  });
});

describe('node io and the CLI entry point', () => {
  let dir: string;
  const argv = process.argv;
  const cwd = process.cwd();

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'vesper-ratchet-'));
    mkdirSync(join(dir, 'coverage'));
    writeFileSync(join(dir, 'coverage-layers.json'), JSON.stringify({ layers }));
    writeFileSync(join(dir, 'coverage/coverage-summary.json'), JSON.stringify(withBranches(90)));
    writeFileSync(join(dir, 'coverage-baseline.json'), JSON.stringify(withBranches(90)));
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    process.argv = argv;
    process.exitCode = undefined;
    process.chdir(cwd);
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true });
  });

  it('reads, writes and appends real files', () => {
    const summary = join(dir, 'summary.md');
    writeFileSync(summary, '');
    expect(main(['--write-baseline', '--fallback', 'written.json'], {}, undefined, dir)).toBe(0);
    expect(readFileSync(join(dir, 'written.json'), 'utf8')).toContain('"total"');
    expect(main([], { GITHUB_STEP_SUMMARY: summary }, undefined, dir)).toBe(0);
    expect(readFileSync(summary, 'utf8')).toContain('Coverage vs main');
    expect(console.log).toHaveBeenCalled();
  });

  it('the CLI sets the process exit code from main', async () => {
    process.chdir(dir);
    process.argv = ['node', 'coverage-ratchet-cli.ts', '--baseline', 'coverage-baseline.json'];
    await import('./coverage-ratchet-cli.ts');
    expect(process.exitCode).toBe(0);
  });
});
