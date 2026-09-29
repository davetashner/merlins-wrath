// Loads scenes into the sim and the renderer together (mw-e00.21). The sim side (entities, static
// colliders) is src/sim/scene; this binds render objects to the new entities through RenderSync, so
// the renderer follows the sim like every other entity: the scene's merged static geometry hangs on
// the scene root entity and every spawn gets its own object. Unloading destroys the entities, removes
// the colliders and disposes every bound object at once, leaving nothing behind in any of the three.
//
// With `physics` (mw-e03.39), the scene's movable props (content `testprop`s with a `body`) become
// sim physics objects and its level colliders belong to stone piece entities (src/sim/scene/
// physics.ts). Their render objects follow the sim pose (`physics.object`), which RenderSync
// interpolates between the last two ticks: the renderer never simulates anything.
//
// Renderer-agnostic: `objects` builds the scene objects (src/render/greybox for Three.js) and
// `binding` says how an object follows its entity (object3DBinding for Three.js).

import { materialPresets, type GameContent } from '@content/index';
import {
  addScenePhysics,
  loadScene,
  PhysicsObjectComponent,
  SceneTransformComponent,
  sceneEntities,
  unloadScene,
  type EntityId,
  type KitLookup,
  type LoadedScene,
  type SceneLayout,
  type SceneSpawnPlacement,
  type StaticColliderSink,
  type Vec3,
  type World,
} from '@sim/index';
import type { RenderSync, SceneBinding, SimView, Transform } from '../loop/render-sync';
import { propBodies } from '../physics-objects';

/** The scene id loaded when the URL names none. */
export const DEFAULT_SCENE = 'testbed';

/** Builds the render objects of a scene. */
export interface SceneObjects<TObject> {
  /** Every part of the scene's static geometry (merged as the renderer sees fit), in one object. */
  staticGeometry(layout: SceneLayout): TObject;
  /** The object for one spawn (a prop, or a marker); its origin is the spawn point. */
  spawn(spawn: SceneSpawnPlacement): TObject;
  /**
   * The object for a movable prop: a `size` box centred on its origin (the body's centre). Without
   * it, movable props get `spawn`'s object (fine for headless runs).
   */
  body?(spawn: SceneSpawnPlacement, size: Vec3): TObject;
}

/** How a scene object reads its entity's transform. */
export type SceneTransformReader = (view: SimView, entity: EntityId) => Transform | undefined;

/** Scene physics options: see src/sim/scene/physics.ts. */
export interface SceneLoaderPhysics {
  /** Material of the level geometry; defaults to stone. */
  readonly levelMaterial?: string;
}

export interface SceneLoaderOptions<TObject, TCommand> {
  readonly world: World<TCommand>;
  readonly sync: RenderSync;
  readonly colliders: StaticColliderSink;
  readonly content: Pick<GameContent, 'all' | 'get' | 'has'>;
  readonly objects: SceneObjects<TObject>;
  /**
   * How an object follows its entity, reading its transform with `read` (`readSceneTransform`, or
   * `readPhysicsObjectTransform` for a movable prop).
   */
  readonly binding: (object: TObject, read: SceneTransformReader) => SceneBinding<TObject>;
  /**
   * Makes movable props physics objects and binds level colliders (the world needs
   * `installGamePhysics` and `colliders` must be its physics). Absent: every spawn stays put.
   */
  readonly physics?: SceneLoaderPhysics;
}

/** Thrown when asked for a scene the content does not have; lists the ones it does. */
export class UnknownSceneError extends Error {
  override readonly name = 'UnknownSceneError';

  constructor(
    readonly requested: string,
    readonly available: readonly string[],
  ) {
    super(`unknown scene "${requested}"; available scenes: ${available.join(', ')}`);
  }
}

/** Reads a scene entity's static transform (for render bindings). */
export function readSceneTransform(view: SimView, entity: EntityId): Transform | undefined {
  return view.get(entity, SceneTransformComponent);
}

/** Reads a physics object's pose as of the last tick: the centre of its body and its rotation. */
export function readPhysicsObjectTransform(view: SimView, entity: EntityId): Transform | undefined {
  const object = view.get(entity, PhysicsObjectComponent);
  return object === undefined
    ? undefined
    : { position: object.position, rotation: object.rotation };
}

export class SceneLoader<TObject, TCommand = unknown> {
  private loaded: LoadedScene | undefined;
  private readonly kit: KitLookup;

  constructor(private readonly options: SceneLoaderOptions<TObject, TCommand>) {
    const { content } = options;
    this.kit = (id) => (content.has('kit', id) ? content.get('kit', id) : undefined);
  }

  /** The loaded scene, if any. */
  get current(): LoadedScene | undefined {
    return this.loaded;
  }

  /** Ids of every scene in the content, sorted. */
  available(): string[] {
    return this.options.content.all('scene').map((scene) => scene.id);
  }

  /**
   * Loads scene `id` (after unloading the current one) into the sim, the physics sink and the
   * renderer. Call between sim steps.
   * @throws UnknownSceneError when the content has no scene `id` (the current scene stays loaded).
   */
  load(id: string): LoadedScene {
    const { world, sync, colliders, content, objects, binding } = this.options;
    if (!content.has('scene', id)) throw new UnknownSceneError(id, this.available());
    this.unload();
    const loaded = loadScene(world, content.get('scene', id), this.kit, colliders);
    const { physics } = this.options;
    const props = propBodies(content);
    const movable = new Set(
      physics === undefined
        ? []
        : addScenePhysics(world, loaded, {
            props,
            materials: materialPresets(content.all('material')),
            ...(physics.levelMaterial !== undefined && { levelMaterial: physics.levelMaterial }),
          }).objects,
    );
    sync.bind(loaded.root, binding(objects.staticGeometry(loaded.layout), readSceneTransform));
    for (const { entity, spawn } of loaded.spawns) {
      const size =
        movable.has(entity) && spawn.prop !== undefined ? props(spawn.prop)?.size : undefined;
      sync.bind(
        entity,
        size === undefined
          ? binding(objects.spawn(spawn), readSceneTransform)
          : binding(
              objects.body?.(spawn, size) ?? objects.spawn(spawn),
              readPhysicsObjectTransform,
            ),
      );
    }
    this.loaded = loaded;
    return loaded;
  }

  /** Unloads the current scene, if any: entities, colliders and render objects. Call between steps. */
  unload(): void {
    const loaded = this.loaded;
    if (loaded === undefined) return;
    this.loaded = undefined;
    const { world, sync, colliders } = this.options;
    for (const entity of sceneEntities(loaded)) sync.unbind(entity);
    unloadScene(world, loaded, colliders);
  }
}
