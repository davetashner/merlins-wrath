import { loadGameContent } from '@content/index';
import {
  InMemoryColliderSink,
  registerSceneComponents,
  SceneLayoutError,
  sceneMembers,
  World,
  type SceneLayout,
  type SceneSpawnPlacement,
} from '@sim/index';
import { describe, expect, it } from 'vitest';
import { RenderSync, type SceneBinding, type Transform } from '../loop/render-sync';
import { DEFAULT_SCENE, readSceneTransform, SceneLoader, UnknownSceneError } from './scene-loader';
import { resolveSceneRequest } from './scene-request';

/** A stand-in render object: what it was built from, where it was put, whether it was disposed. */
interface FakeObject {
  readonly kind: 'static' | 'spawn';
  readonly label: string;
  transform?: Transform;
  disposed: boolean;
}

function setup() {
  const content = loadGameContent();
  const world = registerSceneComponents(new World({ seed: 3 }));
  const sync = new RenderSync(world);
  const colliders = new InMemoryColliderSink();
  const built: FakeObject[] = [];
  const binding = (object: FakeObject): SceneBinding<FakeObject> => ({
    object,
    read: readSceneTransform,
    apply(target, transform) {
      target.transform = transform;
    },
    dispose(target) {
      target.disposed = true;
    },
  });
  const loader = new SceneLoader({
    world,
    sync,
    colliders,
    content,
    binding,
    objects: {
      staticGeometry(layout: SceneLayout) {
        const object: FakeObject = { kind: 'static', label: layout.id, disposed: false };
        built.push(object);
        return object;
      },
      spawn(spawn: SceneSpawnPlacement) {
        const object: FakeObject = { kind: 'spawn', label: spawn.id, disposed: false };
        built.push(object);
        return object;
      },
    },
  });
  return { content, world, sync, colliders, built, loader };
}

describe('scene loader glue (mw-e00.21)', () => {
  it('lists the scenes in the content and defaults to the testbed', () => {
    const { loader } = setup();
    expect(loader.available()).toEqual(['kit-gallery', 'testbed']);
    expect(loader.available()).toContain(DEFAULT_SCENE);
    expect(loader.current).toBeUndefined();
  });

  it('loads a scene into the sim, the collider sink and the renderer', () => {
    const { world, sync, colliders, built, loader } = setup();
    const loaded = loader.load('testbed');
    expect(loader.current).toBe(loaded);
    expect(sceneMembers(world, 'testbed').length).toBeGreaterThan(30);
    expect(colliders.count()).toBeGreaterThan(30);
    // One merged static object on the root, one per spawn; all bound and placed.
    expect(built.map((o) => `${o.kind}:${o.label}`)).toEqual([
      'static:testbed',
      'spawn:player-start',
      'spawn:loose-crate',
      'spawn:arena-plank',
    ]);
    expect(sync.size).toBe(4);
    expect(built[0]?.transform?.position).toEqual({ x: 0, y: 0, z: 0 });
    expect(built[1]?.transform?.position).toEqual({ x: 0, y: 0, z: -2 });
  });

  it('AC-2: unloading leaves zero scene entities, zero colliders and zero render objects', () => {
    const { world, sync, colliders, built, loader } = setup();
    loader.load('testbed');
    loader.unload();
    expect(sceneMembers(world)).toEqual([]);
    expect(world.entityCount).toBe(0);
    expect(colliders.count()).toBe(0);
    expect(sync.size).toBe(0);
    expect(built.every((o) => o.disposed)).toBe(true);
    expect(loader.current).toBeUndefined();
    loader.unload(); // idempotent
  });

  it('AC-2: every shipped scene loads and unloads without leaving anything behind', () => {
    const { world, sync, colliders, loader } = setup();
    for (const id of loader.available()) {
      loader.load(id);
      expect(colliders.count()).toBeGreaterThan(0);
    }
    loader.unload();
    expect(world.entityCount).toBe(0);
    expect(colliders.count()).toBe(0);
    expect(sync.size).toBe(0);
  });

  it('switching scenes unloads the previous one first', () => {
    const { world, colliders, loader } = setup();
    loader.load('testbed');
    const gallery = loader.load('kit-gallery');
    expect(sceneMembers(world, 'testbed')).toEqual([]);
    expect(sceneMembers(world)).toHaveLength(1 + gallery.pieces.length + gallery.spawns.length);
    expect(colliders.count()).toBe(gallery.colliders.length);
  });

  it('AC-4: an unknown scene throws, listing the available scenes, and keeps the current one', () => {
    const { loader } = setup();
    const current = loader.load('testbed');
    expect(() => loader.load('does-not-exist')).toThrow(UnknownSceneError);
    expect(() => loader.load('does-not-exist')).toThrow(
      'unknown scene "does-not-exist"; available scenes: kit-gallery, testbed',
    );
    expect(loader.current).toBe(current);
  });

  it('refuses a scene whose kit piece is missing from the content, loading nothing', () => {
    const content = loadGameContent();
    const world = registerSceneComponents(new World({ seed: 3 }));
    const sync = new RenderSync(world);
    const colliders = new InMemoryColliderSink();
    const loader = new SceneLoader({
      world,
      sync,
      colliders,
      content: {
        all: (type) => content.all(type),
        get: (type, id) => content.get(type, id),
        has: (type, id) => (type === 'kit' && id === 'wall' ? false : content.has(type, id)),
      },
      binding: () => {
        throw new Error('nothing should be bound');
      },
      objects: {
        staticGeometry: () => {
          throw new Error('nothing should be built');
        },
        spawn: () => {
          throw new Error('nothing should be built');
        },
      },
    });
    expect(() => loader.load('testbed')).toThrow(SceneLayoutError);
    expect(() => loader.load('testbed')).toThrow(/unknown kit piece "wall"/);
    expect(world.entityCount).toBe(0);
    expect(colliders.count()).toBe(0);
    expect(loader.current).toBeUndefined();
  });

  it('AC-4: resolves ?scene= against the available scenes', () => {
    const available = ['kit-gallery', 'testbed'];
    expect(resolveSceneRequest('', available)).toEqual({ kind: 'scene', id: 'testbed' });
    expect(resolveSceneRequest('?scene=', available)).toEqual({ kind: 'scene', id: 'testbed' });
    expect(resolveSceneRequest('?scene=kit-gallery&perf', available)).toEqual({
      kind: 'scene',
      id: 'kit-gallery',
    });
    expect(resolveSceneRequest('?scene=does-not-exist', available)).toEqual({
      kind: 'unknown',
      requested: 'does-not-exist',
      available,
    });
    expect(resolveSceneRequest('', ['kit-gallery'], 'testbed')).toEqual({
      kind: 'unknown',
      requested: 'testbed',
      available: ['kit-gallery'],
    });
  });
});
