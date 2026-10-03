// A creature's condition (mw-e12.14): the runtime state of a creature that is neither its body nor
// its brain, which a save must carry for failure to have consequences (a knocked-out patrol stays
// down across a reload). Plain frozen data in `creature.condition`, given to every spawned creature.
//
// - `morale`, 0–100, starts full. Fears and morale (mw-e12.10) lower and restore it.
// - `unconsciousUntil`: the tick a knocked-out creature wakes, -1 when it was never knocked out. It
//   is unconscious while the world's tick is before it, so the wake timer is the clock itself: a save
//   (which carries the clock) keeps exactly the time it has left. Takedowns (mw-e10.4) knock out;
//   what an unconscious creature can do (nothing) is theirs to enforce.
//
// Dead and befriended are not conditions: dead is health 0 (`combat.health`), befriended is faction
// disposition (`faction.member`); both are saved with the world and kept per level (`actor.life`,
// `actor.disposition`).

import { defineComponent, type EntityId } from '../core/component';
import type { World } from '../core/world';

/** A creature's condition (see the file header). */
export interface CreatureCondition {
  /** 0–100; 100 is unshaken. */
  readonly morale: number;
  /** The tick it wakes while knocked out; -1 = never knocked out. */
  readonly unconsciousUntil: number;
}

/** Full morale: what every creature starts with. */
export const FULL_MORALE = 100;

/** A creature's condition as spawned: full morale, awake. */
export const FRESH_CONDITION: CreatureCondition = Object.freeze({
  morale: FULL_MORALE,
  unconsciousUntil: -1,
});

/** The condition component (`creature.condition`; a snapshot and save key, never renamed). */
export const CreatureConditionComponent = defineComponent<CreatureCondition>('creature.condition');

/** `entity`'s condition, or undefined when it has none (not a creature, or not registered). */
export function conditionOf(world: World<never>, entity: EntityId): CreatureCondition | undefined {
  return world.isRegistered(CreatureConditionComponent)
    ? world.get(entity, CreatureConditionComponent)
    : undefined;
}

/** Whether `entity` is knocked out now. */
export function isUnconscious(world: World<never>, entity: EntityId): boolean {
  return wakeTicksLeft(world, entity) > 0;
}

/** Ticks until `entity` wakes; 0 when it is awake (or has no condition). */
export function wakeTicksLeft(world: World<never>, entity: EntityId): number {
  const until = conditionOf(world, entity)?.unconsciousUntil ?? -1;
  return Math.max(0, until - world.tick);
}

/**
 * Knocks `entity` out for `seconds` from now (rounded to ticks); a creature already out stays out
 * for whichever lasts longer. Returns false when it has no condition (not a creature).
 * @throws RangeError for seconds that are not a positive finite number.
 */
export function knockOut(world: World<never>, entity: EntityId, seconds: number): boolean {
  if (!(seconds > 0 && Number.isFinite(seconds))) {
    throw new RangeError(`knock-out seconds must be positive and finite, got ${String(seconds)}`);
  }
  const condition = conditionOf(world, entity);
  if (condition === undefined) return false;
  const until = world.tick + Math.max(1, Math.round(seconds * world.clock.hz));
  world.set(
    entity,
    CreatureConditionComponent,
    Object.freeze({
      ...condition,
      unconsciousUntil: Math.max(condition.unconsciousUntil, until),
    }),
  );
  return true;
}
