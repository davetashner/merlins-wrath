// Enforces coverage-exclusions.md as the only source of coverage exclusions (backlog contract §3).
// Run through scripts/check-coverage-exclusions-cli.ts; see coverage-exclusions.md for the rules.
import { globSync, readFileSync } from 'node:fs';
import { matchesGlob, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { METRICS, readLayers, type Layer, type Layers } from './coverage-layers.ts';
import { normalize, type CoverageSummary } from './coverage-ratchet.ts';

/** Excludes every config gets without a row: test files are not product code. */
export const DEFAULT_EXCLUDES = ['**/*.test.ts'];
/** Files the ignore-comment scan reads (the coverage `include` set). */
export const SOURCE_GLOBS = ['src/**/*.ts', 'scripts/**/*.ts'];

export interface ExclusionRow {
  line: number;
  glob: string;
  reason: string;
  bead: string;
  verification: string;
}

export interface GapRow {
  line: number;
  file: string;
  reason: string;
  bead: string;
}

export interface Source {
  path: string;
  text: string;
}

export interface CheckInput {
  exclusions: ExclusionRow[];
  gaps: GapRow[];
  configExcludes: readonly string[];
  layers: Layers;
  summary: CoverageSummary;
  sources: readonly Source[];
}

const BEAD = /\bmw-[a-z0-9]+(?:\.[0-9]+)*\b/;
// Built from parts so this file doesn't trip its own scan.
const IGNORE_COMMENT = new RegExp(String.raw`/[*/]\s*(?:v8|istanbul|c8)\s+ignore\b`);

const cells = (line: string): string[] =>
  line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((c) => c.trim().replace(/^`(.*)`$/, '$1'));

/** Rows of the markdown table under `## <heading>` (header and separator rows skipped). */
function tableRows(md: string, heading: string): { line: number; cells: string[] }[] {
  const lines = md.split('\n');
  const start = lines.findIndex((l) => l.trim() === `## ${heading}`);
  if (start === -1) throw new Error(`coverage-exclusions.md: missing "## ${heading}" section`);
  const rows: { line: number; cells: string[] }[] = [];
  let seenHeader = false;
  for (const [offset, raw] of lines.slice(start + 1).entries()) {
    const text = raw.trim();
    const i = start + 1 + offset;
    if (text.startsWith('## ')) break;
    if (!text.startsWith('|')) continue;
    if (!seenHeader) {
      seenHeader = true; // column header row
    } else if (!/^\|[\s|:-]+\|$/.test(text)) {
      rows.push({ line: i + 1, cells: cells(text) });
    }
  }
  return rows;
}

const at = (row: readonly string[], i: number): string => row[i] ?? '';

export function parseExclusions(md: string): { exclusions: ExclusionRow[]; gaps: GapRow[] } {
  return {
    exclusions: tableRows(md, 'Exclusions').map(({ line, cells: c }) => ({
      line,
      glob: at(c, 0),
      reason: at(c, 1),
      bead: at(c, 2),
      verification: at(c, 3),
    })),
    gaps: tableRows(md, 'Glue-layer gaps').map(({ line, cells: c }) => ({
      line,
      file: at(c, 0),
      reason: at(c, 1),
      bead: at(c, 2),
    })),
  };
}

/** The globs vite.config.ts excludes from coverage. */
export function readExclusionGlobs(path = 'coverage-exclusions.md'): string[] {
  return parseExclusions(readFileSync(path, 'utf8')).exclusions.map((r) => r.glob);
}

const isFull = (layer: Layer): boolean => METRICS.every((m) => layer.thresholds[m] === 100);

/** Static directory prefix of a glob: `src/sim/**` → `src/sim/`. */
const prefix = (glob: string): string => glob.slice(0, glob.search(/[*?[{]|$/));

/** True if the exclusion glob could match any file in the layer glob. */
function overlaps(exclusion: string, layerGlob: string): boolean {
  const layerDir = prefix(layerGlob);
  return (
    prefix(exclusion).startsWith(layerDir) ||
    [`${layerDir}probe.ts`, `${layerDir}nested/probe.ts`].some((p) => matchesGlob(p, exclusion))
  );
}

/** Every policy violation, as human-readable lines. Empty means the check passes. */
export function check(input: CheckInput): string[] {
  const problems: string[] = [];
  const listed = input.exclusions.map((r) => r.glob);

  for (const glob of input.configExcludes) {
    if (!DEFAULT_EXCLUDES.includes(glob) && !listed.includes(glob)) {
      problems.push(`Vitest excludes "${glob}", which is not listed in coverage-exclusions.md.`);
    }
  }
  for (const glob of listed) {
    if (glob && !input.configExcludes.includes(glob)) {
      problems.push(`coverage-exclusions.md lists "${glob}", but Vitest does not exclude it.`);
    }
  }

  for (const row of input.exclusions) {
    const where = `coverage-exclusions.md:${String(row.line)} (${row.glob || 'no glob'})`;
    if (!row.glob) problems.push(`${where}: missing path glob.`);
    if (!row.reason) problems.push(`${where}: missing reason.`);
    if (!BEAD.test(row.bead)) problems.push(`${where}: missing mw- bead id.`);
    if (!row.verification) problems.push(`${where}: missing alternative verification.`);
    for (const [name, layer] of Object.entries(input.layers)) {
      if (row.glob && isFull(layer) && layer.globs.some((g) => overlaps(row.glob, g))) {
        problems.push(`${where}: the ${name} layer requires 100% coverage and cannot be excluded.`);
      }
    }
  }

  for (const row of input.gaps) {
    const where = `coverage-exclusions.md:${String(row.line)} (${row.file || 'no file'})`;
    if (!row.reason) problems.push(`${where}: missing reason.`);
    if (!BEAD.test(row.bead)) problems.push(`${where}: missing mw- bead id.`);
  }

  const glueGlobs = Object.values(input.layers)
    .filter((layer) => !isFull(layer))
    .flatMap((layer) => layer.globs);
  const gapFiles = new Set(input.gaps.map((g) => g.file));
  for (const [file, metrics] of Object.entries(input.summary)) {
    if (file === 'total' || !glueGlobs.some((g) => matchesGlob(file, g))) continue;
    const short = (['lines', 'branches'] as const).filter(
      (m) => metrics[m].covered < metrics[m].total,
    );
    if (short.length > 0 && !gapFiles.has(file)) {
      problems.push(`${file} is below 100% ${short.join(' and ')} without a Glue-layer gaps row.`);
    }
  }

  for (const source of input.sources) {
    if ([...DEFAULT_EXCLUDES, ...listed].some((g) => matchesGlob(source.path, g))) continue;
    source.text.split('\n').forEach((text, i) => {
      if (IGNORE_COMMENT.test(text)) {
        problems.push(
          `${source.path}:${String(i + 1)}: coverage ignore comment outside an excluded path.`,
        );
      }
    });
  }
  return problems;
}

/** `default.test.coverage.exclude` of a loaded vite config module, or [] if absent. */
export function excludesOf(mod: unknown): string[] {
  let node = mod;
  for (const key of ['default', 'test', 'coverage', 'exclude']) {
    node =
      typeof node === 'object' && node !== null
        ? (node as Record<string, unknown>)[key]
        : undefined;
  }
  return Array.isArray(node) ? node.filter((g): g is string => typeof g === 'string') : [];
}

/** Returns the exit code: 0 pass, 1 policy violations, 2 missing input. */
export async function main(argv: readonly string[], root: string = process.cwd()): Promise<number> {
  const arg = (flag: string, fallback: string): string => {
    const i = argv.indexOf(flag);
    return resolve(root, i === -1 ? fallback : (argv[i + 1] ?? fallback));
  };
  const summaryPath = arg('--summary', 'coverage/coverage-summary.json');
  let summaryText: string;
  try {
    summaryText = readFileSync(summaryPath, 'utf8');
  } catch {
    console.log(
      `::error title=Coverage exclusions::No coverage summary at ${relative(root, summaryPath)}; run pnpm test:coverage first.`,
    );
    return 2;
  }

  const config: unknown = await import(pathToFileURL(arg('--config', 'vite.config.ts')).href);
  const problems = check({
    ...parseExclusions(readFileSync(arg('--exclusions', 'coverage-exclusions.md'), 'utf8')),
    configExcludes: excludesOf(config),
    layers: readLayers(arg('--layers', 'coverage-layers.json')),
    summary: normalize(JSON.parse(summaryText) as CoverageSummary, root),
    sources: globSync(SOURCE_GLOBS, { cwd: root }).map((path) => ({
      path,
      text: readFileSync(resolve(root, path), 'utf8'),
    })),
  });
  for (const p of problems) console.log(`::error title=Coverage exclusions::${p}`);
  if (problems.length === 0) console.log('coverage-exclusions.md matches the coverage config.');
  return problems.length > 0 ? 1 : 0;
}
