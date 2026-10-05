// Traversal extension points (mw-e02.2). Climbing (mw-e02.13), mantling and ledge hangs (mw-e02.12,
// src/sim/climb/mantle.ts) and swimming (mw-e02.14) take over the character from ordinary
// locomotion while they last. Each is a TraversalHook the controller consults every tick.
//
// While no traversal mode is active, the controller asks each hook in order whether it wants the
// character (`shouldEnter`); the first that does runs this tick. While one is active, only the hook
// owning that mode runs, until it returns a state whose `traversal` is null (back to locomotion) or
// another mode. A hook may own several modes (mantling hands over to hanging and back).

import type { Frozen, ControllerTuning } from '@content/index';
import type { EntityId } from '../core/component';
import type { Vec3 } from '../stimulus/shapes';
import type { CollisionWorld } from './collision-world';
import type { CharacterInput, CharacterState, ControllerParams } from './controller';

/** The traversal modes later features provide. */
export const TRAVERSAL_MODES = ['climb', 'mantle', 'hang', 'swim'] as const;

/** A traversal mode name. */
export type TraversalMode = (typeof TRAVERSAL_MODES)[number];

/** What a traversal hook sees on a tick. */
export interface TraversalContext {
  /** The character before this tick. */
  readonly state: CharacterState;
  readonly input: CharacterInput;
  readonly world: CollisionWorld;
  readonly tuning: Frozen<ControllerTuning>;
  readonly params: ControllerParams;
  /** The character's entity, when the controller runs inside a sim world (capabilities, class). */
  readonly entity?: EntityId;
}

/**
 * A sim-driven move along a path (mantle curves, lowering to a hang): the path's corners, the tick
 * reached and the move's length in ticks. Not root motion: the sim places the character each tick.
 */
export interface TraversalPath {
  readonly points: readonly Vec3[];
  readonly tick: number;
  readonly ticks: number;
  /** What the character does at the end: stands, crouches (low headroom) or hangs. */
  readonly then: 'stand' | 'crouch' | 'hang';
}

/** The ledge a mantling or hanging character is on (mw-e02.12): plain data, snapshotted and hashed. */
export interface LedgeTraversal {
  /** The ledge (its id in the scene's LedgeIndex). */
  readonly ledge: number;
  /** The move in progress; absent while hanging still or shimmying. */
  readonly path?: TraversalPath;
  /** Ticks the held ledge has been impossible to hold (frozen, burning); 0 when it holds. */
  readonly slipping: number;
}

/**
 * The surface a climbing character holds (mw-e02.13): plain data, snapshotted and hashed. Ropes and
 * walls alike: `normal` points from the surface (or the rope's line) out to the climber, who faces
 * against it.
 */
export interface ClimbTraversal {
  /** The climbable entity held (a piece bound to the wall's collider, or a rope). */
  readonly surface: EntityId;
  /** Unit horizontal normal out of the surface towards the climber. */
  readonly normal: Vec3;
  /** Ticks the surface has been impossible to hold (frozen, burning); 0 when it holds. */
  readonly slipping: number;
}

/**
 * The water a swimming or sinking character is in (mw-e02.14): plain data, snapshotted and hashed.
 * Wading is ordinary locomotion at a lower speed and carries none of this.
 */
export interface SwimTraversal {
  /** World height of the water's surface, m. */
  readonly surface: number;
  /**
   * The armor load drags the character to the bottom (heavy, overloaded): it walks the bottom at a
   * crawl and cannot swim up. False for a swimmer floating or diving.
   */
  readonly sinking: boolean;
  /** A swimmer is diving (crouch held): under the surface, holding its breath. */
  readonly diving: boolean;
}

/** A traversal mode that can take over the character from locomotion. */
export interface TraversalHook {
  /** The modes this hook runs; it is asked to step whenever the character is in one of them. */
  readonly modes: readonly TraversalMode[];
  /** Whether to take over this tick (only asked while no traversal mode is active). */
  shouldEnter(ctx: TraversalContext): boolean;
  /**
   * Simulates one tick in this mode and returns the character's next state. Keep `traversal` equal
   * to `mode` to stay in control; set it to null to hand back to locomotion.
   */
  step(ctx: TraversalContext): CharacterState;
}
