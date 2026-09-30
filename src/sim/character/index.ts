// The player's kinematic character controller (mw-e02.2) and the collision interface it runs on.
// Not exported here, by design: collision-world.contract.ts (Vitest only).
export type { BodyId, Capsule, CollisionHit, CollisionWorld } from './collision-world';
export {
  capsuleOf,
  controllerParams,
  IDLE_INPUT,
  initialCharacterState,
  movementState,
  SKIN,
  stepCharacter,
  type ButtonState,
  type CharacterInput,
  type CharacterState,
  type ControllerContext,
  type ControllerParams,
  type MovementActions,
  type MovementState,
} from './controller';
export { FakeCollisionWorld } from './fake-collision-world';
export {
  box,
  radians,
  rampAngle,
  rampAt,
  type GreyboxBox,
  type GreyboxShape,
  type RampRise,
  type GreyboxRamp,
} from './greybox';
export { NOCLIP_BOOST, stepNoclip } from './noclip';
export {
  CharacterController,
  characterControllerSystem,
  spawnCharacter,
  type CharacterSystemOptions,
} from './system';
export {
  TRAVERSAL_MODES,
  type TraversalContext,
  type TraversalHook,
  type TraversalMode,
} from './traversal';
