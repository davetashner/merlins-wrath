// Segment overlap tests for line of sight (mw-e09.1): does the sight line from `a` to `b` cross an
// axis-aligned box or a sphere? Used by the in-memory SightWorld fake and for occlusion volumes
// (smoke, foliage) that live outside the physics world. Only + − × ÷ (IEEE-exact), so results are
// bit-identical on every platform. Touching counts as crossing.

import type { Vec3 } from '../stimulus/shapes';

const AXES = ['x', 'y', 'z'] as const;

/**
 * Where the segment `a`→`b` first touches the axis-aligned box `min`…`max`, as a fraction of the way
 * from `a` (0 when `a` is inside), or Infinity when it never does.
 */
export function segmentEntersBox(a: Vec3, b: Vec3, min: Vec3, max: Vec3): number {
  let enter = 0;
  let exit = 1;
  for (const axis of AXES) {
    const start = a[axis];
    const delta = b[axis] - start;
    if (delta === 0) {
      if (start < min[axis] || start > max[axis]) return Infinity;
      continue;
    }
    const t1 = (min[axis] - start) / delta;
    const t2 = (max[axis] - start) / delta;
    enter = Math.max(enter, Math.min(t1, t2));
    exit = Math.min(exit, Math.max(t1, t2));
    if (enter > exit) return Infinity;
  }
  return enter;
}

/** Whether the segment `a`→`b` touches the axis-aligned box `min`…`max`. */
export function segmentCrossesBox(a: Vec3, b: Vec3, min: Vec3, max: Vec3): boolean {
  return segmentEntersBox(a, b, min, max) !== Infinity;
}

/** Whether the segment `a`→`b` touches the ball of `radius` around `center`. */
export function segmentCrossesSphere(a: Vec3, b: Vec3, center: Vec3, radius: number): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  const cx = center.x - a.x;
  const cy = center.y - a.y;
  const cz = center.z - a.z;
  const lengthSq = dx * dx + dy * dy + dz * dz;
  const along = lengthSq === 0 ? 0 : (cx * dx + cy * dy + cz * dz) / lengthSq;
  const t = Math.min(1, Math.max(0, along));
  const ox = cx - dx * t;
  const oy = cy - dy * t;
  const oz = cz - dz * t;
  return ox * ox + oy * oy + oz * oz <= radius * radius;
}
