// The combat layer's attack queries for AI (mw-e04.20): what a creature's brain (e11) asks before it
// commits to a swing — may it use this attack now and why not, how far it reaches, what is still on
// cooldown, is the target in range, which of its attacks are usable. All pure reads of sim state, so
// the same world always gives the same answers. Choosing among the usable attacks (weights, spacing)
// stays AI's job; starting one is `startAttack`.

import type { ReachClass, RuntimeAttack } from '@content/index';
import type { EntityId } from '../../core/component';
import type { World } from '../../core/world';
import { PlacementComponent } from '../../stimulus/placement';
import { AttackerComponent } from './components';
import {
  canStartAttack,
  type AttackCheck,
  type AttackContext,
  type AttackLookup,
} from './executor';

/** The distance band an attack is used from, and its move's coarse reach class. */
export interface AttackRange {
  /** Closest distance to the target, metres (centre to centre). */
  readonly min: number;
  /** Farthest distance to the target, metres. */
  readonly max: number;
  /** The move's reach bucket for spacing (close, short, medium, long). */
  readonly reach: ReachClass;
}

/** The range `attack` is used from (`rangeFor(move)` in the bead's words). */
export function rangeFor(attack: RuntimeAttack): AttackRange {
  return { min: attack.rangeMin, max: attack.rangeMax, reach: attack.hitbox.reach };
}

/**
 * Whether `entity` may use `attack` now, and if not why (busy, cooldown, too-close, too-far,
 * target-stance, health): `canStartAttack`. Without a `distance` in `context` the range and
 * target-stance checks are skipped, so AI can ask "is it ready?" before closing in. Throws when
 * `entity` is not an attacker.
 */
export function canUseMove(
  world: World<never>,
  entity: EntityId,
  attack: RuntimeAttack,
  context: Partial<AttackContext> = {},
): AttackCheck {
  return canStartAttack(world, entity, attack, context);
}

/** Ticks until `entity` may start `attack` again (0 when ready, or when it is no attacker). */
export function cooldownLeft(world: World<never>, entity: EntityId, attack: RuntimeAttack): number {
  const readyAt = world.get(entity, AttackerComponent)?.readyAt[attack.id] ?? 0;
  return Math.max(0, readyAt - world.tick);
}

/** Every attack of `entity` still cooling down, attack id → ticks left (empty when none). */
export function cooldowns(world: World<never>, entity: EntityId): Readonly<Record<string, number>> {
  const readyAt = world.get(entity, AttackerComponent)?.readyAt ?? {};
  const out: Record<string, number> = {};
  for (const [id, at] of Object.entries(readyAt).sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (at > world.tick) out[id] = at - world.tick;
  }
  return out;
}

/** Distance between two entities' placements (centre to centre, metres), or undefined unplaced. */
export function distanceBetween(
  world: World<never>,
  from: EntityId,
  to: EntityId,
): number | undefined {
  const a = world.get(from, PlacementComponent);
  const b = world.get(to, PlacementComponent);
  if (a === undefined || b === undefined) return undefined;
  const x = b.x - a.x;
  const y = b.y - a.y;
  const z = b.z - a.z;
  return Math.sqrt(x * x + y * y + z * z);
}

/** Whether `target` stands inside `attack`'s range of `entity` (false when either is unplaced). */
export function inRange(
  world: World<never>,
  entity: EntityId,
  target: EntityId,
  attack: RuntimeAttack,
): boolean {
  const distance = distanceBetween(world, entity, target);
  return distance !== undefined && distance >= attack.rangeMin && distance <= attack.rangeMax;
}

/**
 * The attacks `entity` may start now against a target described by `context` (see `canUseMove`):
 * those it knows (its creature's list; every attack in `attacks` when it has none), in that order.
 * Attacks missing from `attacks` are skipped. Throws when `entity` is not an attacker.
 */
export function usableAttacks(
  world: World<never>,
  entity: EntityId,
  attacks: AttackLookup,
  context: Partial<AttackContext> = {},
): RuntimeAttack[] {
  const known = world.get(entity, AttackerComponent)?.attacks ?? [...attacks.keys()];
  const out: RuntimeAttack[] = [];
  for (const id of known) {
    const attack = attacks.get(id);
    if (attack !== undefined && canUseMove(world, entity, attack, context).ok) out.push(attack);
  }
  return out;
}
