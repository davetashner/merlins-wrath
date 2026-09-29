// Closest-distance queries between the primitives every sim shape is built from (mw-e04.2): points,
// segments, triangles and oriented boxes. Squared distances throughout (no sqrt needed to compare
// against a radius), exact-zero degeneracy checks (a zero-length segment is a point, a zero-area
// triangle is its edges) and only IEEE-exact operations, so the answers are bit-identical everywhere.
// The segment and triangle routines follow Ericson, "Real-Time Collision Detection" (§5.1).
//
// Convex feature pairs: two disjoint convex polytopes are closest at a vertex–face or edge–edge pair,
// so a segment or triangle against a box is the smallest of its vertices against the box, the box's
// corners against the triangle and every edge pair — unless they intersect, which the separating
// axis test answers first.

import type { Vec3 } from '../stimulus/shapes';

// Module-local vector helpers: these run in the innermost loops of every hit query, and a call
// across a module boundary costs more than the maths under Vitest's module runner (the benchmarks).
const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const scale = (a: Vec3, k: number): Vec3 => ({ x: a.x * k, y: a.y * k, z: a.z * k });
const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const lengthSq = (a: Vec3): number => dot(a, a);
const distanceSq = (a: Vec3, b: Vec3): number => lengthSq(sub(a, b));
const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t);
/** `items[index]` for indices in range by construction (lint forbids `!`). */
const at = <T>(items: readonly T[], index: number): T => items[index] as T;

/** An oriented box: centre, three orthonormal axes and the half extent along each. */
export interface Obb {
  readonly center: Vec3;
  readonly axes: readonly [Vec3, Vec3, Vec3];
  readonly half: readonly [number, number, number];
}

/** Squared distance from `p` to segment `a`–`b`. */
export function pointSegmentSq(p: Vec3, a: Vec3, b: Vec3): number {
  // Scalar maths throughout the hot routines: no temporary vectors for the collector.
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abz = b.z - a.z;
  const len = abx * abx + aby * aby + abz * abz;
  const t =
    len === 0 ? 0 : clamp01(((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / len);
  const dx = p.x - (a.x + abx * t);
  const dy = p.y - (a.y + aby * t);
  const dz = p.z - (a.z + abz * t);
  return dx * dx + dy * dy + dz * dz;
}

/** Squared distance between segments `p1`–`q1` and `p2`–`q2`. */
export function segmentSegmentSq(p1: Vec3, q1: Vec3, p2: Vec3, q2: Vec3): number {
  const d1x = q1.x - p1.x;
  const d1y = q1.y - p1.y;
  const d1z = q1.z - p1.z;
  const d2x = q2.x - p2.x;
  const d2y = q2.y - p2.y;
  const d2z = q2.z - p2.z;
  const a = d1x * d1x + d1y * d1y + d1z * d1z;
  const e = d2x * d2x + d2y * d2y + d2z * d2z;
  if (a === 0) return pointSegmentSq(p1, p2, q2);
  if (e === 0) return pointSegmentSq(p2, p1, q1);
  const rx = p1.x - p2.x;
  const ry = p1.y - p2.y;
  const rz = p1.z - p2.z;
  const b = d1x * d2x + d1y * d2y + d1z * d2z;
  const c = d1x * rx + d1y * ry + d1z * rz;
  const f = d2x * rx + d2y * ry + d2z * rz;
  const denom = a * e - b * b;
  // Parallel segments (denom 0): any s works; start from p1 and let the clamps below fix t.
  let s = denom === 0 ? 0 : clamp01((b * f - c * e) / denom);
  let t = (b * s + f) / e;
  if (t < 0) {
    t = 0;
    s = clamp01(-c / a);
  } else if (t > 1) {
    t = 1;
    s = clamp01((b - c) / a);
  }
  const dx = rx + d1x * s - d2x * t;
  const dy = ry + d1y * s - d2y * t;
  const dz = rz + d1z * s - d2z * t;
  return dx * dx + dy * dy + dz * dz;
}

/** Whether triangle `a`, `b`, `c` has zero area. */
function degenerate(a: Vec3, b: Vec3, c: Vec3): boolean {
  return lengthSq(cross(sub(b, a), sub(c, a))) === 0;
}

/** Squared distance from `p` to triangle `a`, `b`, `c` (its surface, edges included). */
export function pointTriangleSq(p: Vec3, a: Vec3, b: Vec3, c: Vec3): number {
  if (degenerate(a, b, c)) {
    return Math.min(pointSegmentSq(p, a, b), pointSegmentSq(p, b, c), pointSegmentSq(p, c, a));
  }
  const ab = sub(b, a);
  const ac = sub(c, a);
  const ap = sub(p, a);
  const d1 = dot(ab, ap);
  const d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return lengthSq(ap);
  const bp = sub(p, b);
  const d3 = dot(ab, bp);
  const d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return lengthSq(bp);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return distanceSq(p, add(a, scale(ab, d1 / (d1 - d3))));
  const cp = sub(p, c);
  const d5 = dot(ab, cp);
  const d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return lengthSq(cp);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return distanceSq(p, add(a, scale(ac, d2 / (d2 - d6))));
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
    return distanceSq(p, add(b, scale(sub(c, b), w)));
  }
  const denom = va + vb + vc;
  return distanceSq(p, add(a, add(scale(ab, vb / denom), scale(ac, vc / denom))));
}

/** Whether segment `p`–`q` pierces triangle `a`, `b`, `c` (not coplanar with it; touching counts). */
function segmentPiercesTriangle(p: Vec3, q: Vec3, a: Vec3, b: Vec3, c: Vec3): boolean {
  const n = cross(sub(b, a), sub(c, a));
  const dp = n.x * (p.x - a.x) + n.y * (p.y - a.y) + n.z * (p.z - a.z);
  const dq = n.x * (q.x - a.x) + n.y * (q.y - a.y) + n.z * (q.z - a.z);
  if ((dp > 0 && dq > 0) || (dp < 0 && dq < 0) || dp === dq) return false;
  const k = dp / (dp - dq);
  const x = { x: p.x + (q.x - p.x) * k, y: p.y + (q.y - p.y) * k, z: p.z + (q.z - p.z) * k };
  return inside(n, a, b, x) && inside(n, b, c, x) && inside(n, c, a, x);
}

/** Whether `x` (in the triangle's plane, normal `n`) is on the inner side of edge `u`→`w`. */
function inside(n: Vec3, u: Vec3, w: Vec3, x: Vec3): boolean {
  const ex = w.x - u.x;
  const ey = w.y - u.y;
  const ez = w.z - u.z;
  const px = x.x - u.x;
  const py = x.y - u.y;
  const pz = x.z - u.z;
  return (ey * pz - ez * py) * n.x + (ez * px - ex * pz) * n.y + (ex * py - ey * px) * n.z >= 0;
}

/** Squared distance between segment `p`–`q` and triangle `a`, `b`, `c`. */
export function segmentTriangleSq(p: Vec3, q: Vec3, a: Vec3, b: Vec3, c: Vec3): number {
  const flat = degenerate(a, b, c);
  if (!flat && segmentPiercesTriangle(p, q, a, b, c)) return 0;
  const edges = Math.min(
    segmentSegmentSq(p, q, a, b),
    segmentSegmentSq(p, q, b, c),
    segmentSegmentSq(p, q, c, a),
  );
  if (flat) return edges;
  return Math.min(edges, pointTriangleSq(p, a, b, c), pointTriangleSq(q, a, b, c));
}

/** Squared distance between triangles `a` and `b` (they touch iff an edge of one meets the other). */
export function triangleTriangleSq(
  a: readonly [Vec3, Vec3, Vec3],
  b: readonly [Vec3, Vec3, Vec3],
): number {
  const [a0, a1, a2] = a;
  const [b0, b1, b2] = b;
  return Math.min(
    segmentTriangleSq(a0, a1, b0, b1, b2),
    segmentTriangleSq(a1, a2, b0, b1, b2),
    segmentTriangleSq(a2, a0, b0, b1, b2),
    segmentTriangleSq(b0, b1, a0, a1, a2),
    segmentTriangleSq(b1, b2, a0, a1, a2),
    segmentTriangleSq(b2, b0, a0, a1, a2),
  );
}

/** `p` in `box`'s frame (coordinates along its axes, from its centre). */
function toBox(box: Obb, p: Vec3): readonly [number, number, number] {
  const d = sub(p, box.center);
  const [u0, u1, u2] = box.axes;
  return [dot(d, u0), dot(d, u1), dot(d, u2)];
}

/** Squared distance from `p` to `box` (0 inside). */
export function pointBoxSq(p: Vec3, box: Obb): number {
  const local = toBox(box, p);
  let sum = 0;
  for (let i = 0; i < 3; i++) {
    const excess = Math.abs(at(local, i)) - at(box.half, i);
    if (excess > 0) sum += excess * excess;
  }
  return sum;
}

/** The eight corners of `box`. */
export function boxCorners(box: Obb): readonly Vec3[] {
  const [u0, u1, u2] = box.axes;
  const [h0, h1, h2] = box.half;
  const out: Vec3[] = [];
  for (const s0 of [-1, 1]) {
    for (const s1 of [-1, 1]) {
      for (const s2 of [-1, 1]) {
        out.push(
          add(box.center, add(scale(u0, s0 * h0), add(scale(u1, s1 * h1), scale(u2, s2 * h2)))),
        );
      }
    }
  }
  return out;
}

/** Corner index pairs of a box's twelve edges (corners as `boxCorners` orders them). */
const BOX_EDGES: readonly (readonly [number, number])[] = [
  [0, 1], [2, 3], [4, 5], [6, 7], // along axis 2
  [0, 2], [1, 3], [4, 6], [5, 7], // along axis 1
  [0, 4], [1, 5], [2, 6], [3, 7], // along axis 0
]; // prettier-ignore

/** Calls `visit` with each of `box`'s twelve edges. */
function forEachEdge(box: Obb, visit: (a: Vec3, b: Vec3) => void): void {
  const corners = boxCorners(box);
  for (const [i, j] of BOX_EDGES) visit(at(corners, i), at(corners, j));
}

/** Whether segment `p`–`q` meets `box` (slab test). */
function segmentMeetsBox(p: Vec3, q: Vec3, box: Obb): boolean {
  const lp = toBox(box, p);
  const lq = toBox(box, q);
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 3; i++) {
    const start = at(lp, i);
    const d = at(lq, i) - start;
    const h = at(box.half, i);
    if (d === 0) {
      if (Math.abs(start) > h) return false;
      continue;
    }
    const t1 = (-h - start) / d;
    const t2 = (h - start) / d;
    lo = Math.max(lo, Math.min(t1, t2));
    hi = Math.min(hi, Math.max(t1, t2));
    if (lo > hi) return false;
  }
  return true;
}

/** Squared distance between segment `p`–`q` and `box` (0 when they meet). */
export function segmentBoxSq(p: Vec3, q: Vec3, box: Obb): number {
  if (segmentMeetsBox(p, q, box)) return 0;
  let best = Math.min(pointBoxSq(p, box), pointBoxSq(q, box));
  forEachEdge(box, (a, b) => {
    best = Math.min(best, segmentSegmentSq(p, q, a, b));
  });
  return best;
}

/** Whether the projections of `points` and `box` onto `axis` (box frame) are disjoint. */
function separatedOn(
  axis: readonly [number, number, number],
  points: readonly (readonly [number, number, number])[],
  half: readonly [number, number, number],
): boolean {
  const r = half[0] * Math.abs(axis[0]) + half[1] * Math.abs(axis[1]) + half[2] * Math.abs(axis[2]);
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of points) {
    const d = p[0] * axis[0] + p[1] * axis[1] + p[2] * axis[2];
    lo = Math.min(lo, d);
    hi = Math.max(hi, d);
  }
  return lo > r || hi < -r;
}

type Triple = readonly [number, number, number];
const cross3 = (a: Triple, b: Triple): Triple => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const sub3 = (a: Triple, b: Triple): Triple => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const UNIT: readonly Triple[] = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

/** Whether triangle `a`, `b`, `c` meets `box` (separating axis test, 13 axes). */
function triangleMeetsBox(a: Vec3, b: Vec3, c: Vec3, box: Obb): boolean {
  const v = [toBox(box, a), toBox(box, b), toBox(box, c)] as const;
  const edges = [sub3(v[1], v[0]), sub3(v[2], v[1]), sub3(v[0], v[2])] as const;
  const axes: Triple[] = [...UNIT, cross3(edges[0], edges[1])];
  for (const e of edges) for (const u of UNIT) axes.push(cross3(u, e));
  return !axes.some((axis) => separatedOn(axis, v, box.half));
}

/** Squared distance between triangle `a`, `b`, `c` and `box` (0 when they meet). */
export function triangleBoxSq(a: Vec3, b: Vec3, c: Vec3, box: Obb): number {
  if (triangleMeetsBox(a, b, c, box)) return 0;
  let best = Math.min(pointBoxSq(a, box), pointBoxSq(b, box), pointBoxSq(c, box));
  for (const corner of boxCorners(box)) best = Math.min(best, pointTriangleSq(corner, a, b, c));
  forEachEdge(box, (p, q) => {
    best = Math.min(
      best,
      segmentSegmentSq(p, q, a, b),
      segmentSegmentSq(p, q, b, c),
      segmentSegmentSq(p, q, c, a),
    );
  });
  return best;
}

/** Whether two oriented boxes overlap (separating axis test, 15 axes; touching counts). */
export function boxesOverlap(a: Obb, b: Obb): boolean {
  const axes: Vec3[] = [...a.axes, ...b.axes];
  for (const u of a.axes) for (const w of b.axes) axes.push(cross(u, w));
  const t = sub(b.center, a.center);
  const radius = (box: Obb, axis: Vec3): number =>
    box.half[0] * Math.abs(dot(box.axes[0], axis)) +
    box.half[1] * Math.abs(dot(box.axes[1], axis)) +
    box.half[2] * Math.abs(dot(box.axes[2], axis));
  return !axes.some((axis) => Math.abs(dot(t, axis)) > radius(a, axis) + radius(b, axis));
}
