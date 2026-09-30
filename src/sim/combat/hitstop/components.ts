// Hit-stop state (mw-e04.11): which world ticks an entity's local time is frozen on by hit-stop, so
// the rules that must keep step with its action timeline — the hit-volume sweep of its open hitbox,
// the length of its hit reaction — hold still exactly when its timeline does. Plain frozen data,
// replaced never mutated, so snapshots, saves and replays carry an entity mid-freeze. The component
// is added on an entity's first hit-stop and kept (a spent freeze is simply in the past).

import type { HitStopTier } from '@content/index';
import { defineComponent, type EntityId } from '../../core/component';
import type { World } from '../../core/world';

export type { HitStopTier };

/** An entity's latest hit-stop. */
export interface HitStop {
  /** Tier of the hit that set its length (the longest of overlapping freezes). */
  readonly tier: HitStopTier;
  /** World tick of that hit. */
  readonly startedAt: number;
  /** First world tick whose timeline run is frozen (the tick after the first hit of the freeze). */
  readonly from: number;
  /** Last world tick whose timeline run is frozen; the timeline runs again from `until + 1`. */
  readonly until: number;
}

/** The hit-stop component (`combat.hit-stop`; a snapshot and save key, never renamed). */
export const HitStopComponent = defineComponent<HitStop>('combat.hit-stop');

function stateOf(world: World<never>, entity: EntityId): HitStop | undefined {
  return world.isRegistered(HitStopComponent) ? world.get(entity, HitStopComponent) : undefined;
}

/**
 * Whether hit-stop freezes `entity` on world tick `tick` (default: the tick being simulated, or,
 * between steps, the next one): its action timeline does not run, its hitboxes do not sweep and its
 * hit reaction does not age. False in a world without the hit-stop component.
 */
export function isHitStopped(world: World<never>, entity: EntityId, tick = world.tick): boolean {
  const state = stateOf(world, entity);
  return state !== undefined && tick >= state.from && tick <= state.until;
}

/**
 * Frozen timeline runs `entity` has left from world tick `tick` on (default: the tick being
 * simulated, or, between steps, the next one), and the tier of the hit that set them; undefined when
 * it is not frozen. For presentation: the frame-data overlay's countdown.
 */
export function hitStopOf(
  world: World<never>,
  entity: EntityId,
  tick = world.tick,
): { readonly tier: HitStopTier; readonly ticksLeft: number } | undefined {
  const state = stateOf(world, entity);
  if (state === undefined || tick > state.until) return undefined;
  const ticksLeft = state.until - Math.max(tick, state.from) + 1;
  return { tier: state.tier, ticksLeft };
}
