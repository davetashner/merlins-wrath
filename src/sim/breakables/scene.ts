// A loaded scene's breakables (mw-e03.11): after `loadScene` and `addScenePhysics`, every placement
// and spawn with a `breakable` gets its profile (src/sim/breakables/system.ts). A breakable piece is
// placed at the centre of its box with the box's bounding sphere, so stimuli reach it; a breakable
// prop is already placed by its body, and any other breakable spawn is placed at its spawn point.
// The sim never imports content: the game passes the profiles in as a lookup.

import type { EntityId } from '../core/component';
import type { World } from '../core/world';
import { at } from '../geom/vec';
import { hypot } from '../math';
import type { LoadedScene } from '../scene/loader';
import type { SceneBreakable } from '../scene/layout';
import { PlacementComponent, placeEntity } from '../stimulus/placement';
import type { Vec3 } from '../stimulus/shapes';
import type { BreakableProfileLookup } from './components';
import { makeBreakable } from './system';

/** What `addSceneBreakables` made breakable, in scene order. */
export interface SceneBreakables {
  readonly pieces: readonly EntityId[];
  readonly spawns: readonly EntityId[];
}

function profileOf(lookup: BreakableProfileLookup, spec: SceneBreakable) {
  const profile = lookup(spec.profile);
  if (profile === undefined) throw new RangeError(`unknown breakable profile "${spec.profile}"`);
  return profile;
}

const instanceOf = (spec: SceneBreakable) => ({
  contents: spec.contents,
  ...(spec.reveals !== undefined && { reveals: spec.reveals }),
});

/** Places `entity` at the centre of the box min–max, with the box's bounding sphere. */
function placeBox(world: World<never>, entity: EntityId, min: Vec3, max: Vec3): void {
  const half = { x: (max.x - min.x) / 2, y: (max.y - min.y) / 2, z: (max.z - min.z) / 2 };
  const centre = { x: min.x + half.x, y: min.y + half.y, z: min.z + half.z };
  placeEntity(world, entity, centre, hypot(half.x, half.y, half.z));
}

/**
 * Makes `loaded`'s breakable placements and spawns breakable. Call between steps, after
 * `addScenePhysics` (props must have their bodies first), in a world with breakables installed.
 * @throws RangeError when a breakable names a profile `profiles` does not have.
 */
export function addSceneBreakables<T>(
  world: World<T>,
  loaded: LoadedScene,
  profiles: BreakableProfileLookup,
): SceneBreakables {
  const sim = world as unknown as World<never>;
  const pieces: EntityId[] = [];
  loaded.pieces.forEach((entity, index) => {
    const piece = at(loaded.layout.pieces, index);
    if (piece.breakable === undefined) return;
    const profile = profileOf(profiles, piece.breakable);
    placeBox(sim, entity, piece.min, piece.max);
    makeBreakable(sim, entity, profile, instanceOf(piece.breakable));
    pieces.push(entity);
  });
  const spawns: EntityId[] = [];
  for (const { entity, spawn } of loaded.spawns) {
    if (spawn.breakable === undefined) continue;
    const profile = profileOf(profiles, spawn.breakable);
    if (!sim.has(entity, PlacementComponent)) placeEntity(sim, entity, spawn.position);
    makeBreakable(sim, entity, profile, instanceOf(spawn.breakable));
    spawns.push(entity);
  }
  return Object.freeze({ pieces: Object.freeze(pieces), spawns: Object.freeze(spawns) });
}
