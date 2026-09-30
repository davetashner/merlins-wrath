// Where an entity is, for systemic queries (mw-e03.3). Stimuli, and later the element field, light
// and AI perception, need a sim-side answer to "what is inside this sphere?". An entity's placement
// is its centre plus a bounding-sphere radius; the physics layer (mw-e03.10) is expected to keep it in
// step with rigid bodies, while static objects are placed once from level data. Entities without a
// placement are only reachable by contact stimuli.
//
// Some placements are a frame origin rather than a centre: a character's is its feet, the frame its
// swings and hurtboxes are placed in (mw-e04.2). Such an entity also carries a placement centre
// (mw-e04.34): where its bounding sphere sits relative to the placement. Stimuli reach and push that
// sphere (`boundingSphereOf`), so a blast at a character's feet lifts it rather than pushing it into
// the ground.

import { defineComponent, type EntityId } from '../core/component';
import type { World } from '../core/world';
import type { Vec3 } from './shapes';

/** An entity's position (its centre, metres) and bounding-sphere radius (metres, 0 = a point). */
export interface Placement extends Vec3 {
  readonly radius: number;
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** Why `value` is not a valid placement, or undefined when it is. Accepts untyped input. */
export function validatePlacement(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) return 'placement must be an object';
  const { x, y, z, radius } = value as Record<string, unknown>;
  // Checked one by one rather than looping over a list: physics objects place every moving body
  // every tick, so this stays allocation-free.
  if (!finite(x)) return 'placement.x must be a finite number';
  if (!finite(y)) return 'placement.y must be a finite number';
  if (!finite(z)) return 'placement.z must be a finite number';
  if (!finite(radius)) return 'placement.radius must be a finite number';
  return radius < 0 ? 'placement.radius must be ≥ 0' : undefined;
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

/** An entity's bounding sphere relative to its placement (see the file header). */
export interface PlacementCentre {
  /** From the placement to the sphere's centre, metres. */
  readonly offset: Vec3;
  /** The sphere's radius, metres (≥ 0); replaces the placement's radius for stimuli. */
  readonly radius: number;
}

function frozenCentre(value: unknown): PlacementCentre {
  const { offset, radius } = (value ?? {}) as Record<string, unknown>;
  const problem = validatePlacement({ ...(offset as object | undefined), radius });
  if (problem !== undefined) throw new RangeError(problem.replace('placement.', 'centre.'));
  const { x, y, z } = offset as Vec3;
  return Object.freeze({ offset: Object.freeze({ x, y, z }), radius: radius as number });
}

/** The placement centre component (`spatial.centre`; a snapshot and save key, never renamed). */
export const PlacementCentreComponent = defineComponent<PlacementCentre>('spatial.centre', {
  deserialize: frozenCentre,
});

/**
 * Gives `entity` a placement centre (validated like a placement: a RangeError for non-finite numbers
 * or a negative radius). Structural when first added, like `placeEntity`.
 */
export function setPlacementCentre(
  world: World<never>,
  entity: EntityId,
  offset: Vec3,
  radius: number,
): void {
  const centre = frozenCentre({ offset, radius });
  if (world.has(entity, PlacementCentreComponent)) {
    world.set(entity, PlacementCentreComponent, centre);
  } else {
    world.add(entity, PlacementCentreComponent, centre);
  }
}

/**
 * The sphere stimuli reach on an entity placed at `at`: `at` itself, or its centre's sphere when it
 * has one. Needs PlacementCentreComponent registered (`installStimuli` does).
 */
export function boundingSphereOf(world: World<never>, entity: EntityId, at: Placement): Placement {
  const centre = world.get(entity, PlacementCentreComponent);
  if (centre === undefined) return at;
  const { offset, radius } = centre;
  return { x: at.x + offset.x, y: at.y + offset.y, z: at.z + offset.z, radius };
}

/** The placement of `entity`, or undefined when it has none. */
export function placementOf(world: World<never>, entity: EntityId): Placement | undefined {
  return world.get(entity, PlacementComponent);
}
