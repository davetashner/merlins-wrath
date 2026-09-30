// Positional audio parameters (mw-e28.1): one place for the panner model and distance curve so the
// engine, the stealing rule and later occlusion/reverb beads (mw-e28.10, mw-e28.12) agree on what
// "far" means. Inverse distance, 2 m reference, 40 m range; HRTF on High, equal-power on Low.
import type { AudioListenerLike, PannerNodeLike } from './web-audio.ts';

/** A point or direction in world metres (renderer axes: +y up). */
export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Where the listener is and which way it faces; follows the camera each render frame. */
export interface ListenerPose {
  readonly position: Vec3;
  readonly forward: Vec3;
  readonly up: Vec3;
}

export type AudioQuality = 'high' | 'low';

export const REF_DISTANCE = 2;
export const MAX_DISTANCE = 40;
export const ROLLOFF = 1;

export const ORIGIN: Vec3 = { x: 0, y: 0, z: 0 };

/** Default pose: at the origin looking down -z with +y up (the Web Audio default). */
export const DEFAULT_LISTENER: ListenerPose = {
  position: ORIGIN,
  forward: { x: 0, y: 0, z: -1 },
  up: { x: 0, y: 1, z: 0 },
};

/** Configures a panner for the quality tier. */
export function configurePanner(panner: PannerNodeLike, quality: AudioQuality): void {
  panner.panningModel = quality === 'high' ? 'HRTF' : 'equalpower';
  panner.distanceModel = 'inverse';
  panner.refDistance = REF_DISTANCE;
  panner.maxDistance = MAX_DISTANCE;
  panner.rolloffFactor = ROLLOFF;
}

/** Moves a panner. Direct `.value` writes: cheap enough for every voice every frame. */
export function setPannerPosition(panner: PannerNodeLike, p: Vec3): void {
  panner.positionX.value = p.x;
  panner.positionY.value = p.y;
  panner.positionZ.value = p.z;
}

/**
 * Gain the Web Audio "inverse" model applies at `distance` with our constants (for tests and for
 * reasoning about audibility; the PannerNode computes it at runtime).
 */
export function inverseDistanceGain(distance: number): number {
  return (
    REF_DISTANCE / (REF_DISTANCE + ROLLOFF * (Math.max(distance, REF_DISTANCE) - REF_DISTANCE))
  );
}

export function distance(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/**
 * Points the listener. Uses the AudioParams where they exist and falls back to the deprecated
 * setters (Firefox has no AudioListener params).
 */
export function applyListener(listener: AudioListenerLike, pose: ListenerPose): void {
  const { position: p, forward: f, up: u } = pose;
  if (listener.positionX && listener.positionY && listener.positionZ) {
    listener.positionX.value = p.x;
    listener.positionY.value = p.y;
    listener.positionZ.value = p.z;
  } else {
    listener.setPosition(p.x, p.y, p.z);
  }
  if (
    listener.forwardX &&
    listener.forwardY &&
    listener.forwardZ &&
    listener.upX &&
    listener.upY &&
    listener.upZ
  ) {
    listener.forwardX.value = f.x;
    listener.forwardY.value = f.y;
    listener.forwardZ.value = f.z;
    listener.upX.value = u.x;
    listener.upY.value = u.y;
    listener.upZ.value = u.z;
  } else {
    listener.setOrientation(f.x, f.y, f.z, u.x, u.y, u.z);
  }
}

/** A rotation quaternion (x, y, z, w), e.g. the camera's. */
export interface Quat {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly w: number;
}

/** `v` rotated by the unit quaternion `q`. */
export function rotate(v: Vec3, q: Quat): Vec3 {
  // t = 2 (q.xyz × v); v' = v + w t + q.xyz × t
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  return {
    x: v.x + q.w * tx + (q.y * tz - q.z * ty),
    y: v.y + q.w * ty + (q.z * tx - q.x * tz),
    z: v.z + q.w * tz + (q.x * ty - q.y * tx),
  };
}

/** The listener pose of a camera at `position` with orientation `rotation` (looking down its −z). */
export function listenerPose(position: Vec3, rotation: Quat): ListenerPose {
  return {
    position: { x: position.x, y: position.y, z: position.z },
    forward: rotate(DEFAULT_LISTENER.forward, rotation),
    up: rotate(DEFAULT_LISTENER.up, rotation),
  };
}
