// Small 3-vector helpers for the character controller (mw-e02.2). Plain immutable `Vec3` values (the
// stimulus module's type) and only IEEE-exact operations (+ − × ÷ and sqrt), so results are
// bit-identical on every platform.

import type { Vec3 } from '../stimulus/shapes';

export const ZERO: Vec3 = { x: 0, y: 0, z: 0 };
export const UP: Vec3 = { x: 0, y: 1, z: 0 };
export const DOWN: Vec3 = { x: 0, y: -1, z: 0 };

export const vec = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
export const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const scale = (a: Vec3, k: number): Vec3 => ({ x: a.x * k, y: a.y * k, z: a.z * k });
export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const length = (a: Vec3): number => Math.sqrt(dot(a, a));
/** The horizontal (xz) part of `a`. */
export const flat = (a: Vec3): Vec3 => ({ x: a.x, y: 0, z: a.z });

/** `a` scaled to unit length; the zero vector stays zero. */
export function normalize(a: Vec3): Vec3 {
  const len = length(a);
  return len === 0 ? ZERO : scale(a, 1 / len);
}

/** `a` with its component into the plane of unit normal `n` removed (left alone when moving away). */
export function clip(a: Vec3, n: Vec3): Vec3 {
  const into = dot(a, n);
  return into < 0 ? sub(a, scale(n, into)) : a;
}
