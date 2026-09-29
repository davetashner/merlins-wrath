// Dodge state (mw-e04.8): which moves an entity's dodge button starts, the direction held at the
// latest press, and the root motion of the move it is performing. Plain frozen data, replaced never
// mutated, so snapshots, saves and replays carry an entity mid-roll.

import { defineComponent, type EntityId } from '../../core/component';
import type { World } from '../../core/world';
import type { Vec3 } from '../../stimulus/shapes';

/** The moves a dodge press starts. */
export interface DodgeMoves {
  /** With a direction held (the knight's `dodge-roll`). */
  readonly roll: string;
  /** With no direction held (the knight's `backstep`). */
  readonly backstep: string;
}

/** The root motion of the move in progress, committed when it started. */
export interface CommittedMotion {
  readonly move: string;
  /** World tick the move started on (tells a new roll from the one in progress). */
  readonly startedAt: number;
  /** Unit horizontal world direction it travels. */
  readonly direction: Vec3;
  /** The move tick motion was last steered for (so each move tick moves once). */
  readonly moveTick: number;
}

/** One entity's dodge. */
export interface Dodge extends DodgeMoves {
  /** Unit horizontal world direction held at the latest dodge press; null when none was held. */
  readonly requested: Vec3 | null;
  /** The running move's committed motion, or null when it has none. */
  readonly motion: CommittedMotion | null;
  /**
   * Root-motion velocity this tick, m/s (the controller travels at it): along the direction on the
   * move's active ticks, zero on its others; null when no move with motion is running.
   */
  readonly velocity: Vec3 | null;
}

/** The dodge component (`combat.dodge`; a snapshot and save key, never renamed). */
export const DodgeComponent = defineComponent<Dodge>('combat.dodge');

/**
 * Gives `entity` a dodge: a press of the dodge action starts `moves.roll` with a direction held and
 * `moves.backstep` without. The entity also needs an action timeline. Adding the component is
 * structural, so during a step it exists from the end of the tick.
 */
export function giveDodge(world: World<never>, entity: EntityId, moves: DodgeMoves): void {
  world.add(
    entity,
    DodgeComponent,
    Object.freeze({
      roll: moves.roll,
      backstep: moves.backstep,
      requested: null,
      motion: null,
      velocity: null,
    }),
  );
}

/** `entity`'s dodge, or undefined when it has none. */
export function dodgeOf(world: World<never>, entity: EntityId): Dodge | undefined {
  return world.get(entity, DodgeComponent);
}
