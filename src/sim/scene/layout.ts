// Scene layout (mw-e00.21): turns a scene (kit pieces placed on a grid, plus spawns) into world-space
// parts. Both the sim (static colliders, piece entities) and the renderer (greybox meshes) build from
// the same parts, so what you see is what collides. Pieces only turn in quarter turns, so every part
// stays axis-aligned and the maths is exact: rotations use a table of 0/±1 (no trigonometry), and a
// wedge's rise direction just turns with it.
//
// Coordinates: metres, +y up; yaw turns counter-clockwise seen from above (a right-handed rotation
// about +y, the same as Three.js `rotation.y`), so yaw 90 turns local +z into world +x.

import type { KitPurpose, KitShape, SceneYaw } from '@content/index';
import type { RampRise } from '../character/greybox';
import type { InteractableSpec } from '../interaction/affordance';
import type { StaticColliderDesc } from '../physics/static-colliders';
import type { WorldPropertyValues } from '../properties/spec';
import type { Vec3 } from '../stimulus/shapes';

/** A unit quaternion. */
export interface Quat {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;
}

/** Three numbers: x, y, z. */
export type Triple = readonly [number, number, number];

/** One shape of a kit piece, relative to the piece's origin (see src/content/types/kit.ts). */
export interface KitPartSpec {
  readonly shape: KitShape;
  readonly size: Triple;
  readonly offset: Triple;
  readonly collider: boolean;
}

/** A kit piece as the layout needs it; `GameEntry<'kit'>` satisfies it. */
export interface KitPieceSpec {
  readonly id: string;
  readonly purpose: KitPurpose;
  readonly parts: readonly KitPartSpec[];
}

/** A horizontal side of a part: the face whose outward normal points along that axis. */
export type LedgeSide = '+x' | '-x' | '+z' | '-z';

/**
 * Switches ledges of a placed piece off (`ledge: false`) or forces them on (`ledge: true`), for one
 * part and side or for all of them (mw-e03.22). Sides are the piece's own (before yaw).
 */
export interface LedgeOverrideSpec {
  readonly side?: LedgeSide | undefined;
  /** Index of the part in the kit piece. */
  readonly part?: number | undefined;
  readonly ledge: boolean;
}

/**
 * World properties a placement gives its piece over the level material (mw-e03.22): the data-file
 * form, whose material is a reference.
 */
export type ScenePropertiesSpec = {
  readonly [K in Exclude<keyof WorldPropertyValues, 'material'>]?:
    WorldPropertyValues[K] | undefined;
} & { readonly material?: { readonly id: string } | undefined };

export interface ScenePlacementSpec {
  readonly piece: { readonly id: string };
  /** Grid cells. */
  readonly at: Triple;
  readonly yaw: SceneYaw;
  readonly scale: Triple;
  readonly purpose?: KitPurpose | undefined;
  /** World properties of the piece over the level material (e.g. climbable ivy). */
  readonly properties?: ScenePropertiesSpec | undefined;
  /** Ledge overrides, applied in order. */
  readonly ledges?: readonly LedgeOverrideSpec[] | undefined;
}

export interface SceneSpawnSpec {
  readonly id: string;
  /** Grid cells. */
  readonly at: Triple;
  readonly yaw: SceneYaw;
  readonly prop?: { readonly id: string } | undefined;
  readonly tags: readonly string[];
  /** Makes the spawned entity interactable (mw-e02.5). */
  readonly interact?: InteractableSpec | undefined;
}

/** A scene as the layout needs it; `GameEntry<'scene'>` satisfies it. */
export interface SceneSpec {
  readonly id: string;
  /** Metres per grid cell. */
  readonly grid: number;
  readonly placements: readonly ScenePlacementSpec[];
  readonly spawns: readonly SceneSpawnSpec[];
}

/** Finds a kit piece by id (undefined when there is none). */
export type KitLookup = (id: string) => KitPieceSpec | undefined;

/** One part of one placed piece, in world space. */
export interface ScenePart {
  /** Index of the placement in the scene. */
  readonly placement: number;
  readonly piece: string;
  /** The placement's purpose, or else the piece's. */
  readonly purpose: KitPurpose;
  readonly shape: KitShape;
  /** Centre of the part, world metres. */
  readonly center: Vec3;
  /** Size along the part's own (unrotated) axes after the placement's scale, metres. */
  readonly size: Vec3;
  readonly yaw: SceneYaw;
  readonly rotation: Quat;
  /** World-space bounds (axis-aligned, exact for every part). */
  readonly min: Vec3;
  readonly max: Vec3;
  /** The static collider for the part, when it is solid. */
  readonly collider: StaticColliderDesc | undefined;
}

/** One placed piece: its origin and rotation, and the bounds of all its parts. */
export interface ScenePiecePlacement {
  readonly placement: number;
  readonly piece: string;
  readonly purpose: KitPurpose;
  readonly position: Vec3;
  readonly rotation: Quat;
  readonly min: Vec3;
  readonly max: Vec3;
  /** The placement's world properties, when it sets any. */
  readonly properties?: ScenePropertiesSpec;
  /** The placement's ledge overrides, when it has any. */
  readonly ledges?: readonly LedgeOverrideSpec[];
}

/** One spawn in world space. */
export interface SceneSpawnPlacement {
  readonly id: string;
  readonly position: Vec3;
  readonly yaw: SceneYaw;
  readonly rotation: Quat;
  readonly prop: string | undefined;
  readonly tags: readonly string[];
  /** Its affordances, when the spawn is interactable (see src/sim/interaction). */
  readonly interact?: InteractableSpec | undefined;
}

export interface SceneLayout {
  readonly id: string;
  readonly pieces: readonly ScenePiecePlacement[];
  readonly parts: readonly ScenePart[];
  readonly spawns: readonly SceneSpawnPlacement[];
}

/** Thrown when a scene names a kit piece the lookup does not have. */
export class SceneLayoutError extends Error {
  override readonly name = 'SceneLayoutError';
}

/** cos/sin of each yaw, exact. */
const TURNS: Record<SceneYaw, { readonly cos: number; readonly sin: number }> = {
  0: { cos: 1, sin: 0 },
  90: { cos: 0, sin: 1 },
  180: { cos: -1, sin: 0 },
  270: { cos: 0, sin: -1 },
};

const RISES: Record<SceneYaw, RampRise> = { 0: '+z', 90: '+x', 180: '-z', 270: '-x' };

const HALF = Math.SQRT1_2;
const ROTATIONS: Record<SceneYaw, Quat> = {
  0: Object.freeze({ x: 0, y: 0, z: 0, w: 1 }),
  90: Object.freeze({ x: 0, y: HALF, z: 0, w: HALF }),
  180: Object.freeze({ x: 0, y: 1, z: 0, w: 0 }),
  270: Object.freeze({ x: 0, y: -HALF, z: 0, w: HALF }),
};

/** The rotation of a yaw, as a unit quaternion. */
export function yawRotation(yaw: SceneYaw): Quat {
  return ROTATIONS[yaw];
}

const vec = (x: number, y: number, z: number): Vec3 => Object.freeze({ x, y, z });

/** Turns `v` by `yaw` about +y. */
export function rotateYaw(v: Vec3, yaw: SceneYaw): Vec3 {
  const { cos, sin } = TURNS[yaw];
  // `+ 0` turns the -0 a zero coefficient can produce into 0, so equal layouts compare equal.
  return vec(v.x * cos + v.z * sin + 0, v.y, -v.x * sin + v.z * cos + 0);
}

function minOf(a: Vec3, b: Vec3): Vec3 {
  return vec(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.min(a.z, b.z));
}

function maxOf(a: Vec3, b: Vec3): Vec3 {
  return vec(Math.max(a.x, b.x), Math.max(a.y, b.y), Math.max(a.z, b.z));
}

function gridToWorld(at: Triple, grid: number): Vec3 {
  return vec(at[0] * grid, at[1] * grid, at[2] * grid);
}

function layoutPart(
  part: KitPartSpec,
  placement: ScenePlacementSpec,
  index: number,
  origin: Vec3,
  purpose: KitPurpose,
): ScenePart {
  const { scale, yaw } = placement;
  const size = vec(part.size[0] * scale[0], part.size[1] * scale[1], part.size[2] * scale[2]);
  const offset = rotateYaw(
    vec(part.offset[0] * scale[0], part.offset[1] * scale[1], part.offset[2] * scale[2]),
    yaw,
  );
  const center = vec(origin.x + offset.x, origin.y + offset.y, origin.z + offset.z);
  const turned = rotateYaw(size, yaw);
  const half = vec(Math.abs(turned.x) / 2, turned.y / 2, Math.abs(turned.z) / 2);
  const min = vec(center.x - half.x, center.y - half.y, center.z - half.z);
  const max = vec(center.x + half.x, center.y + half.y, center.z + half.z);
  const collider: StaticColliderDesc | undefined = !part.collider
    ? undefined
    : part.shape === 'wedge'
      ? Object.freeze({ kind: 'ramp', min, max, rises: RISES[yaw] })
      : Object.freeze({ kind: 'box', min, max });
  return Object.freeze({
    placement: index,
    piece: placement.piece.id,
    purpose,
    shape: part.shape,
    center,
    size,
    yaw,
    rotation: ROTATIONS[yaw],
    min,
    max,
    collider,
  });
}

/**
 * Lays out every placement and spawn of `scene` in world space, in scene order.
 * @throws SceneLayoutError when a placement names a piece `kit` does not have.
 */
export function layoutScene(scene: SceneSpec, kit: KitLookup): SceneLayout {
  const pieces: ScenePiecePlacement[] = [];
  const parts: ScenePart[] = [];
  scene.placements.forEach((placement, index) => {
    const piece = kit(placement.piece.id);
    if (piece === undefined) {
      throw new SceneLayoutError(
        `scene "${scene.id}" placement ${String(index)} uses unknown kit piece "${placement.piece.id}"`,
      );
    }
    if (piece.parts.length === 0) {
      throw new SceneLayoutError(`kit piece "${piece.id}" has no parts`);
    }
    const origin = gridToWorld(placement.at, scene.grid);
    const purpose = placement.purpose ?? piece.purpose;
    const own = piece.parts.map((part) => layoutPart(part, placement, index, origin, purpose));
    parts.push(...own);
    pieces.push(
      Object.freeze({
        placement: index,
        piece: piece.id,
        purpose,
        position: origin,
        rotation: ROTATIONS[placement.yaw],
        min: own.map((p) => p.min).reduce(minOf),
        max: own.map((p) => p.max).reduce(maxOf),
        ...(placement.properties !== undefined && { properties: placement.properties }),
        ...(placement.ledges !== undefined && { ledges: placement.ledges }),
      }),
    );
  });
  const spawns = scene.spawns.map((spawn) =>
    Object.freeze({
      id: spawn.id,
      position: gridToWorld(spawn.at, scene.grid),
      yaw: spawn.yaw,
      rotation: ROTATIONS[spawn.yaw],
      prop: spawn.prop?.id,
      tags: Object.freeze([...spawn.tags]),
      interact: spawn.interact,
    }),
  );
  return Object.freeze({
    id: scene.id,
    pieces: Object.freeze(pieces),
    parts: Object.freeze(parts),
    spawns: Object.freeze(spawns),
  });
}
