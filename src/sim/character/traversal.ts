// Traversal extension points (mw-e02.2). Climbing (mw-e10.9), mantling and ledge grabs (mw-e02.12) and
// swimming (mw-e02.14) take over the character from ordinary locomotion while they last. Each is a
// TraversalHook the controller consults every tick; none is implemented here.
//
// While no traversal mode is active, the controller asks each hook in order whether it wants the
// character (`shouldEnter`); the first that does runs this tick. While one is active, only that hook
// runs, until it returns a state whose `traversal` is null (back to locomotion) or another mode.

import type { Frozen, ControllerTuning } from '@content/index';
import type { CollisionWorld } from './collision-world';
import type { CharacterInput, CharacterState, ControllerParams } from './controller';

/** The traversal modes later features provide. */
export const TRAVERSAL_MODES = ['climb', 'mantle', 'swim'] as const;

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
}

/** A traversal mode that can take over the character from locomotion. */
export interface TraversalHook {
  readonly mode: TraversalMode;
  /** Whether to take over this tick (only asked while no traversal mode is active). */
  shouldEnter(ctx: TraversalContext): boolean;
  /**
   * Simulates one tick in this mode and returns the character's next state. Keep `traversal` equal
   * to `mode` to stay in control; set it to null to hand back to locomotion.
   */
  step(ctx: TraversalContext): CharacterState;
}
