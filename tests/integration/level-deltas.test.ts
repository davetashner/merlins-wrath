// mw-e27.3: level deltas over real content and the game's scene loader. The player smashes the weak
// wall and the loot crate of the weak-wall room, leaves (the scene unloads) and comes back (it loads
// fresh from data, then the deltas apply before the first tick): the wall and the crate are still
// gone, the passage is open, and two runs from the same seed give the same state hashes. The slice's
// rope bridge and real area transitions (mw-e01.11) do not exist yet, so this stands in for AC-5.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it } from 'vitest';
import { loadGameContent, materialPresets } from '@content/index';
import { installGamePhysics, propBodies } from '@game/physics-objects';
import { RenderSync } from '@game/loop/render-sync';
import { SceneLoader } from '@game/scene/scene-loader';
import {
  applyStimulus,
  hashWorld,
  PhysicsColliderComponent,
  RapierPhysics,
  registerPersistence,
  registerSceneComponents,
  sceneAuthoredEntities,
  World,
  WorldPersistence,
  type ColliderHandle,
  type EntityId,
  type LoadedScene,
} from '@sim/index';

const content = loadGameContent();
const SCENE = 'weak-wall-room';

/** The breakable wall: the placement with a breakable profile. */
const wallOf = (loaded: LoadedScene): EntityId => {
  const index = loaded.layout.pieces.findIndex((piece) => piece.breakable !== undefined);
  return loaded.pieces[index] ?? -1;
};
const crateOf = (loaded: LoadedScene): EntityId =>
  loaded.spawns.find((s) => s.spawn.id === 'loot-crate')?.entity ?? -1;

function run(seed: number) {
  const physics = new RapierPhysics(RAPIER);
  const world = installGamePhysics(registerSceneComponents(new World<never>({ seed, physics })), {
    breakables: {
      props: propBodies(content),
      materials: materialPresets(content.all('material')),
    },
  });
  registerPersistence(world);
  const loader = new SceneLoader({
    world,
    sync: new RenderSync(world),
    colliders: physics,
    content,
    objects: { staticGeometry: () => ({}), spawn: () => ({}) },
    binding: (object, read) => ({ object, read, apply: () => undefined, dispose: () => undefined }),
    physics: {},
  });
  const persistence = new WorldPersistence();
  const enter = () => {
    const loaded = loader.load(SCENE);
    const baseline = persistence.baseline(world, SCENE, sceneAuthoredEntities(world, loaded));
    return { loaded, baseline };
  };

  // First visit: smash the wall and the crate.
  const first = enter();
  for (const target of [wallOf(first.loaded), crateOf(first.loaded)]) {
    applyStimulus(world, { shape: { kind: 'contact', target }, element: 'blunt', intensity: 500 });
    world.step();
  }
  for (let i = 0; i < 60; i++) world.step();
  // Leave.
  const deltas = persistence.capture(world, first.baseline);
  loader.unload();
  for (let i = 0; i < 30; i++) world.step();
  // Come back: the level spawns from data, then the deltas apply before its first tick.
  const second = enter();
  const wall = wallOf(second.loaded);
  const colliders = world.get(wall, PhysicsColliderComponent)?.colliders ?? [];
  const report = persistence.apply(world, second.baseline, deltas);
  const hashes: string[] = [hashWorld(world)];
  for (let i = 0; i < 60; i++) {
    world.step();
    if (i % 20 === 19) hashes.push(hashWorld(world));
  }
  return { world, physics, deltas, report, wall, colliders, crate: crateOf(second.loaded), hashes };
}

describe('level deltas over a real scene (mw-e27.3)', () => {
  it('AC-5: a smashed wall and crate stay gone after leaving and returning; hashes match', () => {
    const a = run(21);
    // The wall is placement 6 of the scene file.
    expect(a.deltas).toEqual({
      level: SCENE,
      entities: [
        { id: 'piece:6', destroyed: true },
        { id: 'spawn:loot-crate', destroyed: true },
      ],
      spawned: [],
    });
    expect(a.report.skipped).toEqual([]);
    expect(a.colliders.length).toBeGreaterThan(0);
    expect(a.world.isAlive(a.wall)).toBe(false);
    expect(a.world.isAlive(a.crate)).toBe(false);
    expect(a.colliders.some((c) => a.physics.has(c as ColliderHandle))).toBe(false);
    const b = run(21);
    expect(b.deltas).toEqual(a.deltas);
    expect(b.hashes).toEqual(a.hashes);
  });
});
