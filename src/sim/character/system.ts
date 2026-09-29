// The character controller inside the sim world (mw-e02.2): a component holding each character's
// controller state (so it is snapshotted, hashed and replayed) and a system that steps every
// character once per tick with that tick's input.

import type { ControllerTuning, Frozen } from '@content/index';
import { defineComponent, type EntityId } from '../core/component';
import type { System, World } from '../core/world';
import type { Vec3 } from '../stimulus/shapes';
import type { CollisionWorld } from './collision-world';
import {
  controllerParams,
  IDLE_INPUT,
  initialCharacterState,
  stepCharacter,
  type CharacterInput,
  type CharacterState,
} from './controller';
import type { TraversalHook } from './traversal';

/** A character moved by the kinematic controller. */
export const CharacterController = defineComponent<CharacterState>('character.controller');

/** Adds a character with its feet at `feet` to `world` (register CharacterController first). */
export function spawnCharacter<TInput>(world: World<TInput>, feet: Vec3): EntityId {
  const id = world.spawn();
  world.add(id, CharacterController, initialCharacterState(feet));
  return id;
}

export interface CharacterSystemOptions<TInput> {
  readonly collision: CollisionWorld;
  readonly tuning: Frozen<ControllerTuning>;
  /** Traversal modes in priority order. */
  readonly hooks?: readonly TraversalHook[];
  /** This tick's input for `entity`, picked from the tick's commands; undefined = idle. */
  readonly input: (inputs: readonly TInput[], entity: EntityId) => CharacterInput | undefined;
}

/** A system stepping every CharacterController once per tick. */
export function characterControllerSystem<TInput>(
  options: CharacterSystemOptions<TInput>,
): System<TInput> {
  const { collision, tuning, hooks = [] } = options;
  return {
    name: 'character-controller',
    run({ world, inputs, clock }) {
      const params = controllerParams(tuning, clock);
      const context = { world: collision, tuning, params, hooks };
      world.query(CharacterController).forEach((id, state) => {
        const input = options.input(inputs, id) ?? IDLE_INPUT;
        world.set(id, CharacterController, stepCharacter(state, input, context));
      });
    },
  };
}
