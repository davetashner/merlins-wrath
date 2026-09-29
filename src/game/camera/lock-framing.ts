// Lock-on camera framing (mw-e02.16): presentation only. While the player is locked on, the orbit
// camera stops orbiting at the sim's look yaw and pitch and swings to frame the player and the target
// together: it looks from the player's head towards a point `targetWeight` of the way to the target's
// lock point, `pitchOffset` further down, so the target sits ahead and the player in the foreground.
// On release it swings back to the sim's view and, once there, follows it exactly again (free look
// never lags).
//
// The swing is an exponential ease with time constant `time`: each frame closes 1 − e^(−dt/time) of
// the remaining angle, the short way round for yaw. The OrbitCamera then places the camera behind the
// player at the framed yaw and pitch as usual (collision, zoom, shoulder), so nothing else changes.

import type { Frozen, LockOnTuning } from '@content/index';
import type { Vec3 } from '../loop/render-sync';
import { toRadians } from './orbit-camera';

/** A view direction: yaw about +y (0 looks along −z, positive turns left) and pitch, radians. */
export interface ViewAngles {
  readonly yaw: number;
  readonly pitch: number;
}

/** Pitch limits the framing respects, radians (the camera's look limits). */
export interface PitchLimits {
  readonly min: number;
  readonly max: number;
}

/** Remaining angle below which a release has finished swinging back, radians. */
export const FRAMING_SETTLED = 1e-4;

const TAU = 2 * Math.PI;

/** `angle` wrapped into (−π, π]. */
function wrap(angle: number): number {
  const wrapped = angle - TAU * Math.round(angle / TAU);
  return wrapped <= -Math.PI ? wrapped + TAU : wrapped;
}

/**
 * The view that frames `pivot` (the player's head) and `target` (the lock point): see the file
 * header. Directly above or below the pivot, the yaw stays `fallbackYaw`.
 */
export function framingAngles(
  pivot: Vec3,
  target: Vec3,
  tuning: Frozen<LockOnTuning['framing']>,
  limits: PitchLimits,
  fallbackYaw: number,
): ViewAngles {
  const w = tuning.targetWeight;
  const dx = (target.x - pivot.x) * w;
  const dy = (target.y - pivot.y) * w;
  const dz = (target.z - pivot.z) * w;
  const across = Math.hypot(dx, dz);
  const yaw = across === 0 ? fallbackYaw : Math.atan2(-dx, -dz) + 0;
  const pitch = Math.atan2(dy, across) + toRadians(tuning.pitchOffset);
  return { yaw, pitch: Math.min(limits.max, Math.max(limits.min, pitch)) };
}

/** Eases the camera's view between the sim's look and the lock-on framing. */
export class LockFraming {
  #current: ViewAngles | undefined;
  /** Still away from the sim's view (locked, or swinging back after a release). */
  #engaged = false;

  constructor(
    private readonly tuning: Frozen<LockOnTuning['framing']>,
    private readonly limits: PitchLimits,
  ) {}

  /** Whether the camera is framing a lock or still swinging back from one. */
  get engaged(): boolean {
    return this.#engaged;
  }

  /**
   * The view the camera orbits at this frame, `dt` seconds after the last. `view` is the sim's look;
   * `target` the locked lock point, or undefined when not locked.
   */
  update(view: ViewAngles, pivot: Vec3, target: Vec3 | undefined, dt: number): ViewAngles {
    if (target === undefined && !this.#engaged) {
      this.#current = view;
      return view;
    }
    const goal =
      target === undefined
        ? view
        : framingAngles(pivot, target, this.tuning, this.limits, this.#current?.yaw ?? view.yaw);
    const from = this.#current ?? goal;
    const k = 1 - Math.exp(-Math.max(0, dt) / this.tuning.time);
    const yawGap = wrap(goal.yaw - from.yaw);
    const pitchGap = goal.pitch - from.pitch;
    this.#engaged = true;
    if (
      target === undefined &&
      Math.abs(yawGap) * (1 - k) < FRAMING_SETTLED &&
      Math.abs(pitchGap) * (1 - k) < FRAMING_SETTLED
    ) {
      this.#engaged = false;
      this.#current = view;
      return view;
    }
    const next = { yaw: wrap(from.yaw + yawGap * k), pitch: from.pitch + pitchGap * k };
    this.#current = next;
    return next;
  }

  /** Jumps straight to the next frame's goal (a camera cut). */
  cut(): void {
    this.#current = undefined;
  }
}
