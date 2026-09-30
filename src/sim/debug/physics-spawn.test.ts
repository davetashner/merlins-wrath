// Debug-console props as physics objects (mw-e33.16) on the real deterministic Rapier build: a spawn
// command for a prop with a body makes physics objects in the command's own tick, with the prop's
// material and mass, and a recorded session replays to the same hashes.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { EntityId } from '../core/component';
import { World } from '../core/world';
import {
  addPhysicsObject,
  installPhysicsObjects,
  PhysicsObjectComponent,
} from '../physics/objects';
import type { BodyShape } from '../physics/bodies';
import { RapierPhysics } from '../physics/rapier';
import type { ColliderHandle } from '../physics/static-colliders';
import { addProperties, readProperty, registerWorldProperties } from '../properties/components';
import type { MaterialPresets } from '../properties/materials';
import { playReplay } from '../replay/player';
import { ReplayRecorder } from '../replay/recorder';
import { TEST_SCENE, testKit } from '../scene/fixtures';
import {
  loadScene,
  registerSceneComponents,
  SceneSpawnComponent,
  SceneTransformComponent,
} from '../scene/loader';
import type { PropBody } from '../scene/physics';
import { PlacementComponent, placementOf } from '../stimulus/placement';
import { spawnCommand, teleportCommand, type DebugCommand } from './commands';
import { DEBUG_SPAWN_TAG, installDebugCommands, SPAWN_SPACING, testPropSpawners } from './system';

const MATERIALS: MaterialPresets = new Map([
  ['stone', { friction: 0.6 }],
  ['wood', { friction: 0.5, impactAbsorb: 0.1, flammable: true }],
]);

const CRATE: PropBody = { size: { x: 0.6, y: 0.6, z: 0.6 }, material: 'wood', weight: 12 };

interface Setup {
  readonly world: World;
  readonly physics: RapierPhysics;
}

/** A world with physics objects, the test room's floor (top at y = 0) and debug commands. */
function setup(): Setup {
  const physics = new RapierPhysics(RAPIER);
  const world = registerSceneComponents(new World<unknown>({ seed: 7, physics }));
  const sim = world as unknown as World<never>;
  registerWorldProperties(sim).register(PlacementComponent);
  installDebugCommands(world, {
    spawners: testPropSpawners(['crate', 'plank'], {
      props: (id) => (id === 'crate' ? CRATE : undefined),
      materials: MATERIALS,
    }),
  });
  installPhysicsObjects(sim);
  loadScene(world, TEST_SCENE, testKit, physics);
  return { world, physics };
}

/** Debug-spawned props of `prop`, in id order. */
function spawned(world: World, prop: string): EntityId[] {
  const ids: EntityId[] = [];
  world.query(SceneSpawnComponent).forEach((id, spawn) => {
    if (spawn.prop === prop && spawn.tags.includes(DEBUG_SPAWN_TAG)) ids.push(id);
  });
  return ids;
}

const AT = { x: -3, y: 2, z: -3 };

describe('debug physics spawns (mw-e33.16)', () => {
  it('AC-1: spawn testprop-crate 3 makes 3 wood physics objects with the crate mass that fall to rest on the floor', () => {
    const { world, physics } = setup();
    world.step([spawnCommand('testprop-crate', 3, AT)]);
    const crates = spawned(world, 'crate');
    expect(crates).toHaveLength(3);
    crates.forEach((crate, i) => {
      const object = world.get(crate, PhysicsObjectComponent);
      // Live at the end of the spawn tick, standing on the spawn point (the middle of its base).
      expect(object?.position).toEqual({ x: AT.x + i * SPAWN_SPACING, y: AT.y + 0.3, z: AT.z });
      expect(object?.shape).toEqual({ kind: 'box', halfExtents: { x: 0.3, y: 0.3, z: 0.3 } });
      expect(readProperty(world as unknown as World<never>, crate, 'material')).toBe('wood');
      expect(readProperty(world as unknown as World<never>, crate, 'weight')).toBe(12);
      expect(readProperty(world as unknown as World<never>, crate, 'friction')).toBe(0.5);
      // The body was built with the crate's mass although its properties were not live yet.
      const motion = physics.motionOf(object?.body as ColliderHandle);
      expect(motion.mass).toBeCloseTo(12, 5);
    });
    for (let i = 0; i < 120; i++) world.step();
    for (const crate of crates) {
      const rested = world.get(crate, PhysicsObjectComponent);
      expect(rested?.position.y).toBeCloseTo(0.3, 2); // on the floor, whose top is at y = 0
    }
  });

  it('AC-1: props without a body still spawn as plain scene props', () => {
    const { world } = setup();
    world.step([spawnCommand('testprop-plank', 2, AT)]);
    const planks = spawned(world, 'plank');
    expect(planks).toHaveLength(2);
    for (const plank of planks) expect(world.has(plank, PhysicsObjectComponent)).toBe(false);
  });

  it('AC-2: a recorded session with a physics spawn replays with every checkpoint hash matching', () => {
    const { world } = setup();
    const recorder = new ReplayRecorder(world, {
      scenario: 'debug-physics',
      buildSha: 'test',
      contentHash: null,
      checkpointInterval: 10,
    });
    recorder.step();
    recorder.step([spawnCommand('testprop-crate', 3, AT)]);
    for (let i = 0; i < 40; i++) recorder.step();
    recorder.step([spawnCommand('testprop-crate', 1, { x: -2, y: 3, z: -3 })]);
    for (let i = 0; i < 40; i++) recorder.step();
    const replay = recorder.finish();
    expect(replay.checkpoints.length).toBeGreaterThan(5);
    const outcome = playReplay(replay, {
      name: 'debug-physics',
      usesContent: false,
      command: z.custom<DebugCommand>(() => true),
      create: () => setup().world,
      drive: () => [],
    });
    expect(outcome.status).toBe('passed');
  });
});

describe('debug teleport of physics objects (mw-e33.17)', () => {
  const TO = { x: 2, y: 0, z: -2 };

  /** A crate spawned at AT and left to settle on the floor. */
  function settledCrate(world: World): EntityId {
    world.step([spawnCommand('testprop-crate', 1, AT)]);
    for (let i = 0; i < 120; i++) world.step();
    const [crate] = spawned(world, 'crate');
    if (crate === undefined) throw new Error('the crate spawned');
    return crate;
  }

  it('AC-1: tp moves a resting crate’s body to stand on the destination in the command’s tick', () => {
    const { world, physics } = setup();
    const crate = settledCrate(world);
    const centre = { x: TO.x, y: TO.y + 0.3, z: TO.z };
    world.step([teleportCommand(crate, TO)]);
    // The pose is read back from the engine, which keeps 32-bit floats.
    const near = (p: { x: number; y: number; z: number } | undefined): number[] =>
      [p?.x ?? NaN, p?.y ?? NaN, p?.z ?? NaN].map((n) => Math.round(n * 1e5) / 1e5);
    const object = world.get(crate, PhysicsObjectComponent);
    expect(object?.sleeping).toBe(false);
    expect(near(object?.position)).toEqual(near(centre));
    const motion = physics.motionOf(object?.body as ColliderHandle);
    expect(near(motion.position)).toEqual(near(centre));
    expect(motion.linvel).toEqual({ x: 0, y: 0, z: 0 });
    expect(near(placementOf(world as unknown as World<never>, crate))).toEqual(near(centre));
    expect(world.get(crate, SceneTransformComponent)?.position).toEqual(TO);
    for (let i = 0; i < 60; i++) world.step();
    const rested = world.get(crate, PhysicsObjectComponent)?.position;
    expect(rested?.x).toBeCloseTo(TO.x, 2);
    expect(rested?.y).toBeCloseTo(0.3, 2); // still standing on the floor there
    expect(rested?.z).toBeCloseTo(TO.z, 2);
  });

  it('AC-1: spheres and capsules stand on the destination too', () => {
    const { world } = setup();
    const sim = world as unknown as World<never>;
    const shapes: BodyShape[] = [
      { kind: 'sphere', radius: 0.4 },
      { kind: 'capsule', halfHeight: 0.5, radius: 0.2 },
    ];
    const bodies = shapes.map((shape) => {
      const id = world.spawn();
      giveBodyProperties(sim, id);
      addPhysicsObject(sim, id, { shape, position: { x: 0, y: 3, z: 0 } });
      return id;
    });
    world.step(bodies.map((id) => teleportCommand(id, TO)));
    const heights = bodies.map((id) => world.get(id, PhysicsObjectComponent)?.position.y);
    expect(heights[0]).toBeCloseTo(0.4, 5);
    expect(heights[1]).toBeCloseTo(0.7, 5);
  });

  it('AC-2: a recorded session teleporting a crate replays with every checkpoint hash matching', () => {
    const { world } = setup();
    const recorder = new ReplayRecorder(world, {
      scenario: 'debug-teleport',
      buildSha: 'test',
      contentHash: null,
      checkpointInterval: 10,
    });
    recorder.step([spawnCommand('testprop-crate', 2, AT)]);
    for (let i = 0; i < 30; i++) recorder.step();
    const [crate] = spawned(world, 'crate');
    recorder.step([teleportCommand(crate ?? -1, { x: 1, y: 2, z: 1 })]);
    for (let i = 0; i < 40; i++) recorder.step();
    const replay = recorder.finish();
    const outcome = playReplay(replay, {
      name: 'debug-teleport',
      usesContent: false,
      command: z.custom<DebugCommand>(() => true),
      create: () => setup().world,
      drive: () => [],
    });
    expect(outcome.status).toBe('passed');
  });

  it('AC-3: a prop without a body still just moves its scene transform', () => {
    const { world } = setup();
    world.step([spawnCommand('testprop-plank', 1, AT)]);
    const [plank] = spawned(world, 'plank');
    world.step([teleportCommand(plank ?? -1, TO)]);
    expect(world.get(plank ?? -1, SceneTransformComponent)?.position).toEqual(TO);
    expect(world.has(plank ?? -1, PhysicsObjectComponent)).toBe(false);
  });
});

/** Gives `id` the few properties a body is built from. */
function giveBodyProperties(world: World<never>, id: EntityId): void {
  addProperties(world, id, { weight: 1, friction: 0.5 });
}
