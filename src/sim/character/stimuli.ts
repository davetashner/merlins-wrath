// Characters as stimulus targets (mw-e04.34). A force stimulus reaches whatever is placed inside its
// shape and is pushable or liftable with a weight; the impulse API (impulse.ts) turns the push into
// the character's velocity change. So a character needs three things for blasts, Gusts and shoves
// to reach it the same way they reach a crate:
//
// - a placement kept in step with its controller: at its feet with the capsule's radius (the frame
//   its swings and hurtboxes are placed in), updated after every controller step;
// - a placement centre: the bounding sphere of its capsule, standing or crouched, so a blast is
//   measured from the body, and one at its feet pushes it up and away rather than into the ground;
// - the `pushable` and `weight` properties, its weight the controller tuning's `launch.mass`.
//
// `installCharacterStimuli` wires the first two and the impulse API for every character in a world;
// `makePushable` gives one character the properties.

import type { ControllerTuning, Frozen } from '@content/index';
import type { EntityId } from '../core/component';
import type { System, World } from '../core/world';
import { addProperties } from '../properties/components';
import {
  placeEntity,
  PlacementCentreComponent,
  setPlacementCentre,
  type PlacementCentre,
} from '../stimulus/placement';
import { DEFAULT_LAUNCH_TUNING } from './controller';
import { installCharacterImpulses } from './impulse';
import { CharacterController } from './system';

/** The bounding sphere of a capsule standing (or crouched) on the origin, as a placement centre. */
export function characterCentre(
  capsule: Frozen<ControllerTuning>['capsule'],
  crouched: boolean,
): PlacementCentre {
  const half = (crouched ? capsule.crouchHeight : capsule.height) / 2;
  return { offset: { x: 0, y: half, z: 0 }, radius: half };
}

/**
 * Keeps every character's placement at its feet (capsule radius) and its placement centre on its
 * capsule (see the file header). Add it after the controller system; needs the placement and
 * placement centre components registered (`installStimuli`).
 */
export function characterPlacementSystem<TInput>(tuning: Frozen<ControllerTuning>): System<TInput> {
  const { capsule } = tuning;
  return {
    name: 'character-placement',
    run: ({ world: w }) => {
      const world: World<never> = w;
      world.query(CharacterController).forEach((entity, state) => {
        placeEntity(world, entity, state.position, capsule.radius);
        const { offset, radius } = characterCentre(capsule, state.crouched);
        if (world.get(entity, PlacementCentreComponent)?.radius !== radius) {
          setPlacementCentre(world, entity, offset, radius);
        }
      });
    },
  };
}

/**
 * Makes every character in `world` a target for force stimuli (see the file header): adds the
 * placement system (call after the controller system is added) and routes force impulses to
 * characters. Needs stimuli installed. Returns the impulse subscription's unsubscribe.
 */
export function installCharacterStimuli<TInput>(
  world: World<TInput>,
  tuning: Frozen<ControllerTuning>,
): () => void {
  world.addSystem(characterPlacementSystem(tuning));
  return installCharacterImpulses(world);
}

/** Gives character `entity` the `pushable` and `weight` (launch.mass) properties. */
export function makePushable(
  world: World<never>,
  entity: EntityId,
  tuning: Frozen<ControllerTuning>,
): void {
  const { mass } = tuning.launch ?? DEFAULT_LAUNCH_TUNING;
  addProperties(world, entity, { pushable: true, weight: mass });
}
