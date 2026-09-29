// Focus selection (mw-e02.5): which one object the Interact verb acts on. Pure and deterministic:
// the same actor view and candidates always pick the same target, whatever order they come in.
//
// Scoring, for a candidate within range and view angle:
//
//   score = distanceWeight × (1 − d / range) + angleWeight × cos(angle)
//
// - d: metres from the actor's reach point (feet + reachHeight) to the nearest point of the
//   candidate's bounding sphere (0 inside it); out of range when d > range (2.5 m by default, or
//   the candidate's own).
// - angle: between the actor's facing (look yaw) and the direction to the candidate's centre, in the
//   horizontal plane, so looking up or down with the orbit camera never loses focus; out of view
//   when it exceeds maxAngle (45° by default). Directly above or below counts as straight ahead.
// - Both weights are 1: at the defaults an object 1 m away at 30° off-axis (0.6 + 0.866) beats one
//   2 m straight ahead (0.2 + 1).
// - Line of sight: a candidate behind anything solid is not a candidate (checked by the caller,
//   see system.ts, only for candidates that would otherwise qualify).
//
// The best score wins; equal scores go to the lower entity id. Hysteresis stops flicker between two
// close candidates: the current focus, while still a candidate, keeps focus unless the best other
// scores more than `hysteresis` (10%) above it.

import type { EntityId } from '../core/component';
import { cos, hypot, sin } from '../math';
import type { Vec3 } from '../stimulus/shapes';

/** How focus is scored; see the file header. */
export interface FocusSettings {
  /** Default reach, metres (a candidate may set its own). */
  readonly range: number;
  /** cos of the widest view angle a candidate may be at. */
  readonly minCos: number;
  readonly distanceWeight: number;
  readonly angleWeight: number;
  /** Fraction a challenger must beat the current focus by to take focus. */
  readonly hysteresis: number;
  /** Height of the reach point above the actor's feet, metres. */
  readonly reachHeight: number;
}

/** The bead's defaults: 2.5 m, 45°, equal weights, 10% hysteresis, reach from 1 m up. */
export const DEFAULT_FOCUS_SETTINGS: FocusSettings = Object.freeze({
  range: 2.5,
  minCos: Math.SQRT1_2,
  distanceWeight: 1,
  angleWeight: 1,
  hysteresis: 0.1,
  reachHeight: 1,
});

/** Where an actor reaches from and which way it faces. */
export interface ActorView {
  /** The reach point, world metres. */
  readonly origin: Vec3;
  /** Look yaw, radians: 0 faces −z, positive turns left (as PlayerLook). */
  readonly yaw: number;
}

/** Something that could take focus. */
export interface FocusCandidate {
  readonly entity: EntityId;
  /** Centre, world metres. */
  readonly center: Vec3;
  /** Bounding-sphere radius, metres (0 = a point). */
  readonly radius: number;
  /** Reach for this candidate, metres; defaults to the settings' range. */
  readonly range?: number;
}

/** The unit horizontal facing of a look yaw. */
export function facing(yaw: number): { readonly x: number; readonly z: number } {
  return { x: -sin(yaw) + 0, z: -cos(yaw) + 0 };
}

/**
 * The focus score of `candidate` seen from `view`, or undefined when it is out of range or out of
 * the view angle.
 */
export function focusScore(
  view: ActorView,
  candidate: FocusCandidate,
  settings: FocusSettings = DEFAULT_FOCUS_SETTINGS,
): number | undefined {
  const { origin } = view;
  const dx = candidate.center.x - origin.x;
  const dy = candidate.center.y - origin.y;
  const dz = candidate.center.z - origin.z;
  const range = candidate.range ?? settings.range;
  const d = Math.max(0, hypot(dx, dy, dz) - candidate.radius);
  if (d > range) return undefined;
  const flat = hypot(dx, dz);
  const ahead = facing(view.yaw);
  const cosAngle = flat === 0 ? 1 : (ahead.x * dx + ahead.z * dz) / flat;
  if (cosAngle < settings.minCos) return undefined;
  return settings.distanceWeight * (1 - d / range) + settings.angleWeight * cosAngle;
}

/** A scored candidate. */
export interface ScoredFocus {
  readonly entity: EntityId;
  readonly score: number;
}

/**
 * The focus among scored candidates (any order), given the current focus: the best score, ties to
 * the lower id, except that `current`, while among them, keeps focus unless the best other beats it
 * by more than the hysteresis. Undefined when there are none.
 */
export function selectFocus(
  scored: readonly ScoredFocus[],
  current: EntityId | null,
  settings: Pick<FocusSettings, 'hysteresis'> = DEFAULT_FOCUS_SETTINGS,
): ScoredFocus | undefined {
  let best: ScoredFocus | undefined;
  let kept: ScoredFocus | undefined;
  for (const candidate of scored) {
    if (candidate.entity === current) kept = candidate;
    if (
      best === undefined ||
      candidate.score > best.score ||
      (candidate.score === best.score && candidate.entity < best.entity)
    ) {
      best = candidate;
    }
  }
  if (kept === undefined || best === undefined) return best;
  return best.score > kept.score * (1 + settings.hysteresis) ? best : kept;
}
