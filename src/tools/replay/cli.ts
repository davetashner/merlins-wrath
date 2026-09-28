// pnpm replay:record / pnpm replay:rebless (mw-e00.17), run through scripts/replay-cli.ts.
//
// record: runs a registered scenario headlessly with its input script and writes a golden replay.
// rebless: after an intended sim or content change, re-records every golden's exact commands on the
// current build and rewrites files whose hashes changed, printing the first changed checkpoint so
// the reviewer knows where outcomes moved. The rewritten JSON diff is part of the PR under review.
// Files whose hashes still match are left untouched (no buildSha churn).

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parseArgs } from 'node:util';
import { reblessReplay, recordScenario, replayScenarios, type Replay } from '@sim/index';
import {
  currentContentHash,
  GOLDEN_REPLAY_DIR,
  readReplay,
  scenarioOf,
  writeReplay,
  type ScenarioRegistry,
} from './files';

export interface CliIo {
  /** Repo root: default paths resolve against it. */
  readonly cwd: string;
  log(line: string): void;
  error(line: string): void;
  /** The build's git SHA, stored in recorded replays. */
  buildSha(): string;
  contentHash(): string;
  readonly scenarios: ScenarioRegistry;
}

/** `git rev-parse --short=12 HEAD`, or "unknown" outside a git checkout. */
export function gitSha(cwd: string): string {
  try {
    return execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], {
      cwd,
      encoding: 'utf8',
    }).trim();
  } catch {
    return 'unknown';
  }
}

export const defaultIo = (cwd: string): CliIo => ({
  cwd,
  log: (line) => {
    console.log(line);
  },
  error: (line) => {
    console.error(line);
  },
  buildSha: () => gitSha(cwd),
  contentHash: currentContentHash,
  scenarios: replayScenarios,
});

export const USAGE = `Usage:
  pnpm replay:record <scenario> [--seed N] [--ticks N] [--every N] [--no-states] [--out FILE] [--force]
      Record a scenario's input script into a golden replay (default ${GOLDEN_REPLAY_DIR}/<scenario>.json,
      seed 1, 3600 ticks, a checkpoint every 60 ticks with full states).
  pnpm replay:rebless [FILE...]
      Re-record golden replays (default: all of ${GOLDEN_REPLAY_DIR}/*.json) after an intended change.`;

class UsageError extends Error {}

function count(value: string | undefined, name: string, fallback: number, min: number): number {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < min) {
    throw new UsageError(`--${name} must be an integer ≥ ${String(min)}, got "${value}"`);
  }
  return n;
}

function recordArgs(args: readonly string[]) {
  try {
    return parseArgs({
      args: [...args],
      allowPositionals: true,
      options: {
        seed: { type: 'string' },
        ticks: { type: 'string' },
        every: { type: 'string' },
        'no-states': { type: 'boolean' },
        out: { type: 'string' },
        force: { type: 'boolean' },
      },
    });
  } catch (error) {
    throw new UsageError((error as Error).message);
  }
}

function record(args: readonly string[], io: CliIo): number {
  const { values, positionals } = recordArgs(args);
  const [name, ...extra] = positionals;
  if (name === undefined || extra.length > 0)
    throw new UsageError('record takes one scenario name');
  const scenario = io.scenarios[name];
  if (scenario === undefined) {
    throw new UsageError(
      `unknown scenario "${name}" (registered: ${Object.keys(io.scenarios).join(', ')})`,
    );
  }
  const out = join(io.cwd, values.out ?? join(GOLDEN_REPLAY_DIR, `${name}.json`));
  if (existsSync(out) && values.force !== true) {
    throw new UsageError(`${relative(io.cwd, out)} exists; pass --force to overwrite it`);
  }
  const replay = recordScenario(scenario, {
    seed: count(values.seed, 'seed', 1, 0),
    ticks: count(values.ticks, 'ticks', 3600, 0),
    checkpointInterval: count(values.every, 'every', 60, 1),
    keepStates: values['no-states'] !== true,
    buildSha: io.buildSha(),
    contentHash: io.contentHash(),
  });
  writeReplay(out, replay);
  io.log(
    `recorded ${relative(io.cwd, out)}: ${String(replay.ticks)} ticks, ` +
      `${String(replay.checkpoints.length)} checkpoints, final hash ${replay.finalHash}`,
  );
  return 0;
}

/** What re-blessing changed, or undefined when every hash still matches. */
function changes(before: Replay, after: Replay): string | undefined {
  const moved = after.checkpoints.find(
    (checkpoint, i) => checkpoint.hash !== before.checkpoints[i]?.hash,
  );
  if (moved !== undefined) {
    return `outcomes changed from checkpoint tick ${String(moved.tick)} (final hash ${before.finalHash} → ${after.finalHash})`;
  }
  if (after.contentHash !== before.contentHash) return 'content hash updated; outcomes unchanged';
  return undefined;
}

function rebless(files: readonly string[], io: CliIo): number {
  const dir = join(io.cwd, GOLDEN_REPLAY_DIR);
  const paths =
    files.length > 0
      ? files.map((file) => join(io.cwd, file))
      : (existsSync(dir) ? readdirSync(dir) : [])
          .filter((file) => file.endsWith('.json'))
          .sort()
          .map((file) => join(dir, file));
  let failed = 0;
  for (const path of paths) {
    const name = relative(io.cwd, path);
    try {
      const before = readReplay(path);
      const after = reblessReplay(before, scenarioOf(before, io.scenarios), {
        buildSha: io.buildSha(),
        contentHash: io.contentHash(),
      });
      const change = changes(before, after);
      if (change === undefined) {
        io.log(`unchanged ${name}`);
      } else {
        writeReplay(path, after);
        io.log(`reblessed ${name}: ${change}`);
      }
    } catch (error) {
      failed++;
      io.error(`${name}: ${(error as Error).message}`);
    }
  }
  if (paths.length === 0) io.log(`no replays in ${GOLDEN_REPLAY_DIR}`);
  return failed > 0 ? 1 : 0;
}

/** Runs `record …` or `rebless …`; returns the process exit code. */
export function main(args: readonly string[], io: CliIo = defaultIo(process.cwd())): number {
  const [command, ...rest] = args;
  try {
    if (command === 'record') return record(rest, io);
    if (command === 'rebless') return rebless(rest, io);
    if (command === undefined || command === '--help' || command === '-h') {
      io.log(USAGE);
      return command === undefined ? 2 : 0;
    }
    throw new UsageError(`unknown command "${command}"`);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    io.error(`${error.message}\n\n${USAGE}`);
    return 2;
  }
}
