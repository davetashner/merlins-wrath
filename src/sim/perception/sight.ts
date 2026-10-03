// Sight (mw-e11.5): the cone test and the strength of a sighting, as pure functions of sampled values.
// The perception system samples the world (eye, facing, the target's body, line of sight, light) and
// calls in; nothing here reads an entity.
//
// Cone: the sight line from the agent's eye to the aimed point (a target's chest) is in view when it
// is no longer than the profile's far range, no steeper than its vertical half-angle
// (|dy| ≤ d · sin(vertical)), and within its peripheral half-angle of the facing direction measured
// on the ground plane. Within the primary half-angle it is in the primary zone, else the peripheral.
//
// Strength of a seen target = visibility score × range falloff × zone weight, where
//   visibility  the e09 visibility model (light lifted by dark vision, stance, motion, profile, the
//               line-of-sight fraction, the stealth distance falloff), 0–1
//   range       the profile's own falloff: 1 within near range, falling linearly to 0 at far range
//   zone        1 in the primary cone, the tuning's peripheral weight outside it
// and certainty = zone certainty (1 primary, the tuning's peripheral certainty) × the fraction of the
// target in sight. Nothing is perceived at strength 0 (a target fully behind cover, or in darkness
// the agent cannot see in).

import type { Frozen, SenseProfile } from '@content/index';
import { cos, sin } from '../math';
import type { Vec3 } from '../stimulus/shapes';
import { percept, type Percept, type PerceptSource } from './percept';
import type { PerceptionTuning } from './tuning';

/** A sense profile's sight. */
export type SightProfile = Frozen<NonNullable<SenseProfile['sight']>>;

/** Which part of the view a point is in. */
export type SightZone = 'primary' | 'peripheral';

/** Where a point is in an agent's view. */
export interface ConeHit {
  readonly zone: SightZone;
  /** Eye to point, metres. */
  readonly distance: number;
}

const DEG = Math.PI / 180;

/** Eye to point, metres. */
export function pointDistance(a: Vec3, b: Vec3): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Where `point` is in the view of an eye at `eye` facing `facing` (horizontal; it need not be unit
 * length), or undefined when it is out of view (see the file header). A point straight above or
 * below the eye is in the primary zone when the vertical limit allows it.
 */
export function coneHit(
  sight: SightProfile,
  eye: Vec3,
  facing: Vec3,
  point: Vec3,
): ConeHit | undefined {
  const distance = pointDistance(eye, point);
  if (distance > sight.farRange) return undefined;
  if (Math.abs(point.y - eye.y) > distance * sin(sight.verticalHalfAngle * DEG)) return undefined;
  const dx = point.x - eye.x;
  const dz = point.z - eye.z;
  const across = Math.sqrt(dx * dx + dz * dz);
  const length = Math.sqrt(facing.x * facing.x + facing.z * facing.z);
  if (across === 0 || length === 0) return { zone: 'primary', distance };
  const ahead = (facing.x * dx + facing.z * dz) / (across * length);
  if (ahead >= cos(sight.primaryHalfAngle * DEG)) return { zone: 'primary', distance };
  if (ahead >= cos(sight.peripheralHalfAngle * DEG)) return { zone: 'peripheral', distance };
  return undefined;
}

/** The profile's range falloff at `distance`: 1 within near range, linear to 0 at far range. */
export function rangeFalloff(sight: SightProfile, distance: number): number {
  if (distance <= sight.nearRange) return 1;
  if (distance >= sight.farRange) return 0;
  return (sight.farRange - distance) / (sight.farRange - sight.nearRange);
}

/** What a sighting needs, already sampled. */
export interface SightSample {
  readonly source: PerceptSource;
  /** Where the agent sees it (a target's feet, an anomaly's position). */
  readonly position: Vec3;
  readonly cone: ConeHit;
  /** The visibility score, 0–1 (for a target, the e09 model including the line-of-sight fraction). */
  readonly visibility: number;
  /** Fraction of it in sight, 0–1. */
  readonly inSight: number;
}

/** The zone's strength weight and certainty. */
function zoneTerms(zone: SightZone, tuning: PerceptionTuning): [number, number] {
  return zone === 'primary'
    ? [1, 1]
    : [tuning.sight.peripheralWeight, tuning.sight.peripheralCertainty];
}

/**
 * The percept of `kind` for a sighting (see the file header), or undefined when its strength is 0.
 */
export function sightPercept(
  sight: SightProfile,
  kind: 'seen-target' | 'seen-anomaly',
  sample: SightSample,
  tuning: PerceptionTuning,
): Percept | undefined {
  const [weight, certainty] = zoneTerms(sample.cone.zone, tuning);
  const strength = sample.visibility * rangeFalloff(sight, sample.cone.distance) * weight;
  if (!(strength > 0)) return undefined;
  return percept({
    source: sample.source,
    kind,
    sense: 'sight',
    position: sample.position,
    strength,
    certainty: certainty * sample.inSight,
  });
}
