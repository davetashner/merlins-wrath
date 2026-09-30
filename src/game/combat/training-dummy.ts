// Training dummies (mw-e04.6): something to hit in the greybox testbed until the combat sandbox
// (mw-e04.9) brings real dummy creatures. A scene spawn tagged `training-dummy` becomes a sim entity
// with a placement at its feet, one torso hurtbox (multiplier 1, so a hit deals its damage exactly)
// and health, and nothing else: it does not move, block, stagger or fight back. Its health is
// published for the HUD-less e2e (`dummyReadout`).

import type { EntityId, SceneSpawnPlacement, World } from '@sim/index';
import {
  giveCombatant,
  giveHurtboxes,
  healthOf,
  placeEntity,
  PlacementComponent,
} from '@sim/index';
import type { SimView, Transform } from '../loop/render-sync';

/** The tag that marks a scene's training dummy spawns. */
export const TRAINING_DUMMY_TAG = 'training-dummy';

/** A training dummy's numbers (defaults chosen for the testbed, see the file header). */
export const TRAINING_DUMMY = Object.freeze({
  /** Hit points: enough for two full light chains (2 × 72). */
  health: 200,
  /** Bounding radius and torso radius, metres. */
  radius: 0.35,
  /** Torso capsule from 0.3 m to 1.6 m above the feet. */
  torso: Object.freeze({ bottom: 0.3, top: 1.6 }),
});

/** The spawns in `spawns` tagged TRAINING_DUMMY_TAG. */
export function trainingDummySpawns(
  spawns: readonly SceneSpawnPlacement[],
): readonly SceneSpawnPlacement[] {
  return spawns.filter((spawn) => spawn.tags.includes(TRAINING_DUMMY_TAG));
}

/**
 * Spawns a training dummy at `spawn`. Register the hit-volume, damage and placement components
 * first; call between steps.
 */
export function spawnTrainingDummy(world: World<never>, spawn: SceneSpawnPlacement): EntityId {
  const { radius, torso, health } = TRAINING_DUMMY;
  const entity = world.spawn();
  placeEntity(world, entity, spawn.position, radius);
  giveHurtboxes(world, entity, {
    boxes: [
      {
        id: 'torso',
        socket: 'root',
        region: 'torso',
        armored: false,
        multiplier: 1,
        shape: {
          kind: 'capsule',
          from: { x: 0, y: torso.bottom, z: 0 },
          to: { x: 0, y: torso.top, z: 0 },
          radius,
        },
      },
    ],
  });
  giveCombatant(world, entity, { health });
  return entity;
}

/** What the dummy publishes: its health now. */
export interface DummyReadout {
  readonly health: number;
  readonly max: number;
}

/** `entity`'s readout, or undefined when it has no health (destroyed). */
export function dummyReadout(world: World<never>, entity: EntityId): DummyReadout | undefined {
  const health = healthOf(world, entity);
  return health === undefined ? undefined : { health: health.current, max: health.max };
}

const UPRIGHT = Object.freeze({ x: 0, y: 0, z: 0, w: 1 });

/** A dummy's transform for render sync: its feet, upright. */
export function readDummyTransform(view: SimView, entity: EntityId): Transform | undefined {
  const at = view.get(entity, PlacementComponent);
  return at === undefined
    ? undefined
    : { position: { x: at.x, y: at.y, z: at.z }, rotation: UPRIGHT };
}
