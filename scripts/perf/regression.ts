// Relative frame-time regression vs main (mw-e32.1 AC-5). GitHub's runners have no GPU, so CI frame
// times are software-rendered (SwiftShader) and say nothing absolute about the reference machine; what
// they can show is a PR making the same scene slower than main on the same kind of runner. This
// compares a PR's perf report with the latest report from main (the `perf-report` artifact of main's
// last successful CI run) and prints a GitHub warning annotation for every frame-time percentile that
// regressed by more than 15 %. It never fails the job: runner hardware and load vary between runs, so
// a regression is a prompt to look, not a verdict. Run through scripts/perf/compare-cli.ts.

import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import type { FrameRun, PerfRunReport } from './report.ts';

/** A regression above this fraction of main's value warns (± 15 %, from the bead). */
export const REGRESSION_THRESHOLD = 0.15;

const TITLE = 'Perf regression vs main';

/** The percentiles compared, per scene. */
const COMPARED = ['p50', 'p95'] as const;

export interface RegressionRow {
  readonly scene: string;
  readonly percentile: (typeof COMPARED)[number];
  readonly base: number;
  readonly current: number;
  /** (current − base) / base. */
  readonly change: number;
  readonly regressed: boolean;
}

/** One row per scene measured in both reports and compared percentile. */
export function compareFrames(
  base: readonly FrameRun[],
  current: readonly FrameRun[],
  threshold: number = REGRESSION_THRESHOLD,
): RegressionRow[] {
  return current.flatMap((run) => {
    const before = base.find((b) => b.scene === run.scene);
    if (before === undefined) return [];
    return COMPARED.filter((p) => before.frame[p] > 0).map((percentile) => {
      const change = (run.frame[percentile] - before.frame[percentile]) / before.frame[percentile];
      return {
        scene: run.scene,
        percentile,
        base: before.frame[percentile],
        current: run.frame[percentile],
        change,
        regressed: change > threshold,
      };
    });
  });
}

const pct = (n: number): string => `${n >= 0 ? '+' : ''}${(n * 100).toFixed(1)}%`;

/** Markdown for the job summary. */
export function formatRows(rows: readonly RegressionRow[], baseSha: string): string {
  return [
    `## Software-rendered frame time vs main (\`${baseSha}\`)`,
    '',
    `Warning only (mw-e32.1 AC-5): more than ${pct(REGRESSION_THRESHOLD)} is flagged.`,
    '',
    '| Scene | Percentile | main (ms) | PR (ms) | Change | |',
    '|---|---|---|---|---|---|',
    ...rows.map(
      (r) =>
        `| ${r.scene} | ${r.percentile} | ${r.base.toFixed(2)} | ${r.current.toFixed(2)} | ${pct(r.change)} | ${r.regressed ? '⚠ regressed' : 'ok'} |`,
    ),
    '',
  ].join('\n');
}

export interface Io {
  readonly log: (line: string) => void;
  readonly env: Readonly<Record<string, string | undefined>>;
}

function readReport(path: string): PerfRunReport {
  return JSON.parse(readFileSync(path, 'utf8')) as PerfRunReport;
}

/**
 * `--current <report.json> [--baseline <main's report.json>]`. Prints a warning annotation per
 * regression, a notice when there is no baseline, and appends a table to $GITHUB_STEP_SUMMARY.
 * Returns 0 in every case but a missing --current argument (a broken workflow, not a regression).
 */
export function main(argv: readonly string[], io: Io): number {
  const arg = (name: string): string | undefined => {
    const i = argv.indexOf(name);
    return i === -1 ? undefined : argv[i + 1];
  };
  const currentPath = arg('--current');
  if (currentPath === undefined) {
    io.log('usage: compare-cli.ts --current <perf-report.json> [--baseline <perf-report.json>]');
    return 2;
  }
  if (!existsSync(currentPath)) {
    io.log(
      `::warning title=${TITLE}::No perf report at ${currentPath}: the perf run did not finish, nothing to compare.`,
    );
    return 0;
  }
  const basePath = arg('--baseline');
  if (basePath === undefined || !existsSync(basePath)) {
    io.log(`::notice title=${TITLE}::No perf report from main to compare with yet; skipped.`);
    return 0;
  }
  const base = readReport(basePath);
  const rows = compareFrames(base.frames, readReport(currentPath).frames);
  for (const r of rows.filter((row) => row.regressed)) {
    io.log(
      `::warning title=${TITLE}::${r.scene} frame time ${r.percentile} ${r.current.toFixed(2)} ms vs main's ${r.base.toFixed(2)} ms (${pct(r.change)}, over the ${pct(REGRESSION_THRESHOLD)} threshold). Software-rendered on a CI runner: check locally or on the reference machine before trusting it.`,
    );
  }
  const regressed = rows.filter((row) => row.regressed).length;
  io.log(
    `Frame time vs main (${base.sha}): ${String(rows.length)} compared, ${String(regressed)} regressed by more than ${pct(REGRESSION_THRESHOLD)}.`,
  );
  const summary = io.env['GITHUB_STEP_SUMMARY'];
  if (summary !== undefined && summary !== '') appendFileSync(summary, formatRows(rows, base.sha));
  return 0;
}
