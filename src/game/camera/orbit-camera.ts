// The third-person orbit camera (mw-e02.4): presentation only. It reads where the player is and
// looks (the sim's CharacterController and PlayerLook, whose yaw and pitch the sim owns so replays
// reproduce them) and places the camera behind it, over the shoulder, never inside level geometry.
//
// Each drawn frame:
//   1. The pivot is the player's head (pivotHeight above the feet, lowered while crouched so it
//      stays inside the capsule, which the level never overlaps).
//   2. A sphere of the collision radius is swept from the pivot sideways to the shoulder, then from
//      the shoulder back along the view to the zoom distance. Anything in the way pulls the camera in
//      to just in front of it, on the same frame: nothing between the camera and the player is
//      skipped, so no drawn frame clips (AC-2).
//   3. Once the way is clear again, each length eases back out over recoveryTime with an ease-out
//      that never overshoots (AC-3).
// The sphere is at least as large as the near-plane probe's reach from the camera centre, so a
// camera clear of geometry has its whole near plane clear (checked independently by
// `nearPlaneClear`); a very wide window grows it past the content's collision radius.
//
// Collision queries are read-only CollisionWorld calls (the same RapierCollisionWorld the controller
// uses, between sim steps), so the camera never changes sim state or its hash.

import type { CameraTuning, Frozen } from '@content/index';
import type { Capsule, CollisionWorld, LookSettings } from '@sim/index';
import type { Vec3 } from '../loop/render-sync';

/** Degrees → radians. */
export const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/** Metres the camera keeps back from a surface beyond the collision radius (float slack). */
export const CAMERA_SKIN = 0.01;

/** What the camera frames this frame. */
export interface OrbitSubject {
  /** The drawn (interpolated) feet position. */
  readonly feet: Vec3;
  /** Look yaw, radians (0 looks along −z, positive turns left). */
  readonly yaw: number;
  /** Look pitch, radians above the horizon. */
  readonly pitch: number;
  /** The capsule's current height (lower while crouched), metres. */
  readonly height: number;
}

/** The projection the camera draws with. */
export interface CameraLens {
  /** Vertical field of view, degrees. */
  readonly fov: number;
  /** Near clip distance, metres. */
  readonly near: number;
  /** Width / height. */
  readonly aspect: number;
}

/** Where the camera is this frame, and why. */
export interface OrbitPose {
  readonly position: Vec3;
  /** Unit view direction. */
  readonly forward: Vec3;
  /** The shoulder point the boom hangs from (after collision). */
  readonly focus: Vec3;
  /** The boom length drawn, metres behind the focus. */
  readonly boom: number;
  /** The zoom distance the boom returns to when nothing is in the way. */
  readonly ideal: number;
  /** The radius of the sphere swept this frame. */
  readonly radius: number;
}

/** The look settings the sim's PlayerLook uses, from camera content (degrees → radians). */
export function lookSettings(tuning: Frozen<CameraTuning>): LookSettings {
  return {
    sensitivity: tuning.mouseSensitivity,
    invertY: tuning.invertY,
    minPitch: toRadians(tuning.pitch.min),
    maxPitch: toRadians(tuning.pitch.max),
    stick: {
      deadzone: tuning.stick.deadzone,
      exponent: tuning.stick.exponent,
      yawRate: toRadians(tuning.stick.yawRate),
      pitchRate: toRadians(tuning.stick.pitchRate),
    },
  };
}

/** The view direction for a look yaw and pitch: yaw 0 pitch 0 looks along −z. */
export function lookForward(yaw: number, pitch: number): Vec3 {
  const flat = Math.cos(pitch);
  return { x: -Math.sin(yaw) * flat, y: Math.sin(pitch), z: -Math.cos(yaw) * flat };
}

/** The horizontal right-hand direction for a look yaw. */
export function lookRight(yaw: number): Vec3 {
  return { x: Math.cos(yaw), y: 0, z: -Math.sin(yaw) };
}

/** Half the near plane's diagonal, metres. */
function nearHalfDiagonal({ fov, near, aspect }: CameraLens): number {
  const halfHeight = near * Math.tan(toRadians(fov) / 2);
  return halfHeight * Math.sqrt(1 + aspect * aspect);
}

/**
 * How far from the camera centre the near-plane probe's sphere reaches (near + half diagonal),
 * metres. The swept sphere is at least this big, so a camera clear of geometry passes the probe.
 */
export function nearPlaneReach(lens: CameraLens): number {
  return lens.near + nearHalfDiagonal(lens);
}

const along = (from: Vec3, direction: Vec3, distance: number): Vec3 => ({
  x: from.x + direction.x * distance,
  y: from.y + direction.y * distance,
  z: from.z + direction.z * distance,
});

/** A sphere as the CollisionWorld's vertical capsule: height 2r, feet at the bottom. */
const sphere = (radius: number): Capsule => ({ radius, height: 2 * radius });
const sphereFeet = (centre: Vec3, radius: number): Vec3 => ({ ...centre, y: centre.y - radius });

/** How far a sphere of `radius` at `from` gets along `direction` (≤ max), kept CAMERA_SKIN back. */
function clearance(
  collision: CollisionWorld,
  from: Vec3,
  direction: Vec3,
  max: number,
  radius: number,
): number {
  if (max <= 0) return 0;
  const hit = collision.sweepCapsule(sphere(radius), sphereFeet(from, radius), direction, max);
  return hit === undefined ? max : Math.max(0, hit.distance - CAMERA_SKIN);
}

/**
 * Whether the near plane is clear of geometry: the sphere around the near plane's centre that holds
 * the whole plane overlaps nothing. Conservative (a clear answer is certain), and independent of the
 * sweeps that placed the camera, so tests and the e2e can use it as a clipping probe.
 */
export function nearPlaneClear(
  collision: CollisionWorld,
  pose: Pick<OrbitPose, 'position' | 'forward'>,
  lens: CameraLens,
): boolean {
  const radius = nearHalfDiagonal(lens);
  const centre = along(pose.position, pose.forward, lens.near);
  return !collision.overlapCapsule(sphere(radius), sphereFeet(centre, radius));
}

/** Ease-out cubic: fast away from where it starts, settling without overshoot. */
const easeOut = (t: number): number => 1 - (1 - t) ** 3;

/**
 * A length that snaps in to whatever collision allows and eases back out to its ideal over a fixed
 * time. It never exceeds what collision allows this frame, and never the ideal.
 */
export class RecoveringLength {
  #value: number | undefined;
  #from = 0;
  #elapsed = 0;

  constructor(private readonly duration: number) {}

  /** The length now, or undefined before the first update. */
  get value(): number | undefined {
    return this.#value;
  }

  /** Forget the current length: the next update snaps to what is allowed. */
  reset(): void {
    this.#value = undefined;
  }

  /** The length for a frame `dt` seconds on, when collision allows `allowed` of `ideal`. */
  update(allowed: number, ideal: number, dt: number): number {
    const current = this.#value;
    if (current === undefined || allowed <= current) {
      this.#value = allowed;
      this.#from = allowed;
      this.#elapsed = 0;
      return allowed;
    }
    this.#elapsed += dt;
    const t = Math.min(1, this.#elapsed / this.duration);
    const eased = this.#from + (ideal - this.#from) * easeOut(t);
    const next = Math.min(allowed, Math.max(current, eased));
    this.#value = next;
    return next;
  }
}

/** The orbit camera's state between frames: zoom and the two recovering lengths. */
export class OrbitCamera {
  #zoom: number;
  readonly #boom: RecoveringLength;
  readonly #shoulder: RecoveringLength;

  constructor(
    private readonly tuning: Frozen<CameraTuning>,
    private readonly collision: CollisionWorld,
  ) {
    this.#zoom = tuning.distance.initial;
    this.#boom = new RecoveringLength(tuning.recoveryTime);
    this.#shoulder = new RecoveringLength(tuning.recoveryTime);
  }

  /** The zoom distance the boom returns to, metres. */
  get zoom(): number {
    return this.#zoom;
  }

  /** Zooms by whole wheel notches (positive = out), within the tuning's range. */
  zoomBy(notches: number): void {
    const { min, max, step } = this.tuning.distance;
    this.#zoom = Math.min(max, Math.max(min, this.#zoom + notches * step));
  }

  /** Drops the eased lengths, so the next frame places the camera without recovering (a cut). */
  cut(): void {
    this.#boom.reset();
    this.#shoulder.reset();
  }

  /** Places the camera for `subject`, `dt` seconds after the previous frame. */
  update(subject: OrbitSubject, lens: CameraLens, dt: number): OrbitPose {
    const { tuning, collision } = this;
    const radius = Math.max(tuning.collisionRadius, nearPlaneReach(lens) + CAMERA_SKIN);
    const lift = Math.min(tuning.pivotHeight, subject.height - radius);
    const pivot = { ...subject.feet, y: subject.feet.y + lift };

    const side = tuning.shoulder < 0 ? -1 : 1;
    const right = lookRight(subject.yaw);
    const outward = { x: right.x * side, y: 0, z: right.z * side };
    const reach = Math.abs(tuning.shoulder);
    const shoulder = this.#shoulder.update(
      clearance(collision, pivot, outward, reach, radius),
      reach,
      dt,
    );
    const focus = along(pivot, outward, shoulder);

    const forward = lookForward(subject.yaw, subject.pitch);
    const back = { x: -forward.x, y: -forward.y, z: -forward.z };
    const ideal = this.#zoom;
    const boom = this.#boom.update(clearance(collision, focus, back, ideal, radius), ideal, dt);
    return { position: along(focus, back, boom), forward, focus, boom, ideal, radius };
  }
}

/** The camera the rig drives; a Three.js PerspectiveCamera satisfies it. */
export interface OrbitCameraTarget extends CameraLens {
  readonly position: { set(x: number, y: number, z: number): unknown };
  lookAt(x: number, y: number, z: number): unknown;
  /** Vertical field of view, degrees: the bow's aim zoom writes it (mw-e05.21). */
  fov: number;
  /** Rebuilds the projection after `fov` changed (Three.js needs it; absent = nothing to do). */
  updateProjectionMatrix?(): unknown;
}

/** Moves `camera` to `pose`, looking along its forward direction. */
export function applyOrbitPose(
  camera: OrbitCameraTarget,
  { position, forward }: Pick<OrbitPose, 'position' | 'forward'>,
): void {
  camera.position.set(position.x, position.y, position.z);
  camera.lookAt(position.x + forward.x, position.y + forward.y, position.z + forward.z);
}
