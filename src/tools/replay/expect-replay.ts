// Vitest helper (mw-e00.17): `expectReplay('tests/replays/foo.json')` plays a replay file against its
// registered scenario and the current content, and fails with a readable report — the checkpoint
// tick, the first differing entity/component/field, and whether content changed — when it doesn't
// reproduce. It throws a plain error rather than importing vitest, so it works in any runner.

import { describeOutcome, playReplay, type ReplayOutcome } from '@sim/index';
import { currentContentHash, readReplay, scenarioOf, type ScenarioRegistry } from './files';

export interface ExpectReplayOptions {
  /** Defaults to the registered scenarios. */
  readonly scenarios?: ScenarioRegistry;
  /** Defaults to the hash of the game content as loaded now. */
  readonly contentHash?: string;
}

/** A replay that did not reproduce; the message is the full report. */
export class ReplayAssertionError extends Error {
  override readonly name = 'ReplayAssertionError';

  constructor(
    readonly outcome: Exclude<ReplayOutcome, { status: 'passed' }>,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Asserts that the replay at `path` reproduces every recorded checkpoint hash.
 * @returns the passing outcome (final hash, checkpoints verified, whether content changed).
 * @throws ReplayAssertionError describing the first divergence.
 */
export function expectReplay(
  path: string,
  options: ExpectReplayOptions = {},
): Extract<ReplayOutcome, { status: 'passed' }> {
  const replay = readReplay(path);
  const outcome = playReplay(replay, scenarioOf(replay, options.scenarios), {
    contentHash: options.contentHash ?? currentContentHash(),
  });
  if (outcome.status !== 'passed') {
    throw new ReplayAssertionError(outcome, describeOutcome(path, outcome));
  }
  return outcome;
}
