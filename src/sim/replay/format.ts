// Replay file format (mw-e00.17). A replay is the sim commands fed to `World.step` on every tick of a
// session plus state hashes taken along the way, so re-running the commands through the same build
// must reproduce every hash: backlog contract §3's determinism net. It is plain JSON so goldens can
// be committed, diffed in review and (later) shipped inside bug reports.
//
// Commands are recorded after input mapping (sim commands, not DOM events), so replays survive key
// remapping. Consecutive ticks with identical command lists are run-length encoded: [count, commands].
// Each checkpoint stores the state hash and, optionally, the full snapshot so a mismatch can name the
// first differing entity and field. Stored snapshots go through JSON, so -0, NaN and ±Infinity in
// component data come back as 0/null: fine for diagnosis (the hash is the source of truth), but a
// diff can then point at such a value before the real difference.
//
// Versioning: `formatVersion` covers this layout; `snapshotEncoding` pins the hash encoding
// (SNAPSHOT_ENCODING_VERSION). A newer format is refused with UnsupportedReplayVersionError; an
// older hash encoding makes the replay invalid until it is re-blessed.

import { z } from 'zod';
import type { WorldSnapshot } from '../core/world';
import { SNAPSHOT_ENCODING_VERSION } from '../snapshot';

/** The replay layout this build reads and writes. */
export const REPLAY_FORMAT_VERSION = 1;

/** Default ticks between checkpoints: one per second at 60 Hz. */
export const DEFAULT_CHECKPOINT_INTERVAL = 60;

/** Plain JSON data: what a recorded command may contain. */
export type JsonValue =
  null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };

/** Thrown when a replay was written by a newer build than this one understands. */
export class UnsupportedReplayVersionError extends Error {
  override readonly name = 'UnsupportedReplayVersion';

  constructor(
    /** The replay's formatVersion. */
    readonly version: number,
    /** The newest formatVersion this build reads. */
    readonly supported: number = REPLAY_FORMAT_VERSION,
  ) {
    super(
      `replay formatVersion ${String(version)} is newer than supported (${String(supported)}); ` +
        'update the build to play it',
    );
  }
}

/** Thrown for a replay (or its commands) that does not match the format. */
export class InvalidReplayError extends Error {
  override readonly name = 'InvalidReplayError';

  constructor(
    /** One human-readable line per problem, each prefixed with its location. */
    readonly issues: readonly string[],
  ) {
    super(`invalid replay:\n  ${issues.join('\n  ')}`);
  }
}

const count = z.number().int().nonnegative();
const hash = z.string().regex(/^[0-9a-f]{8}$/, 'expected an 8-digit lowercase hex state hash');

const snapshotSchema = z.object({
  seed: z.number(),
  clock: z.object({ tick: count, hz: count }),
  nextEntity: count,
  entities: z.array(count),
  components: z.record(z.string(), z.array(z.tuple([count, z.json()]))),
  rng: z.record(z.string(), z.object({ seed: z.number(), state: z.array(z.number()) })),
  physics: z.object({ engine: z.string(), data: z.json() }).exactOptional(),
});

const checkpointSchema = z.object({
  tick: count,
  hash,
  state: snapshotSchema.optional(),
});

const replaySchema = z
  .object({
    formatVersion: z.literal(REPLAY_FORMAT_VERSION),
    snapshotEncoding: z.literal(SNAPSHOT_ENCODING_VERSION, {
      error: `hashes use an older snapshot encoding; re-bless (encoding is now ${String(SNAPSHOT_ENCODING_VERSION)})`,
    }),
    /** Which registered scenario builds the world (see ReplayScenario). */
    scenario: z.string().min(1),
    /** The build that recorded it (git SHA); informational. */
    buildSha: z.string(),
    /** Content fingerprint at record time, or null for scenarios that use no content. */
    contentHash: z.string().nullable(),
    seed: z.number().int().min(0).max(0xffff_ffff),
    stepHz: z.number().int().min(1).max(1000),
    /** Total ticks simulated. */
    ticks: count,
    checkpointInterval: z.number().int().positive(),
    /** Run-length encoded per-tick commands: [ticks in the run, that tick's commands]. */
    inputs: z.array(z.tuple([z.number().int().positive(), z.array(z.json())])),
    /** Ascending by tick; the last one is at `ticks`. */
    checkpoints: z.array(checkpointSchema).min(1),
    /** State hash after the last tick (equal to the last checkpoint's). */
    finalHash: hash,
  })
  .superRefine((replay, ctx) => {
    const total = replay.inputs.reduce((sum, [n]) => sum + n, 0);
    if (total !== replay.ticks) {
      ctx.addIssue({
        code: 'custom',
        path: ['inputs'],
        message: `runs cover ${String(total)} ticks but ticks is ${String(replay.ticks)}`,
      });
    }
    let previous = -1;
    replay.checkpoints.forEach(({ tick }, i) => {
      if (tick <= previous || tick > replay.ticks) {
        ctx.addIssue({
          code: 'custom',
          path: ['checkpoints', i, 'tick'],
          message: `checkpoint ticks must ascend within [0, ${String(replay.ticks)}]`,
        });
      }
      previous = tick;
    });
    const last = replay.checkpoints.at(-1);
    if (last?.tick !== replay.ticks || last.hash !== replay.finalHash) {
      ctx.addIssue({
        code: 'custom',
        path: ['finalHash'],
        message: 'the last checkpoint must be at the final tick with hash finalHash',
      });
    }
  });

/** One state checkpoint: the hash after `tick` ticks and, optionally, the full snapshot. */
export interface ReplayCheckpoint {
  readonly tick: number;
  /** hashWorld() after `tick` ticks. */
  readonly hash: string;
  /** The world snapshot at this tick (for diffing a mismatch); absent when states were not kept. */
  readonly state?: WorldSnapshot | undefined;
}

/** [ticks in the run, the commands given on each of those ticks]. */
export type InputRun = readonly [count: number, commands: readonly JsonValue[]];

/** A validated replay (see the field docs on the schema above). Commands stay plain JSON until a
 * scenario validates them. */
export interface Replay {
  readonly formatVersion: typeof REPLAY_FORMAT_VERSION;
  readonly snapshotEncoding: typeof SNAPSHOT_ENCODING_VERSION;
  readonly scenario: string;
  readonly buildSha: string;
  readonly contentHash: string | null;
  readonly seed: number;
  readonly stepHz: number;
  readonly ticks: number;
  readonly checkpointInterval: number;
  readonly inputs: readonly InputRun[];
  readonly checkpoints: readonly ReplayCheckpoint[];
  readonly finalHash: string;
}

/** `a.b[2].c: message` for a zod issue. */
export function describeIssue(issue: z.core.$ZodIssue): string {
  const path = issue.path.map((key) =>
    typeof key === 'number' ? `[${String(key)}]` : `.${String(key)}`,
  );
  return `$${path.join('')}: ${issue.message}`;
}

/**
 * Validates parsed JSON as a replay.
 * @throws UnsupportedReplayVersionError when `formatVersion` is newer than REPLAY_FORMAT_VERSION.
 * @throws InvalidReplayError listing every problem otherwise.
 */
export function parseReplay(data: unknown): Replay {
  if (typeof data === 'object' && data !== null && 'formatVersion' in data) {
    const { formatVersion } = data;
    if (typeof formatVersion === 'number' && formatVersion > REPLAY_FORMAT_VERSION) {
      throw new UnsupportedReplayVersionError(formatVersion);
    }
  }
  const result = replaySchema.safeParse(data);
  if (!result.success) throw new InvalidReplayError(result.error.issues.map(describeIssue));
  return result.data;
}

/**
 * The replay as JSON text with a stable, review-friendly layout: one field per line and one input
 * run or checkpoint per line, so a re-bless diff shows exactly which checkpoints changed.
 */
export function serializeReplay(replay: Replay): string {
  const fields = Object.entries(replay).map(([key, value]) => {
    const text =
      Array.isArray(value) && value.length > 0
        ? `[\n${value.map((item) => `    ${JSON.stringify(item)}`).join(',\n')}\n  ]`
        : JSON.stringify(value);
    return `  ${JSON.stringify(key)}: ${text}`;
  });
  return `{\n${fields.join(',\n')}\n}\n`;
}
