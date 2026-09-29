import { describe, expect, it, vi } from 'vitest';
import { loadGameContent, PLAYER_CONTROLLER_ID } from '@content/index';
import {
  box,
  CharacterController,
  FakeCollisionWorld,
  PlayerLook,
  spawnCharacter,
  InMemoryColliderSink,
  registerSceneComponents,
  SKIN,
  World,
  type ActionFrame,
} from '@sim/index';
import { ActionSampler } from '../input';
import { createGameLoop, FakeFrames, type SceneBinding, type Transform } from '../loop';
import { readSceneTransform, SceneLoader } from '../scene';
import { followCameraPose } from './follow-camera';
import {
  readPlayerTransform,
  setupTestbedPlayer,
  type PlayerReadout,
  type TestbedPlayerOptions,
  type TransformReader,
} from './testbed-player';

const content = loadGameContent();
const tuning = content.get('controller', PLAYER_CONTROLLER_ID);

/** A headless scene object: remembers the last transform applied and whether it was disposed. */
interface Box {
  transform?: Transform;
  disposed?: boolean;
}

function binding(object: Box, read: TransformReader): SceneBinding<Box> {
  return {
    object,
    read,
    apply(target, transform) {
      target.transform = transform;
    },
    dispose(target) {
      target.disposed = true;
    },
  };
}

function fakeCamera() {
  const camera = {
    at: { x: 0, y: 0, z: 0 },
    target: { x: 0, y: 0, z: 0 },
    position: {
      set(x: number, y: number, z: number) {
        camera.at = { x, y, z };
      },
    },
    lookAt(x: number, y: number, z: number) {
      camera.target = { x, y, z };
    },
  };
  return camera;
}

type Extra = Partial<TestbedPlayerOptions<Box, ActionFrame>>;

/** The testbed loaded headlessly, with the player wired to a sampler and a fake-frame loop. */
function testbed(extra: Extra = {}) {
  const world = registerSceneComponents(new World<ActionFrame>({ seed: 1 }));
  const sampler = new ActionSampler();
  const frames = new FakeFrames();
  const { loop, sync } = createGameLoop<ActionFrame>({
    world,
    sources: { now: frames.now, scheduler: frames, visibility: frames },
    sampleCommands: sampler.sampleCommands,
    draw: () => {
      player.frame();
    },
    warn: () => undefined,
  });
  const loader = new SceneLoader({
    world,
    sync,
    colliders: new InMemoryColliderSink(),
    content,
    objects: { staticGeometry: () => ({}), spawn: () => ({}) },
    binding: (object: Box) => binding(object, readSceneTransform),
  });
  const scene = loader.load('testbed');
  const capsule: Box = {};
  const camera = fakeCamera();
  const player = setupTestbedPlayer({
    world,
    scene,
    sync,
    tuning,
    object: capsule,
    binding,
    camera,
    ...extra,
  });
  loop.start();
  /** Runs `seconds` of 60 Hz display frames. */
  const run = (seconds: number) => {
    for (let i = 0; i < Math.round(seconds * 60); i++) frames.frame(1000 / 60);
  };
  const state = () => {
    const readout = player.readout();
    if (readout === undefined) throw new Error('no player');
    return readout;
  };
  return { world, sync, sampler, player, capsule, camera, run, state, loop, frames };
}

describe('testbed player wiring (mw-e02.23)', () => {
  it('spawns the player at the testbed player-start, facing +z into the room', () => {
    const { state } = testbed();
    expect(state()).toEqual({
      tick: 0,
      position: { x: 0, y: SKIN, z: -1 },
      grounded: false,
      yaw: Math.round(Math.PI * 1e4) / 1e4,
    });
  });

  it('binds the capsule through render sync at the player feet', () => {
    const { capsule, sync, player } = testbed();
    expect(sync.has(player.entity)).toBe(true);
    expect(capsule.transform?.position).toEqual({ x: 0, y: SKIN, z: -1 });
  });

  it('places the follow camera behind and above the player before the first frame', () => {
    const { camera } = testbed();
    const pose = followCameraPose({ x: 0, y: SKIN, z: -1 }, Math.PI);
    expect(camera.at.x).toBeCloseTo(pose.position.x, 9);
    expect(camera.at.y).toBeCloseTo(pose.position.y, 9);
    expect(camera.at.z).toBeCloseTo(pose.position.z, 9);
    expect(camera.at.z).toBeLessThan(-1); // behind: the player faces +z
    expect(camera.at.z).toBeGreaterThan(-4.9); // still inside the room
    expect(camera.target).toEqual({ x: 0, y: SKIN + 1.5, z: -1 });
  });

  it('holding W for 1 s moves the player at least 4 m forward (+z), and the camera follows', () => {
    const { sampler, run, state, camera } = testbed();
    run(0.2);
    const before = state().position;
    sampler.down('KeyW');
    run(1);
    sampler.up('KeyW');
    run(0.3);
    const after = state().position;
    expect(after.z - before.z).toBeGreaterThanOrEqual(4);
    expect(Math.abs(after.x - before.x)).toBeLessThan(1e-3);
    expect(camera.target.z).toBeCloseTo(after.z, 3);
  });

  it('the back wall stops the player: it rests in front of it and never passes through', () => {
    const { sampler, run, state } = testbed();
    sampler.down('KeyS'); // back, towards the wall at z = −5 (its face is at −4.9)
    run(2);
    const radius = tuning.capsule.radius;
    expect(state().position.z).toBeGreaterThan(-4.9 + radius - 2 * SKIN);
    expect(state().position.z).toBeLessThan(-4.9 + radius + 0.05);
  });

  it('Space jumps: the player leaves the ground and lands again within 1 s', () => {
    const { sampler, run, state, world } = testbed();
    run(0.2);
    expect(state().grounded).toBe(true);
    sampler.down('Space');
    const pressedAt = world.tick;
    let peak = 0;
    let landedAt: number | undefined;
    for (let i = 0; i < 60 && landedAt === undefined; i++) {
      run(1 / 60);
      if (i === 5) sampler.up('Space');
      peak = Math.max(peak, state().position.y);
      if (state().grounded && peak > 0.5) landedAt = world.tick;
    }
    expect(peak).toBeGreaterThan(1);
    expect(landedAt).toBeDefined();
    expect((landedAt ?? Infinity) - pressedAt).toBeLessThanOrEqual(60);
  });

  it('interpolates the capsule between sim steps', () => {
    const { sampler, run, capsule, state, frames } = testbed();
    sampler.down('KeyW');
    run(0.5); // running at full speed, 5 m/s = 1/12 m per tick
    const latest = state().position.z;
    frames.frame(1000 / 120); // half a step: no sim step, the capsule is drawn halfway back
    const drawn = capsule.transform?.position.z ?? Infinity;
    expect(drawn).toBeLessThan(latest - 0.02);
    expect(drawn).toBeGreaterThan(latest - 1 / 12);
  });

  it('mouse look turns the player and the camera swings behind it', () => {
    const { sampler, run, state, camera } = testbed({ sensitivity: Math.PI / 2 / 100 });
    sampler.look(100, 0); // a quarter turn right: now facing −x
    run(0.1);
    expect(state().yaw).toBeCloseTo(Math.PI / 2, 3);
    // Behind a player facing −x is +x.
    expect(camera.at.x).toBeGreaterThan(state().position.x + 3);
  });

  it('leaves the camera alone while the follow camera is off (debug camera)', () => {
    const { sampler, run, camera, player } = testbed();
    player.followCamera = false;
    const parked = camera.at;
    sampler.down('KeyW');
    run(0.5);
    expect(camera.at).toBe(parked);
    player.followCamera = true;
    run(1 / 60);
    expect(camera.at).not.toBe(parked);
  });

  it('publishes one readout per new sim tick', () => {
    const publish = vi.fn<(readout: PlayerReadout) => void>();
    const { run, player } = testbed({ publish });
    expect(publish).toHaveBeenCalledTimes(1); // at setup
    run(0.5);
    const ticks = publish.mock.calls.map(([readout]) => readout.tick);
    expect(ticks).toEqual([...new Set(ticks)]);
    expect(ticks.at(-1)).toBe(30);
    player.frame(); // no new tick: nothing new
    expect(publish.mock.calls).toHaveLength(ticks.length);
  });

  it('uses the CollisionWorld it is given instead of the scene greybox', () => {
    // A wall 1 m in front of the player that the testbed does not have.
    const collision = new FakeCollisionWorld([
      box({ x: -50, y: -1, z: -50 }, { x: 50, y: 0, z: 50 }),
      box({ x: -5, y: 0, z: -0.5 }, { x: 5, y: 3, z: 0 }),
    ]);
    const { sampler, run, state, player } = testbed({ collision });
    expect(player.collision).toBe(collision);
    sampler.down('KeyW');
    run(1);
    expect(state().position.z).toBeLessThan(-0.5);
  });

  it('dispose removes the player and its capsule, and publishing stops', () => {
    const publish = vi.fn<(readout: PlayerReadout) => void>();
    const { player, capsule, world, sync, run, loop } = testbed({ publish });
    player.dispose();
    expect(capsule.disposed).toBe(true);
    expect(world.isAlive(player.entity)).toBe(false);
    expect(sync.has(player.entity)).toBe(false);
    expect(player.readout()).toBeUndefined();
    run(0.1);
    expect(publish).toHaveBeenCalledTimes(1);
    player.dispose(); // twice is harmless
    loop.stop();
  });
});

describe('readPlayerTransform', () => {
  it('is undefined for a character that is not the player', () => {
    const world = new World({ seed: 1 }).register(CharacterController, PlayerLook);
    const npc = spawnCharacter(world, { x: 0, y: 0, z: 0 });
    expect(readPlayerTransform(world, npc)).toBeUndefined();
  });
});
