// Sim collision shapes and their swept overlap tests (mw-e04.2), renderer-independent and shared by
// melee hitboxes, hurtboxes and later arrows (e05) and spells. A shape is a sphere, a capsule or an
// oriented box in world space; local shapes (the stimulus vocabulary a move or hurtbox is authored
// in: sphere, capsule, axis-aligned box) are placed in the world by a pose (position + rotation).
//
// Every test reduces a shape to pieces: a rounded simplex (a point, segment or triangle grown by a
// radius) or an oriented box. A sphere is a rounded point and a capsule a rounded segment. Sweeping
// a shape from one pose to the next covers the space it passed through, so a fast swing cannot skip
// a thin target between ticks:
// - sphere: the rounded segment between the two centres (exact for straight motion);
// - capsule: the two rounded triangles spanning the start and end axes (the ruled surface between
//   them, split along a diagonal; exact for straight motion, the chord of an arc for a rotation);
// - box: the box at evenly spaced in-between poses, no further apart than half its thinnest side
//   (conservative sampling, at most MAX_BOX_SUBSTEPS; hitboxes that must not tunnel use capsules).
// Only IEEE-exact operations are used, so every client agrees on every overlap.

import type { Vec3 } from '../stimulus/shapes';
import {
  boxCorners,
  boxesOverlap,
  pointBoxSq,
  pointSegmentSq,
  pointTriangleSq,
  segmentBoxSq,
  segmentSegmentSq,
  segmentTriangleSq,
  triangleBoxSq,
  triangleTriangleSq,
  type Obb,
} from './distance';
import {
  at,
  distanceSq,
  IDENTITY_QUAT,
  lerp,
  mulQuat,
  nlerpQuat,
  rotate,
  v3,
  type Quat,
} from './vec';

/** `p` rotated by `q` then moved by `t` (module-local: it runs for every placed shape). */
function rotateAdd(q: Quat, p: Vec3, t: Vec3): Vec3 {
  // p' = p + 2w(u × p) + 2u × (u × p), u = (q.x, q.y, q.z).
  const cx = 2 * (q.y * p.z - q.z * p.y);
  const cy = 2 * (q.z * p.x - q.x * p.z);
  const cz = 2 * (q.x * p.y - q.y * p.x);
  return {
    x: t.x + p.x + q.w * cx + (q.y * cz - q.z * cy),
    y: t.y + p.y + q.w * cy + (q.z * cx - q.x * cz),
    z: t.z + p.z + q.w * cz + (q.x * cy - q.y * cx),
  };
}

/** A ball, world space. */
export interface GeomSphere {
  readonly kind: 'sphere';
  readonly center: Vec3;
  readonly radius: number;
}

/** Every point within `radius` of the segment `from`–`to`, world space. */
export interface GeomCapsule {
  readonly kind: 'capsule';
  readonly from: Vec3;
  readonly to: Vec3;
  readonly radius: number;
}

/** A box rotated by `rotation` about its centre, world space. */
export interface GeomBox {
  readonly kind: 'box';
  readonly center: Vec3;
  readonly halfExtents: Vec3;
  readonly rotation: Quat;
}

/** A world-space collision shape. */
export type GeomShape = GeomSphere | GeomCapsule | GeomBox;

/** A shape as authored in a local frame: the stimulus sphere, capsule and axis-aligned box. */
export type LocalShape =
  | { readonly kind: 'sphere'; readonly center: Vec3; readonly radius: number }
  | { readonly kind: 'capsule'; readonly from: Vec3; readonly to: Vec3; readonly radius: number }
  | { readonly kind: 'box'; readonly center: Vec3; readonly halfExtents: Vec3 };

/** A rigid transform: rotate by `rotation`, then move by `position`. */
export interface Pose {
  readonly position: Vec3;
  readonly rotation: Quat;
}

/** The identity pose. */
export const IDENTITY_POSE: Pose = Object.freeze({
  position: Object.freeze(v3(0, 0, 0)),
  rotation: IDENTITY_QUAT,
});

/** `p` (in `pose`'s local frame) in the outer frame. */
export function transformPoint(pose: Pose, p: Vec3): Vec3 {
  return rotateAdd(pose.rotation, p, pose.position);
}

/** `inner` (a pose inside `outer`'s frame) in the frame `outer` lives in. */
export function composePose(outer: Pose, inner: Pose): Pose {
  return {
    position: transformPoint(outer, inner.position),
    rotation: mulQuat(outer.rotation, inner.rotation),
  };
}

/** A local shape placed by `pose`. */
export function placeShape(shape: LocalShape, pose: Pose): GeomShape {
  switch (shape.kind) {
    case 'sphere':
      return { kind: 'sphere', center: transformPoint(pose, shape.center), radius: shape.radius };
    case 'capsule':
      return {
        kind: 'capsule',
        from: transformPoint(pose, shape.from),
        to: transformPoint(pose, shape.to),
        radius: shape.radius,
      };
    case 'box':
      return {
        kind: 'box',
        center: transformPoint(pose, shape.center),
        halfExtents: shape.halfExtents,
        rotation: pose.rotation,
      };
  }
}

/** Points of a simplex: a point, a segment or a triangle. */
export type Simplex = readonly [Vec3] | readonly [Vec3, Vec3] | readonly [Vec3, Vec3, Vec3];

/** What overlap tests work on (see the file header). */
export type Piece =
  | { readonly kind: 'simplex'; readonly points: Simplex; readonly radius: number }
  | { readonly kind: 'box'; readonly box: Obb };

/** The oriented box of a GeomBox. */
export function obbOf(box: GeomBox): Obb {
  const { rotation: q, halfExtents: h } = box;
  return {
    center: box.center,
    axes: [rotate(q, v3(1, 0, 0)), rotate(q, v3(0, 1, 0)), rotate(q, v3(0, 0, 1))],
    half: [h.x, h.y, h.z],
  };
}

/** `shape` as a piece. */
export function pieceOf(shape: GeomShape): Piece {
  switch (shape.kind) {
    case 'sphere':
      return { kind: 'simplex', points: [shape.center], radius: shape.radius };
    case 'capsule':
      return { kind: 'simplex', points: [shape.from, shape.to], radius: shape.radius };
    case 'box':
      return { kind: 'box', box: obbOf(shape) };
  }
}

/** Squared distance between two simplices. */
export function simplexDistanceSq(a: Simplex, b: Simplex): number {
  if (a.length < b.length) return simplexDistanceSq(b, a);
  switch (a.length) {
    case 1:
      return distanceSq(a[0], b[0]);
    case 2:
      return b.length === 1
        ? pointSegmentSq(b[0], a[0], a[1])
        : segmentSegmentSq(a[0], a[1], b[0], b[1]);
    case 3:
      switch (b.length) {
        case 1:
          return pointTriangleSq(b[0], ...a);
        case 2:
          return segmentTriangleSq(...b, ...a);
        case 3:
          return triangleTriangleSq(a, b);
      }
  }
}

/** Squared distance between a simplex and an oriented box. */
export function simplexBoxSq(points: Simplex, box: Obb): number {
  switch (points.length) {
    case 1:
      return pointBoxSq(points[0], box);
    case 2:
      return segmentBoxSq(...points, box);
    case 3:
      return triangleBoxSq(...points, box);
  }
}

/** Whether two pieces overlap (touching counts). */
export function piecesOverlap(a: Piece, b: Piece): boolean {
  if (a.kind === 'box') {
    if (b.kind === 'box') return boxesOverlap(a.box, b.box);
    return simplexBoxSq(b.points, a.box) <= b.radius * b.radius;
  }
  if (b.kind === 'box') return simplexBoxSq(a.points, b.box) <= a.radius * a.radius;
  const reach = a.radius + b.radius;
  return simplexDistanceSq(a.points, b.points) <= reach * reach;
}

/** Whether two shapes overlap (touching counts). */
export function shapesOverlap(a: GeomShape, b: GeomShape): boolean {
  return piecesOverlap(pieceOf(a), pieceOf(b));
}

/** The most in-between poses a box sweep samples. */
export const MAX_BOX_SUBSTEPS = 16;

function boxSweep(from: GeomBox, to: GeomBox): Piece[] {
  // Sample often enough that no corner moves further than half the thinnest side between samples.
  const a = boxCorners(obbOf(from));
  const b = boxCorners(obbOf(to));
  let travelSq = 0;
  for (let i = 0; i < 8; i++) travelSq = Math.max(travelSq, distanceSq(at(a, i), at(b, i)));
  const { x, y, z } = from.halfExtents;
  const thinnest = Math.min(x, y, z);
  let steps = 1;
  while (steps < MAX_BOX_SUBSTEPS && travelSq > thinnest * thinnest * steps * steps) steps++;
  const out: Piece[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const box: GeomBox = {
      kind: 'box',
      center: lerp(from.center, to.center, t),
      halfExtents: from.halfExtents,
      rotation: nlerpQuat(from.rotation, to.rotation, t),
    };
    out.push(pieceOf(box));
  }
  return out;
}

/**
 * The pieces covering `from` moved to `to` (see the file header). Both must be the same kind of
 * shape with the same size (a pose change, not a morph); the size of `from` is used.
 */
export function sweepPieces(from: GeomShape, to: GeomShape): readonly Piece[] {
  switch (from.kind) {
    case 'sphere': {
      const end = to as GeomSphere;
      return [{ kind: 'simplex', points: [from.center, end.center], radius: from.radius }];
    }
    case 'capsule': {
      const end = to as GeomCapsule;
      const { radius } = from;
      return [
        { kind: 'simplex', points: [from.from, from.to, end.to], radius },
        { kind: 'simplex', points: [from.from, end.to, end.from], radius },
      ];
    }
    case 'box':
      return boxSweep(from, to as GeomBox);
  }
}

/** An axis-aligned bounding box: the broad phase before the exact tests. */
export interface GeomBounds {
  readonly min: Vec3;
  readonly max: Vec3;
}

function pointsBounds(points: readonly Vec3[], grow: number): GeomBounds {
  let x0 = Infinity;
  let y0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  let z1 = -Infinity;
  for (const p of points) {
    x0 = Math.min(x0, p.x - grow);
    y0 = Math.min(y0, p.y - grow);
    z0 = Math.min(z0, p.z - grow);
    x1 = Math.max(x1, p.x + grow);
    y1 = Math.max(y1, p.y + grow);
    z1 = Math.max(z1, p.z + grow);
  }
  return { min: { x: x0, y: y0, z: z0 }, max: { x: x1, y: y1, z: z1 } };
}

/** The bounds of `piece`. */
export function pieceBounds(piece: Piece): GeomBounds {
  return piece.kind === 'box'
    ? pointsBounds(boxCorners(piece.box), 0)
    : pointsBounds(piece.points, piece.radius);
}

/** A piece with its bounds (the broad phase before `piecesOverlap`). */
export interface BoundedPiece {
  readonly piece: Piece;
  readonly bounds: GeomBounds;
}

/** A set of pieces with their bounds and the bounds of them all. */
export interface BoundedPieces {
  readonly pieces: readonly BoundedPiece[];
  readonly bounds: GeomBounds;
}

/** `pieces` (at least one) with their bounds, in one call (hit queries run this per sweep). */
export function boundPieces(pieces: readonly Piece[]): BoundedPieces {
  const bounded = pieces.map((piece) => ({ piece, bounds: pieceBounds(piece) }));
  return { pieces: bounded, bounds: bounded.map((p) => p.bounds).reduce(unionBounds) };
}

/** The bounds enclosing both `a` and `b`. */
export function unionBounds(a: GeomBounds, b: GeomBounds): GeomBounds {
  return pointsBounds([a.min, a.max, b.min, b.max], 0);
}

/** Whether two bounds overlap (touching counts). */
export function boundsOverlap(a: GeomBounds, b: GeomBounds): boolean {
  return (
    a.min.x <= b.max.x &&
    b.min.x <= a.max.x &&
    a.min.y <= b.max.y &&
    b.min.y <= a.max.y &&
    a.min.z <= b.max.z &&
    b.min.z <= a.max.z
  );
}
