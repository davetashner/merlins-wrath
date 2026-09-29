// Free-fly debug camera maths (mw-e00.21). A developer tool, so it runs on render time and never
// touches the sim. The pose is a position plus yaw (about +y) and pitch (about the camera's x axis);
// the camera looks down its local -z, as Three.js cameras do, and never rolls.

import type { Quat, Transform, Vec3 } from '@game/loop/index';

export interface FlyPose {
  readonly position: Vec3;
  /** Radians about +y; 0 looks down -z, positive turns left (counter-clockwise from above). */
  readonly yaw: number;
  /** Radians; positive looks up. Clamped to just short of straight up/down. */
  readonly pitch: number;
}

/** What the player is holding this frame, and how far the mouse moved (CSS pixels). */
export interface FlyInput {
  readonly forward: boolean;
  readonly back: boolean;
  readonly left: boolean;
  readonly right: boolean;
  readonly up: boolean;
  readonly down: boolean;
  readonly fast: boolean;
  readonly lookX: number;
  readonly lookY: number;
}

export const IDLE_FLY_INPUT: FlyInput = Object.freeze({
  forward: false,
  back: false,
  left: false,
  right: false,
  up: false,
  down: false,
  fast: false,
  lookX: 0,
  lookY: 0,
});

/** Metres per second. */
export const FLY_SPEED = 8;
/** Speed multiplier while `fast` is held. */
export const FLY_FAST_MULTIPLIER = 4;
/** Radians per pixel of mouse movement. */
export const LOOK_SENSITIVITY = 0.003;
/** Pitch limit, radians (just under 90°, so the view never flips). */
export const MAX_PITCH = Math.PI / 2 - 0.01;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/** Rotates `v` by the unit quaternion `q`. */
function rotate(v: Vec3, q: Quat): Vec3 {
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  return {
    x: v.x + q.w * tx + (q.y * tz - q.z * ty),
    y: v.y + q.w * ty + (q.z * tx - q.x * tz),
    z: v.z + q.w * tz + (q.x * ty - q.y * tx),
  };
}

/** The fly pose that looks the same way as `transform` (any roll is dropped). */
export function poseFromTransform({ position, rotation }: Transform): FlyPose {
  const forward = rotate({ x: 0, y: 0, z: -1 }, rotation);
  return {
    position: { ...position },
    yaw: Math.atan2(-forward.x, -forward.z),
    pitch: clamp(Math.asin(clamp(forward.y, -1, 1)), -MAX_PITCH, MAX_PITCH),
  };
}

/** The camera transform of a pose: yaw, then pitch (Euler order YXZ). */
export function transformFromPose({ position, yaw, pitch }: FlyPose): Transform {
  const sy = Math.sin(yaw / 2);
  const cy = Math.cos(yaw / 2);
  const sx = Math.sin(pitch / 2);
  const cx = Math.cos(pitch / 2);
  return {
    position: { ...position },
    rotation: { x: cy * sx, y: sy * cx, z: -sy * sx, w: cy * cx },
  };
}

/** Advances `pose` by `dtSeconds` of `input`: look first, then move along the new view. */
export function stepFly(pose: FlyPose, input: FlyInput, dtSeconds: number): FlyPose {
  const yaw = pose.yaw - input.lookX * LOOK_SENSITIVITY;
  const pitch = clamp(pose.pitch - input.lookY * LOOK_SENSITIVITY, -MAX_PITCH, MAX_PITCH);
  const along = Number(input.forward) - Number(input.back);
  const side = Number(input.right) - Number(input.left);
  const lift = Number(input.up) - Number(input.down);
  const cosPitch = Math.cos(pitch);
  // forward = (-sin yaw · cos pitch, sin pitch, -cos yaw · cos pitch); right = (cos yaw, 0, -sin yaw)
  const x = -Math.sin(yaw) * cosPitch * along + Math.cos(yaw) * side;
  const y = Math.sin(pitch) * along + lift;
  const z = -Math.cos(yaw) * cosPitch * along - Math.sin(yaw) * side;
  const length = Math.hypot(x, y, z);
  const distance =
    length === 0 ? 0 : (FLY_SPEED * (input.fast ? FLY_FAST_MULTIPLIER : 1) * dtSeconds) / length;
  return {
    position: {
      x: pose.position.x + x * distance,
      y: pose.position.y + y * distance,
      z: pose.position.z + z * distance,
    },
    yaw,
    pitch,
  };
}
