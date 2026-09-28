// The attacker's frame (mw-e12.5). Move hit volumes and impulses are authored in the attacker's local
// frame (origin at the root, +z forward, +y up, +x right; see src/content/types/move.ts); an attack
// commits to a horizontal aim when it starts, so turning that data into world space is a yaw about
// +y plus a translation to the attacker's placement. Only + - * / and sqrt are used (IEEE-exact).
//
// Boxes are axis-aligned in the stimulus vocabulary, so a box hit volume is replaced by the
// axis-aligned box enclosing it after the yaw: exact for aims along an axis, conservative between.

import type { StimulusShape, Vec3 } from '../../stimulus/shapes';

/** The shapes a move's hit volume can have (the stimulus sphere, capsule and box). */
export type HitShape = Extract<StimulusShape, { kind: 'sphere' | 'capsule' | 'box' }>;

/**
 * The unit horizontal direction of `aim` (its y is dropped). Throws a RangeError when that is zero
 * or not finite, since an attack must face somewhere.
 */
export function horizontalAim(aim: Vec3): Vec3 {
  const { x, z } = aim;
  const len = Math.sqrt(x * x + z * z);
  if (!Number.isFinite(len) || len === 0) {
    throw new RangeError('attack aim must have a finite, non-zero horizontal direction');
  }
  return Object.freeze({ x: x / len, y: 0, z: z / len });
}

/** Local direction `v` (attacker frame) in world space, for a unit horizontal `aim`. */
export function rotateToWorld(v: Vec3, aim: Vec3): Vec3 {
  return {
    x: aim.z * v.x + aim.x * v.z,
    y: v.y,
    z: aim.z * v.z - aim.x * v.x,
  };
}

/** Local point `p` in world space, for an attacker at `origin` facing unit horizontal `aim`. */
export function pointToWorld(p: Vec3, origin: Vec3, aim: Vec3): Vec3 {
  const r = rotateToWorld(p, aim);
  return { x: origin.x + r.x, y: origin.y + r.y, z: origin.z + r.z };
}

/** A local hit volume in world space (see the file header for boxes). */
export function shapeToWorld(shape: HitShape, origin: Vec3, aim: Vec3): HitShape {
  switch (shape.kind) {
    case 'sphere':
      return {
        kind: 'sphere',
        center: pointToWorld(shape.center, origin, aim),
        radius: shape.radius,
      };
    case 'capsule':
      return {
        kind: 'capsule',
        from: pointToWorld(shape.from, origin, aim),
        to: pointToWorld(shape.to, origin, aim),
        radius: shape.radius,
      };
    case 'box': {
      const { x: hx, y: hy, z: hz } = shape.halfExtents;
      const c = Math.abs(aim.z);
      const s = Math.abs(aim.x);
      return {
        kind: 'box',
        center: pointToWorld(shape.center, origin, aim),
        halfExtents: { x: c * hx + s * hz, y: hy, z: s * hx + c * hz },
      };
    }
  }
}
