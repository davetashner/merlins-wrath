// Quaternion helpers for the animation runtime (mw-e02.20). Poses are flat Float64Arrays of local
// bone rotations, four numbers (x, y, z, w) per bone, so evaluating a character allocates nothing.
// Renderer-agnostic: src/render/animation/three-rig.ts copies poses into Three.js bones.

/** A pose: local rotation quaternions, [x, y, z, w] per bone. */
export type Pose = Float64Array;

/** A new pose of `bones` identity rotations. */
export function createPose(bones: number): Pose {
  const pose = new Float64Array(bones * 4);
  for (let i = 0; i < bones; i++) pose[i * 4 + 3] = 1;
  return pose;
}

/** Resets every rotation of `pose` to identity. */
export function identityPose(pose: Pose): void {
  pose.fill(0);
  for (let i = 3; i < pose.length; i += 4) pose[i] = 1;
}

const DEG = Math.PI / 180;

/** Quaternion [x, y, z, w] of Euler angles in degrees, XYZ order (as Three.js's default 'XYZ'). */
export function quatFromEulerDeg(
  x: number,
  y: number,
  z: number,
): [number, number, number, number] {
  const c1 = Math.cos((x * DEG) / 2);
  const c2 = Math.cos((y * DEG) / 2);
  const c3 = Math.cos((z * DEG) / 2);
  const s1 = Math.sin((x * DEG) / 2);
  const s2 = Math.sin((y * DEG) / 2);
  const s3 = Math.sin((z * DEG) / 2);
  return [
    s1 * c2 * c3 + c1 * s2 * s3,
    c1 * s2 * c3 - s1 * c2 * s3,
    c1 * c2 * s3 + s1 * s2 * c3,
    c1 * c2 * c3 - s1 * s2 * s3,
  ];
}

/**
 * Normalised lerp of quaternion `a` (at `ai` in `aArr`) towards `b` (at `bi` in `bArr`) by `t`, along
 * the short arc, written to `out` at `oi`.
 */
export function nlerpInto(
  out: Float64Array,
  oi: number,
  aArr: ArrayLike<number>,
  ai: number,
  bArr: ArrayLike<number>,
  bi: number,
  t: number,
): void {
  const ax = aArr[ai] ?? 0;
  const ay = aArr[ai + 1] ?? 0;
  const az = aArr[ai + 2] ?? 0;
  const aw = aArr[ai + 3] ?? 1;
  let bx = bArr[bi] ?? 0;
  let by = bArr[bi + 1] ?? 0;
  let bz = bArr[bi + 2] ?? 0;
  let bw = bArr[bi + 3] ?? 1;
  if (ax * bx + ay * by + az * bz + aw * bw < 0) {
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
  }
  const x = ax + (bx - ax) * t;
  const y = ay + (by - ay) * t;
  const z = az + (bz - az) * t;
  const w = aw + (bw - aw) * t;
  const inv = 1 / (Math.hypot(x, y, z, w) || 1);
  out[oi] = x * inv;
  out[oi + 1] = y * inv;
  out[oi + 2] = z * inv;
  out[oi + 3] = w * inv;
}

/** Hamilton product a·b written to `out` at `oi` (b applied first, in local terms: a then b). */
export function multiplyInto(
  out: Float64Array,
  oi: number,
  a: ArrayLike<number>,
  ai: number,
  b: ArrayLike<number>,
  bi: number,
): void {
  const ax = a[ai] ?? 0;
  const ay = a[ai + 1] ?? 0;
  const az = a[ai + 2] ?? 0;
  const aw = a[ai + 3] ?? 1;
  const bx = b[bi] ?? 0;
  const by = b[bi + 1] ?? 0;
  const bz = b[bi + 2] ?? 0;
  const bw = b[bi + 3] ?? 1;
  out[oi] = aw * bx + ax * bw + ay * bz - az * by;
  out[oi + 1] = aw * by - ax * bz + ay * bw + az * bx;
  out[oi + 2] = aw * bz + ax * by - ay * bx + az * bw;
  out[oi + 3] = aw * bw - ax * bx - ay * by - az * bz;
}

/** Angle in degrees between the rotations of bone `i` in poses `a` and `b`. */
export function boneAngleDeg(a: Pose, b: Pose, i: number): number {
  const o = i * 4;
  const dot = Math.abs(
    (a[o] ?? 0) * (b[o] ?? 0) +
      (a[o + 1] ?? 0) * (b[o + 1] ?? 0) +
      (a[o + 2] ?? 0) * (b[o + 2] ?? 0) +
      (a[o + 3] ?? 1) * (b[o + 3] ?? 1),
  );
  return (2 * Math.acos(Math.min(1, dot))) / DEG;
}

/** The largest per-bone rotation difference between two poses, degrees. */
export function maxBoneDeltaDeg(a: Pose, b: Pose): number {
  let max = 0;
  for (let i = 0; i < a.length / 4; i++) max = Math.max(max, boneAngleDeg(a, b, i));
  return max;
}
