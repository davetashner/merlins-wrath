// The player in the sim (mw-e02.23): the character the ActionFrames drive. Installing the player adds
// one entity at the scene's player-start spawn with a CharacterController and a PlayerLook, and two
// systems run each tick in this order: mouse look turns the player's view yaw, then the character
// controller moves it with the tick's ActionFrame and that yaw.
//
// The view yaw lives in the sim (not in the camera) so a replay of ActionFrames alone reproduces
// every turn: the recorded look deltas are the only source of yaw. The follow camera (src/game/player,
// and later the orbit camera, mw-e02.4) only reads it.

import type { ControllerTuning, Frozen } from '@content/index';
import { SKIN } from '../character/controller';
import type { CollisionWorld } from '../character/collision-world';
import { radians } from '../character/greybox';
import {
  CharacterController,
  characterControllerSystem,
  spawnCharacter,
} from '../character/system';
import { defineComponent, type EntityId } from '../core/component';
import type { System, World } from '../core/world';
import { actionFrameOf } from '../input/action-frame';
import type { SceneSpawnPlacement } from '../scene/layout';

/** The tag that marks a scene's player spawn. */
export const PLAYER_START_TAG = 'player-start';

/** Radians of yaw per mouse count (the same feel as the debug camera until settings, mw-e31). */
export const PLAYER_LOOK_SENSITIVITY = 0.003;

/** Where the player looks: yaw about +y, radians in (−π, π]; 0 looks along −z, positive turns left. */
export interface PlayerLook {
  readonly yaw: number;
}

export const PlayerLook = defineComponent<PlayerLook>('player.look');

const TAU = 2 * Math.PI;

/** `yaw` wrapped into (−π, π]. */
export function wrapYaw(yaw: number): number {
  const wrapped = yaw - TAU * Math.round(yaw / TAU);
  return wrapped <= -Math.PI ? wrapped + TAU : wrapped;
}

/**
 * The look yaw that faces a spawn's direction. A scene yaw of 0 faces +z and turns counter-clockwise
 * seen from above; look yaw 0 faces −z, so the two differ by a half turn.
 */
export function spawnYaw(spawn: Pick<SceneSpawnPlacement, 'yaw'>): number {
  return wrapYaw(radians(spawn.yaw) + Math.PI);
}

/** The scene's player spawn: the first one tagged `player-start`, if any. */
export function playerStart(
  spawns: readonly SceneSpawnPlacement[],
): SceneSpawnPlacement | undefined {
  return spawns.find((spawn) => spawn.tags.includes(PLAYER_START_TAG));
}

/** Turns every PlayerLook by the tick's mouse look: moving the mouse right turns right. */
export function playerLookSystem<TInput>(sensitivity = PLAYER_LOOK_SENSITIVITY): System<TInput> {
  return {
    name: 'player-look',
    run({ world, inputs }) {
      const turn = actionFrameOf(inputs)?.look.x ?? 0;
      if (turn === 0) return;
      world.query(PlayerLook).forEach((id, look) => {
        world.set(id, PlayerLook, { yaw: wrapYaw(look.yaw - turn * sensitivity) });
      });
    },
  };
}

export interface PlayerOptions {
  /** The loaded scene's spawns; the player starts at the one tagged `player-start`. */
  readonly spawns: readonly SceneSpawnPlacement[];
  readonly collision: CollisionWorld;
  readonly tuning: Frozen<ControllerTuning>;
  /** Radians per mouse count; defaults to PLAYER_LOOK_SENSITIVITY. */
  readonly sensitivity?: number;
}

/** Thrown when a scene has no spawn tagged `player-start`. */
export class NoPlayerStartError extends Error {
  override readonly name = 'NoPlayerStartError';
}

/**
 * Adds the player to `world`: registers its components, adds the look and controller systems and
 * spawns it at the player start, facing the spawn's direction. Once per world, between steps. The
 * feet start SKIN above the spawn, where the controller rests on flat ground, so an idle player
 * does not move on its first tick.
 * @throws NoPlayerStartError when no spawn is tagged `player-start` (the world is left unchanged).
 */
export function installPlayer<TInput>(world: World<TInput>, options: PlayerOptions): EntityId {
  const start = playerStart(options.spawns);
  if (start === undefined) {
    throw new NoPlayerStartError(`the scene has no spawn tagged "${PLAYER_START_TAG}"`);
  }
  world.register(CharacterController, PlayerLook);
  world.addSystem(playerLookSystem(options.sensitivity)).addSystem(
    characterControllerSystem<TInput>({
      collision: options.collision,
      tuning: options.tuning,
      input: (inputs, entity) => {
        const actions = actionFrameOf(inputs);
        const look = world.get(entity, PlayerLook);
        return actions === undefined || look === undefined
          ? undefined
          : { actions, cameraYaw: look.yaw };
      },
    }),
  );
  const { x, y, z } = start.position;
  const id = spawnCharacter(world, { x, y: y + SKIN, z });
  world.add(id, PlayerLook, { yaw: spawnYaw(start) });
  return id;
}
