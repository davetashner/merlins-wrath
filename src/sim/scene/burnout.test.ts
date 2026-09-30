// A level piece that burns away takes its colliders with it (mw-e03.42), on the real deterministic
// Rapier build with the real fire rules: an ivy wall burns out, and by the end of that tick its
// colliders have left the physics world and the light model's occluders, line of sight sees through
// where it stood and its ledges are gone; unloading the scene afterwards removes nothing twice.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it } from 'vitest';
import { sceneLedges } from '../climb/ledges';
import { World } from '../core/world';
import { fireBurntOut, fireRules, type FireBurnout } from '../elements/fire';
import { ElementRuleSet, elementRulesSystem } from '../elements/rules';
import { elementFieldSystem, installElementField } from '../field/install';
import { at } from '../geom/vec';
import { LightField } from '../light/field';
import { installPhysicsObjects, PhysicsColliderComponent } from '../physics/objects';
import { RapierPhysics } from '../physics/rapier';
import { RapierSightWorld } from '../physics/rapier-sight-world';
import { ColliderFanOut, type ColliderHandle } from '../physics/static-colliders';
import { assignProperty, registerWorldProperties } from '../properties/components';
import type { MaterialPresets } from '../properties/materials';
import { installStimuli, stimulusSystem } from '../stimulus/stimulus';
import type { KitLookup, KitPieceSpec, SceneSpec } from './layout';
import { loadScene, registerSceneComponents, unloadScene } from './loader';
import { addScenePhysics } from './physics';

const MATERIALS: MaterialPresets = new Map([
  ['stone', { friction: 0.6 }],
  ['ivy', { flammable: true, ignitionPoint: 250, fuel: 0.1 }],
]);

const KIT: readonly KitPieceSpec[] = [
  {
    id: 'floor',
    purpose: 'walkable',
    parts: [{ shape: 'box', size: [10, 0.2, 10], offset: [0, -0.1, 0], collider: true }],
  },
  {
    id: 'wall',
    purpose: 'blocking',
    parts: [
      { shape: 'box', size: [4, 2, 0.4], offset: [0, 1, 0], collider: true },
      { shape: 'box', size: [4, 1, 0.4], offset: [0, 2.5, 0], collider: true },
    ],
  },
];
const kit: KitLookup = (id) => KIT.find((piece) => piece.id === id);

/** A floor and, 3 m along +z, a two-part wall of ivy. */
const SCENE = {
  id: 'ivy-room',
  grid: 1,
  placements: [
    { piece: { id: 'floor' }, at: [0, 0, 0], yaw: 0, scale: [1, 1, 1] },
    {
      piece: { id: 'wall' },
      at: [0, 0, 3],
      yaw: 0,
      scale: [1, 1, 1],
      properties: { material: { id: 'ivy' } },
    },
  ],
  spawns: [],
} as unknown as SceneSpec;

const EYE = { x: 0, y: 1, z: 0 };
const BEYOND = { x: 0, y: 1, z: 6 };

function setup() {
  const physics = new RapierPhysics(RAPIER);
  const light = new LightField();
  // One sink feeds physics and the light model, as the game hands both to the scene loader.
  const level = new ColliderFanOut(physics, light.statics);
  const world = installElementField(
    installStimuli(
      registerWorldProperties(registerSceneComponents(new World<never>({ seed: 3, physics }))),
    ),
    { maxChunks: 8 },
  );
  installPhysicsObjects(world, { levelColliders: level });
  const rules = new ElementRuleSet(fireRules({ presets: MATERIALS, burnt: new Map() }));
  world
    .addSystem(stimulusSystem())
    .addSystem(elementRulesSystem(rules))
    .addSystem(elementFieldSystem());
  const loaded = loadScene(world, SCENE, kit, level);
  addScenePhysics(world, loaded, { props: () => undefined, materials: MATERIALS });
  const wall = at(loaded.pieces, 1);
  const burnt: FireBurnout[] = [];
  world.events.on(fireBurntOut, (e) => burnt.push(e));
  return { world, physics, light, level, loaded, wall, burnt };
}

type Setup = ReturnType<typeof setup>;

/** Sets the wall on fire and steps until the tick it burns out. */
function burnWall({ world, wall, burnt }: Setup): void {
  assignProperty(world, wall, 'temperature', 900);
  assignProperty(world, wall, 'burning', true);
  for (let i = 0; i < 60 && burnt.length === 0; i++) world.step();
  expect(burnt).toEqual([{ entity: wall, becomes: null }]);
}

describe('burnt-away level pieces lose their colliders (mw-e03.42)', () => {
  it('AC-1: an ivy piece that burns out leaves the physics world by the end of that tick', () => {
    const s = setup();
    const { world, physics, wall } = s;
    const walls = world.get(wall, PhysicsColliderComponent)?.colliders ?? [];
    expect(walls).toHaveLength(2);
    world.step(); // the port's queries see the scene from its first step
    expect(physics.count()).toBe(3);
    const sight = new RapierSightWorld(physics);
    expect(walls).toContain(sight.firstCrossing(EYE, BEYOND));

    burnWall(s);
    expect(world.isAlive(wall)).toBe(false);
    for (const collider of walls) expect(physics.has(collider as ColliderHandle)).toBe(false);
    expect(physics.count()).toBe(1); // only the floor
    world.step(); // line of sight answers from the port's last step
    expect(sight.firstCrossing(EYE, BEYOND)).toBeUndefined();
  });

  it('AC-2: unloading the scene afterwards removes every other collider once and throws nothing', () => {
    const s = setup();
    burnWall(s);
    const { world, physics, light, level, loaded } = s;
    expect(() => {
      unloadScene(world, loaded, level);
    }).not.toThrow();
    expect(physics.count()).toBe(0);
    expect(light.statics.count()).toBe(0);
    expect(level.count()).toBe(0);
    world.step();
  });

  it('AC-3: the light model’s occluders and the ledge index stop seeing it', () => {
    const s = setup();
    const { world, light, loaded, wall } = s;
    const ledges = sceneLedges(loaded);
    const top = { x: 0, y: 3, z: 3 };
    expect(ledges.near(world, top, 0.5).map((hit) => hit.entity)).toContain(wall);
    const blockers = () =>
      light.statics.along(EYE.x, EYE.y, EYE.z, BEYOND.x, BEYOND.y, BEYOND.z, 0);
    expect(blockers()).toHaveLength(1);
    const version = light.statics.version;

    burnWall(s);
    expect(light.statics.count()).toBe(1);
    expect(light.statics.version).toBeGreaterThan(version); // baked light is rebuilt
    expect(blockers()).toEqual([]);
    expect(ledges.near(world, top, 0.5)).toEqual([]);
  });
});
