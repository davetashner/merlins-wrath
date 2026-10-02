// Climbing ropes (mw-e02.13): a rope is any entity with the `climbable: rope` property and a
// ClimbRope line hanging straight down from its anchor. Ropes have no collider (a character climbs
// round them, never into them), so the climb hook finds them by this component rather than by a
// collision query. An authored rope is a scene piece marked `climbable: rope` (`sceneRopes`); a rope
// arrow or a spell spawns one at runtime (`spawnRope`): both are the same data, so both climb alike.
//
// The anchor is read live every tick: whatever moves it (a swaying anchor, a rope tied to a moving
// platform) carries the climber with it. Whether the rope can be held is still the world property,
// so a rope that burns away drops its climber like burning ivy does.

import { defineComponent, type EntityId } from '../core/component';
import type { World } from '../core/world';
import { at } from '../geom/vec';
import { addProperties, readProperty, type WorldPropertyInit } from '../properties/components';
import type { LoadedScene } from '../scene/loader';
import type { Vec3 } from '../stimulus/shapes';

/** A rope's line: from its anchor straight down `length` metres. */
export interface ClimbRope {
  /** Where the rope is tied, world metres (its top). */
  readonly anchor: Vec3;
  /** How far it hangs below the anchor, metres (> 0). */
  readonly length: number;
}

/** The rope component (`climb.rope`; a snapshot and save key, never renamed). */
export const ClimbRopeComponent = defineComponent<ClimbRope>('climb.rope');

function checkLength(length: number): void {
  if (!(Number.isFinite(length) && length > 0)) {
    throw new RangeError(`a rope must be longer than 0 m, got ${String(length)}`);
  }
}

/**
 * Gives `entity` a rope's line hanging from `rope.anchor` (register ClimbRopeComponent first). Its
 * grade still comes from its `climbable` property: a line on an entity that is not `rope` climbs as
 * nothing. Structural, so during a step it exists from the end of the tick.
 * @throws RangeError for a length that is not a positive number.
 */
export function makeRope(world: World<never>, entity: EntityId, rope: ClimbRope): void {
  checkLength(rope.length);
  world.add(
    entity,
    ClimbRopeComponent,
    Object.freeze({ anchor: rope.anchor, length: rope.length }),
  );
}

/**
 * Spawns a climbable rope at runtime (a rope arrow's payload, a vines spell): a new entity with
 * `properties` (a material's, say) and the rope grade, hanging from `rope.anchor`. Register the world
 * properties and ClimbRopeComponent first.
 * @throws RangeError for a length that is not a positive number (nothing is spawned).
 */
export function spawnRope(
  world: World<never>,
  rope: ClimbRope,
  properties: WorldPropertyInit = {},
): EntityId {
  checkLength(rope.length);
  const entity = world.spawn();
  addProperties(world, entity, { ...properties, climbable: 'rope' });
  makeRope(world, entity, rope);
  return entity;
}

/**
 * Makes every piece of `loaded` whose properties say `climbable: rope` a rope hanging down the middle
 * of its bounds, from the top. Call once after loading and adding the scene's physics (which gives
 * the pieces their properties). Returns the rope entities in scene order.
 */
export function sceneRopes(world: World<never>, loaded: LoadedScene): EntityId[] {
  const ropes: EntityId[] = [];
  loaded.pieces.forEach((entity, placement) => {
    if (readProperty(world, entity, 'climbable') !== 'rope') return;
    const { min, max } = at(loaded.layout.pieces, placement);
    const anchor = Object.freeze({ x: (min.x + max.x) / 2, y: max.y, z: (min.z + max.z) / 2 });
    makeRope(world, entity, { anchor, length: max.y - min.y });
    ropes.push(entity);
  });
  return ropes;
}
