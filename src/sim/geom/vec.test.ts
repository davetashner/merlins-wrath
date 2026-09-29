import { describe, expect, it } from 'vitest';
import { rotateToWorld } from '../combat/attacks/frame';
import {
  add,
  at,
  clamp01,
  cross,
  IDENTITY_QUAT,
  lerp,
  mulQuat,
  nlerpQuat,
  normalizeQuat,
  rotate,
  v3,
  yawQuat,
} from './vec';

const H = Math.SQRT1_2;
/** 90° about +y: +z → +x. */
const YAW_90 = { x: 0, y: H, z: 0, w: H };

function close(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) {
  expect(a.x).toBeCloseTo(b.x, 12);
  expect(a.y).toBeCloseTo(b.y, 12);
  expect(a.z).toBeCloseTo(b.z, 12);
}

describe('geom vectors and quaternions (mw-e04.2)', () => {
  it('basic vector helpers', () => {
    expect(add(v3(1, 2, 3), v3(1, 1, 1))).toEqual(v3(2, 3, 4));
    expect(cross(v3(1, 0, 0), v3(0, 1, 0))).toEqual(v3(0, 0, 1));
    expect(lerp(v3(0, 0, 0), v3(2, 4, 6), 0.5)).toEqual(v3(1, 2, 3));
    expect([clamp01(-1), clamp01(0.5), clamp01(2)]).toEqual([0, 0.5, 1]);
    expect(at([7, 8], 1)).toBe(8);
  });

  it('rotate: identity leaves vectors alone; a yaw of 90° turns +z onto +x', () => {
    expect(rotate(IDENTITY_QUAT, v3(1, 2, 3))).toEqual(v3(1, 2, 3));
    close(rotate(YAW_90, v3(0, 0, 1)), v3(1, 0, 0));
    close(rotate(YAW_90, v3(1, 0, 0)), v3(0, 0, -1));
  });

  it('mulQuat composes: two 90° yaws are 180°', () => {
    const q = mulQuat(YAW_90, YAW_90);
    close(rotate(q, v3(0, 0, 1)), v3(0, 0, -1));
  });

  it('normalizeQuat scales to unit length; zero becomes the identity', () => {
    expect(normalizeQuat({ x: 0, y: 2, z: 0, w: 0 })).toEqual({ x: 0, y: 1, z: 0, w: 0 });
    expect(normalizeQuat({ x: 0, y: 0, z: 0, w: 0 })).toBe(IDENTITY_QUAT);
  });

  it('nlerpQuat goes the short way round (flips a negated end)', () => {
    const neg = { x: -YAW_90.x, y: -YAW_90.y, z: -YAW_90.z, w: -YAW_90.w };
    const mid = nlerpQuat(IDENTITY_QUAT, neg, 0.5);
    close(rotate(mid, v3(0, 0, 1)), v3(Math.SQRT1_2, 0, Math.SQRT1_2));
    const same = nlerpQuat(IDENTITY_QUAT, YAW_90, 0.5);
    close(rotate(same, v3(0, 0, 1)), v3(Math.SQRT1_2, 0, Math.SQRT1_2));
  });

  it('yawQuat matches the attacker frame (rotateToWorld) for every facing, including −z', () => {
    for (const facing of [
      v3(0, 0, 1),
      v3(1, 0, 0),
      v3(-1, 0, 0),
      v3(0, 0, -1),
      v3(0.6, 0, -0.8),
      v3(-0.28, 0, 0.96),
    ]) {
      for (const v of [v3(1, 0, 0), v3(0, 1, 0), v3(0.3, -0.2, 1.1)]) {
        close(rotate(yawQuat(facing), v), rotateToWorld(v, facing));
      }
    }
  });
});
