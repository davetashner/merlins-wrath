// A scene's light (mw-e03.37): its light data becomes the light field's environment, its static
// geometry feeds the field's occluders through the same collider fan-out as physics, and spawns
// with world properties (a torch) are placed so the field sees them.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it } from 'vitest';
import { World } from '../core/world';
import { LightField } from '../light/field';
import { installLightField, lightFieldSystem } from '../light/install';
import { installPhysicsObjects } from '../physics/objects';
import { RapierPhysics } from '../physics/rapier';
import { ColliderFanOut } from '../physics/static-colliders';
import { readProperty, registerWorldProperties } from '../properties/components';
import type { MaterialPresets } from '../properties/materials';
import { PlacementComponent } from '../stimulus/placement';
import type { Vec3 } from '../stimulus/shapes';
import { TEST_SCENE, testKit } from './fixtures';
import { sceneLight, type SceneSpec } from './layout';
import { loadScene, registerSceneComponents, unloadScene } from './loader';
import { addScenePhysics, type PropBody } from './physics';

const MATERIALS: MaterialPresets = new Map([
  ['stone', { friction: 0.6 }],
  ['wood', { friction: 0.5, flammable: true }],
]);
const CRATE: PropBody = { size: { x: 0.6, y: 0.6, z: 0.6 }, material: 'wood', weight: 12 };
const at = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

/** The test room with light data, a torch by the doorway and a burning crate. */
const LIT_SCENE: SceneSpec = {
  ...TEST_SCENE,
  grid: 2,
  placements: TEST_SCENE.placements.map((p) => ({ ...p, at: [p.at[0] / 2, p.at[1], p.at[2] / 2] })),
  spawns: [
    ...TEST_SCENE.spawns.map((s) =>
      s.prop === undefined ? s : { ...s, properties: { burning: true } },
    ),
    // At x −1 m, z 4.2 m: the doorway's post (world z 4–4.4, x ±0.1) stands between it and x > 0.
    { id: 'torch', at: [-0.5, 0.5, 2.1], yaw: 0, tags: [], properties: { burning: true } },
  ],
  light: {
    ambient: 0.05,
    ambientZones: [{ id: 'alcove', min: [-2, 0, -2], max: [-1, 1, -1], level: 0 }],
    directional: [{ id: 'moon', direction: [0, -1, 0], level: 0.2, reach: 30 }],
  },
};

function setup() {
  const physics = new RapierPhysics(RAPIER);
  const world = registerWorldProperties(
    registerSceneComponents(new World<never>({ seed: 5, physics })),
  );
  world.register(PlacementComponent);
  const field = new LightField();
  const colliders = new ColliderFanOut(physics, field.statics);
  installPhysicsObjects(world, { levelColliders: colliders });
  installLightField(world, field);
  world.addSystem(lightFieldSystem(field));
  const loaded = loadScene(world, LIT_SCENE, testKit, colliders);
  field.setEnvironment(loaded.layout.light);
  const scenePhysics = addScenePhysics(world, loaded, {
    props: (id) => (id === 'crate' ? CRATE : undefined),
    materials: MATERIALS,
  });
  world.step();
  return { world, physics, field, colliders, loaded, scenePhysics };
}

describe('scene light (mw-e03.37)', () => {
  it('AC-2: a scene with light data loads its ambient level, zones and directional lights into the field', () => {
    const { field } = setup();
    expect(field.environment).toEqual({
      ambient: 0.05,
      ambientZones: [{ id: 'alcove', min: at(-4, 0, -4), max: at(-2, 2, -2), level: 0 }],
      directional: [{ id: 'moon', direction: at(0, -1, 0), level: 0.2, reach: 30 }],
    });
    expect(field.sample(at(-3, 1, -3))).toMatchObject({ zone: 'alcove', ambient: 0 });
    // Outside the zone the scene's own ambient level applies.
    expect(field.sample(at(3, 1, -3))).toMatchObject({ zone: null, ambient: 0.05 });
  });

  it('AC-2: its static geometry blocks light, and a piece that burns away stops blocking it', () => {
    const { world, field, loaded, physics } = setup();
    const torch = field.lights().find((light) => light.position.z === 4.2);
    expect(torch?.position).toEqual(at(-1, 1, 4.2));
    const torchLight = (p: Vec3): number =>
      field
        .sample(p)
        .contributions.filter(
          (c) => c.source.kind === 'emitter' && c.source.entity === torch?.entity,
        )
        .reduce((sum, c) => sum + c.level, 0);
    expect(torchLight(at(1, 1, 4.2))).toBe(0); // behind the doorway's post
    expect(torchLight(at(1, 1, 5))).toBeGreaterThan(0); // through the opening
    const doorway = loaded.pieces[1];
    if (doorway === undefined) throw new Error('the scene has a doorway');
    const before = physics.count();
    world.destroy(doorway); // burnt away (mw-e03.42)
    world.step();
    expect(physics.count()).toBe(before - 3);
    expect(field.statics.count()).toBe(physics.count() - 1); // the crate's body is not level geometry
    expect(torchLight(at(1, 1, 4.2))).toBeGreaterThan(0);
  });

  it('spawns with properties are placed and light the room; a prop spawn keeps its body', () => {
    const { world, field, loaded, scenePhysics } = setup();
    const torch = loaded.spawns.find((s) => s.spawn.id === 'torch')?.entity;
    const crate = loaded.spawns.find((s) => s.spawn.id === 'crate')?.entity;
    expect(scenePhysics.placed).toEqual([torch]);
    expect(scenePhysics.objects).toEqual([crate]);
    if (torch === undefined || crate === undefined) throw new Error('both spawns exist');
    expect(world.get(torch, PlacementComponent)).toEqual({ x: -1, y: 1, z: 4.2, radius: 0 });
    expect(readProperty(world, crate, 'burning')).toBe(true);
    expect(readProperty(world, crate, 'weight')).toBe(12);
    expect(field.lights().map((light) => light.entity)).toEqual([crate, torch]);
    // Markers without properties stay unplaced.
    const start = loaded.spawns.find((s) => s.spawn.id === 'player-start')?.entity;
    expect(start !== undefined && world.has(start, PlacementComponent)).toBe(false);
  });

  it('unloading takes the scene out of the light statics too', () => {
    const { world, field, colliders, loaded } = setup();
    expect(field.statics.count()).toBeGreaterThan(0);
    unloadScene(world, loaded, colliders);
    expect(field.statics.count()).toBe(0);
    expect(colliders.count()).toBe(0);
  });

  it('a scene without light data is dark but for its emitters', () => {
    expect(sceneLight(undefined, 1)).toEqual({});
    expect(sceneLight({ ambient: 0.1 }, 1)).toEqual({
      ambient: 0.1,
      ambientZones: [],
      directional: [],
    });
  });
});
