// Replay playback (mw-e00.17). Re-runs a replay's commands through a freshly built scenario world and
// compares the state hash at every checkpoint. At the first mismatch it stops and, when the replay
// kept the recorded snapshot there, names the first differing entity/component/field with
// diffSnapshots. A replay recorded against different content that then diverges is reported as
// "content changed", not as a determinism failure: the fix for one is a re-bless, for the other a bug
// hunt.

import type { World } from '../core/world';
import { diffSnapshots, hashWorld, type SnapshotDifference } from '../snapshot';
import {
  describeIssue,
  InvalidReplayError,
  type InputRun,
  type Replay,
  type ReplayCheckpoint,
} from './format';
import { ReplayRecorder } from './recorder';
import type { ReplayScenario } from './scenario';

/** The first checkpoint whose replayed hash differs from the recorded one. */
export interface Divergence {
  readonly tick: number;
  readonly expectedHash: string;
  readonly actualHash: string;
  /** First differing field against the recorded snapshot; undefined when none was kept. */
  readonly difference: SnapshotDifference | undefined;
}

export type ReplayOutcome =
  | {
      readonly status: 'passed';
      readonly finalHash: string;
      /** Checkpoints verified. */
      readonly checkpoints: number;
      /** The content hash differs from the recorded one, yet every checkpoint matched. */
      readonly contentChanged: boolean;
    }
  | { readonly status: 'diverged'; readonly divergence: Divergence }
  | {
      readonly status: 'content-changed';
      readonly recordedContentHash: string;
      readonly currentContentHash: string;
      readonly divergence: Divergence;
    };

export interface PlayOptions {
  /** The current content hash; when given, a diverging replay recorded on other content says so. */
  readonly contentHash?: string | undefined;
}

/** Thrown when a replay cannot be played at all (wrong scenario, world not at tick 0). */
export class ReplayError extends Error {
  override readonly name = 'ReplayError';
}

/**
 * The replay's input runs with each command validated by the scenario.
 * @throws InvalidReplayError listing every command the scenario rejects.
 */
function scenarioRuns<TInput>(
  replay: Replay,
  scenario: ReplayScenario<TInput>,
): (readonly [number, readonly TInput[]])[] {
  if (replay.scenario !== scenario.name) {
    throw new ReplayError(`replay is for scenario "${replay.scenario}", not "${scenario.name}"`);
  }
  const issues: string[] = [];
  const runs = replay.inputs.map(([count, commands]: InputRun, run) => {
    const parsed: TInput[] = [];
    commands.forEach((command, i) => {
      const result = scenario.command.safeParse(command);
      if (result.success) parsed.push(result.data);
      else {
        for (const issue of result.error.issues) {
          issues.push(`inputs[${String(run)}][1][${String(i)}]${describeIssue(issue).slice(1)}`);
        }
      }
    });
    return [count, parsed] as const;
  });
  if (issues.length > 0) throw new InvalidReplayError(issues);
  return runs;
}

function freshWorld<TInput>(replay: Replay, scenario: ReplayScenario<TInput>): World<TInput> {
  const world = scenario.create({ seed: replay.seed, hz: replay.stepHz });
  if (world.tick !== 0) {
    throw new ReplayError(
      `scenario "${scenario.name}" built a world at tick ${String(world.tick)}, not 0`,
    );
  }
  return world;
}

/**
 * Plays a replay against its scenario, verifying every checkpoint hash.
 * @throws ReplayError / InvalidReplayError when the replay cannot be played against this scenario.
 */
export function playReplay<TInput>(
  replay: Replay,
  scenario: ReplayScenario<TInput>,
  options: PlayOptions = {},
): ReplayOutcome {
  const runs = scenarioRuns(replay, scenario);
  const world = freshWorld(replay, scenario);
  let next = 0;

  const verify = (): Divergence | undefined => {
    const checkpoint: ReplayCheckpoint | undefined = replay.checkpoints[next];
    if (checkpoint?.tick !== world.tick) return undefined;
    next++;
    const actualHash = hashWorld(world);
    if (actualHash === checkpoint.hash) return undefined;
    return {
      tick: checkpoint.tick,
      expectedHash: checkpoint.hash,
      actualHash,
      difference: checkpoint.state && diffSnapshots(checkpoint.state, world.snapshot()),
    };
  };

  const run = (): Divergence | undefined => {
    let divergence = verify();
    for (const [count, commands] of runs) {
      for (let i = 0; i < count && divergence === undefined; i++) {
        world.step(commands);
        divergence = verify();
      }
    }
    return divergence;
  };

  const divergence = run();
  const recorded = replay.contentHash;
  const current = options.contentHash;
  const contentChanged = recorded !== null && current !== undefined && recorded !== current;
  if (divergence === undefined) {
    return { status: 'passed', finalHash: hashWorld(world), checkpoints: next, contentChanged };
  }
  return contentChanged
    ? {
        status: 'content-changed',
        recordedContentHash: recorded,
        currentContentHash: current,
        divergence,
      }
    : { status: 'diverged', divergence };
}

export interface ReblessOptions {
  readonly buildSha: string;
  /** The current content hash (stored only when the scenario uses content). */
  readonly contentHash: string;
}

/**
 * Re-records a replay's exact commands on the current build: same seed, tick rate, checkpoint
 * interval and state keeping, fresh hashes. Used by pnpm replay:rebless after an intended change.
 */
export function reblessReplay<TInput>(
  replay: Replay,
  scenario: ReplayScenario<TInput>,
  options: ReblessOptions,
): Replay {
  const runs = scenarioRuns(replay, scenario);
  const recorder = new ReplayRecorder(freshWorld(replay, scenario), {
    scenario: scenario.name,
    buildSha: options.buildSha,
    contentHash: scenario.usesContent ? options.contentHash : null,
    checkpointInterval: replay.checkpointInterval,
    keepStates: replay.checkpoints.some((checkpoint) => checkpoint.state !== undefined),
  });
  for (const [count, commands] of runs) {
    for (let i = 0; i < count; i++) recorder.step(commands);
  }
  return recorder.finish();
}

/** A JS-literal-ish rendering of a snapshot value for failure messages. */
function show(value: unknown): string {
  if (value === undefined) return '(absent)';
  if (typeof value === 'number') return Object.is(value, -0) ? '-0' : String(value);
  return JSON.stringify(value);
}

function describeDivergence({ tick, expectedHash, actualHash, difference }: Divergence): string {
  const head = `diverged at checkpoint tick ${String(tick)}: state hash ${actualHash}, recorded ${expectedHash}`;
  if (difference === undefined)
    return `${head}\n  (no recorded state at this checkpoint to diff against)`;
  return (
    `${head}\n  first difference: ${difference.path}` +
    ` — replayed ${show(difference.b)}, recorded ${show(difference.a)}`
  );
}

const REBLESS_HINT = 'If this change is intended, run `pnpm replay:rebless` and review the diff.';

/** A human-readable report of an outcome, as printed by the vitest helper and the CLI. */
export function describeOutcome(label: string, outcome: ReplayOutcome): string {
  switch (outcome.status) {
    case 'passed':
      return `${label}: passed (${String(outcome.checkpoints)} checkpoints, final hash ${outcome.finalHash})`;
    case 'diverged':
      return `${label}: determinism failure — ${describeDivergence(outcome.divergence)}\n${REBLESS_HINT}`;
    case 'content-changed':
      return (
        `${label}: content changed since recording (content hash ${outcome.currentContentHash}, ` +
        `recorded ${outcome.recordedContentHash}) and the replay ${describeDivergence(outcome.divergence)}\n` +
        REBLESS_HINT
      );
  }
}
