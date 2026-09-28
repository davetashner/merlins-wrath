// A replay scenario (mw-e00.17): the code half of a replay. A replay file holds data (seed, commands,
// hashes); the scenario it names builds the world those commands drive — components, systems,
// handlers and starting entities — and validates the commands read back from JSON. Scenarios are
// registered by name in ./scenarios so goldens, the vitest helper and pnpm replay:* resolve them.

import type { z } from 'zod';
import type { World } from '../core/world';
import type { Rng } from '../rng';

/** What a scenario's headless input script sees on each tick while recording. */
export interface DriveContext<TInput> {
  /** The tick about to be simulated. */
  readonly tick: number;
  /** Read it, never change it: the recorder steps the world. */
  readonly world: World<TInput>;
  /** The driver's own stream (derived from the replay seed, separate from the world's streams). */
  readonly rng: Rng;
}

export interface ReplayScenario<TInput> {
  /** Unique registry key; stored in every replay recorded from this scenario. */
  readonly name: string;
  /** Whether outcomes depend on game content (then replays record and check the content hash). */
  readonly usesContent: boolean;
  /** Validates one command read back from a replay file. */
  readonly command: z.ZodType<TInput>;
  /** Builds a fresh world at tick 0 for this seed and tick rate. */
  create(options: { readonly seed: number; readonly hz: number }): World<TInput>;
  /** Headless input script used by pnpm replay:record: the commands for one tick. */
  drive(ctx: DriveContext<TInput>): readonly TInput[];
}
