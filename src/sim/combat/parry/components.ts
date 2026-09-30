// Parry state (mw-e04.12): what the parry rules remember between ticks — which parry run deflected a
// hit (its recovery is then no counter-hit window) and, on an attacker whose swing was parried, the
// Parried stun a riposte can punish. Plain frozen data, replaced never mutated, so snapshots, saves and
// replays carry a fighter mid-parry or mid-stun. The component is added on an entity's first parry or
// first time Parried (structural: during a step it exists from the end of the tick) and kept after.

import { defineComponent, type EntityId } from '../../core/component';
import type { World } from '../../core/world';

/** A Parried stun: its attacker's swing was deflected and it stands open to a riposte. */
export interface ParriedStun {
  /** The fighter whose parry deflected it. */
  readonly by: EntityId;
  /** World tick of the parry. */
  readonly startedAt: number;
  /**
   * First world tick it is over: startedAt + 1 + PARRIED_TICKS, plus every tick hit-stop froze the
   * entity since (mw-e04.11), so it ends on the tick its timeline lock runs out. A riposte ends it at
   * once (endsAt becomes the riposte's tick).
   */
  readonly endsAt: number;
}

/** One fighter's parry state. */
export interface ParryState {
  /** `startedAt` of the parry run that deflected a hit, or null: that run has no counter window. */
  readonly deflected: number | null;
  /** The latest Parried stun (possibly over: see `endsAt`), or null. */
  readonly parried: ParriedStun | null;
}

/** The parry component (`combat.parry`; a snapshot and save key, never renamed). */
export const ParryComponent = defineComponent<ParryState>('combat.parry');

/** Every parry component, for `world.register(...PARRY_COMPONENTS)`. */
export const PARRY_COMPONENTS = Object.freeze([ParryComponent] as const);

const CALM: ParryState = Object.freeze({ deflected: null, parried: null });

function stateOf(world: World<never>, entity: EntityId): ParryState | undefined {
  return world.isRegistered(ParryComponent) ? world.get(entity, ParryComponent) : undefined;
}

/** Replaces `entity`'s parry state with `change` applied (adding the component if it has none). */
export function updateParry(
  world: World<never>,
  entity: EntityId,
  change: Partial<ParryState>,
): void {
  const previous = stateOf(world, entity);
  const next = Object.freeze({ ...(previous ?? CALM), ...change });
  if (previous === undefined) world.add(entity, ParryComponent, next);
  else world.set(entity, ParryComponent, next);
}

/**
 * `entity`'s Parried stun while it lasts on world tick `tick` (default: the tick being simulated, or,
 * between steps, the next one), with the ticks left; undefined when it is not Parried (or the parry
 * component is not registered).
 */
export function parriedOf(
  world: World<never>,
  entity: EntityId,
  tick = world.tick,
): (ParriedStun & { readonly ticksLeft: number }) | undefined {
  const stun = stateOf(world, entity)?.parried ?? null;
  if (stun === null || tick >= stun.endsAt) return undefined;
  return { ...stun, ticksLeft: stun.endsAt - tick };
}

/** Whether `entity` is Parried on `tick` (see `parriedOf`). */
export function isParried(world: World<never>, entity: EntityId, tick = world.tick): boolean {
  return parriedOf(world, entity, tick) !== undefined;
}

/** `startedAt` of the parry run of `entity` that deflected a hit, or null. */
export function deflectedRun(world: World<never>, entity: EntityId): number | null {
  return stateOf(world, entity)?.deflected ?? null;
}
