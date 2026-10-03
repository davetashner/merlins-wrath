// A scene's sound graph (mw-e09.3): the scene's `acoustics` (rooms and portals in grid cells, a
// portal's door named by spawn id) turned into a SoundGraphSpec in metres with door entities, then
// built. A scene without acoustics is all outside: every noise falls off with distance alone.

import type { EntityId } from '../core/component';
import type { LoadedScene } from '../scene/loader';
import { buildSoundGraph, type SoundGraph } from './graph';

type Triple = readonly [number, number, number];

/** A scene's acoustics as the sim needs them; `GameEntry<'scene'>['acoustics']` satisfies it. */
export interface SceneAcousticsSpec {
  readonly rooms: readonly { readonly id: string; readonly min: Triple; readonly max: Triple }[];
  readonly portals: readonly {
    readonly id: string;
    readonly rooms: readonly [string, string];
    readonly at: Triple;
    readonly door?: string | undefined;
  }[];
  readonly partitions: readonly {
    readonly rooms: readonly [string, string];
    readonly material: string;
  }[];
}

/** What `soundGraphFromScene` reads of a scene. */
export interface SceneSoundSpec {
  /** Metres per grid cell. */
  readonly grid: number;
  readonly acoustics?: SceneAcousticsSpec | undefined;
}

const metres = (at: Triple, grid: number) => ({
  x: at[0] * grid,
  y: at[1] * grid,
  z: at[2] * grid,
});

/**
 * Builds the sound graph of `scene`, as loaded into `loaded` (for its door spawns' entities).
 * @throws RangeError for a portal door no spawn of the loaded scene is, or anything buildSoundGraph
 * rejects.
 */
export function soundGraphFromScene(scene: SceneSoundSpec, loaded: LoadedScene): SoundGraph {
  const { grid, acoustics } = scene;
  if (acoustics === undefined) return buildSoundGraph({ rooms: [], portals: [] });
  const spawns = new Map<string, EntityId>(loaded.spawns.map((s) => [s.spawn.id, s.entity]));
  return buildSoundGraph({
    rooms: acoustics.rooms.map((room) => ({
      id: room.id,
      min: metres(room.min, grid),
      max: metres(room.max, grid),
    })),
    portals: acoustics.portals.map((portal) => {
      let door: EntityId | null = null;
      if (portal.door !== undefined) {
        const entity = spawns.get(portal.door);
        if (entity === undefined) {
          throw new RangeError(`portal "${portal.id}" names door "${portal.door}", no spawn`);
        }
        door = entity;
      }
      return { id: portal.id, rooms: portal.rooms, position: metres(portal.at, grid), door };
    }),
    partitions: acoustics.partitions,
  });
}
