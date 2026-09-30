// The facing rule (mw-e04.6): how a fighter's body turns around its moves. Commitment is what makes a
// swing weighty, so a fighter turns freely only while idle; once a move starts it may still track its
// target during startup, at most ATTACK_TURN_DEGREES_PER_SECOND (360°/s: 6° a tick at 60 Hz), and from
// its first active tick to its last recovery tick its facing is locked. The hitbox opens facing
// where startup left it.
//
// Where a fighter wants to face comes from a FacingRule: the player's is the lock-on target when it
// has one (`faceTarget`, fed by lock-on, e02.16) and otherwise its look direction; an AI's is its
// target. A rule that has no answer leaves the facing as it is. Turning uses the sim's deterministic
// trig (src/sim/math), so replays turn identically everywhere.

import type { MoveTable } from '@content/index';
import type { EntityId } from '../../core/component';
import type { System, World } from '../../core/world';
import { atan2, cos, sin } from '../../math';
import { PlacementComponent } from '../../stimulus/placement';
import type { Vec3 } from '../../stimulus/shapes';
import { horizontalAim } from '../attacks/frame';
import { actionOf, phaseAt } from '../timeline/timeline';
import { CombatFacingComponent } from './components';

/** The fastest a fighter turns during a move's startup (mw-e04.6): 360°/s. */
export const ATTACK_TURN_DEGREES_PER_SECOND = 360;

/** Where `entity` wants to face this tick (any horizontal direction), or undefined for no change. */
export type FacingRule = (world: World<never>, entity: EntityId) => Vec3 | undefined;

/** The rule that never turns anyone. */
export const keepFacing: FacingRule = () => undefined;

/** Where an entity is (its feet or origin), or undefined when it cannot be located. */
export type EntityLocator = (world: World<never>, entity: EntityId) => Vec3 | undefined;

/** The default target locator: the entity's placement. */
const placementOf: EntityLocator = (world, entity) => world.get(entity, PlacementComponent);

/**
 * Faces the entity `target` names (lock-on, an AI's quarry): the horizontal direction from the
 * fighter's placement to where `locate` puts the target (its placement by default; lock-on passes
 * its own locator, so a target with only a scene transform is faced too). No answer without a
 * target, without a position for either, or when the two stand on the same spot.
 */
export function faceTarget(
  target: (world: World<never>, entity: EntityId) => EntityId | undefined,
  locate: EntityLocator = placementOf,
): FacingRule {
  return (world, entity) => {
    const other = target(world, entity);
    if (other === undefined) return undefined;
    const from = world.get(entity, PlacementComponent);
    const to = locate(world, other);
    if (from === undefined || to === undefined) return undefined;
    const x = to.x - from.x;
    const z = to.z - from.z;
    return x === 0 && z === 0 ? undefined : { x, y: 0, z };
  };
}

/** The first rule of `rules` with an answer (e.g. lock-on first, then the look direction). */
export function firstFacing(...rules: readonly FacingRule[]): FacingRule {
  return (world, entity) => {
    for (const rule of rules) {
      const facing = rule(world, entity);
      if (facing !== undefined) return facing;
    }
    return undefined;
  };
}

/**
 * Unit horizontal `from` turned toward `to` by at most `maxRadians` (both unit horizontal). Turning
 * the short way; exactly `to` once within reach.
 */
export function turnToward(from: Vec3, to: Vec3, maxRadians: number): Vec3 {
  const angle = atan2(from.z * to.x - from.x * to.z, from.x * to.x + from.z * to.z);
  if (Math.abs(angle) <= maxRadians) return to;
  const step = Math.sign(angle) * maxRadians;
  const c = cos(step);
  const s = sin(step);
  return horizontalAim({ x: from.x * c + from.z * s, y: 0, z: from.z * c - from.x * s });
}

/** What the facing system needs. */
export interface FacingOptions {
  /** Every move the fighters may perform (to know which phase a move is in). */
  readonly moves: MoveTable;
  /** Where each fighter wants to face. */
  readonly desired: FacingRule;
  /** The startup turn rate, degrees per second; defaults to ATTACK_TURN_DEGREES_PER_SECOND. */
  readonly turnDegreesPerSecond?: number;
}

/**
 * Turns every fighter with a facing (see the file header). Run it after the action timeline, so a
 * move that started this tick is already in startup. Fighters without an action timeline turn freely.
 */
export function facingSystem<TInput>(options: FacingOptions): System<TInput> {
  const { moves, desired } = options;
  const degrees = options.turnDegreesPerSecond ?? ATTACK_TURN_DEGREES_PER_SECOND;
  if (!(Number.isFinite(degrees) && degrees >= 0)) {
    throw new RangeError(`turn rate must be a finite number ≥ 0, got ${String(degrees)}`);
  }
  return {
    name: 'combat-facing',
    run: ({ world, clock }) => {
      const w: World<never> = world;
      const maxRadians = (degrees * Math.PI) / 180 / clock.hz;
      w.query(CombatFacingComponent).forEach((entity, { facing }) => {
        const want = desired(w, entity);
        if (want === undefined) return;
        const target = horizontalAim(want);
        const action = actionOf(w, entity);
        let next = target;
        if (action !== undefined) {
          const move = moves.get(action.move);
          if (move === undefined) throw new Error(`move "${action.move}" is not in the move table`);
          if (phaseAt(move, action.tick) !== 'startup') return;
          next = turnToward(facing, target, maxRadians);
        }
        if (next.x !== facing.x || next.z !== facing.z) {
          w.set(entity, CombatFacingComponent, Object.freeze({ facing: next }));
        }
      });
    },
  };
}
