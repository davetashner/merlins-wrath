// Door geometry (mw-e03.18): where a door's leaf is at a given openness, the box it collides as, and
// where a moving leaf first touches something in its way. Pure functions of the door's data.
//
// A door is laid out in its own frame and turned by its yaw (quarter turns, so boxes stay
// axis-aligned and exact): the origin is the middle of the bottom of the closed leaf, x runs across
// the doorway, y up, z through it. `hinge` puts the hinge at x = −w/2 (left) or +w/2 (right); the
// free edge points the other way (`dx`). Openness o runs 0 (closed) … 1 (open):
//
// - hinged: the leaf turns about the vertical hinge line by o · 90°, towards +z (swing forward) or
//   −z (back);
// - trapdoor: a floor hatch whose top is flush with y = 0, turning up about a hinge line along z by
//   o · 90° (its size y is its extent along the hinge);
// - portcullis: the leaf rises by o · height into the wall above;
// - sliding: the leaf slides by o · width towards the hinge side, into the wall.
//
// Obstacles are bounding spheres, or upright bodies (a character's capsule: its feet, footprint
// radius and height, mw-e01.19). A turning leaf (hinged, trapdoor) touches an obstacle when it
// overlaps the sector the leaf sweeps; a portcullis or sliding leaf touches one when its leading edge
// reaches it. A hinged leaf meets an upright body by its footprint over its height, so a character
// pressed against the back of a door that swings away from it does not stop it, while one standing in
// the swing still does; every other leaf meets an upright body as its bounding sphere. The leaf stops where it first touches, so it never ends inside what it met. Only the
// leaf's leading motion meets things: a rising portcullis or a door sliding into the wall never does.

import type { SceneYaw } from '@content/index';
import { atan2, cos, hypot, sin } from '../math';
import { rotateYaw, yawRotation, type Quat } from '../scene/layout';
import type { Placement } from '../stimulus/placement';
import type { Bounds, Vec3 } from '../stimulus/shapes';
import type { Door } from './components';

/** The door data the geometry reads. */
export type DoorFrame = Pick<Door, 'kind' | 'size' | 'origin' | 'yaw' | 'hinge' | 'swing'>;

/**
 * Something a leaf can meet, world metres: a bounding sphere (centre and radius), or, with `height`,
 * an upright body standing on (x, y, z) with a footprint of `radius` (a character's capsule).
 */
export interface Obstacle extends Placement {
  /** Feet to crown, metres: set for an upright body. */
  readonly height?: number;
}

const QUARTER = Math.PI / 2;
const INVERSE: Readonly<Record<SceneYaw, SceneYaw>> = { 0: 0, 90: 270, 180: 180, 270: 90 };

const vec = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

/** −1 or +1: the free edge's direction from the hinge, along x. */
const freeSide = (door: DoorFrame): number => (door.hinge === 'left' ? 1 : -1);
/** x of the hinge line. */
const hingeX = (door: DoorFrame): number => (-freeSide(door) * door.size.x) / 2;

/** A point of the door's frame in world metres. */
export function toWorld(door: DoorFrame, local: Vec3): Vec3 {
  const turned = rotateYaw(local, door.yaw);
  return vec(door.origin.x + turned.x, door.origin.y + turned.y, door.origin.z + turned.z);
}

/** A world point in the door's frame. */
export function toLocal(door: DoorFrame, world: Vec3): Vec3 {
  const { origin } = door;
  return rotateYaw(
    vec(world.x - origin.x, world.y - origin.y, world.z - origin.z),
    INVERSE[door.yaw],
  );
}

/** A box of the door's frame in world metres. */
function worldBox(door: DoorFrame, min: Vec3, max: Vec3): Bounds {
  const a = toWorld(door, min);
  const b = toWorld(door, max);
  return {
    min: vec(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.min(a.z, b.z)),
    max: vec(Math.max(a.x, b.x), Math.max(a.y, b.y), Math.max(a.z, b.z)),
  };
}

/** The closed leaf, world metres. */
export function closedBox(door: DoorFrame): Bounds {
  const { x: w, y: h, z: t } = door.size;
  if (door.kind === 'trapdoor')
    return worldBox(door, vec(-w / 2, -t, -h / 2), vec(w / 2, 0, h / 2));
  return worldBox(door, vec(-w / 2, 0, -t / 2), vec(w / 2, h, t / 2));
}

/** The leaf of a turning door standing fully open, world metres. */
function openTurnedBox(door: DoorFrame): Bounds {
  const { x: w, y: h, z: t } = door.size;
  const hx = hingeX(door);
  const dx = freeSide(door);
  const [x0, x1] = dx > 0 ? [hx, hx + t] : [hx - t, hx];
  if (door.kind === 'trapdoor') return worldBox(door, vec(x0, 0, -h / 2), vec(x1, w, h / 2));
  const [z0, z1] = door.swing === 'forward' ? [0, w] : [-w, 0];
  return worldBox(door, vec(x0, 0, z0), vec(x1, h, z1));
}

/**
 * The box the leaf collides as at `openness`, world metres. A portcullis or sliding leaf is where it
 * is; a turning leaf is its closed box until it is fully open, then its open box.
 */
export function leafBox(door: DoorFrame, openness: number): Bounds {
  const { x: w, y: h, z: t } = door.size;
  switch (door.kind) {
    case 'portcullis':
      return worldBox(door, vec(-w / 2, openness * h, -t / 2), vec(w / 2, h + openness * h, t / 2));
    case 'sliding': {
      const shift = -freeSide(door) * openness * w;
      return worldBox(door, vec(shift - w / 2, 0, -t / 2), vec(shift + w / 2, h, t / 2));
    }
    default:
      return openness >= 1 ? openTurnedBox(door) : closedBox(door);
  }
}

/** The centre of the closed leaf, world metres. */
export function leafCentre(door: DoorFrame): Vec3 {
  const { min, max } = closedBox(door);
  return vec((min.x + max.x) / 2, (min.y + max.y) / 2, (min.z + max.z) / 2);
}

/** Angular half-width of a sphere of radius `r` seen from `rho` away (π when inside it). */
function halfWidth(rho: number, r: number): number {
  return rho <= r ? Math.PI : atan2(r, Math.sqrt(rho * rho - r * r));
}

/**
 * Turning leaf: where in angle a sweep from `from` to `to` (radians) first touches a disc of radius
 * `r` at `p` in the plane the leaf turns in, given the obstacle spans [bottom, top] along the hinge
 * (height for a door, z for a hatch).
 */
function turnedContact(
  door: DoorFrame,
  from: number,
  to: number,
  p: Vec3,
  r: number,
  bottom: number,
  top: number,
): number | undefined {
  const { x: w, y: h } = door.size;
  const hatch = door.kind === 'trapdoor';
  const along = hatch ? bottom < h / 2 && top > -h / 2 : bottom < h && top > 0;
  if (!along) return undefined;
  const a = (p.x - hingeX(door)) * freeSide(door);
  const b = hatch ? p.y : door.swing === 'forward' ? p.z : -p.z;
  const rho = hypot(a, b);
  if (rho - r >= w) return undefined;
  const phi = atan2(b, a);
  const alpha = halfWidth(rho, r);
  if (to > from)
    return phi + alpha > from && phi - alpha < to ? Math.max(from, phi - alpha) : undefined;
  return phi - alpha < from && phi + alpha > to ? Math.min(from, phi + alpha) : undefined;
}

/**
 * Where a leaf moving from openness `from` to `to` first touches `obstacle` (world metres), as an
 * openness between them; undefined when it does not touch it.
 */
export function contactOpenness(
  door: DoorFrame,
  from: number,
  to: number,
  obstacle: Obstacle,
): number | undefined {
  const local = toLocal(door, obstacle);
  const { height } = obstacle;
  if (door.kind === 'hinged' && height !== undefined) {
    // An upright body: its footprint, over its height.
    const angle = turnedContact(
      door,
      from * QUARTER,
      to * QUARTER,
      local,
      obstacle.radius,
      local.y,
      local.y + height,
    );
    return angle === undefined ? undefined : angle / QUARTER;
  }
  // Anything else meets it as a bounding sphere.
  const p = height === undefined ? local : vec(local.x, local.y + height / 2, local.z);
  const r = height === undefined ? obstacle.radius : Math.max(obstacle.radius, height / 2);
  const { x: w, y: h, z: t } = door.size;
  switch (door.kind) {
    case 'portcullis': {
      // Only a closing portcullis meets things: its bottom edge comes down from `from` to `to`.
      if (to >= from || Math.abs(p.x) >= w / 2 + r || Math.abs(p.z) >= t / 2 + r) return undefined;
      const top = p.y + r;
      const bottom = p.y - r;
      if (top <= to * h || bottom >= from * h) return undefined;
      return Math.min(from, top / h);
    }
    case 'sliding': {
      // Only a closing leaf meets things: its free edge comes back across the doorway.
      if (to >= from || Math.abs(p.z) >= t / 2 + r || p.y - r >= h || p.y + r <= 0) {
        return undefined;
      }
      const u = p.x * freeSide(door);
      const edge = (o: number): number => w / 2 - o * w;
      if (u + r <= edge(from) || u - r >= edge(to)) return undefined;
      return Math.min(from, (w / 2 - (u - r)) / w);
    }
    default: {
      const [bottom, top] = door.kind === 'trapdoor' ? [p.z - r, p.z + r] : [p.y - r, p.y + r];
      const angle = turnedContact(door, from * QUARTER, to * QUARTER, p, r, bottom, top);
      return angle === undefined ? undefined : angle / QUARTER;
    }
  }
}

/** A rotation of `angle` radians about the unit axis (x, y, z). */
function axisAngle(x: number, y: number, z: number, angle: number): Quat {
  const s = sin(angle / 2);
  return { x: x * s, y: y * s, z: z * s, w: cos(angle / 2) };
}

/** a × b: rotate by b, then by a. */
function multiply(a: Quat, b: Quat): Quat {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

/** How to draw a leaf: its pivot's pose and the leaf box's centre and size about the pivot. */
export interface LeafPose {
  /** The pivot (hinge for turning doors, else the door's origin moved with the leaf), metres. */
  readonly position: Vec3;
  readonly rotation: Quat;
  /** The leaf box's centre in the pivot's frame, metres. */
  readonly centre: Vec3;
  /** The leaf box's size in the pivot's frame, metres. */
  readonly size: Vec3;
}

/** The leaf's pose at `openness` for drawing it (renderers interpolate between two ticks' poses). */
export function leafPose(door: DoorFrame, openness: number): LeafPose {
  const { x: w, y: h, z: t } = door.size;
  const turn = yawRotation(door.yaw);
  const dx = freeSide(door);
  const hinge = vec(hingeX(door), 0, 0);
  switch (door.kind) {
    case 'hinged': {
      const s = door.swing === 'forward' ? 1 : -1;
      return {
        position: toWorld(door, hinge),
        rotation: multiply(turn, axisAngle(0, 1, 0, -dx * s * openness * QUARTER)),
        centre: vec((dx * w) / 2, h / 2, 0),
        size: vec(w, h, t),
      };
    }
    case 'trapdoor':
      return {
        position: toWorld(door, hinge),
        rotation: multiply(turn, axisAngle(0, 0, 1, dx * openness * QUARTER)),
        centre: vec((dx * w) / 2, -t / 2, 0),
        size: vec(w, t, h),
      };
    case 'portcullis':
      return {
        position: toWorld(door, vec(0, openness * h, 0)),
        rotation: turn,
        centre: vec(0, h / 2, 0),
        size: vec(w, h, t),
      };
    case 'sliding':
      return {
        position: toWorld(door, vec(-dx * openness * w, 0, 0)),
        rotation: turn,
        centre: vec(0, h / 2, 0),
        size: vec(w, h, t),
      };
  }
}
