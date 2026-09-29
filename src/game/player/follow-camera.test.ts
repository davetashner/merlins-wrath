import { describe, expect, it } from 'vitest';
import {
  applyCameraPose,
  DEFAULT_FOLLOW_RIG,
  followCameraPose,
  yawOf,
  yawRotation,
} from './follow-camera';

describe('follow camera (mw-e02.23)', () => {
  it('sits behind and above the player: yaw 0 looks along −z, so the camera is at +z', () => {
    const { position, target } = followCameraPose({ x: 1, y: 0, z: 2 }, 0);
    expect(target).toEqual({ x: 1, y: DEFAULT_FOLLOW_RIG.pivotHeight, z: 2 });
    expect(position.x).toBeCloseTo(1, 12);
    expect(position.y).toBe(DEFAULT_FOLLOW_RIG.pivotHeight + DEFAULT_FOLLOW_RIG.height);
    expect(position.z).toBeCloseTo(2 + DEFAULT_FOLLOW_RIG.distance, 12);
  });

  it('turns with the yaw: facing −x (yaw π/2) puts the camera at +x', () => {
    const rig = { pivotHeight: 1, distance: 3, height: 2 };
    const { position } = followCameraPose({ x: 0, y: 0, z: 0 }, Math.PI / 2, rig);
    expect(position.x).toBeCloseTo(3, 12);
    expect(position.y).toBe(3);
    expect(position.z).toBeCloseTo(0, 12);
  });

  it('round-trips a yaw through its rotation', () => {
    for (const yaw of [0, 1, -2.5, Math.PI - 1e-9])
      expect(yawOf(yawRotation(yaw))).toBeCloseTo(yaw, 9);
  });

  it('applies a pose to a camera', () => {
    const calls: string[] = [];
    applyCameraPose(
      {
        position: { set: (x, y, z) => calls.push(`at ${String([x, y, z])}`) },
        lookAt: (x, y, z) => calls.push(`look ${String([x, y, z])}`),
      },
      { position: { x: 1, y: 2, z: 3 }, target: { x: 4, y: 5, z: 6 } },
    );
    expect(calls).toEqual(['at 1,2,3', 'look 4,5,6']);
  });
});
