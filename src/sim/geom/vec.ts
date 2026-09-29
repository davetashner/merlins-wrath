// Vector and quaternion helpers for the shared shape maths (mw-e04.2). Plain immutable values and only
// IEEE-exact operations (+ − × ÷ and sqrt), so every result is bit-identical on every platform and
// melee hits, arrows (e05) and spells agree on what touched what.

import type { Quat } from '../scene/layout';
import type { Vec3 } from '../stimulus/shapes';

export type { Quat };

/**
 * `items[index]` for indices in range by construction (noUncheckedIndexedAccess cannot see that and
 * lint forbids `!`, so the assertion lives here once).
 */
export function at<T>(items: readonly T[], index: number): T {
  return items[index] as T;
}

/** The identity rotation. */
export const IDENTITY_QUAT: Quat = Object.freeze({ x: 0, y: 0, z: 0, w: 1 });

export const v3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
export const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const scale = (a: Vec3, k: number): Vec3 => ({ x: a.x * k, y: a.y * k, z: a.z * k });
export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
export const lengthSq = (a: Vec3): number => dot(a, a);
export const distanceSq = (a: Vec3, b: Vec3): number => lengthSq(sub(a, b));
/** `a + (b − a)·t`. */
export const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => add(a, scale(sub(b, a), t));
export const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t);

/** `v` rotated by unit quaternion `q`. */
export function rotate(q: Quat, v: Vec3): Vec3 {
  // v' = v + 2w(u × v) + 2u × (u × v), u = (q.x, q.y, q.z).
  const u = { x: q.x, y: q.y, z: q.z };
  const t = scale(cross(u, v), 2);
  return add(add(v, scale(t, q.w)), cross(u, t));
}

/** The rotation `a` applied after `b` (Hamilton product a·b). */
export function mulQuat(a: Quat, b: Quat): Quat {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

/** `q` scaled to unit length; a zero quaternion becomes the identity. */
export function normalizeQuat(q: Quat): Quat {
  const len = Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w);
  if (len === 0) return IDENTITY_QUAT;
  return { x: q.x / len, y: q.y / len, z: q.z / len, w: q.w / len };
}

/** Normalised linear interpolation between unit quaternions (the shorter way round). */
export function nlerpQuat(a: Quat, b: Quat, t: number): Quat {
  const sign = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w < 0 ? -1 : 1;
  return normalizeQuat({
    x: a.x + (sign * b.x - a.x) * t,
    y: a.y + (sign * b.y - a.y) * t,
    z: a.z + (sign * b.z - a.z) * t,
    w: a.w + (sign * b.w - a.w) * t,
  });
}

/**
 * The yaw about +y that turns +z onto the unit horizontal direction `facing` (the attacker frame's
 * convention: +z forward). Half-angle identities keep it to sqrt: no trigonometry.
 */
export function yawQuat(facing: Vec3): Quat {
  const c = facing.z;
  const s = facing.x;
  const halfCos = Math.sqrt((1 + c) / 2);
  if (halfCos === 0) return { x: 0, y: 1, z: 0, w: 0 };
  return { x: 0, y: s / (2 * halfCos), z: 0, w: halfCos };
}
