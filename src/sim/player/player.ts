// The player in the sim (mw-e02.23): the character the ActionFrames drive. Installing the player adds
// one entity at the scene's player-start spawn with a CharacterController and a PlayerLook, and two
// systems run each tick in this order: mouse look turns the player's view yaw, then the character
// controller moves it with the tick's ActionFrame and that yaw.
//
// The view yaw and pitch live in the sim (not in the camera) so a replay of ActionFrames alone
// reproduces every turn: the recorded look deltas are the only source of both. Pitch does not move
// the player today, but aiming will (bow, spells: mw-e05.3, mw-e06.15), so it is clamped here once,
// as a rule, rather than in the camera. The orbit camera (src/game/camera, mw-e02.4) only reads them.

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
import { actionFrameOf, type ActionVector } from '../input/action-frame';
import { pow } from '../math';
import type { SceneSpawnPlacement } from '../scene/layout';

/** The tag that marks a scene's player spawn. */
export const PLAYER_START_TAG = 'player-start';

/** Radians of yaw per mouse count (the same feel as the debug camera until settings, mw-e31). */
export const PLAYER_LOOK_SENSITIVITY = 0.003;

/**
 * Where the player looks. Yaw is about +y, radians in (−π, π]; 0 looks along −z, positive turns
 * left. Pitch is radians above the horizon (positive looks up), within the look settings' limits.
 */
export interface PlayerLook {
  readonly yaw: number;
  readonly pitch: number;
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

/**
 * How an analog stick turns the view (rate-based: a held deflection turns at a steady speed). No
 * gamepad feeds it yet (mw-e02.9); `lookTurn` already maps a stick, so it can without touching the
 * camera or the look state.
 */
export interface StickLookSettings {
  /** Deflection at or below this (0–1, radial) is ignored. */
  readonly deadzone: number;
  /** Response curve exponent over the live range: 1 is linear, 2 gives finer aim near centre. */
  readonly exponent: number;
  /** Turn rate at full deflection, radians per second. */
  readonly yawRate: number;
  /** Pitch rate at full deflection, radians per second. */
  readonly pitchRate: number;
}

/** How look input turns the view. The game passes the camera content's values (mw-e02.4). */
export interface LookSettings {
  /** Mouse: radians per mouse count, both axes (a delta, so no time scaling). */
  readonly sensitivity: number;
  /** Looking up (mouse or stick) looks down. */
  readonly invertY: boolean;
  /** Lowest pitch, radians (looking down); ≤ 0. */
  readonly minPitch: number;
  /** Highest pitch, radians (looking up); ≥ 0. */
  readonly maxPitch: number;
  readonly stick: StickLookSettings;
}

/** The defaults: the bead's clamp of −70°..+60° (mw-e02.4 AC-1). */
export const DEFAULT_LOOK_SETTINGS: LookSettings = Object.freeze({
  sensitivity: PLAYER_LOOK_SENSITIVITY,
  invertY: false,
  minPitch: radians(-70),
  maxPitch: radians(60),
  stick: Object.freeze({
    deadzone: 0.15,
    exponent: 2,
    yawRate: radians(240),
    pitchRate: radians(160),
  }),
});

/** One tick of look input, from any device: x right, y up. */
export interface LookInput {
  /** Mouse movement this tick, raw counts. */
  readonly mouse?: ActionVector;
  /** Stick deflection, each axis −1..1. */
  readonly stick?: ActionVector;
}

/** A view turn, radians: yaw (positive turns left) and pitch (positive looks up). */
export interface LookTurn {
  readonly yaw: number;
  readonly pitch: number;
}

/** The stick's rate as a fraction of full speed per axis, after the deadzone and response curve. */
export function stickResponse(stick: ActionVector, settings: StickLookSettings): ActionVector {
  const length = Math.sqrt(stick.x * stick.x + stick.y * stick.y);
  if (length <= settings.deadzone) return { x: 0, y: 0 };
  const live = (Math.min(1, length) - settings.deadzone) / (1 - settings.deadzone);
  const scale = pow(live, settings.exponent) / length;
  return { x: stick.x * scale, y: stick.y * scale };
}

/**
 * How far `input` turns the view in one tick of `dt` seconds: mouse counts × sensitivity (a delta),
 * plus the stick's response × its rates × dt (a rate). Moving right turns right; up looks up.
 */
export function lookTurn(input: LookInput, settings: LookSettings, dt: number): LookTurn {
  const up = settings.invertY ? -1 : 1;
  let yaw = 0;
  let pitch = 0;
  if (input.mouse !== undefined) {
    yaw -= input.mouse.x * settings.sensitivity;
    pitch += input.mouse.y * settings.sensitivity * up;
  }
  if (input.stick !== undefined) {
    const rate = stickResponse(input.stick, settings.stick);
    yaw -= rate.x * settings.stick.yawRate * dt;
    pitch += rate.y * settings.stick.pitchRate * dt * up;
  }
  return { yaw: yaw + 0, pitch: pitch + 0 };
}

/** `pitch` clamped to the settings' limits. */
export function clampPitch(
  pitch: number,
  { minPitch, maxPitch }: Pick<LookSettings, 'minPitch' | 'maxPitch'>,
): number {
  return Math.min(maxPitch, Math.max(minPitch, pitch));
}

/**
 * Turns every PlayerLook by the tick's look input (see `lookTurn`); pitch stops at the limits. The
 * ActionFrame carries mouse counts today; mw-e02.9 adds a stick vector and passes it here too.
 */
export function playerLookSystem<TInput>(
  settings: LookSettings = DEFAULT_LOOK_SETTINGS,
): System<TInput> {
  return {
    name: 'player-look',
    run({ world, inputs, clock }) {
      const frame = actionFrameOf(inputs);
      if (frame === undefined) return;
      const turn = lookTurn({ mouse: frame.look }, settings, 1 / clock.hz);
      if (turn.yaw === 0 && turn.pitch === 0) return;
      world.query(PlayerLook).forEach((id, current) => {
        world.set(id, PlayerLook, {
          yaw: wrapYaw(current.yaw + turn.yaw),
          pitch: clampPitch(current.pitch + turn.pitch, settings),
        });
      });
    },
  };
}

export interface PlayerOptions {
  /** The loaded scene's spawns; the player starts at the one tagged `player-start`. */
  readonly spawns: readonly SceneSpawnPlacement[];
  readonly collision: CollisionWorld;
  readonly tuning: Frozen<ControllerTuning>;
  /** Look input; each setting defaults to DEFAULT_LOOK_SETTINGS. */
  readonly look?: Partial<LookSettings>;
  /** The pitch the player starts with, radians (clamped to the limits); defaults to level (0). */
  readonly pitch?: number;
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
  const look: LookSettings = { ...DEFAULT_LOOK_SETTINGS, ...options.look };
  world.register(CharacterController, PlayerLook);
  world.addSystem(playerLookSystem(look)).addSystem(
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
  world.add(id, PlayerLook, { yaw: spawnYaw(start), pitch: clampPitch(options.pitch ?? 0, look) });
  return id;
}
