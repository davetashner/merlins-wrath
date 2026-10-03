import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { percentiles } from '../../src/tools/perf/percentiles.ts';
import { compareFrames, formatRows, main, REGRESSION_THRESHOLD } from './regression.ts';
import type { FrameRun, PerfRunReport } from './report.ts';

const run = (scene: string, p50: number, p95: number): FrameRun => ({
  scene,
  frame: { ...percentiles([1]), count: 1800, p50, p95 },
  work: percentiles([1]),
  viewport: '1280×720 @1x',
  renderer: 'SwiftShader',
});

const report = (sha: string, frames: FrameRun[]): PerfRunReport => ({
  schema: 1,
  mode: 'ci',
  sha,
  date: '2026-10-03T00:00:00.000Z',
  browser: 'chromium',
  results: [],
  measurements: [],
  frames,
  pass: true,
});

describe('frame-time regression vs main (mw-e32.1 AC-5)', () => {
  it('flags percentiles more than 15 % slower than main, per scene measured in both', () => {
    expect(REGRESSION_THRESHOLD).toBe(0.15);
    const rows = compareFrames(
      [run('perf-baseline', 40, 50), run('old-scene', 10, 10), run('zero', 0, 10)],
      [run('perf-baseline', 46.4, 57.4), run('new-scene', 99, 99), run('zero', 5, 10)],
    );
    expect(rows.map((r) => [r.scene, r.percentile, r.regressed])).toEqual([
      ['perf-baseline', 'p50', true], // +16 %
      ['perf-baseline', 'p95', false], // +14.8 %
      ['zero', 'p95', false], // a zero baseline percentile is not compared
    ]);
    expect(rows[0]?.change).toBeCloseTo(0.16);
    const faster = compareFrames([run('s', 10, 10)], [run('s', 8, 8)]);
    expect(faster[0]?.change).toBeCloseTo(-0.2);
    expect(formatRows(faster, 'main123')).toContain('| s | p50 | 10.00 | 8.00 | -20.0% | ok |');
    expect(formatRows(rows, 'main123')).toContain(
      '| perf-baseline | p50 | 40.00 | 46.40 | +16.0% | ⚠ regressed |',
    );
    expect(formatRows(rows, 'main123')).toContain(
      '| perf-baseline | p95 | 50.00 | 57.40 | +14.8% | ok |',
    );
  });

  describe('CLI', () => {
    let dir: string;
    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'perf-compare-'));
    });
    afterEach(() => {
      rmSync(dir, { recursive: true });
      process.exitCode = undefined;
      vi.restoreAllMocks();
    });

    const write = (name: string, value: PerfRunReport): string => {
      const path = join(dir, name);
      writeFileSync(path, JSON.stringify(value));
      return path;
    };

    it('AC-5: a PR more than 15 % slower than main gets a warning annotation and still passes', () => {
      const base = write('base.json', report('main123', [run('perf-baseline', 40, 50)]));
      const current = write('pr.json', report('pr45678', [run('perf-baseline', 48, 51)]));
      const summary = join(dir, 'summary.md');
      writeFileSync(summary, '');
      const lines: string[] = [];
      const code = main(['--current', current, '--baseline', base], {
        log: (line) => lines.push(line),
        env: { GITHUB_STEP_SUMMARY: summary },
      });
      expect(code).toBe(0); // non-blocking
      expect(lines.filter((l) => l.startsWith('::warning'))).toEqual([
        expect.stringMatching(
          /^::warning title=Perf regression vs main::perf-baseline frame time p50 48\.00 ms vs main's 40\.00 ms \(\+20\.0%/,
        ),
      ]);
      expect(lines.at(-1)).toBe(
        'Frame time vs main (main123): 2 compared, 1 regressed by more than +15.0%.',
      );
      expect(readFileSync(summary, 'utf8')).toContain(
        'Software-rendered frame time vs main (`main123`)',
      );
    });

    it('AC-5: no regression, no warning; no baseline or no report is a notice, not a failure', () => {
      const base = write('base.json', report('main123', [run('perf-baseline', 40, 50)]));
      const current = write('pr.json', report('pr45678', [run('perf-baseline', 41, 52)]));
      const log = vi.fn();
      expect(main(['--current', current, '--baseline', base], { log, env: {} })).toBe(0);
      expect(log).toHaveBeenCalledTimes(1);
      expect(main(['--current', current], { log, env: {} })).toBe(0);
      expect(
        main(['--current', current, '--baseline', join(dir, 'gone.json')], { log, env: {} }),
      ).toBe(0);
      expect(log).toHaveBeenLastCalledWith(
        expect.stringMatching(/^::notice .*No perf report from main/),
      );
      expect(
        main(['--current', join(dir, 'gone.json')], { log, env: { GITHUB_STEP_SUMMARY: '' } }),
      ).toBe(0);
      expect(log).toHaveBeenLastCalledWith(expect.stringMatching(/^::warning .*did not finish/));
      expect(main([], { log, env: {} })).toBe(2);
    });

    it('the CLI sets the exit code', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => undefined);
      const argv = process.argv;
      process.argv = ['node', 'compare-cli.ts', '--current', join(dir, 'none.json')];
      try {
        await import('./compare-cli.ts');
      } finally {
        process.argv = argv;
      }
      expect(process.exitCode).toBe(0);
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('did not finish'));
    });
  });
});
