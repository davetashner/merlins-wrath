import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  coreComponents,
  coreScenario,
  parseReplay,
  type CoreCommand,
  type ReplayScenario,
} from '@sim/index';
import { defaultIo, gitSha, main, USAGE, type CliIo } from './cli';
import { readReplay } from './files';

let dir: string;
let lines: string[];
let errors: string[];

function io(scenarios: CliIo['scenarios'] = { core: coreScenario }): CliIo {
  return {
    cwd: dir,
    log: (line) => lines.push(line),
    error: (line) => errors.push(line),
    buildSha: () => 'feedface',
    contentHash: () => 'content-1',
    scenarios,
  };
}

/** The core scenario with every body's Position.x nudged during tick `at`. */
function changedAt(at: number): ReplayScenario<CoreCommand> {
  const { Position } = coreComponents;
  return {
    ...coreScenario,
    create(options) {
      const world = coreScenario.create(options);
      world.addSystem({
        name: 'change',
        run({ tick }) {
          if (tick === at) {
            world.query(Position).forEach((id, p) => {
              world.set(id, Position, { x: p.x + 0.5, y: p.y });
            });
          }
        },
      });
      return world;
    },
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'replay-cli-'));
  lines = [];
  errors = [];
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('pnpm replay:record', () => {
  it('records a scenario to tests/replays/<name>.json with the defaults', () => {
    expect(main(['record', 'core'], io())).toBe(0);
    const replay = readReplay(join(dir, 'tests/replays/core.json'));
    expect(replay).toMatchObject({
      seed: 1,
      ticks: 3600,
      checkpointInterval: 60,
      buildSha: 'feedface',
    });
    expect(replay.checkpoints[0]?.state).toBeDefined();
    expect(lines).toEqual([
      `recorded tests/replays/core.json: 3600 ticks, 61 checkpoints, final hash ${replay.finalHash}`,
    ]);
  });

  it('honours --seed, --ticks, --every, --no-states and --out, and refuses to overwrite without --force', () => {
    const args = [
      'record',
      'core',
      '--seed',
      '9',
      '--ticks',
      '100',
      '--every',
      '25',
      '--no-states',
      '--out',
      'x/r.json',
    ];
    expect(main(args, io())).toBe(0);
    const replay = readReplay(join(dir, 'x/r.json'));
    expect(replay).toMatchObject({ seed: 9, ticks: 100, checkpointInterval: 25 });
    expect(replay.checkpoints.map((c) => c.tick)).toEqual([0, 25, 50, 75, 100]);
    expect(replay.checkpoints[0]?.state).toBeUndefined();
    expect(main(args, io())).toBe(2);
    expect(errors[0]).toMatch(/^x\/r\.json exists; pass --force to overwrite it/);
    expect(main([...args, '--force'], io())).toBe(0);
  });

  it('rejects bad arguments with usage', () => {
    const cases: [string[], string][] = [
      [['record'], 'record takes one scenario name'],
      [['record', 'core', 'extra'], 'record takes one scenario name'],
      [['record', 'ghost'], 'unknown scenario "ghost" (registered: core)'],
      [['record', 'core', '--ticks', 'many'], '--ticks must be an integer ≥ 0, got "many"'],
      [['record', 'core', '--every', '0'], '--every must be an integer ≥ 1, got "0"'],
      [['record', 'core', '--speed', '2'], "Unknown option '--speed'"],
      [['replay'], 'unknown command "replay"'],
    ];
    for (const [args, message] of cases) {
      errors = [];
      expect(main(args, io())).toBe(2);
      expect(errors[0]).toContain(message);
      expect(errors[0]).toContain(USAGE);
    }
    expect(existsSync(join(dir, 'tests'))).toBe(false);
  });

  it('prints usage for --help (success) and for no command (usage error)', () => {
    expect(main(['--help'], io())).toBe(0);
    expect(main(['-h'], io())).toBe(0);
    expect(main([], io())).toBe(2);
    expect(lines).toEqual([USAGE, USAGE, USAGE]);
  });

  it('lets unexpected errors propagate', () => {
    const broken = {
      core: {
        ...coreScenario,
        create: () => {
          throw new Error('boom');
        },
      },
    };
    expect(() => main(['record', 'core'], io(broken))).toThrow('boom');
  });
});

describe('pnpm replay:rebless', () => {
  const record = (name: string, extra: string[] = []) =>
    main(['record', 'core', '--ticks', '300', '--out', `tests/replays/${name}`, ...extra], io());

  it('leaves replays whose hashes still match untouched', () => {
    record('a.json');
    const path = join(dir, 'tests/replays/a.json');
    const before = readFileSync(path, 'utf8');
    lines = [];
    expect(main(['rebless'], { ...io(), buildSha: () => 'newer' })).toBe(0);
    expect(lines).toEqual(['unchanged tests/replays/a.json']);
    expect(readFileSync(path, 'utf8')).toBe(before);
  });

  it('rewrites changed replays and reports the first changed checkpoint', () => {
    record('a.json');
    record('b.json', ['--no-states']);
    writeFileSync(join(dir, 'tests/replays/notes.txt'), 'ignored');
    lines = [];
    expect(main(['rebless'], io({ core: changedAt(70) }))).toBe(0);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(
      /^reblessed tests\/replays\/a\.json: outcomes changed from checkpoint tick 120 \(final hash \w{8} → \w{8}\)$/,
    );
    expect(lines[1]).toMatch(/^reblessed tests\/replays\/b\.json: /);
    const b = parseReplay(JSON.parse(readFileSync(join(dir, 'tests/replays/b.json'), 'utf8')));
    expect(b.checkpoints[0]?.state).toBeUndefined();
  });

  it('refreshes only the content hash when outcomes are unchanged', () => {
    const scenarios = { core: { ...coreScenario, usesContent: true } };
    expect(main(['record', 'core', '--ticks', '60'], io(scenarios))).toBe(0);
    lines = [];
    expect(
      main(['rebless', 'tests/replays/core.json'], {
        ...io(scenarios),
        contentHash: () => 'content-2',
      }),
    ).toBe(0);
    expect(lines).toEqual([
      'reblessed tests/replays/core.json: content hash updated; outcomes unchanged',
    ]);
    expect(readReplay(join(dir, 'tests/replays/core.json')).contentHash).toBe('content-2');
  });

  it('reports unreadable replays and fails, but still processes the rest', () => {
    record('good.json');
    mkdirSync(join(dir, 'tests/replays'), { recursive: true });
    writeFileSync(join(dir, 'tests/replays/bad.json'), '{}');
    lines = [];
    expect(main(['rebless'], io())).toBe(1);
    expect(errors[0]).toMatch(/^tests\/replays\/bad\.json: invalid replay/);
    expect(lines).toEqual(['unchanged tests/replays/good.json']);
  });

  it('says so when there is nothing to rebless', () => {
    expect(main(['rebless'], io())).toBe(0);
    expect(lines).toEqual(['no replays in tests/replays']);
  });
});

describe('defaultIo', () => {
  it('logs to the console and resolves the git SHA, content hash and registered scenarios', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const real = defaultIo(process.cwd());
    real.log('hello');
    real.error('oops');
    expect(log).toHaveBeenCalledWith('hello');
    expect(error).toHaveBeenCalledWith('oops');
    expect(real.buildSha()).toMatch(/^[0-9a-f]{12}$/);
    expect(real.contentHash()).toMatch(/^[0-9a-f]{16}$/);
    expect(real.scenarios['core']).toBe(coreScenario);
    vi.restoreAllMocks();
  });

  it('uses "unknown" as the build SHA outside a git checkout', () => {
    expect(gitSha(dir)).toBe('unknown');
  });

  it('main defaults to the real IO', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    expect(main(['--help'])).toBe(0);
    expect(log).toHaveBeenCalledWith(USAGE);
    vi.restoreAllMocks();
  });
});
