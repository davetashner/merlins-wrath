// pnpm save:fixture / pnpm save:check (mw-e30.3), run through scripts/save-fixture-cli.ts.
//
// save:fixture writes fixtures for the current save schema (a new revision when any version moved)
// and updates the lock; it refuses when a section schema changed without a version bump. save:check
// runs the same gate CI runs: the lock check, then every fixture loaded through the current
// migration chain.

import { createGameSaveRegistry } from '@game/save/sections';
import type { SaveRegistry } from '@game/save/format';
import {
  checkSaveFixtures,
  generateSaveFixtures,
  listFixtures,
  loadFixtureFile,
  LOCK_PATH,
} from './files';
import { FIXTURE_WORLDS, type FixtureWorld, type ScenarioRegistry } from './fixtures';
import { FIXTURE_SCENARIOS } from './scenarios';

export interface CliIo {
  /** Repo root: fixture paths resolve against it. */
  readonly cwd: string;
  log(line: string): void;
  error(line: string): void;
  registry(): SaveRegistry;
  readonly worlds: readonly FixtureWorld[];
  readonly scenarios: ScenarioRegistry;
}

export const defaultIo = (cwd: string): CliIo => ({
  cwd,
  log: (line) => {
    console.log(line);
  },
  error: (line) => {
    console.error(line);
  },
  registry: createGameSaveRegistry,
  worlds: FIXTURE_WORLDS,
  scenarios: FIXTURE_SCENARIOS,
});

export const USAGE = `Usage:
  pnpm save:fixture   Commit fixtures for the current save schema: a new revision under
                      tests/save-fixtures/<N>/ plus the updated ${LOCK_PATH}
                      whenever a save version changed.
  pnpm save:check     Run the CI gate: schema lock check, then load every fixture.`;

function check(io: CliIo): number {
  const registry = io.registry();
  const problems = checkSaveFixtures(io.cwd, registry);
  for (const problem of problems) io.error(problem.message);
  let failed = problems.length;
  let loaded = 0;
  for (const path of Object.values(listFixtures(io.cwd)).flat()) {
    try {
      loadFixtureFile(io.cwd, path, registry, io.scenarios);
      loaded++;
    } catch (error) {
      failed++;
      io.error((error as Error).message);
    }
  }
  if (failed > 0) return 1;
  io.log(`save schema lock OK; ${String(loaded)} fixtures load under the current build`);
  return 0;
}

function generate(io: CliIo): number {
  const outcome = generateSaveFixtures(io.cwd, io.registry(), io.worlds, io.scenarios);
  if (outcome.status === 'refused') {
    for (const problem of outcome.problems) io.error(problem.message);
    io.error('No fixtures written.');
    return 1;
  }
  if (outcome.status === 'up-to-date') {
    io.log(`save fixtures are up to date (revision ${String(outcome.revision)}); nothing written`);
    return 0;
  }
  for (const file of outcome.files) io.log(`wrote ${file}`);
  io.log(`revision ${String(outcome.revision)} recorded in ${LOCK_PATH}; commit both`);
  return check(io);
}

/** Runs `generate` or `check`; returns the process exit code. */
export function main(args: readonly string[], io: CliIo = defaultIo(process.cwd())): number {
  const [command, ...rest] = args;
  if (rest.length === 0 && command === 'generate') return generate(io);
  if (rest.length === 0 && command === 'check') return check(io);
  if (command === '--help' || command === '-h') {
    io.log(USAGE);
    return 0;
  }
  io.error(USAGE);
  return 2;
}
