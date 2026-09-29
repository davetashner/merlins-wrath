// A fixed follow camera (mw-e02.23): rigidly behind and above the player, turned with the player's
// look yaw, aimed at a point above its feet. A placeholder until the colliding orbit camera
// (mw-e02.4) replaces it: no smoothing, no collision, no pitch. It only reads the player's
// interpolated transform, so it never touches the sim.

import type { Quat, Vec3 } from '../loop/render-sync';

/** The camera the rig moves; a Three.js camera satisfies it. */
export interface FollowCameraTarget {
  readonly position: { set(x: number, y: number, z: number): unknown };
  lookAt(x: number, y: number, z: number): unknown;
}

/** Where the camera sits relative to the player, metres. */
export interface FollowRig {
  /** Height above the feet the camera aims at (about the head). */
  readonly pivotHeight: number;
  /** Horizontal distance behind the pivot. */
  readonly distance: number;
  /** Height above the pivot. */
  readonly height: number;
}

/**
 * Close enough to read the capsule, and at the testbed's player start (4 m in front of the back
 * wall) still inside the room rather than behind the wall.
 */
export const DEFAULT_FOLLOW_RIG: FollowRig = Object.freeze({
  pivotHeight: 1.5,
  distance: 3.5,
  height: 2,
});

export interface CameraPose {
  readonly position: Vec3;
  readonly target: Vec3;
}

/** The yaw (radians about +y) of a rotation about +y only, as the player's transform carries. */
export function yawOf(rotation: Quat): number {
  return 2 * Math.atan2(rotation.y, rotation.w);
}

/** The rotation of `yaw` radians about +y. */
export function yawRotation(yaw: number): Quat {
  return { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
}

/** The camera pose behind a player standing at `feet` and looking along `yaw` (0 = −z). */
export function followCameraPose(feet: Vec3, yaw: number, rig = DEFAULT_FOLLOW_RIG): CameraPose {
  // Forward for yaw 0 is −z; positive yaw turns left (counter-clockwise from above).
  const forwardX = -Math.sin(yaw);
  const forwardZ = -Math.cos(yaw);
  const target = { x: feet.x, y: feet.y + rig.pivotHeight, z: feet.z };
  return {
    position: {
      x: target.x - forwardX * rig.distance,
      y: target.y + rig.height,
      z: target.z - forwardZ * rig.distance,
    },
    target,
  };
}

/** Points `camera` at `pose`. */
export function applyCameraPose(
  camera: FollowCameraTarget,
  { position, target }: CameraPose,
): void {
  camera.position.set(position.x, position.y, position.z);
  camera.lookAt(target.x, target.y, target.z);
}
