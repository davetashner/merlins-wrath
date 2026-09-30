// The scene loader (mw-e00.21): puts a scene into the sim world and takes it out again. Loading
// spawns one root entity for the scene (the renderer hangs the merged static geometry on it), one
// entity per placed kit piece and one per spawn, all tagged with the scene they belong to, and adds a
// static collider for every solid part to the physics sink. Unloading destroys exactly those entities
// and removes exactly those colliders, so a load/unload cycle leaves nothing behind.
//
// Load and unload between steps (setup, tools, scene changes), not from a system: outside a step the
// world applies spawns and destroys at once, so render bindings can attach straight after loading.

import { defineComponent, type EntityId } from '../core/component';
import type { World } from '../core/world';
import type { ColliderHandle, StaticColliderSink } from '../physics/static-colliders';
import type { Vec3 } from '../stimulus/shapes';
import {
  layoutScene,
  type KitLookup,
  type Quat,
  type SceneLayout,
  type SceneSpawnPlacement,
  type SceneSpec,
} from './layout';

/** Marks every entity a scene load created (`scene.member`; a snapshot key, never renamed). */
export interface SceneMember {
  readonly scene: string;
}

/** A static world transform: position (metres) and rotation. */
export interface SceneTransform {
  readonly position: Vec3;
  readonly rotation: Quat;
}

/** A placed kit piece: which one, its purpose and its world bounds. */
export interface ScenePiece {
  readonly piece: string;
  /** Index of the placement in the scene file. */
  readonly placement: number;
  readonly purpose: string;
  readonly min: Vec3;
  readonly max: Vec3;
}

/**
 * A spawn point: its name in the scene, the prop it spawns (absent for a marker) and its tags. `prop`
 * is left out rather than undefined, so the component stays canonically encodable (state hashes).
 */
export interface SceneSpawn {
  readonly id: string;
  readonly prop?: string;
  readonly tags: readonly string[];
}

export const SceneMemberComponent = defineComponent<SceneMember>('scene.member');
export const SceneTransformComponent = defineComponent<SceneTransform>('scene.transform');
export const ScenePieceComponent = defineComponent<ScenePiece>('scene.piece');
export const SceneSpawnComponent = defineComponent<SceneSpawn>('scene.spawn');

/** Every component the scene loader writes; register them once per world before loading. */
export const sceneComponents = [
  SceneMemberComponent,
  SceneTransformComponent,
  ScenePieceComponent,
  SceneSpawnComponent,
] as const;

/** Registers the scene components on `world`. */
export function registerSceneComponents<T>(world: World<T>): World<T> {
  return world.register(...sceneComponents);
}

/** What a load created, for unloading and for binding render objects. */
export interface LoadedScene {
  readonly id: string;
  readonly layout: SceneLayout;
  /** The scene's root entity (identity transform); the static geometry binds to it. */
  readonly root: EntityId;
  /** One entity per placement, in scene order. */
  readonly pieces: readonly EntityId[];
  /** One entity per spawn, in scene order. */
  readonly spawns: readonly { readonly entity: EntityId; readonly spawn: SceneSpawnPlacement }[];
  readonly colliders: readonly ColliderHandle[];
}

const IDENTITY: SceneTransform = Object.freeze({
  position: Object.freeze({ x: 0, y: 0, z: 0 }),
  rotation: Object.freeze({ x: 0, y: 0, z: 0, w: 1 }),
});

function spawnMember<T>(world: World<T>, scene: string, transform: SceneTransform): EntityId {
  const entity = world.spawn();
  world.add(entity, SceneMemberComponent, Object.freeze({ scene }));
  world.add(entity, SceneTransformComponent, transform);
  return entity;
}

/**
 * Loads `scene` into `world` (which must have the scene components registered) and its solid parts
 * into `colliders`.
 * @throws SceneLayoutError when the scene names a kit piece `kit` does not have (nothing is loaded).
 */
export function loadScene<T>(
  world: World<T>,
  scene: SceneSpec,
  kit: KitLookup,
  colliders: StaticColliderSink,
): LoadedScene {
  const layout = layoutScene(scene, kit);
  const id = layout.id;
  const root = spawnMember(world, id, IDENTITY);
  const pieces = layout.pieces.map((piece) => {
    const entity = spawnMember(
      world,
      id,
      Object.freeze({ position: piece.position, rotation: piece.rotation }),
    );
    world.add(
      entity,
      ScenePieceComponent,
      Object.freeze({
        piece: piece.piece,
        placement: piece.placement,
        purpose: piece.purpose,
        min: piece.min,
        max: piece.max,
      }),
    );
    return entity;
  });
  const spawns = layout.spawns.map((spawn) => {
    const entity = spawnMember(
      world,
      id,
      Object.freeze({ position: spawn.position, rotation: spawn.rotation }),
    );
    world.add(
      entity,
      SceneSpawnComponent,
      Object.freeze({
        id: spawn.id,
        ...(spawn.prop !== undefined && { prop: spawn.prop }),
        tags: spawn.tags,
      }),
    );
    return Object.freeze({ entity, spawn });
  });
  const handles = layout.parts.flatMap((part) =>
    part.collider === undefined ? [] : [colliders.add(part.collider)],
  );
  return Object.freeze({
    id,
    layout,
    root,
    pieces: Object.freeze(pieces),
    spawns: Object.freeze(spawns),
    colliders: Object.freeze(handles),
  });
}

/** Every entity a load created: root, pieces, spawns. */
export function sceneEntities(loaded: LoadedScene): EntityId[] {
  return [loaded.root, ...loaded.pieces, ...loaded.spawns.map((s) => s.entity)];
}

/**
 * Removes a loaded scene: destroys its entities that are still alive (a system may already have
 * destroyed a spawned prop or burnt a piece away) and removes its colliders that are still in
 * `colliders` (a piece's bound colliders go with the piece, mw-e03.42), each exactly once.
 */
export function unloadScene<T>(
  world: World<T>,
  loaded: LoadedScene,
  colliders: StaticColliderSink,
): void {
  for (const entity of sceneEntities(loaded)) {
    if (world.isAlive(entity)) world.destroy(entity);
  }
  for (const handle of loaded.colliders) {
    if (colliders.has(handle)) colliders.remove(handle);
  }
}

/** Entities in `world` created by a scene load (optionally only those of scene `id`). */
export function sceneMembers<T>(world: World<T>, id?: string): EntityId[] {
  const members: EntityId[] = [];
  world.query(SceneMemberComponent).forEach((entity, member) => {
    if (id === undefined || member.scene === id) members.push(entity);
  });
  return members;
}
