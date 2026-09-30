// Light occlusion geometry (mw-e03.15): what stops light, and the segment tests the light field runs.
//
// Static occluders are the level's static collision geometry. `StaticOccluders` implements the same
// `StaticColliderSink` the scene loader writes to, so a scene's greybox boxes and ramps are "baked"
// into the light model exactly as they go into physics: axis-aligned boxes and wedge ramps, plain
// numbers, no engine. A 2D (x/z) bucket grid finds the occluders near a segment without scanning
// the whole level.
//
// Occluders are open sets: a segment that only touches a face, edge or corner is not blocked, and
// neither is one that starts or ends exactly on a surface (a sample on the floor, a torch on a wall).
// A segment that starts inside solid geometry is blocked. Only + - * / are used, so every result is
// bit-for-bit deterministic.

import type { GreyboxShape } from '../character/greybox';
import type {
  ColliderHandle,
  StaticColliderDesc,
  StaticColliderSink,
} from '../physics/static-colliders';
import type { Vec3 } from '../stimulus/shapes';

/**
 * An occluder as flat numbers: an open axis-aligned box, optionally cut by a half-space (a ramp's
 * wedge is the part of its box where `nx·x + ny·y + nz·z < d`). Unused plane fields are 0.
 */
export interface Occluder {
  readonly minX: number;
  readonly minY: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly maxZ: number;
  readonly cut: boolean;
  readonly nx: number;
  readonly ny: number;
  readonly nz: number;
  readonly d: number;
}

/** An open axis-aligned box occluder from `min` to `max`. */
export function boxOccluder(min: Vec3, max: Vec3): Occluder {
  return makeOccluder(min, max, false, 0, 0, 0, 0);
}

/** Every occluder is built here, so they all share one object shape (the hot loops stay fast). */
function makeOccluder(
  min: Vec3,
  max: Vec3,
  cut: boolean,
  nx: number,
  ny: number,
  nz: number,
  d: number,
): Occluder {
  return {
    minX: min.x,
    minY: min.y,
    minZ: min.z,
    maxX: max.x,
    maxY: max.y,
    maxZ: max.z,
    cut,
    nx,
    ny,
    nz,
    d,
  };
}

/** The occluder of a greybox collider: its box, and for a ramp the half-space below its slope. */
export function occluderOf(shape: GreyboxShape): Occluder {
  const { min, max } = shape;
  if (shape.kind === 'box') return boxOccluder(min, max);
  const rise = max.y - min.y;
  const runX = max.x - min.x;
  const runZ = max.z - min.z;
  // Solid below the slope: (y - min.y) · run < (distance from the low end) · rise.
  switch (shape.rises) {
    case '+x':
      return makeOccluder(min, max, true, -rise, runX, 0, runX * min.y - rise * min.x);
    case '-x':
      return makeOccluder(min, max, true, rise, runX, 0, runX * min.y + rise * max.x);
    case '+z':
      return makeOccluder(min, max, true, 0, runZ, -rise, runZ * min.y - rise * min.z);
    case '-z':
      return makeOccluder(min, max, true, 0, runZ, rise, runZ * min.y + rise * max.z);
  }
}

/**
 * Whether the segment from `a` to `b` passes through the interior of `occluder` grown by `grow`
 * metres on every side (0 for the exact test). A grown test ignores a ramp's slope, so it is a
 * conservative superset: the light field uses it to pick candidate occluders for a whole cell.
 * (Hot path: the three slab clips are written out so nothing is allocated.)
 */
export function segmentHits(
  occluder: Occluder,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  grow = 0,
): boolean {
  // Cheap rejection when the segment's bounds miss the (grown) box.
  if (
    (ax > bx ? ax : bx) <= occluder.minX - grow ||
    (ax < bx ? ax : bx) >= occluder.maxX + grow ||
    (ay > by ? ay : by) <= occluder.minY - grow ||
    (ay < by ? ay : by) >= occluder.maxY + grow ||
    (az > bz ? az : bz) <= occluder.minZ - grow ||
    (az < bz ? az : bz) >= occluder.maxZ + grow
  ) {
    return false;
  }
  let t0 = 0;
  let t1 = 1;
  let enter: number;
  let exit: number;

  const dx = bx - ax;
  let lo = occluder.minX - grow;
  let hi = occluder.maxX + grow;
  // dx = 0: the bounds check above already put ax strictly inside the slab.
  if (dx !== 0) {
    enter = (lo - ax) / dx;
    exit = (hi - ax) / dx;
    if (enter > exit) {
      const swap = enter;
      enter = exit;
      exit = swap;
    }
    if (enter > t0) t0 = enter;
    if (exit < t1) t1 = exit;
  }

  const dy = by - ay;
  lo = occluder.minY - grow;
  hi = occluder.maxY + grow;
  // dy = 0: the bounds check above already put ay strictly inside the slab.
  if (dy !== 0) {
    enter = (lo - ay) / dy;
    exit = (hi - ay) / dy;
    if (enter > exit) {
      const swap = enter;
      enter = exit;
      exit = swap;
    }
    if (enter > t0) t0 = enter;
    if (exit < t1) t1 = exit;
    if (!(t0 < t1)) return false;
  }

  const dz = bz - az;
  lo = occluder.minZ - grow;
  hi = occluder.maxZ + grow;
  // dz = 0: the bounds check above already put az strictly inside the slab.
  if (dz !== 0) {
    enter = (lo - az) / dz;
    exit = (hi - az) / dz;
    if (enter > exit) {
      const swap = enter;
      enter = exit;
      exit = swap;
    }
    if (enter > t0) t0 = enter;
    if (exit < t1) t1 = exit;
    if (!(t0 < t1)) return false;
  }

  if (!occluder.cut || grow > 0) return t0 < t1;
  // Inside the half-space where g(t) = n·(a + t·(b - a)) - d < 0.
  const g0 = occluder.nx * ax + occluder.ny * ay + occluder.nz * az - occluder.d;
  const gd = occluder.nx * dx + occluder.ny * dy + occluder.nz * dz;
  if (gd === 0) return g0 < 0;
  const cross = -g0 / gd;
  if (gd > 0) t1 = cross < t1 ? cross : t1;
  else t0 = cross > t0 ? cross : t0;
  return t0 < t1;
}

/** Whether the segment from `a` to `b` passes through the open ball at `c` of radius `r`. */
export function segmentHitsSphere(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  cx: number,
  cy: number,
  cz: number,
  r: number,
): boolean {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const len2 = dx * dx + dy * dy + dz * dz;
  let t = len2 === 0 ? 0 : ((cx - ax) * dx + (cy - ay) * dy + (cz - az) * dz) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const px = ax + t * dx - cx;
  const py = ay + t * dy - cy;
  const pz = az + t * dz - cz;
  return px * px + py * py + pz * pz < r * r;
}

/** Bucket edge length of the static occluder grid, metres. */
const BUCKET = 4;
/** Bucket indices are clamped to ±BUCKET_LIMIT (±131 km): far enough for any level. */
const BUCKET_LIMIT = 32_767;

const bucketIndex = (v: number): number => {
  const i = Math.floor(v / BUCKET);
  return i < -BUCKET_LIMIT ? -BUCKET_LIMIT : i > BUCKET_LIMIT ? BUCKET_LIMIT : i;
};
const bucketKey = (i: number, k: number): number =>
  (i + BUCKET_LIMIT) * (2 * BUCKET_LIMIT + 1) + (k + BUCKET_LIMIT);

/**
 * The level's static light occluders, fed by the scene loader like the physics sink. `version`
 * changes whenever the set changes, so caches built on it know to rebuild.
 */
export class StaticOccluders implements StaticColliderSink {
  private readonly shapes = new Map<ColliderHandle, Occluder>();
  private next = 1;
  private changes = 0;
  private buckets: Map<number, Occluder[]> | undefined;
  /** Per-occluder stamp so a gather reports each occluder once. */
  private stamps = new Map<Occluder, number>();
  private stamp = 0;

  /** Bumped by every add and remove. */
  get version(): number {
    return this.changes;
  }

  add(desc: StaticColliderDesc): ColliderHandle {
    const handle = this.next++ as ColliderHandle;
    this.shapes.set(handle, occluderOf(desc));
    this.changed();
    return handle;
  }

  remove(handle: ColliderHandle): void {
    if (!this.shapes.delete(handle)) {
      throw new Error(`collider ${String(handle)} is not in this light occluder set`);
    }
    this.changed();
  }

  has(handle: ColliderHandle): boolean {
    return this.shapes.has(handle);
  }

  count(): number {
    return this.shapes.size;
  }

  private changed(): void {
    this.changes++;
    this.buckets = undefined;
  }

  private index(): Map<number, Occluder[]> {
    if (this.buckets !== undefined) return this.buckets;
    const buckets = new Map<number, Occluder[]>();
    this.stamps = new Map();
    for (const occluder of this.shapes.values()) {
      this.stamps.set(occluder, 0);
      for (let i = bucketIndex(occluder.minX); i <= bucketIndex(occluder.maxX); i++) {
        for (let k = bucketIndex(occluder.minZ); k <= bucketIndex(occluder.maxZ); k++) {
          const key = bucketKey(i, k);
          const list = buckets.get(key);
          if (list === undefined) buckets.set(key, [occluder]);
          else list.push(occluder);
        }
      }
    }
    this.buckets = buckets;
    return buckets;
  }

  /**
   * The occluders the segment from `a` to `b`, grown by `grow` metres, may pass through (see
   * `segmentHits`), each once. With `grow` 0 these are exactly the occluders that block it.
   */
  along(
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    grow: number,
  ): Occluder[] {
    const buckets = this.index();
    const found: Occluder[] = [];
    const stamp = ++this.stamp;
    const i0 = bucketIndex((ax < bx ? ax : bx) - grow);
    const i1 = bucketIndex((ax < bx ? bx : ax) + grow);
    const k0 = bucketIndex((az < bz ? az : bz) - grow);
    const k1 = bucketIndex((az < bz ? bz : az) + grow);
    for (let i = i0; i <= i1; i++) {
      for (let k = k0; k <= k1; k++) {
        for (const occluder of buckets.get(bucketKey(i, k)) ?? []) {
          if (this.stamps.get(occluder) === stamp) continue;
          this.stamps.set(occluder, stamp);
          if (segmentHits(occluder, ax, ay, az, bx, by, bz, grow)) found.push(occluder);
        }
      }
    }
    return found;
  }
}
