import type { ControllerTuning, Frozen } from '@content/index';
import { describe, expect, it } from 'vitest';
import { SKIN } from '../character/controller';
import { CharacterController, spawnCharacter } from '../character/system';
import { World } from '../core/world';
import {
  actionFrame,
  actionButton,
  actionVector,
  IDLE_ACTION_FRAME,
  type ActionFrame,
  type ButtonAction,
} from '../input/action-frame';
import { sceneCollisionWorld } from '../scene/collision';
import { TEST_SCENE, testKit } from '../scene/fixtures';
import { layoutScene, type SceneSpawnPlacement } from '../scene/layout';
import { hashWorld } from '../snapshot';
import {
  installPlayer,
  NoPlayerStartError,
  PLAYER_LOOK_SENSITIVITY,
  PlayerLook,
  playerLookSystem,
  playerStart,
  spawnYaw,
  wrapYaw,
} from './player';

const TUNING: Frozen<ControllerTuning> = {
  capsule: { radius: 0.35, height: 1.8, crouchHeight: 1.0 },
  speeds: { run: 5, sprint: 7.5, crouch: 2.2 },
  accelTime: 0.15,
  decelTime: 0.1,
  airControl: 0.3,
  gravity: 25,
  maxFallSpeed: 40,
  jumpApex: 1.2,
  coyoteMs: 120,
  jumpBufferMs: 150,
  stepHeight: 0.35,
  slopeLimit: 45,
};

const LAYOUT = layoutScene(TEST_SCENE, testKit);

interface FrameSpec {
  move?: [number, number];
  look?: number;
  pressed?: ButtonAction[];
  held?: ButtonAction[];
}

function frame({ move = [0, 0], look = 0, pressed = [], held = [] }: FrameSpec): ActionFrame {
  return actionFrame({
    move: actionVector(move[0], move[1]),
    look: actionVector(look, 0),
    buttons: (action) => actionButton(pressed.includes(action), held.includes(action), false),
  });
}

function setup(sensitivity?: number) {
  const world = new World<ActionFrame>({ seed: 3 });
  const player = installPlayer(world, {
    spawns: LAYOUT.spawns,
    collision: sceneCollisionWorld(LAYOUT),
    tuning: TUNING,
    ...(sensitivity !== undefined && { sensitivity }),
  });
  const state = () => {
    const value = world.get(player, CharacterController);
    if (value === undefined) throw new Error('no player');
    return value;
  };
  const yaw = () => world.get(player, PlayerLook)?.yaw;
  return { world, player, state, yaw };
}

const spawn = (yaw: SceneSpawnPlacement['yaw'], tags: string[]) =>
  ({ ...LAYOUT.spawns[0], yaw, tags }) as SceneSpawnPlacement;

describe('wrapYaw', () => {
  it('keeps angles in (−π, π]', () => {
    expect(wrapYaw(0)).toBe(0);
    expect(wrapYaw(1)).toBe(1);
    expect(wrapYaw(Math.PI)).toBe(Math.PI);
    expect(wrapYaw(-Math.PI)).toBe(Math.PI);
    expect(wrapYaw(3 * Math.PI)).toBeCloseTo(Math.PI, 12);
    expect(wrapYaw(1.5 * Math.PI)).toBeCloseTo(-Math.PI / 2, 12);
    expect(wrapYaw(-1.5 * Math.PI)).toBeCloseTo(Math.PI / 2, 12);
  });
});

describe('player spawn (mw-e02.23)', () => {
  it('faces the spawn direction: scene yaw 0 looks along +z, 90 along +x', () => {
    expect(spawnYaw({ yaw: 0 })).toBe(Math.PI);
    expect(spawnYaw({ yaw: 90 })).toBeCloseTo(-Math.PI / 2, 12);
    expect(spawnYaw({ yaw: 180 })).toBe(0);
    expect(spawnYaw({ yaw: 270 })).toBeCloseTo(Math.PI / 2, 12);
  });

  it('finds the spawn tagged player-start', () => {
    expect(playerStart(LAYOUT.spawns)?.id).toBe('player-start');
    expect(playerStart([spawn(0, ['crate']), spawn(90, ['x', 'player-start'])])?.yaw).toBe(90);
    expect(playerStart([spawn(0, [])])).toBeUndefined();
  });

  it('spawns the player at the player start, resting SKIN above it, facing its direction', () => {
    const { state, yaw } = setup();
    expect(state().position).toEqual({ x: 0, y: SKIN, z: -2 });
    expect(yaw()).toBe(Math.PI);
  });

  it('throws NoPlayerStartError and leaves the world untouched when no spawn is tagged', () => {
    const world = new World<ActionFrame>({ seed: 3 });
    expect(() =>
      installPlayer(world, {
        spawns: [spawn(0, [])],
        collision: sceneCollisionWorld(LAYOUT),
        tuning: TUNING,
      }),
    ).toThrow(NoPlayerStartError);
    expect(world.entityCount).toBe(0);
    expect(() => world.register(CharacterController, PlayerLook)).not.toThrow();
  });

  it('an idle player does not move from its spawn', () => {
    const { world, state } = setup();
    const start = state().position;
    for (let i = 0; i < 30; i++) world.step([IDLE_ACTION_FRAME]);
    for (let i = 0; i < 30; i++) world.step([]);
    expect(state().position.x).toBe(start.x);
    expect(state().position.z).toBe(start.z);
    expect(state().position.y).toBeCloseTo(start.y, 9);
    expect(state().grounded).toBe(true);
  });
});

describe('ActionFrames drive the player (mw-e02.23)', () => {
  it('forward moves the player the way it faces (+z at the testbed start)', () => {
    const { world, state } = setup();
    for (let i = 0; i < 60; i++) world.step([frame({ move: [0, 1] })]);
    expect(state().position.z).toBeGreaterThan(-2 + 4);
    expect(state().position.x).toBeCloseTo(0, 9);
  });

  it('jump leaves the ground and lands again', () => {
    const { world, state } = setup();
    world.step([frame({ pressed: ['jump'], held: ['jump'] })]);
    const heights: number[] = [];
    for (let i = 0; i < 59; i++) {
      world.step([frame({})]);
      heights.push(state().position.y);
    }
    expect(Math.max(...heights)).toBeGreaterThan(1);
    expect(state().grounded).toBe(true);
  });

  it('mouse look turns the player: right is a turn to the right (yaw decreases)', () => {
    const { world, yaw } = setup();
    world.step([frame({ look: 100 })]);
    expect(yaw()).toBeCloseTo(Math.PI - 100 * PLAYER_LOOK_SENSITIVITY, 12);
    world.step([frame({ look: -100 })]);
    expect(yaw()).toBeCloseTo(Math.PI, 12);
    world.step([frame({ look: -100 })]); // crosses π and wraps
    expect(yaw()).toBeCloseTo(-Math.PI + 100 * PLAYER_LOOK_SENSITIVITY, 12);
  });

  it('no look (or no frame) leaves the yaw as it is', () => {
    const { world, yaw } = setup();
    world.step([frame({})]);
    world.step([]);
    expect(yaw()).toBe(Math.PI);
  });

  it('turning then running forward moves along the new facing', () => {
    const { world, state } = setup(Math.PI / 2 / 100);
    world.step([frame({ look: 100 })]); // a quarter turn right: now facing −x
    for (let i = 0; i < 30; i++) world.step([frame({ move: [0, 1] })]);
    expect(state().position.x).toBeLessThan(-1);
    expect(state().position.z).toBeCloseTo(-2, 6);
  });

  it('other characters (no PlayerLook) get no input from the frames', () => {
    const { world } = setup();
    const other = spawnCharacter(world, { x: 2, y: SKIN, z: 2 });
    for (let i = 0; i < 30; i++) world.step([frame({ move: [0, 1] })]);
    const position = world.get(other, CharacterController)?.position;
    expect(position?.x).toBe(2);
    expect(position?.z).toBe(2);
  });

  it('the look system can run on its own, with the default sensitivity', () => {
    const world = new World<ActionFrame>({ seed: 1 }).register(PlayerLook);
    world.addSystem(playerLookSystem());
    const id = world.spawn();
    world.add(id, PlayerLook, { yaw: 0 });
    world.step([frame({ look: 10 })]);
    expect(world.get(id, PlayerLook)?.yaw).toBeCloseTo(-10 * PLAYER_LOOK_SENSITIVITY, 12);
  });

  it('the same frames give the same state hash', () => {
    const run = () => {
      const { world } = setup();
      for (let i = 0; i < 90; i++) {
        world.step([frame({ move: [i % 3 === 0 ? 1 : 0, 1], look: (i % 7) - 3 })]);
      }
      return hashWorld(world);
    };
    expect(run()).toBe(run());
  });
});
