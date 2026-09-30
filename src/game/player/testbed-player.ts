// A controllable player in a loaded scene (mw-e02.23): the glue from sampled ActionFrames to a
// capsule on screen. It installs the player into the sim (spawn at the scene's player start, look and
// controller systems; see src/sim/player), resolves collisions against the given CollisionWorld (the
// game passes RapierCollisionWorld over the sim's physics, mw-e02.21), binds a placeholder capsule to
// the player through render sync so it is interpolated like every other entity, and each drawn frame
// places the orbit camera (mw-e02.4, src/game/camera) behind the interpolated capsule and publishes
// small read-only readouts for the HUD and the Playwright e2e: the player's state after every sim
// tick, and the camera's after every frame it drives.
//
// With `interaction` (mw-e02.5) the player can also focus and interact with world objects: the
// sim's interaction system runs after the controller, the scene's interactable spawns get their
// affordances, and `prompt()` returns what the contextual prompt should show.
//
// Renderer-agnostic: the caller supplies the capsule object and how an object follows its entity
// (object3DBinding for Three.js). The sim steps only through the frame loop, as ever; nothing here
// mutates the sim after setup (the camera's collision queries are read-only).

import type { CameraTuning, ControllerTuning, Frozen, MoveTable } from '@content/index';
import {
  addInteractor,
  addSceneInteractables,
  ActionTimelineComponent,
  CharacterController,
  installInteraction,
  installPlayer,
  interacted,
  interactionPrompt,
  PlayerLook,
  type BodyId,
  staminaOf,
  type PlayerMeleeOptions,
  type CollisionWorld,
  type EntityId,
  type Interaction,
  type InteractionPrompt,
  type InteractorKit,
  type LoadedScene,
  type SightWorld,
  type World,
} from '@sim/index';
import {
  applyOrbitPose,
  lookSettings,
  nearPlaneClear,
  OrbitCamera,
  toRadians,
  type OrbitCameraTarget,
} from '../camera';
import type { FrameInfo } from '../loop';
import type { Quat, RenderSync, SceneBinding, SimView, Transform, Vec3 } from '../loop/render-sync';

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
  /** Look pitch, radians above the horizon. */
  readonly pitch: number;
  /** Combat state, when the player has moves (mw-e04.6): the e2e reads the chain from it. */
  readonly combat?: PlayerCombatReadout;
}

/** The player's combat state in a readout. */
export interface PlayerCombatReadout {
  /** The move in progress, or null when idle. */
  readonly action: string | null;
  /** Stamina now (rounded to 0.1 mm like positions: 1e-4). */
  readonly stamina: number;
  /** The shield is up. */
  readonly blocking: boolean;
}

/** What the orbit camera publishes each frame it drives (the e2e clipping probe reads it). */
export interface CameraReadout {
  /** Frames the orbit camera has placed the camera for. */
  readonly frames: number;
  /** Of those, frames whose near plane touched geometry (nearPlaneClear failed): must stay 0. */
  readonly clipped: number;
  /** Of those, frames where collision held the boom short of the zoom distance. */
  readonly pulledIn: number;
  /** This frame's boom length and zoom distance, metres (rounded to 0.1 mm). */
  readonly boom: number;
  readonly zoom: number;
  /** This frame's camera position (rounded to 0.1 mm). */
  readonly position: Vec3;
}

/**
 * The player's interactions (mw-e02.5). Register the placement component and the world properties
 * on the world first (the focus reads both).
 */
export interface TestbedInteractionOptions {
  /** Solid colliders that block reach: RapierSightWorld over the world's physics. */
  readonly sight?: SightWorld;
  /** Colliders belonging to an entity, which never block reach to it. */
  readonly bodiesOf?: (entity: EntityId) => readonly BodyId[];
  /** The player's capabilities and items (none until classes and inventory arrive). */
  readonly kit?: Partial<InteractorKit>;
  /** Receives every interaction the player completes (the e2e hook). */
  readonly publish?: (interaction: Interaction) => void;
}

export interface TestbedPlayerOptions<TObject, TCommand> {
  readonly world: World<TCommand>;
  /** The loaded scene; the player spawns at its `player-start` spawn. */
  readonly scene: LoadedScene;
  readonly sync: RenderSync;
  readonly tuning: Frozen<ControllerTuning>;
  /** The orbit camera and look tuning (content `camera`, `player`). */
  readonly cameraTuning: Frozen<CameraTuning>;
  /** Collision for the controller and the camera: RapierCollisionWorld over the world's physics. */
  readonly collision: CollisionWorld;
  /** The placeholder capsule; its origin is the player's feet and it faces −z. */
  readonly object: TObject;
  /** How `object` follows the player (object3DBinding for Three.js). */
  readonly binding: (object: TObject, read: TransformReader) => SceneBinding<TObject>;
  readonly camera: OrbitCameraTarget;
  /** Receives a readout after every sim tick that a frame shows (the e2e test hook). */
  readonly publish?: (readout: PlayerReadout) => void;
  /** Receives the camera's readout after every frame it drives (the e2e clipping probe). */
  readonly publishCamera?: (readout: CameraReadout) => void;
  /** Mouse look, radians per count; defaults to the camera tuning's. */
  readonly sensitivity?: number;
  /**
   * The moves the player may perform (`compileMoves` of the game content): gives it stamina, an
   * action timeline and the dodge roll and backstep (mw-e04.8). Absent = movement only.
   */
  readonly moves?: MoveTable;
  /** Lets the player focus and interact with world objects (mw-e02.5). */
  readonly interaction?: TestbedInteractionOptions;
  /**
   * Sword and shield (mw-e04.6), with `moves`: the light chain and the block. The caller registers
   * the hit-volume, damage and placement components and wires the strikes (see installPlayer).
   */
  readonly melee?: PlayerMeleeOptions;
}

export interface TestbedPlayer {
  readonly entity: EntityId;
  /** Whether the orbit camera drives the camera (off while the debug camera flies). */
  drivesCamera: boolean;
  /** Call once per drawn frame, after render sync and before drawing. */
  frame(info?: Pick<FrameInfo, 'alpha' | 'timeMs'>): void;
  /** Zooms the orbit camera by whole mouse-wheel notches (positive = out). */
  zoom(notches: number): void;
  /** The player's state now, or undefined once disposed. */
  readout(): PlayerReadout | undefined;
  /** What the Interact prompt shows now; undefined with nothing in focus or no interaction. */
  prompt(): InteractionPrompt | undefined;
  /** Unbinds the capsule and removes the player (its systems stay; they find no player). */
  dispose(): void;
}

const round = (n: number): number => Math.round(n * 1e4) / 1e4 + 0;
const roundVec = ({ x, y, z }: Vec3): Vec3 => ({ x: round(x), y: round(y), z: round(z) });

/** The yaw (radians about +y) of a rotation about +y only, as the player's transform carries. */
export function yawOf(rotation: Quat): number {
  return 2 * Math.atan2(rotation.y, rotation.w);
}

/** The rotation of `yaw` radians about +y. */
export function yawRotation(yaw: number): Quat {
  return { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
}

/** The player's transform: its feet, turned to its look yaw. */
export const readPlayerTransform: TransformReader = (view, entity) => {
  const state = view.get(entity, CharacterController);
  const look = view.get(entity, PlayerLook);
  if (state === undefined || look === undefined) return undefined;
  return { position: state.position, rotation: yawRotation(look.yaw) };
};

/** Seconds between two frame timestamps; 0 for the first frame or a clock that went back. */
const secondsSince = (last: number | undefined, now: number): number =>
  last === undefined ? 0 : Math.max(0, now - last) / 1000;

/** Puts a controllable player into `options.scene`. Call between sim steps, after loading. */
export function setupTestbedPlayer<TObject, TCommand>(
  options: TestbedPlayerOptions<TObject, TCommand>,
): TestbedPlayer {
  const { world, scene, sync, camera, publish, publishCamera, collision, tuning } = options;
  const cameraTuning = options.cameraTuning;
  const look = lookSettings(cameraTuning);
  const entity = installPlayer(world, {
    spawns: scene.layout.spawns,
    collision,
    tuning,
    look: {
      ...look,
      ...(options.sensitivity !== undefined && { sensitivity: options.sensitivity }),
    },
    pitch: toRadians(cameraTuning.pitch.initial),
    ...(options.moves !== undefined && {
      combat: {
        moves: options.moves,
        ...(options.melee !== undefined && { melee: options.melee }),
      },
    }),
  });
  const orbit = new OrbitCamera(cameraTuning, collision);
  const interaction = options.interaction;
  let unsubscribe: (() => void) | undefined;
  if (interaction !== undefined) {
    const { sight, bodiesOf, publish: publishInteraction } = interaction;
    installInteraction(world, {
      ...(sight !== undefined && { sight }),
      ...(bodiesOf !== undefined && { bodiesOf: (_world, target) => bodiesOf(target) }),
    });
    addInteractor(world, entity, interaction.kit);
    addSceneInteractables(world, scene.spawns);
    if (publishInteraction !== undefined) {
      unsubscribe = world.events.on(interacted, (event) => {
        if (event.actor === entity) publishInteraction(event);
      });
    }
  }
  const hasMoves = options.moves !== undefined;

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
    const view = world.get(entity, PlayerLook);
    if (state === undefined || view === undefined) return undefined;
    // Only a player with moves has a timeline (and the components are only registered then).
    const timeline = hasMoves ? world.get(entity, ActionTimelineComponent) : undefined;
    const pool = timeline === undefined ? undefined : staminaOf(world, entity);
    return {
      tick: world.tick,
      position: roundVec(state.position),
      grounded: state.grounded,
      yaw: round(view.yaw),
      pitch: round(view.pitch),
      ...(timeline !== undefined && {
        combat: {
          action: timeline.current?.move ?? null,
          stamina: round(pool?.current ?? 0),
          blocking: pool?.blocking ?? false,
        },
      }),
    };
  };

  // Pitch is not part of the interpolated transform (the capsule does not tilt), so it is
  // interpolated here between the last two ticks the camera saw, as render sync does for yaw.
  let pitchTick: number | undefined;
  let pitchBefore = 0;
  let pitchNow = 0;
  const drawnPitch = (current: number, alpha: number): number => {
    if (pitchTick === undefined) pitchNow = current;
    if (world.tick !== pitchTick) {
      pitchBefore = pitchNow;
      pitchNow = current;
      pitchTick = world.tick;
    }
    return pitchBefore + (pitchNow - pitchBefore) * alpha;
  };

  const counts = { frames: 0, clipped: 0, pulledIn: 0 };
  let lastMs: number | undefined;
  let publishedTick = -1;
  let drove = false;
  let drivesCamera = true;

  const placeCamera = (alpha: number, dt: number): void => {
    const state = world.get(entity, CharacterController);
    const look = world.get(entity, PlayerLook);
    if (shown === undefined || state === undefined || look === undefined) return;
    const height = state.crouched ? tuning.capsule.crouchHeight : tuning.capsule.height;
    // Coming back from the debug camera is a cut: no recovery from wherever it last was.
    if (!drove) orbit.cut();
    drove = true;
    const pose = orbit.update(
      {
        feet: shown.position,
        yaw: yawOf(shown.rotation),
        pitch: drawnPitch(look.pitch, alpha),
        height,
      },
      camera,
      dt,
    );
    applyOrbitPose(camera, pose);
    if (publishCamera === undefined) return;
    counts.frames += 1;
    if (!nearPlaneClear(collision, pose, camera)) counts.clipped += 1;
    if (pose.boom < pose.ideal - 1e-6) counts.pulledIn += 1;
    publishCamera({
      ...counts,
      boom: round(pose.boom),
      zoom: round(pose.ideal),
      position: roundVec(pose.position),
    });
  };

  const player: TestbedPlayer = {
    entity,
    get drivesCamera() {
      return drivesCamera;
    },
    set drivesCamera(value: boolean) {
      drivesCamera = value;
      if (!value) drove = false;
    },
    frame(info) {
      const dt = info === undefined ? 0 : secondsSince(lastMs, info.timeMs);
      if (info !== undefined) lastMs = info.timeMs;
      if (drivesCamera) placeCamera(info?.alpha ?? 1, dt);
      if (publish === undefined || world.tick === publishedTick) return;
      const current = readout();
      if (current === undefined) return;
      publishedTick = world.tick;
      publish(current);
    },
    zoom(notches) {
      orbit.zoomBy(notches);
    },
    readout,
    prompt() {
      if (interaction === undefined || !world.isAlive(entity)) return undefined;
      return interactionPrompt(world, entity);
    },
    dispose() {
      unsubscribe?.();
      sync.unbind(entity);
      if (world.isAlive(entity)) world.destroy(entity);
      shown = undefined;
    },
  };
  player.frame(); // camera and readout in place before the first frame
  return player;
}
