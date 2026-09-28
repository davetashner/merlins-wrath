// Coverage ratchet (backlog contract §3): fails when any metric falls versus main, globally or for any
// layer in coverage-layers.json. Run through scripts/coverage-ratchet-cli.ts; see --help.
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { matchesGlob, relative, resolve } from 'node:path';
import { METRICS, parseLayers, type Layers, type Metric } from './coverage-layers.ts';

export interface MetricSummary {
  total: number;
  covered: number;
}
export type FileSummary = Record<Metric, MetricSummary>;
/** Vitest/istanbul json-summary: `total` plus one entry per file path. */
export type CoverageSummary = Record<string, FileSummary>;
export type Percentages = Record<Metric, number>;

export interface Row {
  scope: string;
  metric: Metric;
  base: number;
  current: number;
  ok: boolean;
}

/** Tolerance in percentage points, so float noise never fails a PR. */
export const TOLERANCE = 0.01;

const pct = ({ total, covered }: MetricSummary): number =>
  total === 0 ? 100 : (covered / total) * 100;

/** Makes file keys repo-relative, so summaries from different checkouts compare. */
export function normalize(summary: CoverageSummary, root: string): CoverageSummary {
  const out: CoverageSummary = {};
  for (const [key, value] of Object.entries(summary)) {
    out[key === 'total' || !key.startsWith('/') ? key : relative(root, key)] = value;
  }
  return out;
}

/** Aggregate percentages over the files matching any glob, or null if none match. */
export function aggregate(
  summary: CoverageSummary,
  globs: readonly string[] | null,
): Percentages | null {
  const files =
    globs === null
      ? [summary['total']]
      : Object.entries(summary)
          .filter(([key]) => key !== 'total' && globs.some((g) => matchesGlob(key, g)))
          .map(([, value]) => value);
  const present = files.filter((f): f is FileSummary => f !== undefined);
  if (present.length === 0) return null;
  const out = {} as Percentages;
  for (const metric of METRICS) {
    out[metric] = pct({
      total: present.reduce((sum, f) => sum + f[metric].total, 0),
      covered: present.reduce((sum, f) => sum + f[metric].covered, 0),
    });
  }
  return out;
}

/** One row per scope (global, then each layer present in both summaries) and metric. */
export function compare(base: CoverageSummary, current: CoverageSummary, layers: Layers): Row[] {
  const scopes: [string, readonly string[] | null][] = [
    ['global', null],
    ...Object.entries(layers).map(([name, layer]): [string, string[]] => [name, layer.globs]),
  ];
  const rows: Row[] = [];
  for (const [scope, globs] of scopes) {
    const before = aggregate(base, globs);
    const after = aggregate(current, globs);
    if (!before || !after) continue;
    for (const metric of METRICS) {
      rows.push({
        scope,
        metric,
        base: before[metric],
        current: after[metric],
        ok: after[metric] >= before[metric] - TOLERANCE,
      });
    }
  }
  return rows;
}

const fmt = (n: number): string => `${n.toFixed(2)}%`;

export function renderTable(rows: readonly Row[]): string {
  const lines = ['| Scope | Metric | main | this PR | Δ | |', '|---|---|---|---|---|---|'];
  for (const r of rows) {
    const delta = r.current - r.base;
    const sign = delta > 0 ? '+' : '';
    lines.push(
      `| ${r.scope} | ${r.metric} | ${fmt(r.base)} | ${fmt(r.current)} | ${sign}${delta.toFixed(2)} | ${r.ok ? '✅' : '❌'} |`,
    );
  }
  return lines.join('\n');
}

export interface Io {
  readFile(path: string): string | null;
  writeFile(path: string, text: string): void;
  appendFile(path: string, text: string): void;
  log(line: string): void;
}

export const nodeIo: Io = {
  readFile(path) {
    try {
      return readFileSync(path, 'utf8');
    } catch {
      return null;
    }
  },
  writeFile: (path, text) => {
    writeFileSync(path, text);
  },
  appendFile: (path, text) => {
    appendFileSync(path, text);
  },
  log: (line) => {
    console.log(line);
  },
};

const USAGE = `Usage: node scripts/coverage-ratchet-cli.ts [options]
  --current <file>    this run's json-summary (default coverage/coverage-summary.json)
  --baseline <file>   main's json-summary, downloaded by CI (default baseline/coverage-summary.json)
  --fallback <file>   committed baseline used when --baseline is missing (default coverage-baseline.json)
  --layers <file>     coverage layer definitions (default coverage-layers.json)
  --write-baseline    write --current to --fallback with repo-relative paths, then exit`;

const VALUE_FLAGS = ['--current', '--baseline', '--fallback', '--layers'];

function parseArgs(argv: readonly string[]): Map<string, string> | string {
  const args = new Map<string, string>();
  let pending: string | null = null;
  for (const arg of argv) {
    if (pending !== null) {
      args.set(pending, arg);
      pending = null;
    } else if (arg === '--write-baseline' || arg === '--help') {
      args.set(arg, '');
    } else if (VALUE_FLAGS.includes(arg)) {
      pending = arg;
    } else {
      return `unknown option ${arg}`;
    }
  }
  return pending === null ? args : `${pending} needs a value`;
}

/** Returns the process exit code: 0 pass, 1 coverage fell, 2 usage or input error. */
export function main(
  argv: readonly string[],
  env: Record<string, string | undefined>,
  io: Io = nodeIo,
  root: string = process.cwd(),
): number {
  const args = parseArgs(argv);
  if (typeof args === 'string' || args.has('--help')) {
    io.log(typeof args === 'string' ? `coverage-ratchet: ${args}\n${USAGE}` : USAGE);
    return typeof args === 'string' ? 2 : 0;
  }
  const path = (flag: string, fallback: string): string =>
    resolve(root, args.get(flag) ?? fallback);
  const load = (file: string): CoverageSummary | null => {
    const text = io.readFile(file);
    return text === null ? null : normalize(JSON.parse(text) as CoverageSummary, root);
  };

  const currentPath = path('--current', 'coverage/coverage-summary.json');
  const fallbackPath = path('--fallback', 'coverage-baseline.json');
  const current = load(currentPath);
  if (!current) {
    io.log(
      `::error title=Coverage ratchet::No coverage summary at ${relative(root, currentPath)}; run pnpm test:coverage first.`,
    );
    return 2;
  }
  if (args.has('--write-baseline')) {
    io.writeFile(fallbackPath, `${JSON.stringify(current, null, 2)}\n`);
    io.log(`Wrote ${relative(root, fallbackPath)}.`);
    return 0;
  }

  let base = load(path('--baseline', 'baseline/coverage-summary.json'));
  if (!base) {
    io.log(
      `::warning title=Coverage ratchet::No main-branch coverage artifact found; comparing against the committed ${relative(root, fallbackPath)}.`,
    );
    base = load(fallbackPath);
  }
  if (!base) {
    io.log(
      `::error title=Coverage ratchet::No baseline to compare against (${relative(root, fallbackPath)} is missing).`,
    );
    return 2;
  }

  const layersPath = path('--layers', 'coverage-layers.json');
  const layersText = io.readFile(layersPath);
  if (layersText === null) {
    io.log(
      `::error title=Coverage ratchet::No layer definitions at ${relative(root, layersPath)}.`,
    );
    return 2;
  }
  const rows = compare(base, current, parseLayers(JSON.parse(layersText)));
  const table = renderTable(rows);
  io.log(table);
  const summaryFile = env['GITHUB_STEP_SUMMARY'];
  if (summaryFile) io.appendFile(summaryFile, `## Coverage vs main\n\n${table}\n`);

  const failures = rows.filter((r) => !r.ok);
  for (const r of failures) {
    io.log(
      `::error title=Coverage ratchet::${r.scope} ${r.metric} coverage fell from ${fmt(r.base)} to ${fmt(r.current)}.`,
    );
  }
  return failures.length > 0 ? 1 : 0;
}
