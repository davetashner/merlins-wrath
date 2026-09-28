// Replay files on disk (mw-e00.17): reading/writing the JSON format, resolving the scenario a file
// names, and the current content hash replays are checked against. Shared by the vitest helper and
// the pnpm replay:* CLI, which are the only places replays touch the file system.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { loadGameContent } from '@content/game-content';
import {
  parseReplay,
  replayScenarios,
  serializeReplay,
  type Replay,
  type ReplayScenario,
} from '@sim/index';

/** Where golden replays live, relative to the repo root; every file here runs in CI. */
export const GOLDEN_REPLAY_DIR = 'tests/replays';

/** Scenario registry lookups, injectable for tests. */
export type ScenarioRegistry = Readonly<Record<string, ReplayScenario<unknown>>>;

/**
 * Reads and validates a replay file.
 * @throws Error naming the file for unreadable JSON; the format's typed errors otherwise.
 */
export function readReplay(path: string): Replay {
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`${path}: cannot read replay JSON (${(error as Error).message})`, {
      cause: error,
    });
  }
  return parseReplay(data);
}

/** Writes a replay in its stable, review-friendly layout (creating its folder if needed). */
export function writeReplay(path: string, replay: Replay): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, serializeReplay(replay));
}

/** The registered scenario a replay names. */
export function scenarioOf(
  replay: Replay,
  scenarios: ScenarioRegistry = replayScenarios,
): ReplayScenario<unknown> {
  const scenario = scenarios[replay.scenario];
  if (scenario === undefined) {
    const known = Object.keys(scenarios).join(', ');
    throw new Error(`unknown replay scenario "${replay.scenario}" (registered: ${known})`);
  }
  return scenario;
}

/** The fingerprint of the game content as it is now (see src/content/hash.ts). */
export function currentContentHash(): string {
  return loadGameContent().hash;
}
