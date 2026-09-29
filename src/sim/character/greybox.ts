// Greybox collision shapes (mw-e02.2): the plain-data scene description shared by the in-memory
// CollisionWorld fake, the CollisionWorld contract suite (which the Rapier port runs against the same
// scenes, mw-e02.21) and the traversal test course. Axis-aligned boxes and wedge ramps cover floors,
// walls, steps, ledges, ceilings, slopes and moving platforms.

import { atan2, tan } from '../math';
import type { Vec3 } from '../stimulus/shapes';

/** The axis and direction a ramp's surface climbs towards. */
export type RampRise = '+x' | '-x' | '+z' | '-z';

/** An axis-aligned box from `min` to `max` (every max coordinate above its min). */
export interface GreyboxBox {
  readonly kind: 'box';
  readonly min: Vec3;
  readonly max: Vec3;
  /** Constant velocity, m/s, for a moving (kinematic) collider; absent = static. */
  readonly velocity?: Vec3;
}

/**
 * A wedge inside the box `min`…`max`: its top surface climbs from `min.y` at the low end to `max.y`
 * at the high end along `rises`; the high end is a vertical face.
 */
export interface GreyboxRamp {
  readonly kind: 'ramp';
  readonly min: Vec3;
  readonly max: Vec3;
  readonly rises: RampRise;
  /** Constant velocity, m/s, for a moving (kinematic) collider; absent = static. */
  readonly velocity?: Vec3;
}

export type GreyboxShape = GreyboxBox | GreyboxRamp;

/** Degrees → radians. */
export const radians = (degrees: number): number => (degrees * Math.PI) / 180;

/** A static box. */
export const box = (min: Vec3, max: Vec3): GreyboxBox => ({ kind: 'box', min, max });

/**
 * A ramp of `angle` degrees along +x starting at `start` (its low edge's -z corner, on the ground),
 * climbing to `height` over `width` metres of z, with the length the angle needs.
 */
export function rampAt(start: Vec3, angle: number, height: number, width: number): GreyboxRamp {
  const length = height / tan(radians(angle));
  return {
    kind: 'ramp',
    min: start,
    max: { x: start.x + length, y: start.y + height, z: start.z + width },
    rises: '+x',
  };
}

/** The slope of a ramp's surface in degrees. */
export function rampAngle(ramp: GreyboxRamp): number {
  const along = ramp.rises === '+x' || ramp.rises === '-x' ? 'x' : 'z';
  const run = ramp.max[along] - ramp.min[along];
  return (atan2(ramp.max.y - ramp.min.y, run) * 180) / Math.PI;
}
