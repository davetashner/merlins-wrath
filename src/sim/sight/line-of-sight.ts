// Multi-point line of sight (mw-e09.1). An observer's eye looks at N sample points on a target
// (head, chest, hips and feet by default, as fractions of the target's current height, so crouching
// lowers them) and the answer is the fraction visible, 0…1: the mean over the samples of each sight
// line's visibility. A crate hiding hips and feet leaves 0.5; glass leaves the unobstructed value.
//
// A sight line's visibility is the product of the transmittance of every occluder it crosses
// (occlusion.ts): colliders from the physics world (SightWorld) and occlusion volumes that are not
// physics (smoke, foliage), which callers supply per query so they can come and go every tick. An
// opaque collider or volume ends the line at 0. Colliders with no registered occlusion are opaque, so
// level geometry blocks sight by default. Dynamic occluders work because every query reads the
// current state: a closing door is a moving collider, and a door whose occlusion changes (a curtain
// drawn) just answers differently from `occlusionOf`.
//
// Most sight lines are clear or end at an opaque wall, so each one first asks the world for the
// nearest collider only, and visits every crossing only when that one lets some sight through.
//
// A zero-length sight line (the eye at a sample point, e.g. an observer inside the target) sees it:
// visibility 1, no query. Visibility composition (light, stance, motion) and sight cones are not
// here (mw-e09.2, mw-e11.5).

import type { BodyId } from '../character/collision-world';
import type { Vec3 } from '../stimulus/shapes';
import { OPAQUE, transmittance, type Occlusion } from './occlusion';
import { segmentCrossesBox, segmentCrossesSphere } from './segment';
import type { SightWorld } from './sight-world';

/** Sample heights as fractions of the target's height: head, chest, hips, feet. */
export const DEFAULT_SIGHT_SAMPLES: readonly number[] = Object.freeze([0.95, 0.72, 0.5, 0.05]);

/** Who is being looked at: an upright body standing at `feet`. */
export interface SightTarget {
  /** Lowest point of the body, world space, metres. */
  readonly feet: Vec3;
  /** Current height, metres (lower when crouched). */
  readonly height: number;
  /** Sample heights as fractions of `height`; defaults to DEFAULT_SIGHT_SAMPLES. Must be non-empty. */
  readonly samples?: readonly number[];
}

/** One observer looking at one target. */
export interface SightQuery {
  /** The observer's eye, world space. */
  readonly eye: Vec3;
  readonly target: SightTarget;
}

/** An occluding region that is not a physics collider (smoke, a foliage clump). */
export type OcclusionVolume =
  | { readonly kind: 'box'; readonly min: Vec3; readonly max: Vec3; readonly occlusion: Occlusion }
  | {
      readonly kind: 'sphere';
      readonly center: Vec3;
      readonly radius: number;
      readonly occlusion: Occlusion;
    };

export interface LineOfSightOptions {
  /** Colliders the sight lines are tested against. */
  readonly world: SightWorld;
  /** A collider's occlusion; undefined = opaque. Read on every query, so it may change over time. */
  readonly occlusionOf?: (body: BodyId) => Occlusion | undefined;
}

/** Per-query overrides. */
export interface SightOptions {
  /** Occlusion volumes present right now (smoke, foliage). */
  readonly volumes?: readonly OcclusionVolume[];
}

const NO_VOLUMES: readonly OcclusionVolume[] = [];

/** The line-of-sight service. Stateless between queries. */
export class LineOfSight {
  private readonly world: SightWorld;
  private readonly occlusionOf: (body: BodyId) => Occlusion | undefined;
  /** The running product of the sight line being traced (kept here to avoid a closure per ray). */
  private carried = 1;
  private readonly visit = (body: BodyId): boolean => {
    this.carried *= this.transmittanceOf(body);
    return this.carried > 0;
  };

  constructor(options: LineOfSightOptions) {
    this.world = options.world;
    this.occlusionOf = options.occlusionOf ?? (() => undefined);
  }

  private transmittanceOf(body: BodyId): number {
    return transmittance(this.occlusionOf(body) ?? OPAQUE);
  }

  /** Visibility of the single sight line `from`→`to`, 0…1. */
  ray(from: Vec3, to: Vec3, options: SightOptions = {}): number {
    if (from.x === to.x && from.y === to.y && from.z === to.z) return 1;
    let carried = 1;
    for (const volume of options.volumes ?? NO_VOLUMES) {
      const crosses =
        volume.kind === 'box'
          ? segmentCrossesBox(from, to, volume.min, volume.max)
          : segmentCrossesSphere(from, to, volume.center, volume.radius);
      if (crosses) carried *= transmittance(volume.occlusion);
    }
    if (carried === 0) return 0;
    const first = this.world.firstCrossing(from, to);
    if (first === undefined) return carried;
    if (this.transmittanceOf(first) === 0) return 0;
    this.carried = carried;
    this.world.forEachCrossing(from, to, this.visit);
    return this.carried;
  }

  /**
   * Fraction of `target` visible from `eye`, 0…1: the mean visibility of the sight lines to its
   * sample points.
   * @throws RangeError when the target has no sample points.
   */
  visibleFraction(eye: Vec3, target: SightTarget, options: SightOptions = {}): number {
    const samples = target.samples ?? DEFAULT_SIGHT_SAMPLES;
    if (samples.length === 0) throw new RangeError('a sight target needs at least one sample');
    const { feet, height } = target;
    let sum = 0;
    for (const fraction of samples) {
      sum += this.ray(eye, { x: feet.x, y: feet.y + height * fraction, z: feet.z }, options);
    }
    return sum / samples.length;
  }

  /**
   * Batch form for many observers per tick: `out[i]` is the visible fraction for `queries[i]`, all
   * against the same volumes. Returns `out` (a new array unless one is passed in to reuse).
   */
  visibleFractions(
    queries: readonly SightQuery[],
    options: SightOptions = {},
    out: number[] = [],
  ): number[] {
    out.length = queries.length;
    queries.forEach(({ eye, target }, i) => {
      out[i] = this.visibleFraction(eye, target, options);
    });
    return out;
  }
}
