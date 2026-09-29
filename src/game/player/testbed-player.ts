// A controllable player in a loaded scene (mw-e02.23): the glue from sampled ActionFrames to a
// capsule on screen. It installs the player into the sim (spawn at the scene's player start, look and
// controller systems; see src/sim/player), resolves collisions against the given CollisionWorld (by
// default the in-memory one built from the scene's greybox colliders), binds a placeholder capsule to
// the player through render sync so it is interpolated like every other entity, and each drawn frame
// points a fixed follow camera at the interpolated capsule and publishes a small read-only readout
// (position, grounded, yaw) for the HUD and the Playwright e2e.
//
// Renderer-agnostic: the caller supplies the capsule object and how an object follows its entity
// (object3DBinding for Three.js). The sim steps only through the frame loop, as ever; nothing here
// mutates the sim after setup.

import type { ControllerTuning, Frozen } from '@content/index';
import {
  CharacterController,
  installPlayer,
  PlayerLook,
  sceneCollisionWorld,
  type CollisionWorld,
  type EntityId,
  type LoadedScene,
  type World,
} from '@sim/index';
import type { RenderSync, SceneBinding, SimView, Transform, Vec3 } from '../loop/render-sync';
import {
  applyCameraPose,
  DEFAULT_FOLLOW_RIG,
  followCameraPose,
  yawOf,
  yawRotation,
  type FollowCameraTarget,
  type FollowRig,
} from './follow-camera';

/** Reads an entity's transform from the sim (what render sync interpolates). */
export type TransformReader = (view: SimView, entity: EntityId) => Transform | undefined;

/** What the player publishes each tick: plain JSON, rounded to 0.1 mm. */
export interface PlayerReadout {
  /** The sim tick the readout was taken after. */
  readonly tick: number;
  /** Feet position, metres. */
  readonly position: Vec3;
  readonly grounded: boolean;
  /** Look yaw, radians (0 looks along −z). */
  readonly yaw: number;
}

export interface TestbedPlayerOptions<TObject, TCommand> {
  readonly world: World<TCommand>;
  /** The loaded scene; the player spawns at its `player-start` spawn. */
  readonly scene: LoadedScene;
  readonly sync: RenderSync;
  readonly tuning: Frozen<ControllerTuning>;
  /** Collision for the controller; defaults to the scene's greybox colliders, in memory. */
  readonly collision?: CollisionWorld;
  /** The placeholder capsule; its origin is the player's feet and it faces −z. */
  readonly object: TObject;
  /** How `object` follows the player (object3DBinding for Three.js). */
  readonly binding: (object: TObject, read: TransformReader) => SceneBinding<TObject>;
  readonly camera: FollowCameraTarget;
  readonly rig?: FollowRig;
  /** Receives a readout after every sim tick that a frame shows (the e2e test hook). */
  readonly publish?: (readout: PlayerReadout) => void;
  /** Mouse look, radians per count. */
  readonly sensitivity?: number;
}

export interface TestbedPlayer {
  readonly entity: EntityId;
  readonly collision: CollisionWorld;
  /** Whether the follow camera drives the camera (off while the debug camera flies). */
  followCamera: boolean;
  /** Call once per drawn frame, after render sync and before drawing. */
  frame(): void;
  /** The player's state now, or undefined once disposed. */
  readout(): PlayerReadout | undefined;
  /** Unbinds the capsule and removes the player (its systems stay; they find no player). */
  dispose(): void;
}

const round = (n: number): number => Math.round(n * 1e4) / 1e4 + 0;

/** The player's transform: its feet, turned to its look yaw. */
export const readPlayerTransform: TransformReader = (view, entity) => {
  const state = view.get(entity, CharacterController);
  const look = view.get(entity, PlayerLook);
  if (state === undefined || look === undefined) return undefined;
  return { position: state.position, rotation: yawRotation(look.yaw) };
};

/** Puts a controllable player into `options.scene`. Call between sim steps, after loading. */
export function setupTestbedPlayer<TObject, TCommand>(
  options: TestbedPlayerOptions<TObject, TCommand>,
): TestbedPlayer {
  const { world, scene, sync, camera, publish } = options;
  const rig = options.rig ?? DEFAULT_FOLLOW_RIG;
  const collision = options.collision ?? sceneCollisionWorld(scene.layout);
  const entity = installPlayer(world, {
    spawns: scene.layout.spawns,
    collision,
    tuning: options.tuning,
    ...(options.sensitivity !== undefined && { sensitivity: options.sensitivity }),
  });

  // Remember the interpolated transform render sync last applied: the camera follows exactly what
  // is drawn.
  let shown: Transform | undefined;
  const inner = options.binding(options.object, readPlayerTransform);
  sync.bind(entity, {
    ...inner,
    apply(object, transform) {
      inner.apply(object, transform);
      shown = transform;
    },
  });

  const readout = (): PlayerReadout | undefined => {
    const state = world.get(entity, CharacterController);
    const look = world.get(entity, PlayerLook);
    if (state === undefined || look === undefined) return undefined;
    const { x, y, z } = state.position;
    return {
      tick: world.tick,
      position: { x: round(x), y: round(y), z: round(z) },
      grounded: state.grounded,
      yaw: round(look.yaw),
    };
  };

  let publishedTick = -1;
  const player: TestbedPlayer = {
    entity,
    collision,
    followCamera: true,
    frame() {
      if (player.followCamera && shown !== undefined) {
        applyCameraPose(camera, followCameraPose(shown.position, yawOf(shown.rotation), rig));
      }
      if (publish === undefined || world.tick === publishedTick) return;
      const current = readout();
      if (current === undefined) return;
      publishedTick = world.tick;
      publish(current);
    },
    readout,
    dispose() {
      sync.unbind(entity);
      if (world.isAlive(entity)) world.destroy(entity);
      shown = undefined;
    },
  };
  player.frame(); // camera and readout in place before the first frame
  return player;
}
