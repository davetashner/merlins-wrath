import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it, vi } from 'vitest';
import { loadGameContent, PLAYER_CAMERA_ID, PLAYER_CONTROLLER_ID } from '@content/index';
import {
  box,
  CharacterController,
  FakeCollisionWorld,
  hashWorld,
  interacted,
  PlacementComponent,
  PlayerLook,
  RapierSightWorld,
  registerWorldProperties,
  spawnCharacter,
  RapierCollisionWorld,
  RapierPhysics,
  registerSceneComponents,
  SKIN,
  World,
  type ActionFrame,
  type Interaction,
} from '@sim/index';
import { ActionSampler } from '../input';
import { createGameLoop, FakeFrames, type SceneBinding, type Transform } from '../loop';
import { readSceneTransform, SceneLoader } from '../scene';
import { lookForward, toRadians } from '../camera';
import {
  readPlayerTransform,
  setupTestbedPlayer,
  yawOf,
  yawRotation,
  type CameraReadout,
  type PlayerReadout,
  type TestbedPlayerOptions,
  type TransformReader,
} from './testbed-player';

const content = loadGameContent();
const tuning = content.get('controller', PLAYER_CONTROLLER_ID);
const cameraTuning = content.get('camera', PLAYER_CAMERA_ID);

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
    fov: 70,
    near: 0.1,
    aspect: 16 / 9,
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

/**
 * The testbed loaded headlessly as the game loads it (static colliders in the sim's Rapier world,
 * the controller querying it), with the player wired to a sampler and a fake-frame loop.
 */
function testbed(options: Extra | ((physics: RapierPhysics) => Extra) = {}) {
  const physics = new RapierPhysics(RAPIER);
  const extra = typeof options === 'function' ? options(physics) : options;
  const world = registerSceneComponents(new World<ActionFrame>({ seed: 1, physics }));
  if (extra.interaction !== undefined) registerWorldProperties(world).register(PlacementComponent);
  const sampler = new ActionSampler();
  const frames = new FakeFrames();
  const { loop, sync } = createGameLoop<ActionFrame>({
    world,
    sources: { now: frames.now, scheduler: frames, visibility: frames },
    sampleCommands: sampler.sampleCommands,
    draw: (frame) => {
      player.frame(frame);
    },
    warn: () => undefined,
  });
  const loader = new SceneLoader({
    world,
    sync,
    colliders: physics,
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
    cameraTuning,
    collision: new RapierCollisionWorld(physics),
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
  return { world, sync, sampler, player, capsule, camera, run, state, loop, frames, physics };
}

describe('testbed player wiring (mw-e02.23)', () => {
  it('spawns the player at the testbed player-start, facing +z into the room', () => {
    const { state } = testbed();
    expect(state()).toEqual({
      tick: 0,
      position: { x: 0, y: SKIN, z: -1 },
      grounded: false,
      yaw: Math.round(Math.PI * 1e4) / 1e4,
      pitch: Math.round(toRadians(cameraTuning.pitch.initial) * 1e4) / 1e4,
    });
  });

  it('binds the capsule through render sync at the player feet', () => {
    const { capsule, sync, player } = testbed();
    expect(sync.has(player.entity)).toBe(true);
    expect(capsule.transform?.position).toEqual({ x: 0, y: SKIN, z: -1 });
  });

  it('places the orbit camera behind, above and over the shoulder before the first frame', () => {
    const { camera } = testbed();
    // The player faces +z, so behind is −z and its right is −x.
    expect(camera.at.z).toBeLessThan(-1 - 2);
    expect(camera.at.z).toBeGreaterThan(-4.9); // still inside the room
    expect(camera.at.y).toBeGreaterThan(SKIN + cameraTuning.pivotHeight); // looking down on it
    expect(camera.at.x).toBeCloseTo(-cameraTuning.shoulder, 6);
    // It looks along the view direction: pitched down 15°, towards +z.
    const forward = lookForward(Math.PI, toRadians(cameraTuning.pitch.initial));
    expect(camera.target.x - camera.at.x).toBeCloseTo(forward.x, 6);
    expect(camera.target.y - camera.at.y).toBeCloseTo(forward.y, 6);
    expect(camera.target.z - camera.at.z).toBeCloseTo(forward.z, 6);
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
    expect(camera.at.z).toBeLessThan(after.z - 2); // still behind it
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

  it('leaves the camera alone while the orbit camera is off (debug camera)', () => {
    const { sampler, run, camera, player } = testbed();
    player.drivesCamera = false;
    expect(player.drivesCamera).toBe(false);
    const parked = camera.at;
    sampler.down('KeyW');
    run(0.5);
    expect(camera.at).toBe(parked);
    player.drivesCamera = true;
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

  it('collides against whichever CollisionWorld it is given', () => {
    // A wall 1 m in front of the player that the testbed does not have.
    const collision = new FakeCollisionWorld([
      box({ x: -50, y: -1, z: -50 }, { x: 50, y: 0, z: 50 }),
      box({ x: -5, y: 0, z: -0.5 }, { x: 5, y: 3, z: 0 }),
    ]);
    const { sampler, run, state } = testbed({ collision });
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

describe('testbed orbit camera (mw-e02.4)', () => {
  it('mouse up and down pitch the view within the limits, and the camera follows', () => {
    const { sampler, run, state, camera } = testbed({ sensitivity: 0.01 });
    const startY = camera.at.y;
    sampler.look(0, 1000); // mouse down a long way: look down, camera up
    run(0.1);
    expect(state().pitch).toBeCloseTo(toRadians(cameraTuning.pitch.min), 4);
    expect(camera.at.y).toBeGreaterThan(startY);
    sampler.look(0, -1000);
    run(0.1);
    expect(state().pitch).toBeCloseTo(toRadians(cameraTuning.pitch.max), 4);
  });

  it('interpolates the pitch between sim steps', () => {
    const { sampler, run, frames, camera } = testbed({ sensitivity: 0.01 });
    run(0.1);
    const level = camera.at.y;
    sampler.look(0, -20); // mouse up: look up 0.2 rad on the next tick, so the camera drops
    frames.frame(1000 / 60); // the tick runs; drawn at the start of its interval (alpha 0)
    const stepped = camera.at.y;
    frames.frame(1000 / 120); // half a step on: part way there
    const halfway = camera.at.y;
    frames.frame(1000 / 120); // the next tick: all the way
    const final = camera.at.y;
    expect(final).toBeLessThan(level - 0.3);
    expect(halfway).toBeLessThan(level - 0.1);
    expect(halfway).toBeGreaterThan(final + 0.1);
    expect(Math.abs(stepped - level)).toBeLessThan(Math.abs(halfway - level));
  });

  it('AC-4: at camera yaw 90° the player moves along the camera forward vector', () => {
    const { sampler, run, state, camera } = testbed({ sensitivity: Math.PI / 2 / 100 });
    sampler.look(-100, 0); // a quarter turn left: from yaw π to 3π/2 ≡ −π/2
    run(1 / 60);
    sampler.look(-200, 0); // half a turn more: yaw π/2
    run(0.2);
    expect(state().yaw).toBeCloseTo(Math.PI / 2, 3);
    const before = state().position;
    sampler.down('KeyW');
    run(0.5);
    const after = state().position;
    const moved = { x: after.x - before.x, z: after.z - before.z };
    // The camera's horizontal forward, from where it is and where it looks.
    const look = { x: camera.target.x - camera.at.x, z: camera.target.z - camera.at.z };
    const length = Math.hypot(look.x, look.z);
    expect(look.x / length).toBeCloseTo(-1, 6);
    expect(Math.hypot(moved.x, moved.z)).toBeGreaterThan(1);
    expect(moved.x / Math.hypot(moved.x, moved.z)).toBeCloseTo(look.x / length, 6);
    expect(moved.z / Math.hypot(moved.x, moved.z)).toBeCloseTo(look.z / length, 6);
  });

  it('publishes the camera every frame it drives; the near plane never clips walking into a wall', () => {
    const publishCamera = vi.fn<(readout: CameraReadout) => void>();
    const { sampler, run, player } = testbed({ publishCamera });
    sampler.down('KeyS'); // back into the room's back wall: the camera is squeezed against it
    run(2);
    const last = publishCamera.mock.calls.at(-1)?.[0];
    expect(last?.frames).toBe(121); // setup plus 120 frames
    expect(last?.clipped).toBe(0);
    expect(last?.pulledIn).toBeGreaterThan(30);
    expect(last?.boom).toBeLessThan(last?.zoom ?? 0);
    expect(last?.position.z).toBeGreaterThanOrEqual(-4.9 + 0.2);
    player.drivesCamera = false;
    run(0.1);
    expect(publishCamera).toHaveBeenCalledTimes(121);
  });

  it('the wheel zooms within 2–6 m', () => {
    const publishCamera = vi.fn<(readout: CameraReadout) => void>();
    const { run, player } = testbed({ publishCamera });
    const zoom = () => publishCamera.mock.calls.at(-1)?.[0].zoom;
    expect(zoom()).toBe(cameraTuning.distance.initial);
    player.zoom(-1);
    run(1 / 60);
    expect(zoom()).toBe(cameraTuning.distance.initial - cameraTuning.distance.step);
    player.zoom(100);
    run(1 / 60);
    expect(zoom()).toBe(cameraTuning.distance.max);
  });

  it('the camera never changes the sim: same inputs, same hash, with or without it drawing', () => {
    const drive = (drawCamera: boolean) => {
      const { sampler, run, world, player } = testbed();
      player.drivesCamera = drawCamera;
      sampler.down('KeyS');
      sampler.look(40, 5);
      run(1);
      return hashWorld(world);
    };
    expect(drive(true)).toBe(drive(false));
  });

  it('counts a frame whose near plane the probe finds inside geometry', () => {
    const publishCamera = vi.fn<(readout: CameraReadout) => void>();
    // Everything overlaps: the probe must report every frame as clipped.
    const solid = new FakeCollisionWorld([box({ x: -50, y: -1, z: -50 }, { x: 50, y: 0, z: 50 })]);
    solid.overlapCapsule = () => true;
    const { run } = testbed({ publishCamera, collision: solid });
    run(0.1);
    const last = publishCamera.mock.calls.at(-1)?.[0];
    expect(last?.clipped).toBe(last?.frames);
  });

  it('crouching lowers the orbit pivot', () => {
    const { sampler, run, camera } = testbed();
    run(0.2);
    const standing = camera.at.y;
    sampler.down('KeyC');
    run(0.2);
    expect(camera.at.y).toBeLessThan(standing - 0.3);
  });

  it('frames before any timestamp, or with the clock going back, recover nothing', () => {
    const { player, camera } = testbed();
    player.frame({ alpha: 1, timeMs: 500 });
    player.frame({ alpha: 1, timeMs: 400 });
    player.frame();
    expect(camera.at.z).toBeLessThan(-1);
  });
});

describe('testbed player interaction (mw-e02.5)', () => {
  const pressE = (sampler: ActionSampler, run: (seconds: number) => void) => {
    sampler.down('KeyE');
    run(0.1);
    sampler.up('KeyE');
    run(0.1);
  };

  it('AC-6: facing the testbed lever at spawn, Interact pulls it and the prompt names it', () => {
    const pulled: Interaction[] = [];
    const { player, sampler, run, world } = testbed((physics) => ({
      interaction: {
        sight: new RapierSightWorld(physics),
        bodiesOf: () => [],
        publish: (event) => pulled.push(event),
      },
    }));
    run(0.1);
    expect(player.prompt()).toMatchObject({ verb: 'pull', label: 'Pull lever', available: true });
    pressE(sampler, run);
    expect(pulled).toHaveLength(1);
    expect(pulled[0]).toMatchObject({ actor: player.entity, verb: 'pull', affordance: 0 });
    expect(world.isAlive(pulled[0]?.target ?? 0)).toBe(true);
    player.dispose();
    expect(player.prompt()).toBeUndefined();
  });

  it('stops publishing once disposed', () => {
    const pulled: Interaction[] = [];
    const rig = testbed({ interaction: { publish: (event) => pulled.push(event) } });
    rig.run(0.1);
    pressE(rig.sampler, rig.run);
    expect(pulled).toHaveLength(1);
    // Other actors' interactions are not the player's.
    rig.world.events.emit(interacted, { actor: 999, target: 1, verb: 'pull', affordance: 0 });
    rig.run(0.05);
    expect(pulled).toHaveLength(1);
    rig.player.dispose();
    pressE(rig.sampler, rig.run);
    expect(pulled).toHaveLength(1);
  });

  it('interacts without publishing when nobody listens', () => {
    const rig = testbed({ interaction: {} });
    rig.run(0.1);
    expect(rig.player.prompt()?.verb).toBe('pull');
    rig.player.dispose();
  });

  it('has no prompt without interaction', () => {
    const { player, run } = testbed();
    run(0.1);
    expect(player.prompt()).toBeUndefined();
  });
});

describe('yaw helpers', () => {
  it('round-trips a yaw through its rotation', () => {
    for (const yaw of [0, 1, -2.5, Math.PI - 1e-9])
      expect(yawOf(yawRotation(yaw))).toBeCloseTo(yaw, 9);
  });
});

describe('readPlayerTransform', () => {
  it('is undefined for a character that is not the player', () => {
    const world = new World({ seed: 1 }).register(CharacterController, PlayerLook);
    const npc = spawnCharacter(world, { x: 0, y: 0, z: 0 });
    expect(readPlayerTransform(world, npc)).toBeUndefined();
  });
});
