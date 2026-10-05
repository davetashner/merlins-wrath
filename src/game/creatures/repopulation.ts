// Creature repopulation in the game (mw-ju8.29): the glue between the sim's rules
// (src/sim/creatures/repopulation.ts), the world's level deltas, the day clock and the scene's line
// of sight. Two entry points, both used by src/main.ts and by tests/integration/creature-repopulation:
// - `repopulateOnArrival`, before a scene's stored deltas are applied (a crossing reloads the page and
//   rebuilds the scene from its authored spawns): due creatures' dead entries leave the deltas, so
//   they stand at their spawns again, fresh.
// - `installRepopulationOnRest`, for the loaded scene: on `rest.completed`, due creatures are spawned
//   again unless the player is near their spawn or can see it.

import {
  DAY_FACT,
  LineOfSight,
  levelDeltasOf,
  repopulateLive,
  repopulateStored,
  REPOPULATION_MIN_DISTANCE,
  restCompleted,
  PlacementComponent,
  type CreatureSpawnOptions,
  type EntityId,
  type SceneSpawnPlacement,
  type SightWorld,
  type World,
} from '@sim/index';

/** The world day now. */
const today = (world: World<never>): number => Number(world.facts.get(DAY_FACT) ?? 1);

/**
 * Drops the dead entries of every opted-in, due creature of the not-yet-entered level `level` from
 * its stored deltas. Returns the spawn points that returned. Call before `levelDeltasOf(world).enter`.
 */
export function repopulateOnArrival(
  world: World<never>,
  level: string,
  spawns: readonly SceneSpawnPlacement[],
): readonly string[] {
  const store = levelDeltasOf(world);
  const stored = store.deltas(level);
  if (stored === undefined) return [];
  const result = repopulateStored(stored, spawns, world.facts, today(world));
  if (result.returned.length > 0) store.replace(result.deltas);
  return result.returned;
}

export interface RestRepopulationOptions {
  readonly level: string;
  readonly spawns: readonly SceneSpawnPlacement[];
  readonly spawnOptions: CreatureSpawnOptions;
  readonly sight: SightWorld;
  readonly player: EntityId | undefined;
  /** Called with the spawn points that returned. */
  readonly onReturned?: (points: readonly string[]) => void;
}

/** Eye height of the player for the sight check, metres. */
const EYE_HEIGHT = 1.6;
/** Height of the creature that would appear, metres. */
const CREATURE_HEIGHT = 1.8;

/** Repopulates the loaded scene when the player rests (see the file header). Returns an uninstaller. */
export function installRepopulationOnRest(
  world: World<never>,
  options: RestRepopulationOptions,
): () => void {
  const sight = new LineOfSight({ world: options.sight });
  return world.events.on(restCompleted, ({ wakes }) => {
    const at =
      options.player === undefined ? undefined : world.get(options.player, PlacementComponent);
    const returned = repopulateLive(world, world.facts, {
      level: options.level,
      spawns: options.spawns,
      today: wakes.day,
      spawnOptions: options.spawnOptions,
      player: at,
      minDistance: REPOPULATION_MIN_DISTANCE,
      canSee: (point) =>
        at !== undefined &&
        sight.visibleFraction(
          { x: at.x, y: at.y + EYE_HEIGHT, z: at.z },
          { feet: point, height: CREATURE_HEIGHT },
        ) > 0,
    });
    if (returned.length > 0) options.onReturned?.(returned);
  });
}
