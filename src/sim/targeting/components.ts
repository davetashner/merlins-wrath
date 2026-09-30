// Lock-on state in the sim (mw-e02.16): what can be locked on to (Targetable) and who is locked on
// to what (LockOn). Both are plain data, snapshotted and hashed every tick, so a replay reproduces
// every pick, cycle and break.

import type { Frozen, TargetableDef } from '@content/index';
import { defineComponent, type EntityId } from '../core/component';
import type { World } from '../core/world';
import type { Vec3 } from '../stimulus/shapes';

/**
 * Something the player can lock on to: a creature, a shootable mechanism, an interactable flagged
 * lockable. Its position comes from the lock-on system's locator (see TargetLocator).
 */
export interface Targetable {
  /** Lock points as offsets from the entity's origin, metres, world axes; the first is the main one. */
  readonly points: readonly Vec3[];
  /** Pick preference: each point takes `priorityWeight` off the pick score. */
  readonly priority: number;
}

export const TargetableComponent = defineComponent<Targetable>('targeting.targetable');

/** A locker's lock (the player's). */
export interface LockOn {
  /** The locked entity, or null when not locked on. */
  readonly target: EntityId | null;
  /** Consecutive ticks the locked target has been out of sight (0 while seen or unlocked). */
  readonly unseenTicks: number;
  /** Look input has come back to rest since the last flick, so a flick may cycle. */
  readonly armed: boolean;
}

export const LockOnComponent = defineComponent<LockOn>('targeting.lock');

/** Not locked on, flicks armed. */
export const NO_LOCK: LockOn = Object.freeze({ target: null, unseenTicks: 0, armed: true });

/** The Targetable a content profile describes. */
export function targetableOf(
  profile: Frozen<Pick<TargetableDef, 'points' | 'priority'>>,
): Targetable {
  return Object.freeze({
    points: Object.freeze(profile.points.map(({ at: [x, y, z] }) => Object.freeze({ x, y, z }))),
    priority: profile.priority,
  });
}

/** Makes `entity` targetable with `profile` (register TargetableComponent first). */
export function giveTargetable<T>(
  world: World<T>,
  entity: EntityId,
  profile: Frozen<Pick<TargetableDef, 'points' | 'priority'>>,
): void {
  world.add(entity, TargetableComponent, targetableOf(profile));
}
