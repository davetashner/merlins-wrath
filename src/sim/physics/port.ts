// The sim-owned physics port (ADR-0001, mw-e03.35). Physics runs inside the sim: the World owns one
// port, steps it once per fixed tick before any system runs, and carries its state in snapshots, so
// state hashes, replays and save/restore cover physics like every other piece of sim state.
//
// The port is deliberately small so a deterministic reference implementation (plain TypeScript, no
// WASM) could stand in for Rapier in pure unit tests later (mw-e03.10): static and moving colliders
// in, fixed steps, and opaque plain-data state out and back in. Queries are not part of it: the
// character controller asks through CollisionWorld (src/sim/character/collision-world.ts), which
// each engine implements on top of its own port.

import type { StaticColliderSink } from './static-colliders';

/**
 * A physics engine's whole state as plain, canonically encodable data (numbers, strings, arrays,
 * plain objects), so it can go into a WorldSnapshot, a state hash, a replay checkpoint or a save.
 */
export interface PhysicsState {
  /** Which engine (and version) wrote `data`; restoring it into a different one is refused. */
  readonly engine: string;
  /** Engine-specific state; only the engine that wrote it can read it. */
  readonly data: unknown;
}

/** Thrown when physics state cannot be restored (wrong engine, malformed data). */
export class PhysicsStateError extends Error {
  override readonly name = 'PhysicsStateError';
}

/**
 * The physics the sim owns. `add` also accepts a greybox shape with a `velocity`: a kinematic
 * collider that moves at that constant velocity as the port steps (a moving platform).
 */
export interface PhysicsPort extends StaticColliderSink {
  /**
   * Advances the simulation by `dt` seconds. The World calls it once per tick with 1 / hz before its
   * systems run. `step(0)` advances nothing but brings scene queries up to date with colliders added
   * or removed since the last step (outside the World, e.g. in tests).
   */
  step(dt: number): void;
  /** The current state as plain data (detached: later steps do not change it). */
  snapshot(): PhysicsState;
  /**
   * Replaces the whole state with one from `snapshot()`; handles issued before stay valid only if
   * the state has them.
   * @throws PhysicsStateError when `state` was written by another engine or is malformed.
   */
  restore(state: PhysicsState): void;
}
