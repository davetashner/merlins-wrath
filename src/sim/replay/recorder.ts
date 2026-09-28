// Replay recording (mw-e00.17). ReplayRecorder sits in front of `World.step`: every command list it
// forwards is also captured (as a JSON copy, run-length encoded) and the state hash is taken every
// `checkpointInterval` ticks. Commands must survive a JSON round trip unchanged, so values JSON would
// silently alter (undefined, NaN, ±Infinity, -0, class instances) are rejected at record time rather
// than surfacing later as a baffling replay divergence.

import { DEFAULT_TICK_RATE_HZ } from '../clock';
import type { World } from '../core/world';
import { Rng } from '../rng';
import { hashWorld, SNAPSHOT_ENCODING_VERSION } from '../snapshot';
import {
  DEFAULT_CHECKPOINT_INTERVAL,
  REPLAY_FORMAT_VERSION,
  type InputRun,
  type JsonValue,
  type Replay,
  type ReplayCheckpoint,
} from './format';
import type { ReplayScenario } from './scenario';

/** Thrown when a session cannot be recorded faithfully. */
export class ReplayRecordError extends Error {
  override readonly name = 'ReplayRecordError';
}

export interface RecorderOptions {
  /** The registered scenario that built the world. */
  readonly scenario: string;
  /** The recording build's git SHA (informational). */
  readonly buildSha: string;
  /** Content fingerprint, or null when the scenario uses no content. */
  readonly contentHash: string | null;
  /** Ticks between checkpoints; defaults to DEFAULT_CHECKPOINT_INTERVAL. */
  readonly checkpointInterval?: number | undefined;
  /** Store full snapshots at checkpoints so mismatches can be diffed. Default true. */
  readonly keepStates?: boolean | undefined;
}

/** Where a non-JSON-safe value sits, or undefined when the value round-trips through JSON exactly. */
function unsafeJson(value: unknown, path: string): string | undefined {
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return undefined;
    case 'number':
      if (Object.is(value, -0)) return `${path} is -0`;
      return Number.isFinite(value) ? undefined : `${path} is ${String(value)}`;
    case 'object': {
      if (value === null) return undefined;
      if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) {
          const found = unsafeJson(value[i], `${path}[${String(i)}]`);
          if (found !== undefined) return found;
        }
        return undefined;
      }
      if (Object.getPrototypeOf(value) !== Object.prototype) return `${path} is not a plain object`;
      for (const [key, item] of Object.entries(value)) {
        const found = unsafeJson(item, `${path}.${key}`);
        if (found !== undefined) return found;
      }
      return undefined;
    }
    default:
      return `${path} is ${typeof value}`;
  }
}

/** Records the commands fed to a world, tick by tick, as a Replay. */
export class ReplayRecorder<TInput> {
  private readonly runs: [number, JsonValue[]][] = [];
  private lastText = '';
  private readonly checkpoints: ReplayCheckpoint[] = [];
  private latest: ReplayCheckpoint;
  private readonly interval: number;
  private readonly keepStates: boolean;

  /** @throws ReplayRecordError unless the world is at tick 0 (replays start from a fresh world). */
  constructor(
    private readonly world: World<TInput>,
    private readonly options: RecorderOptions,
  ) {
    if (world.tick !== 0) {
      throw new ReplayRecordError(
        `recording must start at tick 0, world is at ${String(world.tick)}`,
      );
    }
    this.interval = options.checkpointInterval ?? DEFAULT_CHECKPOINT_INTERVAL;
    if (!Number.isInteger(this.interval) || this.interval < 1) {
      throw new RangeError(
        `checkpointInterval must be a positive integer, got ${String(this.interval)}`,
      );
    }
    this.keepStates = options.keepStates ?? true;
    this.latest = this.checkpoint();
    this.checkpoints.push(this.latest);
  }

  /**
   * Records `inputs` for the current tick, then steps the world with them.
   * @throws ReplayRecordError when a command would not survive a JSON round trip.
   */
  step(inputs: readonly TInput[] = []): void {
    const problem = unsafeJson(inputs, `tick ${String(this.world.tick)} commands`);
    if (problem !== undefined) throw new ReplayRecordError(`cannot record ${problem}`);
    const text = JSON.stringify(inputs);
    const last = this.runs.at(-1);
    if (last !== undefined && text === this.lastText) {
      last[0]++;
    } else {
      this.runs.push([1, JSON.parse(text) as JsonValue[]]); // a JSON copy: later mutation can't leak in
      this.lastText = text;
    }
    this.world.step(inputs);
    if (this.world.tick % this.interval === 0) {
      this.latest = this.checkpoint();
      this.checkpoints.push(this.latest);
    }
  }

  /** The session so far as a replay; recording may continue afterwards. */
  finish(): Replay {
    const final = this.latest.tick === this.world.tick ? this.latest : this.checkpoint();
    const checkpoints =
      final === this.latest ? [...this.checkpoints] : [...this.checkpoints, final];
    const inputs: InputRun[] = this.runs.map(([n, commands]) => [n, [...commands]]);
    return {
      formatVersion: REPLAY_FORMAT_VERSION,
      snapshotEncoding: SNAPSHOT_ENCODING_VERSION,
      scenario: this.options.scenario,
      buildSha: this.options.buildSha,
      contentHash: this.options.contentHash,
      seed: this.world.seed,
      stepHz: this.world.clock.hz,
      ticks: this.world.tick,
      checkpointInterval: this.interval,
      inputs,
      checkpoints,
      finalHash: final.hash,
    };
  }

  private checkpoint(): ReplayCheckpoint {
    const tick = this.world.tick;
    const hash = hashWorld(this.world);
    return this.keepStates ? { tick, hash, state: this.world.snapshot() } : { tick, hash };
  }
}

export interface RecordScenarioOptions<TInput> {
  readonly seed: number;
  /** Tick rate; defaults to 60 Hz. */
  readonly hz?: number;
  /** How many ticks to simulate. */
  readonly ticks: number;
  readonly buildSha: string;
  /** The current content hash (stored only when the scenario uses content). */
  readonly contentHash: string;
  readonly checkpointInterval?: number | undefined;
  readonly keepStates?: boolean | undefined;
  /** Commands per tick; defaults to the scenario's own `drive` script. */
  readonly inputs?: (tick: number) => readonly TInput[];
}

/** Stream name the scenario driver draws from (its own root, so the world's streams are untouched). */
const DRIVER_STREAM = 'replay-driver';

/** Records `ticks` ticks of a scenario headlessly (pnpm replay:record, re-blessing, tests). */
export function recordScenario<TInput>(
  scenario: ReplayScenario<TInput>,
  options: RecordScenarioOptions<TInput>,
): Replay {
  const world = scenario.create({ seed: options.seed, hz: options.hz ?? DEFAULT_TICK_RATE_HZ });
  const recorder = new ReplayRecorder(world, {
    scenario: scenario.name,
    buildSha: options.buildSha,
    contentHash: scenario.usesContent ? options.contentHash : null,
    checkpointInterval: options.checkpointInterval,
    keepStates: options.keepStates,
  });
  const rng = Rng.create(options.seed).stream(DRIVER_STREAM);
  const script = options.inputs ?? ((tick: number) => scenario.drive({ tick, world, rng }));
  for (let tick = 0; tick < options.ticks; tick++) recorder.step(script(tick));
  return recorder.finish();
}
