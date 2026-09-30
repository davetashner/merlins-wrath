import { describe, expect, it } from 'vitest';
import type { CameraTuning, Frozen, LockOnTuning } from '@content/index';
import { box, FakeCollisionWorld } from '@sim/index';
import type { Vec3 } from '../loop/render-sync';
import { FRAMING_SETTLED, framingAngles, LockFraming, type PitchLimits } from './lock-framing';
import { OrbitCamera, toRadians, type CameraLens } from './orbit-camera';

/** The shipped framing (src/content/data/lock-on/player.json). */
const FRAMING: Frozen<LockOnTuning['framing']> = { time: 0.2, targetWeight: 0.5, pitchOffset: -10 };
const LIMITS: PitchLimits = { min: toRadians(-70), max: toRadians(60) };
const CAMERA: Frozen<CameraTuning> = {
  fov: 70,
  near: 0.1,
  pivotHeight: 1.5,
  shoulder: 0.5,
  distance: { min: 2, max: 6, initial: 3.5, step: 0.5 },
  pitch: { min: -70, max: 60, initial: -15 },
  mouseSensitivity: 0.003,
  stick: { deadzone: 0.15, exponent: 2, yawRate: 240, pitchRate: 160 },
  invertY: false,
  collisionRadius: 0.26,
  recoveryTime: 0.3,
};
const LENS: CameraLens = { fov: 70, near: 0.1, aspect: 16 / 9 };
const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const HEAD = v(0, 1.5, 0);

/** Whether `point` is inside the camera's view (with a 5% margin inside each edge). */
function inView(position: Vec3, forward: Vec3, point: Vec3): boolean {
  const d = { x: point.x - position.x, y: point.y - position.y, z: point.z - position.z };
  // Camera basis: right = forward × up (normalised), up' = right × forward.
  const rx = -forward.z;
  const rz = forward.x;
  const rl = Math.hypot(rx, rz);
  const right = { x: rx / rl, y: 0, z: rz / rl };
  const up = {
    x: right.y * forward.z - right.z * forward.y,
    y: right.z * forward.x - right.x * forward.z,
    z: right.x * forward.y - right.y * forward.x,
  };
  const depth = d.x * forward.x + d.y * forward.y + d.z * forward.z;
  if (depth <= LENS.near) return false;
  const tanV = Math.tan(toRadians(LENS.fov) / 2) * 0.95;
  const tanH = tanV * LENS.aspect;
  const sx = (d.x * right.x + d.z * right.z) / depth;
  const sy = (d.x * up.x + d.y * up.y + d.z * up.z) / depth;
  return Math.abs(sx) <= tanH && Math.abs(sy) <= tanV;
}

describe('lock-on framing (mw-e02.16)', () => {
  it('aims from the head towards the target, a little down', () => {
    const angles = framingAngles(HEAD, v(0, 1.3, -10), FRAMING, LIMITS, 0);
    expect(angles.yaw).toBe(0);
    expect(angles.pitch).toBeCloseTo(Math.atan2(-0.1, 5) + toRadians(-10), 12);
    const east = framingAngles(HEAD, v(10, 1.5, 0), FRAMING, LIMITS, 0);
    expect(east.yaw).toBeCloseTo(-Math.PI / 2, 12);
  });

  it('keeps the yaw it had straight above a target, and clamps the pitch to the look limits', () => {
    const below = framingAngles(HEAD, v(0, -20, 0), FRAMING, LIMITS, 1.25);
    expect(below.yaw).toBe(1.25);
    expect(below.pitch).toBe(LIMITS.min);
    const above = framingAngles(HEAD, v(0.1, 40, 0), FRAMING, LIMITS, 0);
    expect(above.pitch).toBe(LIMITS.max);
  });

  it('keeps both the player and the target in view at near, mid and far range, any side', () => {
    const collision = new FakeCollisionWorld([box(v(-60, -1, -60), v(60, 0, 60))]);
    for (const [x, y, z] of [
      [0, 1.3, -2.5],
      [2, 1.3, -3],
      [-4, 1.3, -5],
      [3, 3.3, -8], // on a ledge
      [-12, 1.3, -14],
      [0, 1.3, -20],
    ] as const) {
      const target = v(x, y, z);
      const angles = framingAngles(HEAD, target, FRAMING, LIMITS, 0);
      const pose = new OrbitCamera(CAMERA, collision).update(
        { feet: v(0, 0, 0), height: 1.8, ...angles },
        LENS,
        0,
      );
      expect(inView(pose.position, pose.forward, target), `target ${String([x, y, z])}`).toBe(true);
      expect(inView(pose.position, pose.forward, HEAD), `head for ${String([x, y, z])}`).toBe(true);
      expect(
        inView(pose.position, pose.forward, v(0, 0.2, 0)),
        `feet for ${String([x, y, z])}`,
      ).toBe(true);
    }
  });

  it('follows the sim view exactly while unlocked', () => {
    const framing = new LockFraming(FRAMING, LIMITS);
    expect(framing.update({ yaw: 1, pitch: -0.2 }, HEAD, undefined, 0.016)).toEqual({
      yaw: 1,
      pitch: -0.2,
    });
    expect(framing.engaged).toBe(false);
  });

  it('eases into the framing over its time constant, the short way round', () => {
    const framing = new LockFraming(FRAMING, LIMITS);
    const view = { yaw: 3, pitch: 0 };
    framing.update(view, HEAD, undefined, 0.016);
    const target = v(1, 1.5, 10); // behind: framing yaw ≈ −3.04, across ±π from 3
    const goal = framingAngles(HEAD, target, FRAMING, LIMITS, 0);
    const first = framing.update(view, HEAD, target, 0.2);
    expect(framing.engaged).toBe(true);
    // One time constant closes 1 − 1/e of the gap, crossing ±π rather than going the long way.
    const gap = goal.yaw + 2 * Math.PI - 3;
    const expected = 3 + gap * (1 - Math.exp(-1));
    expect(first.yaw).toBeCloseTo(expected - 2 * Math.PI * Math.round(expected / (2 * Math.PI)), 9);
    expect(first.pitch).toBeCloseTo(goal.pitch * (1 - Math.exp(-1)), 9);
    let now = first;
    for (let i = 0; i < 120; i++) now = framing.update(view, HEAD, target, 0.016);
    expect(now.yaw).toBeCloseTo(goal.yaw, 3);
    expect(now.pitch).toBeCloseTo(goal.pitch, 3);
  });

  it('swings back to the sim view on release, then follows it exactly', () => {
    const framing = new LockFraming(FRAMING, LIMITS);
    const view = { yaw: 0, pitch: -0.26 };
    framing.update(view, HEAD, undefined, 0);
    for (let i = 0; i < 30; i++) framing.update(view, HEAD, v(10, 1.3, -10), 0.016);
    const released = framing.update(view, HEAD, undefined, 0.016);
    expect(framing.engaged).toBe(true);
    expect(released.yaw).toBeLessThan(0); // still turned towards where the target was
    let now = released;
    let frames = 0;
    while (framing.engaged && frames < 1000) {
      now = framing.update(view, HEAD, undefined, 0.016);
      frames += 1;
    }
    expect(now).toEqual(view);
    expect(frames).toBeLessThan(200); // about 3 s at worst for a 45° swing
    const moved = { yaw: 0.4, pitch: 0 };
    expect(framing.update(moved, HEAD, undefined, 0.016)).toEqual(moved);
    expect(FRAMING_SETTLED).toBeLessThan(0.001);
  });

  it('a cut jumps straight to the framing; a zero or negative dt does not move it', () => {
    const framing = new LockFraming(FRAMING, LIMITS);
    const target = v(-10, 1.5, -10);
    const goal = framingAngles(HEAD, target, FRAMING, LIMITS, 0);
    framing.update({ yaw: 0, pitch: 0 }, HEAD, undefined, 0.016);
    const still = framing.update({ yaw: 0, pitch: 0 }, HEAD, target, -1);
    expect(still).toEqual({ yaw: 0, pitch: 0 });
    framing.cut();
    expect(framing.update({ yaw: 0, pitch: 0 }, HEAD, target, 0)).toEqual(goal);
  });

  it('a half-turn swing picks one way consistently (−π wraps to +π)', () => {
    const framing = new LockFraming(FRAMING, LIMITS);
    framing.update({ yaw: Math.PI / 2, pitch: 0 }, HEAD, undefined, 0);
    const next = framing.update({ yaw: Math.PI / 2, pitch: 0 }, HEAD, v(10, 1.5, 0), 0.2);
    // Turned left through π: π/2 + π(1 − 1/e), wrapped.
    expect(next.yaw).toBeCloseTo(Math.PI / 2 + Math.PI * (1 - Math.exp(-1)) - 2 * Math.PI, 9);
  });
});
