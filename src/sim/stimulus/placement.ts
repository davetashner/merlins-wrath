// Where an entity is, for systemic queries (mw-e03.3). Stimuli, and later the element field, light
// and AI perception, need a sim-side answer to "what is inside this sphere?". An entity's placement
// is its centre plus a bounding-sphere radius; the physics layer (mw-e03.10) is expected to keep it in
// step with rigid bodies, while static objects are placed once from level data. Entities without a
// placement are only reachable by contact stimuli.

import { defineComponent, type EntityId } from '../core/component';
import type { World } from '../core/world';
import type { Vec3 } from './shapes';

/** An entity's position (its centre, metres) and bounding-sphere radius (metres, 0 = a point). */
export interface Placement extends Vec3 {
  readonly radius: number;
}

/** Why `value` is not a valid placement, or undefined when it is. Accepts untyped input. */
export function validatePlacement(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) return 'placement must be an object';
  const { x, y, z, radius } = value as Record<string, unknown>;
  for (const [name, n] of [
    ['x', x],
    ['y', y],
    ['z', z],
    ['radius', radius],
  ] as const) {
    if (typeof n !== 'number' || !Number.isFinite(n)) {
      return `placement.${name} must be a finite number`;
    }
  }
  return (radius as number) < 0 ? 'placement.radius must be ≥ 0' : undefined;
}

function frozenPlacement(value: unknown): Placement {
  const problem = validatePlacement(value);
  if (problem !== undefined) throw new RangeError(problem);
  const { x, y, z, radius } = value as Placement;
  return Object.freeze({ x, y, z, radius });
}

/** The placement component (`spatial.placement`; a snapshot and save key, never renamed). */
export const PlacementComponent = defineComponent<Placement>('spatial.placement', {
  deserialize: frozenPlacement,
});

/**
 * Places `entity` at `position` with bounding radius `radius` (validated; a RangeError for non-finite
 * numbers or a negative radius). Adding the component is structural, so during a step it takes
 * effect at the end of the tick, like `World.add`.
 */
export function placeEntity(
  world: World<never>,
  entity: EntityId,
  position: Vec3,
  radius = 0,
): void {
  const placement = frozenPlacement({ x: position.x, y: position.y, z: position.z, radius });
  if (world.has(entity, PlacementComponent)) {
    world.set(entity, PlacementComponent, placement);
  } else {
    world.add(entity, PlacementComponent, placement);
  }
}

/** The placement of `entity`, or undefined when it has none. */
export function placementOf(world: World<never>, entity: EntityId): Placement | undefined {
  return world.get(entity, PlacementComponent);
}
