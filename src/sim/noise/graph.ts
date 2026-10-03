// The sound graph (mw-e09.3): a level's rooms and the portals between them, as noise propagation
// reads them. Rooms are axis-aligned boxes; a portal (a doorway, an arch, a hatch) joins two rooms,
// or a room and the outside, and may hold a door whose state sets its loss when a sound passes.
// Rooms that touch transmit through their partition: side by side through a wall, stacked through a
// floor or ceiling. Partitions are found from the boxes (faces within PARTITION_GAP of each other,
// overlapping on the other two axes), so a level only names the material of the ones that are not
// the tuning's default. Everywhere outside every room is one more room, the outside (open terrain):
// it has no partitions, only the portals that open onto it.
//
// The graph is static topology: door states are read when a sound propagates (propagation.ts), so a
// door that opens or shuts between two noises changes the second one with nothing to rebuild.

import type { EntityId } from '../core/component';
import { at } from '../geom/vec';
import type { Vec3 } from '../stimulus/shapes';

/** The room id that stands for everywhere outside the level's rooms (matches content). */
export const OUTSIDE_ROOM = 'outside';

/** Faces of two rooms this close (metres) still touch: room boxes may stop at a wall's faces. */
export const PARTITION_GAP = 0.5;

/** What separates two touching rooms. */
export type SoundPartitionKind = 'wall' | 'floor';

/** A room as a level declares it. */
export interface SoundRoomSpec {
  readonly id: string;
  /** Lower corner, metres. */
  readonly min: Vec3;
  /** Upper corner, metres; above `min` on every axis. */
  readonly max: Vec3;
}

/** A portal as a level declares it. */
export interface SoundPortalSpec {
  readonly id: string;
  /** The two rooms it joins; one may be OUTSIDE_ROOM. */
  readonly rooms: readonly [string, string];
  /** Its middle, metres: where a listener on the far side hears a sound come from. */
  readonly position: Vec3;
  /** The door in it, whose state sets its loss; none: always open. */
  readonly door?: EntityId | null;
}

/** The material of one partition, by the two rooms it separates. */
export interface SoundPartitionSpec {
  readonly rooms: readonly [string, string];
  readonly material: string;
}

/** A level's sound geometry. */
export interface SoundGraphSpec {
  readonly rooms: readonly SoundRoomSpec[];
  readonly portals: readonly SoundPortalSpec[];
  readonly partitions?: readonly SoundPartitionSpec[];
}

/** A portal in a built graph. */
export interface SoundPortal {
  readonly id: string;
  /** Its two rooms, as room indices (the outside is `graph.outside`). */
  readonly rooms: readonly [number, number];
  readonly position: Vec3;
  readonly door: EntityId | null;
}

/** One way out of a room through a partition. */
export interface SoundPartition {
  /** The room on the other side. */
  readonly to: number;
  readonly kind: SoundPartitionKind;
  /** Its material, or null for the tuning's default. */
  readonly material: string | null;
}

/** A room in a built graph. */
export interface SoundRoom {
  readonly id: string;
  readonly min: Vec3;
  readonly max: Vec3;
  /** Indices of the portals that open onto it, in level order. */
  readonly portals: readonly number[];
  readonly partitions: readonly SoundPartition[];
}

/** A built sound graph. Rooms keep level order; the outside comes last, at index `outside`. */
export interface SoundGraph {
  readonly rooms: readonly SoundRoom[];
  readonly portals: readonly SoundPortal[];
  /** Index of the outside room. */
  readonly outside: number;
}

const finiteVec = (v: Vec3): boolean =>
  Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);

const AXES = ['x', 'y', 'z'] as const;

/**
 * How two boxes meet: 'overlap' when they share volume, a partition kind when they touch (faces
 * within PARTITION_GAP, overlapping by more than that on the other two axes), else null.
 */
function meeting(a: SoundRoomSpec, b: SoundRoomSpec): 'overlap' | SoundPartitionKind | null {
  let touching: (typeof AXES)[number] | null = null;
  for (const axis of AXES) {
    const overlap = Math.min(a.max[axis], b.max[axis]) - Math.max(a.min[axis], b.min[axis]);
    if (overlap > PARTITION_GAP) continue;
    if (overlap < -PARTITION_GAP || touching !== null) return null;
    touching = axis;
  }
  if (touching === null) return 'overlap';
  return touching === 'y' ? 'floor' : 'wall';
}

const pairKey = (a: number, b: number): string =>
  a < b ? `${String(a)}|${String(b)}` : `${String(b)}|${String(a)}`;

/**
 * Builds the sound graph of a level.
 * @throws RangeError for a duplicate or reserved id, a room box that is not finite or not above its
 * min, rooms that overlap, a portal or partition naming an unknown room or joining a room to itself,
 * a portal position that is not finite, or a partition between rooms that do not touch.
 */
export function buildSoundGraph(spec: SoundGraphSpec): SoundGraph {
  const index = new Map<string, number>();
  spec.rooms.forEach((room, i) => {
    if (room.id === OUTSIDE_ROOM) throw new RangeError(`room id "${OUTSIDE_ROOM}" is reserved`);
    if (index.has(room.id)) throw new RangeError(`room id "${room.id}" is used twice`);
    if (!finiteVec(room.min) || !finiteVec(room.max)) {
      throw new RangeError(`room "${room.id}" must have finite corners`);
    }
    if (!AXES.every((axis) => room.max[axis] > room.min[axis])) {
      throw new RangeError(`room "${room.id}" max must be above min on every axis`);
    }
    index.set(room.id, i);
  });
  const outside = spec.rooms.length;
  const roomIndex = (id: string, outsideAllowed: boolean, what: string): number => {
    if (outsideAllowed && id === OUTSIDE_ROOM) return outside;
    const found = index.get(id);
    if (found === undefined) throw new RangeError(`${what} names unknown room "${id}"`);
    return found;
  };

  const portalLists: number[][] = Array.from({ length: outside + 1 }, () => []);
  const portalIds = new Set<string>();
  const portals = spec.portals.map((portal, i): SoundPortal => {
    if (portalIds.has(portal.id)) throw new RangeError(`portal id "${portal.id}" is used twice`);
    portalIds.add(portal.id);
    const what = `portal "${portal.id}"`;
    const a = roomIndex(portal.rooms[0], true, what);
    const b = roomIndex(portal.rooms[1], true, what);
    if (a === b) throw new RangeError(`${what} joins a room to itself`);
    if (!finiteVec(portal.position)) throw new RangeError(`${what} must have a finite position`);
    at(portalLists, a).push(i);
    at(portalLists, b).push(i);
    return Object.freeze({
      id: portal.id,
      rooms: Object.freeze([a, b] as const),
      position: Object.freeze({ ...portal.position }),
      door: portal.door ?? null,
    });
  });

  const materials = new Map<string, string>();
  for (const partition of spec.partitions ?? []) {
    const what = `partition ${partition.rooms[0]}–${partition.rooms[1]}`;
    const a = roomIndex(partition.rooms[0], false, what);
    const b = roomIndex(partition.rooms[1], false, what);
    if (a === b) throw new RangeError(`${what} joins a room to itself`);
    const kind = meeting(at(spec.rooms, a), at(spec.rooms, b));
    if (kind === null || kind === 'overlap') {
      throw new RangeError(`${what} names rooms that do not touch`);
    }
    materials.set(pairKey(a, b), partition.material);
  }

  const partitionLists: SoundPartition[][] = Array.from({ length: outside + 1 }, () => []);
  spec.rooms.forEach((a, i) => {
    for (let j = i + 1; j < outside; j++) {
      const b = at(spec.rooms, j);
      const kind = meeting(a, b);
      if (kind === null) continue;
      if (kind === 'overlap') throw new RangeError(`rooms "${a.id}" and "${b.id}" overlap`);
      const material = materials.get(pairKey(i, j)) ?? null;
      at(partitionLists, i).push(Object.freeze({ to: j, kind, material }));
      at(partitionLists, j).push(Object.freeze({ to: i, kind, material }));
    }
  });

  const room = (id: string, min: Vec3, max: Vec3, i: number): SoundRoom =>
    Object.freeze({
      id,
      min: Object.freeze({ ...min }),
      max: Object.freeze({ ...max }),
      portals: Object.freeze(at(portalLists, i)),
      partitions: Object.freeze(at(partitionLists, i)),
    });
  const unbounded = { x: Infinity, y: Infinity, z: Infinity };
  const rooms = [
    ...spec.rooms.map((r, i) => room(r.id, r.min, r.max, i)),
    room(OUTSIDE_ROOM, { x: -Infinity, y: -Infinity, z: -Infinity }, unbounded, outside),
  ];
  return Object.freeze({ rooms: Object.freeze(rooms), portals: Object.freeze(portals), outside });
}

/**
 * The room containing `position` (faces included; on a face two rooms share, the first in level
 * order), or `graph.outside` when it is in none.
 */
export function roomAt(graph: SoundGraph, position: Vec3): number {
  // The outside comes last and is unbounded, so it takes every finite position no room holds.
  let i = 0;
  for (const { min, max } of graph.rooms) {
    if (
      position.x >= min.x &&
      position.x <= max.x &&
      position.y >= min.y &&
      position.y <= max.y &&
      position.z >= min.z &&
      position.z <= max.z
    ) {
      return i;
    }
    i++;
  }
  return graph.outside; // a position that is not a number
}
