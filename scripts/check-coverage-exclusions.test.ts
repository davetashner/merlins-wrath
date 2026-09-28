import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  check,
  excludesOf,
  main,
  parseExclusions,
  readExclusionGlobs,
  type CheckInput,
  type ExclusionRow,
} from './check-coverage-exclusions.ts';
import type { Layers } from './coverage-layers.ts';
import type { FileSummary } from './coverage-ratchet.ts';

const full = { lines: 100, branches: 100, functions: 100, statements: 100 };
const layers: Layers = {
  sim: { globs: ['src/sim/**'], thresholds: full, perFile: true },
  ui: { globs: ['src/ui/**'], thresholds: { lines: 90, branches: 90 }, perFile: false },
};

const row = (overrides: Partial<ExclusionRow> = {}): ExclusionRow => ({
  line: 10,
  glob: 'src/render/**',
  reason: 'needs a GPU',
  bead: 'mw-e00.19',
  verification: 'Playwright smoke',
  ...overrides,
});

const file = (lines: [number, number], branches: [number, number] = [1, 1]): FileSummary => ({
  lines: { covered: lines[0], total: lines[1] },
  branches: { covered: branches[0], total: branches[1] },
  functions: { covered: 1, total: 1 },
  statements: { covered: 1, total: 1 },
});

const input = (overrides: Partial<CheckInput> = {}): CheckInput => ({
  exclusions: [row()],
  gaps: [],
  configExcludes: ['**/*.test.ts', 'src/render/**'],
  layers,
  summary: {},
  sources: [],
  ...overrides,
});

const MD = `# Coverage exclusions

## Exclusions

| Path glob | Reason | Bead | Alternative verification |
|---|---|---|---|
| \`src/render/**\` | needs a GPU | mw-e00.19 | Playwright smoke |
| \`src/short.ts\` | only a reason |

not a table line

## Glue-layer gaps

| File | Reason | Bead |
|---|---|---|
| \`src/ui/menu.ts\` | focus trap needs a real browser | mw-e00.23 |

## Afterword
| ignored | table |
`;

describe('parseExclusions', () => {
  it('reads both tables, strips backticks and pads short rows', () => {
    const { exclusions, gaps } = parseExclusions(MD);
    expect(exclusions).toEqual([
      row({ line: 7 }),
      { line: 8, glob: 'src/short.ts', reason: 'only a reason', bead: '', verification: '' },
    ]);
    expect(gaps).toEqual([
      {
        line: 16,
        file: 'src/ui/menu.ts',
        reason: 'focus trap needs a real browser',
        bead: 'mw-e00.23',
      },
    ]);
  });

  it('fails loudly when a section is missing', () => {
    expect(() => parseExclusions('## Exclusions\n')).toThrow(
      /missing "## Glue-layer gaps" section/,
    );
  });

  it('the committed file lists the bootstrap and the render layer', () => {
    expect(readExclusionGlobs()).toEqual(['src/main.ts', 'src/render/**']);
  });
});

describe('check', () => {
  it('passes for a consistent config and table', () => {
    expect(check(input())).toEqual([]);
  });

  it('AC-1: Vitest excluding an unlisted glob fails naming the glob', () => {
    expect(check(input({ exclusions: [] }))).toEqual([
      'Vitest excludes "src/render/**", which is not listed in coverage-exclusions.md.',
    ]);
  });

  it('a listed glob that Vitest does not exclude fails too', () => {
    expect(check(input({ configExcludes: ['**/*.test.ts'] }))).toEqual([
      'coverage-exclusions.md lists "src/render/**", but Vitest does not exclude it.',
    ]);
  });

  it.each([
    [
      'an empty reason',
      { reason: '' },
      'coverage-exclusions.md:10 (src/render/**): missing reason.',
    ],
    [
      'no bead id',
      { bead: 'TODO' },
      'coverage-exclusions.md:10 (src/render/**): missing mw- bead id.',
    ],
    [
      'no alternative verification',
      { verification: '' },
      'coverage-exclusions.md:10 (src/render/**): missing alternative verification.',
    ],
  ])('AC-2: a row with %s fails naming the row', (_name, overrides, problem) => {
    expect(check(input({ exclusions: [row(overrides)] }))).toEqual([problem]);
  });

  it('AC-2: a row without a glob fails', () => {
    expect(
      check(input({ exclusions: [row({ glob: '' })], configExcludes: ['**/*.test.ts'] })),
    ).toEqual(['coverage-exclusions.md:10 (no glob): missing path glob.']);
  });

  it.each(['src/sim/rng.ts', 'src/sim/**', 'src/**', '**/*.ts'])(
    'AC-3: excluding %s fails because src/sim is a 100%% layer',
    (glob) => {
      const problems = check(input({ exclusions: [row({ glob })], configExcludes: [glob] }));
      expect(problems).toEqual([
        `coverage-exclusions.md:10 (${glob}): the sim layer requires 100% coverage and cannot be excluded.`,
      ]);
    },
  );

  it('glue-layer files below 100% need a gap row', () => {
    const summary = {
      total: file([1, 2]),
      'src/ui/menu.ts': file([9, 10], [1, 2]),
      'src/ui/hud.ts': file([10, 10], [1, 2]),
      'src/ui/ok.ts': file([10, 10]),
      'src/sim/tick.ts': file([1, 2]),
    };
    expect(check(input({ summary }))).toEqual([
      'src/ui/menu.ts is below 100% lines and branches without a Glue-layer gaps row.',
      'src/ui/hud.ts is below 100% branches without a Glue-layer gaps row.',
    ]);
    const gaps = [
      { line: 3, file: 'src/ui/menu.ts', reason: 'focus trap', bead: 'mw-e00.23' },
      { line: 4, file: 'src/ui/hud.ts', reason: '', bead: 'none' },
    ];
    expect(check(input({ summary, gaps }))).toEqual([
      'coverage-exclusions.md:4 (src/ui/hud.ts): missing reason.',
      'coverage-exclusions.md:4 (src/ui/hud.ts): missing mw- bead id.',
    ]);
    expect(check(input({ gaps: [{ line: 5, file: '', reason: 'x', bead: 'mw-e00.1' }] }))).toEqual(
      [],
    );
  });

  it('AC-4: a v8 ignore comment in a non-excluded file fails with file and line', () => {
    const sources = [
      {
        path: 'src/game/foo.ts',
        text: 'export const a = 1;\n/* v8 ignore next */\nexport const b = 2;',
      },
      { path: 'src/ui/bar.ts', text: '// istanbul ignore else\n' },
      { path: 'src/render/scene.ts', text: '/* v8 ignore next */' },
      { path: 'src/game/foo.test.ts', text: '/* c8 ignore next */' },
      { path: 'src/game/clean.ts', text: "const s = 'v8 ignore';" },
    ];
    expect(check(input({ sources }))).toEqual([
      'src/game/foo.ts:2: coverage ignore comment outside an excluded path.',
      'src/ui/bar.ts:1: coverage ignore comment outside an excluded path.',
    ]);
  });
});

describe('excludesOf', () => {
  it('reads default.test.coverage.exclude and tolerates anything else', () => {
    expect(excludesOf({ default: { test: { coverage: { exclude: ['a', 1, 'b'] } } } })).toEqual([
      'a',
      'b',
    ]);
    expect(excludesOf({ default: { test: {} } })).toEqual([]);
    expect(excludesOf(null)).toEqual([]);
  });
});

describe('main', () => {
  let dir: string;
  const cwd = process.cwd();
  const argv = process.argv;
  const write = (path: string, text: string) => {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), text);
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'vesper-exclusions-'));
    write('coverage-exclusions.md', MD.replace(/\| `src\/short\.ts`.*\n/, ''));
    write('coverage-layers.json', JSON.stringify({ layers }));
    write('coverage/coverage-summary.json', JSON.stringify({ total: file([1, 1]) }));
    write(
      'vite.config.mjs',
      "export default { test: { coverage: { exclude: ['**/*.test.ts', 'src/render/**'] } } };",
    );
    write('src/game/foo.ts', 'export const a = 1;\n');
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    process.chdir(cwd);
    process.argv = argv;
    process.exitCode = undefined;
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true });
  });

  it('passes for a consistent repo', async () => {
    expect(await main(['--config', 'vite.config.mjs'], dir)).toBe(0);
    expect(console.log).toHaveBeenCalledWith('coverage-exclusions.md matches the coverage config.');
  });

  it('reports each problem as a GitHub error annotation', async () => {
    write('src/game/foo.ts', '/* v8 ignore next */\n');
    expect(await main(['--config', 'vite.config.mjs'], dir)).toBe(1);
    expect(console.log).toHaveBeenCalledWith(
      '::error title=Coverage exclusions::src/game/foo.ts:1: coverage ignore comment outside an excluded path.',
    );
  });

  it('needs a coverage summary (a flag with no value falls back to the default path)', async () => {
    rmSync(join(dir, 'coverage'), { recursive: true });
    expect(await main(['--config', 'vite.config.mjs', '--summary'], dir)).toBe(2);
    expect(console.log).toHaveBeenCalledWith(expect.stringMatching(/run pnpm test:coverage first/));
  });

  it('AC-5: the committed repo state passes against the real vite.config.ts', async () => {
    const summary = join(dir, 'empty-summary.json');
    writeFileSync(summary, JSON.stringify({ total: file([1, 1]) }));
    expect(await main(['--summary', summary], cwd)).toBe(0);
  });

  it('the CLI sets the process exit code from main', async () => {
    process.chdir(dir);
    process.argv = ['node', 'check-coverage-exclusions-cli.ts', '--config', 'vite.config.mjs'];
    await import('./check-coverage-exclusions-cli.ts');
    expect(process.exitCode).toBe(0);
  });
});
