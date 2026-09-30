// The player in the sim (mw-e02.23): the character the ActionFrames drive. Installing the player adds
// one entity at the scene's player-start spawn with a CharacterController and a PlayerLook, and two
// systems run each tick in this order: look (mouse and right stick) turns the player's view yaw, then
// the character controller moves it with the tick's ActionFrame and that yaw.
//
// With `combat` (mw-e04.8) the player also gets a stamina pool, an action timeline and a dodge, and
// four systems run between look and the controller: stamina, dodge input (a dodge press rolls in the
// held direction relative to the view yaw, or backsteps), the action timeline, and dodge motion,
// whose root-motion velocity the controller travels at while a roll or backstep runs.
//
// With `combat.melee` (mw-e04.6) the player is also a knight: the attack button starts the light
// chain, the block button holds its shield up, and it has a combat facing, hitboxes and a placement
// at its feet (the frame its swings are placed in). Three more systems join: block (just before the
// timeline), facing (after it: idle the knight faces where it looks — or its lock-on target — and a
// move's startup turns at 360°/s, then locks) and, after the controller, placement. While it swings
// the knight is planted and while its shield is up it walks at the shield's speed without sprinting
// (`locomotionScale`). The caller registers the hit-volume, damage and placement components, and
// adds the hit-volume system and `installMeleeStrikes` itself (they are world-wide, not the player's).
//
// After the controller, the locomotion system (mw-e02.6) publishes what the player is doing — idle,
// walk, run, airborne, landing… — with its speeds and turn rate, and emits jump, land and footstep
// events, for animation and audio to follow. The player counts as moving while move input is held or
// a dodge's root motion carries it; its facing is the look yaw.
//
// The view yaw and pitch live in the sim (not in the camera) so a replay of ActionFrames alone
// reproduces every turn: the recorded look input (mouse counts, stick deflection) is their only source. Pitch does not move
// the player today, but aiming will (bow, spells: mw-e05.3, mw-e06.15), so it is clamped here once,
// as a rule, rather than in the camera. The orbit camera (src/game/camera, mw-e02.4) only reads them.

import type { ControllerTuning, Frozen, MoveTable, RuntimeShield } from '@content/index';
import { SKIN } from '../character/controller';
import type { CollisionWorld } from '../character/collision-world';
import { radians } from '../character/greybox';
import {
  CharacterController,
  characterControllerSystem,
  spawnCharacter,
} from '../character/system';
import { CharacterLocomotion, giveLocomotion, locomotionSystem } from '../character/locomotion';
import { DodgeComponent, giveDodge, type DodgeMoves } from '../combat/dodge/components';
import { dodgeInputSystem, dodgeMotionSystem, type DodgeFacing } from '../combat/dodge/dodge';
import {
  DEFAULT_STAMINA_PROFILE,
  giveStamina,
  StaminaComponent,
  staminaSystem,
  type StaminaProfile,
} from '../combat/stamina';
import {
  ACTION_TIMELINE_COMPONENTS,
  giveActionInput,
  giveActionTimeline,
} from '../combat/timeline/components';
import { actionTimelineSystem } from '../combat/timeline/timeline';
import { giveHitboxes } from '../combat/hits/components';
import { giveFacing, giveGuard, MELEE_COMPONENTS } from '../combat/melee/components';
import { faceTarget, facingSystem, firstFacing, type FacingRule } from '../combat/melee/facing';
import { blockSystem, locomotionScale } from '../combat/melee/guard';
import { placeEntity } from '../stimulus/placement';
import { defineComponent, type EntityId } from '../core/component';
import type { System, World } from '../core/world';
import { hasCheat } from '../debug/cheats';
import {
  actionButton,
  actionFrameOf,
  type ActionFrame,
  type ActionVector,
} from '../input/action-frame';
import { cos, pow, sin } from '../math';
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
 * How an analog stick turns the view (rate-based: a held deflection turns at a steady speed). The
 * gamepad's right stick feeds it through the ActionFrame's `lookStick` (mw-e02.9).
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
 * Turns every PlayerLook by the tick's look input (see `lookTurn`): the ActionFrame's mouse counts
 * and right-stick deflection together. Pitch stops at the limits.
 */
export function playerLookSystem<TInput>(
  settings: LookSettings = DEFAULT_LOOK_SETTINGS,
): System<TInput> {
  return {
    name: 'player-look',
    run({ world, inputs, clock }) {
      const frame = actionFrameOf(inputs);
      if (frame === undefined) return;
      const turn = lookTurn({ mouse: frame.look, stick: frame.lookStick }, settings, 1 / clock.hz);
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

/** The knight's dodge moves (src/content/data/move). */
export const KNIGHT_DODGE: DodgeMoves = Object.freeze({ roll: 'dodge-roll', backstep: 'backstep' });

/** The move the knight's attack button starts: the root of its light chain (mw-e04.6). */
export const KNIGHT_LIGHT_ATTACK = 'sword-light-1';

/** The knight's sword and shield (mw-e04.6). */
export interface PlayerMeleeOptions {
  /** The shield the block button raises (content `shield`, e.g. the wood shield). */
  readonly shield: RuntimeShield;
  /** The move the attack button starts; defaults to KNIGHT_LIGHT_ATTACK. */
  readonly lightAttack?: string;
  /** The lock-on target to face during startup (lock-on, e02.16); none by default. */
  readonly target?: (world: World<never>, entity: EntityId) => EntityId | undefined;
}

/** The player's combat (mw-e04.8): what its action timeline can perform. */
export interface PlayerCombatOptions {
  /** Every move the player may perform (`compileMoves` of the game content). */
  readonly moves: MoveTable;
  /** The moves the dodge button starts; defaults to KNIGHT_DODGE. */
  readonly dodge?: DodgeMoves;
  /** The stamina pool the moves draw on; defaults to DEFAULT_STAMINA_PROFILE. */
  readonly stamina?: StaminaProfile;
  /** Sword and shield (mw-e04.6); absent = no attacks or block. */
  readonly melee?: PlayerMeleeOptions;
}

/** The horizontal direction a look yaw faces (yaw 0 faces −z). */
export function yawForward(yaw: number): { readonly x: number; readonly y: 0; readonly z: number } {
  return { x: -sin(yaw) + 0, y: 0, z: -cos(yaw) + 0 };
}

/** The player's facing for dodge input: its look yaw (the camera), until lock-on exists. */
const lookFacing: DodgeFacing & FacingRule = (world, entity) => {
  const look = world.get(entity, PlayerLook);
  return look === undefined ? undefined : yawForward(look.yaw);
};

const UP = actionButton(false, false, false);

/** `actions` as the controller may use them at `scale` of normal speed (see `locomotionScale`). */
export function restrainMovement(actions: ActionFrame, scale: number): ActionFrame {
  if (scale === 1) return actions;
  const { x, y } = actions.move;
  return {
    ...actions,
    move: { x: x * scale, y: y * scale },
    sprint: UP,
    jump: scale === 0 ? UP : actions.jump,
  };
}

/** Keeps the player's placement at its feet (the frame its swings are placed in), after it moves. */
function playerPlacementSystem<TInput>(entity: EntityId, radius: number): System<TInput> {
  return {
    name: 'player-placement',
    run: ({ world }) => {
      const state = world.get(entity, CharacterController);
      if (state !== undefined) placeEntity(world, entity, state.position, radius);
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
  /** Stamina, the action timeline and the dodge (see the file header); absent = movement only. */
  readonly combat?: PlayerCombatOptions;
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
  const { combat } = options;
  world.register(CharacterController, CharacterLocomotion, PlayerLook);
  world.addSystem(playerLookSystem(look));
  const melee = combat?.melee;
  if (combat !== undefined) {
    const { moves } = combat;
    world.register(StaminaComponent, ...ACTION_TIMELINE_COMPONENTS, DodgeComponent);
    world.addSystem(staminaSystem()).addSystem(dodgeInputSystem({ facing: lookFacing }));
    if (melee !== undefined) {
      world.register(...MELEE_COMPONENTS);
      world.addSystem(blockSystem({ moves }));
    }
    world.addSystem(actionTimelineSystem({ moves }));
    if (melee !== undefined) {
      const { target } = melee;
      const desired =
        target === undefined ? lookFacing : firstFacing(faceTarget(target), lookFacing);
      world.addSystem(facingSystem({ moves, desired }));
    }
    world.addSystem(dodgeMotionSystem({ moves, facing: lookFacing }));
  }
  world.addSystem(
    characterControllerSystem<TInput>({
      collision: options.collision,
      tuning: options.tuning,
      input: (inputs, entity) => {
        const frame = actionFrameOf(inputs);
        const look = world.get(entity, PlayerLook);
        if (frame === undefined || look === undefined) return undefined;
        const actions =
          combat?.melee === undefined
            ? frame
            : restrainMovement(frame, locomotionScale(world, entity, combat.moves));
        const motion = combat && world.get(entity, DodgeComponent)?.velocity;
        return motion == null
          ? { actions, cameraYaw: look.yaw }
          : { actions, cameraYaw: look.yaw, motion };
      },
      noclip: (entity) => hasCheat(world, entity, 'noclip'),
    }),
  );
  world.addSystem(
    locomotionSystem<TInput>({
      tuning: options.tuning,
      moving: (inputs, entity) => {
        const move = actionFrameOf(inputs)?.move;
        const held = move !== undefined && (move.x !== 0 || move.y !== 0);
        return (
          held || (combat !== undefined && world.get(entity, DodgeComponent)?.velocity != null)
        );
      },
      facing: (entity) => world.get(entity, PlayerLook)?.yaw,
    }),
  );
  const { x, y, z } = start.position;
  const id = spawnCharacter(world, { x, y: y + SKIN, z });
  giveLocomotion(world, id);
  world.add(id, PlayerLook, { yaw: spawnYaw(start), pitch: clampPitch(options.pitch ?? 0, look) });
  if (combat !== undefined) {
    giveStamina(world, id, combat.stamina ?? DEFAULT_STAMINA_PROFILE);
    giveActionTimeline(world, id);
    giveActionInput(
      world,
      id,
      melee === undefined ? {} : { primaryAttack: melee.lightAttack ?? KNIGHT_LIGHT_ATTACK },
    );
    giveDodge(world, id, combat.dodge ?? KNIGHT_DODGE);
  }
  if (melee !== undefined) {
    giveFacing(world, id, yawForward(spawnYaw(start)));
    giveGuard(world, id, melee.shield);
    giveHitboxes(world, id);
    placeEntity(world, id, { x, y: y + SKIN, z }, options.tuning.capsule.radius);
    world.addSystem(playerPlacementSystem(id, options.tuning.capsule.radius));
  }
  return id;
}
