// Loads scenes into the sim and the renderer together (mw-e00.21). The sim side (entities, static
// colliders) is src/sim/scene; this binds render objects to the new entities through RenderSync, so
// the renderer follows the sim like every other entity: the scene's merged static geometry hangs on
// the scene root entity and every spawn gets its own object. Unloading destroys the entities, removes
// the colliders and disposes every bound object at once, leaving nothing behind in any of the three.
//
// Renderer-agnostic: `objects` builds the scene objects (src/render/greybox for Three.js) and
// `binding` says how an object follows its entity (object3DBinding for Three.js).

import type { GameContent } from '@content/index';
import {
  loadScene,
  SceneTransformComponent,
  sceneEntities,
  unloadScene,
  type EntityId,
  type KitLookup,
  type LoadedScene,
  type SceneLayout,
  type SceneSpawnPlacement,
  type StaticColliderSink,
  type World,
} from '@sim/index';
import type { RenderSync, SceneBinding, SimView, Transform } from '../loop/render-sync';

/** The scene id loaded when the URL names none. */
export const DEFAULT_SCENE = 'testbed';

/** Builds the render objects of a scene. */
export interface SceneObjects<TObject> {
  /** Every part of the scene's static geometry (merged as the renderer sees fit), in one object. */
  staticGeometry(layout: SceneLayout): TObject;
  /** The object for one spawn (a prop, or a marker). */
  spawn(spawn: SceneSpawnPlacement): TObject;
}

export interface SceneLoaderOptions<TObject, TCommand> {
  readonly world: World<TCommand>;
  readonly sync: RenderSync;
  readonly colliders: StaticColliderSink;
  readonly content: Pick<GameContent, 'all' | 'get' | 'has'>;
  readonly objects: SceneObjects<TObject>;
  /** How an object follows its entity; its `read` should be `readSceneTransform`. */
  readonly binding: (object: TObject) => SceneBinding<TObject>;
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
    sync.bind(loaded.root, binding(objects.staticGeometry(loaded.layout)));
    for (const { entity, spawn } of loaded.spawns) sync.bind(entity, binding(objects.spawn(spawn)));
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
