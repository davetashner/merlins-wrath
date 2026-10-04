// How a creature walks, for its animation (mw-e37.402). The sim keeps no velocity for creatures, so
// the speed is read off how far the placement moved since the last time the animation looked — one
// sim step ago — smoothed so a creature that stops and starts does not flicker between clips. Read
// only: animation never feeds the sim.

import { DEFAULT_TICK_RATE_HZ, PlacementComponent, type EntityId } from '@sim/index';
import type { LocomotionReader } from '../animation/sim-params';

/** Below this speed (m/s) a creature reads as standing. */
export const STAND_SPEED = 0.15;
/** Above this speed (m/s) a creature reads as running. */
export const RUN_SPEED = 3.5;
/** How much of the newest speed a read takes (1 = no smoothing). */
export const SPEED_SMOOTHING = 0.35;

/**
 * A locomotion reader for creatures: speed from placement change per sim step (60 Hz), `walk` or `run`
 * while moving, `idle` otherwise. One reader holds the last placement of every creature it has seen.
 */
export function creatureLocomotion(hz: number = DEFAULT_TICK_RATE_HZ): LocomotionReader {
  const last = new Map<EntityId, { x: number; z: number; speed: number }>();
  return (view, entity) => {
    const at = view.get(entity, PlacementComponent);
    if (at === undefined) return undefined;
    const before = last.get(entity);
    const raw = before === undefined ? 0 : Math.hypot(at.x - before.x, at.z - before.z) * hz;
    const speed = before === undefined ? 0 : before.speed + (raw - before.speed) * SPEED_SMOOTHING;
    last.set(entity, { x: at.x, z: at.z, speed });
    const state = speed < STAND_SPEED ? 'idle' : speed < RUN_SPEED ? 'walk' : 'run';
    return { speed, turnRate: 0, grounded: true, state };
  };
}
