import { describe, expect, it } from 'vitest';
import { World } from '../core/world';
import { InMemoryColliderSink } from '../physics/static-colliders';
import { TEST_SCENE, testKit } from './fixtures';
import { SceneLayoutError, type SceneSpec } from './layout';
import {
  loadScene,
  registerSceneComponents,
  sceneComponents,
  sceneEntities,
  sceneMembers,
  ScenePieceComponent,
  SceneSpawnComponent,
  SceneTransformComponent,
  unloadScene,
} from './loader';

function setup() {
  const world = registerSceneComponents(new World({ seed: 7 }));
  return { world, colliders: new InMemoryColliderSink() };
}

describe('scene loader (mw-e00.21)', () => {
  it('spawns a root, one entity per placement and per spawn, and a collider per solid part', () => {
    const { world, colliders } = setup();
    const loaded = loadScene(world, TEST_SCENE, testKit, colliders);
    expect(loaded.id).toBe('test-room');
    expect(loaded.pieces).toHaveLength(4);
    expect(loaded.spawns).toHaveLength(2);
    expect(sceneEntities(loaded)).toHaveLength(7);
    expect(world.entityCount).toBe(7);
    expect(sceneMembers(world, 'test-room')).toEqual(sceneEntities(loaded).sort((a, b) => a - b));
    // floor 1 + doorway 3 + ramp 1; the decal has no collider.
    expect(colliders.count()).toBe(5);
    expect(loaded.colliders).toHaveLength(5);

    expect(world.get(loaded.root, SceneTransformComponent)).toEqual({
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
    });
    const door = loaded.pieces[1] ?? 0;
    expect(world.get(door, ScenePieceComponent)).toMatchObject({
      piece: 'doorway',
      placement: 1,
      purpose: 'blocking',
    });
    expect(world.get(door, SceneTransformComponent)?.position).toEqual({ x: 0, y: 0, z: 5 });
    const crate = loaded.spawns[1];
    expect(crate?.spawn.id).toBe('crate');
    expect(world.get(crate?.entity ?? 0, SceneSpawnComponent)).toEqual({
      id: 'crate',
      prop: 'crate',
      tags: [],
    });
  });

  it('AC-2: loading then unloading a scene leaves zero scene entities and zero colliders', () => {
    const { world, colliders } = setup();
    const other = world.spawn(); // not part of the scene: must survive
    const loaded = loadScene(world, TEST_SCENE, testKit, colliders);
    expect(sceneMembers(world).length).toBeGreaterThan(0);
    expect(colliders.count()).toBeGreaterThan(0);

    unloadScene(world, loaded, colliders);

    expect(sceneMembers(world)).toEqual([]);
    expect(colliders.count()).toBe(0);
    expect(world.entityCount).toBe(1);
    expect(world.isAlive(other)).toBe(true);
    for (const type of sceneComponents) expect(world.query(type).count).toBe(0);
  });

  it('AC-2: repeated load/unload cycles never accumulate entities or colliders', () => {
    const { world, colliders } = setup();
    for (let i = 0; i < 3; i++) {
      unloadScene(world, loadScene(world, TEST_SCENE, testKit, colliders), colliders);
    }
    expect(world.entityCount).toBe(0);
    expect(colliders.count()).toBe(0);
  });

  it('unloads cleanly when a system already destroyed one of its entities', () => {
    const { world, colliders } = setup();
    const loaded = loadScene(world, TEST_SCENE, testKit, colliders);
    world.destroy(loaded.spawns[1]?.entity ?? 0);
    unloadScene(world, loaded, colliders);
    expect(world.entityCount).toBe(0);
    expect(colliders.count()).toBe(0);
  });

  it('keeps two loaded scenes apart', () => {
    const { world, colliders } = setup();
    const a = loadScene(world, TEST_SCENE, testKit, colliders);
    const other: SceneSpec = { ...TEST_SCENE, id: 'other', spawns: [] };
    const b = loadScene(world, other, testKit, colliders);
    expect(sceneMembers(world, 'other')).toHaveLength(5);
    unloadScene(world, a, colliders);
    expect(sceneMembers(world)).toEqual(sceneMembers(world, 'other'));
    expect(colliders.count()).toBe(5);
    unloadScene(world, b, colliders);
    expect(colliders.count()).toBe(0);
  });

  it('loads nothing when the scene names an unknown kit piece', () => {
    const { world, colliders } = setup();
    const broken: SceneSpec = {
      ...TEST_SCENE,
      placements: [{ piece: { id: 'nope' }, at: [0, 0, 0], yaw: 0, scale: [1, 1, 1] }],
    };
    expect(() => loadScene(world, broken, testKit, colliders)).toThrow(SceneLayoutError);
    expect(world.entityCount).toBe(0);
    expect(colliders.count()).toBe(0);
  });
});
