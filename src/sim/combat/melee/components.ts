// Melee state (mw-e04.6): which way a fighter faces, and its shield. Plain frozen data, replaced never
// mutated, so snapshots, saves and replays carry a knight mid-turn or behind a half-raised shield.
//
// Facing is the horizontal direction a fighter's body points: swings commit to it when their hitbox
// opens, and a shield covers an arc centred on it. The facing rule (facing.ts) turns it; nothing else
// writes it. A guard is the shield a fighter carries, whether the block input is held, and the tick
// the shield went up — it blocks once it has been up for the shield's `raiseTicks` (guard.ts).

import type { RuntimeShield } from '@content/index';
import { defineComponent, type EntityId } from '../../core/component';
import type { World } from '../../core/world';
import type { Vec3 } from '../../stimulus/shapes';
import { horizontalAim } from '../attacks/frame';

/** A fighter's body facing. */
export interface CombatFacing {
  /** Unit horizontal direction (y = 0). */
  readonly facing: Vec3;
}

/** A fighter's shield and block state. */
export interface Guard {
  readonly shield: RuntimeShield;
  /** The block input is held (the player's block button, or an AI's choice via `setBlockHeld`). */
  readonly held: boolean;
  /** World tick the shield went up, or null while it is down. */
  readonly raisedAt: number | null;
}

/** The facing component (`combat.facing`; a snapshot and save key, never renamed). */
export const CombatFacingComponent = defineComponent<CombatFacing>('combat.facing');

/** The guard component (`combat.guard`; a snapshot and save key, never renamed). */
export const GuardComponent = defineComponent<Guard>('combat.guard');

/** Every melee component, for `world.register(...MELEE_COMPONENTS)`. */
export const MELEE_COMPONENTS = Object.freeze([CombatFacingComponent, GuardComponent] as const);

/** +z, the facing of an entity nobody has turned. */
export const DEFAULT_FACING: Vec3 = Object.freeze({ x: 0, y: 0, z: 1 });

/**
 * Gives `entity` a facing (the horizontal part of `facing`, default +z); replaces an existing one.
 * Throws a RangeError for a facing with no horizontal direction.
 */
export function giveFacing(world: World<never>, entity: EntityId, facing: Vec3 = DEFAULT_FACING) {
  const value = Object.freeze({ facing: horizontalAim(facing) });
  if (world.has(entity, CombatFacingComponent)) world.set(entity, CombatFacingComponent, value);
  else world.add(entity, CombatFacingComponent, value);
}

/** `entity`'s facing, or DEFAULT_FACING when it has none. */
export function facingOf(world: World<never>, entity: EntityId): Vec3 {
  return world.get(entity, CombatFacingComponent)?.facing ?? DEFAULT_FACING;
}

/** Gives `entity` `shield`, lowered and with the block input released. */
export function giveGuard(world: World<never>, entity: EntityId, shield: RuntimeShield): void {
  world.add(entity, GuardComponent, Object.freeze({ shield, held: false, raisedAt: null }));
}

/** `entity`'s guard, or undefined when it carries no shield. */
export function guardOf(world: World<never>, entity: EntityId): Guard | undefined {
  return world.get(entity, GuardComponent);
}

function requireGuard(world: World<never>, entity: EntityId): Guard {
  const guard = guardOf(world, entity);
  if (guard === undefined) throw new Error(`entity ${String(entity)} has no guard`);
  return guard;
}

/**
 * Records whether `entity` wants its shield up (AI, scripts; the block system reads the player's
 * button itself). The block system raises it on its next run if the entity is free to block.
 * Throws when `entity` has no guard.
 */
export function setBlockHeld(world: World<never>, entity: EntityId, held: boolean): void {
  const guard = requireGuard(world, entity);
  if (guard.held !== held) world.set(entity, GuardComponent, Object.freeze({ ...guard, held }));
}

/** Lowers `entity`'s shield now (a guard break); it goes up again only through the block system. */
export function lowerGuard(world: World<never>, entity: EntityId): void {
  const guard = requireGuard(world, entity);
  if (guard.raisedAt !== null) {
    world.set(entity, GuardComponent, Object.freeze({ ...guard, raisedAt: null }));
  }
}

/** Whether `guard`'s shield blocks on `tick`: up for at least its `raiseTicks`. */
export function isBlocking(guard: Guard, tick: number): boolean {
  return guard.raisedAt !== null && tick - guard.raisedAt >= guard.shield.raiseTicks;
}
