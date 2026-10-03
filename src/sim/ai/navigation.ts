// How AI moves an agent (mw-e11.2). The `move-to` and `follow-route` primitives ask a navigation
// port for one tick of travel; the port answers running, success (arrived) or failure (unreachable).
// Until the navmesh (E12/E14) provides paths, `straightLineNavigation` walks straight across the
// ground plane: it moves the agent's placement toward the goal at the gait speed and turns its
// facing to the direction of travel. A navmesh-backed port replaces it without touching behaviours.
// A port may also measure how far away a point is by its paths (`distance`), which patrol routines
// use to pick the nearest waypoint (mw-e11.9); without it the straight line is the measure.

import type { EntityId } from '../core/component';
import type { World } from '../core/world';
import { CombatFacingComponent } from '../combat/melee/components';
import { PlacementComponent } from '../stimulus/placement';
import type { Vec3 } from '../stimulus/shapes';
import { getIf } from './util';

/** A step's progress (ADR-0005 §4). */
export type AiStatus = 'running' | 'success' | 'failure';

/** One tick of travel toward a goal. */
export interface TravelRequest {
  readonly goal: Vec3;
  /** Arrived within this many metres (horizontal). */
  readonly within: number;
  /** Metres per second. */
  readonly speed: number;
  /** Seconds this tick lasts. */
  readonly dt: number;
}

/** Moves agents for AI. */
export interface AiNavigation {
  /**
   * Moves `entity` one tick toward `request.goal`: success once within `request.within`, failure
   * when the goal cannot be reached, else running.
   */
  travel(world: World<never>, entity: EntityId, request: TravelRequest): AiStatus;
  /**
   * Metres `entity` would travel to reach `goal` (Infinity when it cannot). Optional: without it
   * the straight-line distance stands in.
   */
  readonly distance?: (world: World<never>, entity: EntityId, goal: Vec3) => number;
}

/** Horizontal straight-line metres from `entity` to `goal` (Infinity without a placement). */
export function straightDistance(world: World<never>, entity: EntityId, goal: Vec3): number {
  const at = getIf(world, entity, PlacementComponent);
  if (at === undefined) return Infinity;
  return Math.sqrt((goal.x - at.x) ** 2 + (goal.z - at.z) ** 2);
}

/** Turns `entity`'s facing (when it has one) toward horizontal direction (dx, dz). */
export function face(world: World<never>, entity: EntityId, dx: number, dz: number): void {
  const length = Math.sqrt(dx * dx + dz * dz);
  if (!(length > 1e-9) || getIf(world, entity, CombatFacingComponent) === undefined) return;
  world.set(
    entity,
    CombatFacingComponent,
    Object.freeze({ facing: Object.freeze({ x: dx / length, y: 0, z: dz / length }) }),
  );
}

/**
 * Straight-line travel on the ground plane (see the file header). Fails when the agent has no
 * placement or does not move (speed ≤ 0) and is not there yet.
 */
export const straightLineNavigation: AiNavigation = Object.freeze({
  distance: straightDistance,
  travel(world: World<never>, entity: EntityId, request: TravelRequest): AiStatus {
    const at = getIf(world, entity, PlacementComponent);
    if (at === undefined) return 'failure';
    const dx = request.goal.x - at.x;
    const dz = request.goal.z - at.z;
    const distance = Math.sqrt(dx * dx + dz * dz);
    if (distance <= request.within) return 'success';
    const stride = request.speed * request.dt;
    if (!(stride > 0)) return 'failure';
    const t = Math.min(1, stride / distance);
    world.set(
      entity,
      PlacementComponent,
      Object.freeze({ x: at.x + dx * t, y: at.y, z: at.z + dz * t, radius: at.radius }),
    );
    face(world, entity, dx, dz);
    return distance - stride <= request.within ? 'success' : 'running';
  },
});
