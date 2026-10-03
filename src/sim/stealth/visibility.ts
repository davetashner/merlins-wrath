// The visibility model (mw-e09.2): how visible a target is to an observer, from the light on its body,
// its stance, how fast it moves, what it wears, how much of it is in sight and how far away it is.
// Thief constitution: shadows and patience are the tools, so visibility emerges from those inputs
// instead of a crouch flag and an eye icon.
//
//   visibility = light × stance × motion × profile × LOS fraction × distance falloff, clamped to [0, 1]
//
// - light     the target's light samples (the light field at its head, chest, hips and feet) blend
//             between their mean and their brightest by `peakWeight`; the observer's dark vision then
//             lifts that level (seen = level + (1 − level) × darkVision, so dark vision 1 sees full
//             light and darkness gives no benefit), read on the light curve. When the target is dark
//             (its blended level ≤ darkTargetMax) and the background light along the observer's ray
//             is ≥ backgroundThreshold, it is a silhouette: the contrast bonus is added to the light
//             term, capped at the full-light term.
// - stance    prone / crouched / standing weight.
// - motion    the band of the target's horizontal speed (the fastest band it reaches).
// - profile   the equipment brightness the target supplies (1 = neutral) × the cloak and disguise
//             modifiers when they apply.
// - LOS       the fraction of the target in sight (LineOfSight.visibleFraction, mw-e09.1).
// - distance  the falloff curve at the observer-to-target distance.
//
// The terms multiply, so any zero term hides the target (LOS 0 is exactly 0). Every function here is
// pure and takes sampled values, never entity lookups, so perception (mw-e11.5) samples the world and
// calls in. Self-visibility is the observer-independent part for the HUD (mw-e09.10): light (no dark
// vision, no contrast) × stance × motion × profile. `selfVisibilityOf` samples it from the world.
// All weights come from the stealth tuning content file (src/content/data/stealth/stealth.json);
// DEFAULT_VISIBILITY_TUNING mirrors it for code without content (tests, tools).

import type { VisibilityStance, VisibilityTuning } from '@content/index';

/** What the target wears that changes how it reads (supplied by equipment and effects). */
export interface VisibilityProfile {
  /** Equipment brightness multiplier, 0–2 (polished plate, a white tabard > 1; dark leathers < 1). */
  readonly brightness?: number;
  /** Wearing a cloak or other concealing garment (the tuning's cloak modifier applies). */
  readonly cloaked?: boolean;
  /** Disguised (the tuning's disguise modifier applies). */
  readonly disguised?: boolean;
}

/** The observer-independent inputs: what the target is doing where it stands. */
export interface SelfVisibilityInputs {
  /** Light level at each of the target's sample points, 0–1 each; at least one. */
  readonly lightSamples: readonly number[];
  readonly stance: VisibilityStance;
  /** Horizontal speed, m/s, ≥ 0. */
  readonly speed: number;
  /** What it wears; omitted = neutral. */
  readonly profile?: VisibilityProfile;
}

/** Everything one observer-target visibility needs, already sampled. */
export interface VisibilityInputs extends SelfVisibilityInputs {
  /** The observer's dark vision, 0–1 (sense profile: 0 = needs light, 1 = unaffected). */
  readonly darkVision: number;
  /** Fraction of the target in the observer's sight, 0–1. */
  readonly losFraction: number;
  /** Observer-to-target distance, m, ≥ 0. */
  readonly distance: number;
  /** Light level behind the target along the observer's ray, 0–1; omitted = no contrast. */
  readonly backgroundLight?: number;
}

/** The self-visibility and each of its terms. */
export interface SelfVisibilityTerms {
  /** The target's blended light level, 0–1 (before dark vision). */
  readonly level: number;
  readonly light: number;
  readonly stance: number;
  readonly motion: number;
  readonly profile: number;
  /** The product, clamped to [0, 1]. */
  readonly value: number;
}

/** A visibility and each of its terms. */
export interface VisibilityTerms extends SelfVisibilityTerms {
  readonly los: number;
  readonly distance: number;
  /** The contrast bonus applied (a dark target against bright background light). */
  readonly silhouetted: boolean;
}

/** The shipped stealth tuning's visibility weights (src/content/data/stealth/stealth.json). */
export const DEFAULT_VISIBILITY_TUNING: VisibilityTuning = Object.freeze({
  light: Object.freeze({
    curve: Object.freeze([
      Object.freeze({ level: 0, term: 0 }),
      Object.freeze({ level: 0.15, term: 0.05 }),
      Object.freeze({ level: 0.5, term: 0.45 }),
      Object.freeze({ level: 1, term: 1 }),
    ]),
    peakWeight: 0.5,
  }),
  stance: Object.freeze({ prone: 0.25, crouched: 0.5, standing: 1 }),
  motion: Object.freeze([
    Object.freeze({ fromSpeed: 0, term: 0.8 }),
    Object.freeze({ fromSpeed: 0.2, term: 0.85 }),
    Object.freeze({ fromSpeed: 1.6, term: 0.9 }),
    Object.freeze({ fromSpeed: 2.5, term: 1 }),
    Object.freeze({ fromSpeed: 6, term: 1 }),
  ]),
  profile: Object.freeze({ cloak: 0.7, disguise: 0.8 }),
  distance: Object.freeze([
    Object.freeze({ metres: 0, term: 1 }),
    Object.freeze({ metres: 8, term: 1 }),
    Object.freeze({ metres: 20, term: 0.75 }),
    Object.freeze({ metres: 40, term: 0.4 }),
    Object.freeze({ metres: 80, term: 0.1 }),
  ]),
  contrast: Object.freeze({ backgroundThreshold: 0.7, darkTargetMax: 0.2, bonus: 0.3 }),
});

function check(ok: boolean, problem: string): void {
  if (!ok) throw new RangeError(problem);
}

const within = (n: number, max: number): boolean => n >= 0 && n <= max;

/**
 * The piecewise-linear value of `points` (rising `x`) at `x`, held flat beyond either end. The
 * tuning schema guarantees at least two points in rising order.
 */
export function piecewise(
  points: readonly { readonly x: number; readonly y: number }[],
  x: number,
) {
  const first = points[0] as { x: number; y: number };
  if (x <= first.x) return first.y;
  for (let i = 1; i < points.length; i++) {
    const b = points[i] as { x: number; y: number };
    if (x <= b.x) {
      const a = points[i - 1] as { x: number; y: number };
      const t = (x - a.x) / (b.x - a.x);
      return a.y * (1 - t) + b.y * t; // exact at both points
    }
  }
  return (points[points.length - 1] as { y: number }).y;
}

/** The target's light samples blended between their mean (0) and their brightest (1). */
export function blendedLight(samples: readonly number[], peakWeight: number): number {
  check(samples.length > 0, 'visibility needs at least one light sample');
  let sum = 0;
  let peak = 0;
  for (const s of samples) {
    check(within(s, 1), `light samples must be in [0, 1], got ${String(s)}`);
    sum += s;
    if (s > peak) peak = s;
  }
  const mean = sum / samples.length;
  return mean + (peak - mean) * peakWeight;
}

/** The light term of a blended level seen with `darkVision` (0–1). */
export function lightTerm(level: number, darkVision: number, tuning: VisibilityTuning): number {
  check(within(darkVision, 1), `darkVision must be in [0, 1], got ${String(darkVision)}`);
  const seen = level + (1 - level) * darkVision;
  return curveAt(tuning.light.curve, seen);
}

function curveAt(curve: VisibilityTuning['light']['curve'], level: number): number {
  return piecewise(
    curve.map((p) => ({ x: p.level, y: p.term })),
    level,
  );
}

/** The motion term of horizontal `speed`, m/s: the fastest band it reaches. */
export function motionTerm(speed: number, tuning: VisibilityTuning): number {
  check(
    speed >= 0 && Number.isFinite(speed),
    `speed must be a finite number ≥ 0, got ${String(speed)}`,
  );
  let term = 0;
  for (const band of tuning.motion) {
    if (speed >= band.fromSpeed) term = band.term;
  }
  return term;
}

/** The profile term: brightness × the cloak and disguise modifiers that apply. */
export function profileTerm(profile: VisibilityProfile, tuning: VisibilityTuning): number {
  const brightness = profile.brightness ?? 1;
  check(within(brightness, 2), `brightness must be in [0, 2], got ${String(brightness)}`);
  const cloak = profile.cloaked === true ? tuning.profile.cloak : 1;
  const disguise = profile.disguised === true ? tuning.profile.disguise : 1;
  return brightness * cloak * disguise;
}

/** The distance falloff at `metres` (≥ 0). */
export function distanceTerm(metres: number, tuning: VisibilityTuning): number {
  check(
    metres >= 0 && Number.isFinite(metres),
    `distance must be a finite number ≥ 0, got ${String(metres)}`,
  );
  return piecewise(
    tuning.distance.map((p) => ({ x: p.metres, y: p.term })),
    metres,
  );
}

const clamp01 = (n: number): number => (n > 1 ? 1 : n);

/** The observer-independent terms (see the file header). Pure; throws a RangeError on bad input. */
export function selfVisibilityTerms(
  inputs: SelfVisibilityInputs,
  tuning: VisibilityTuning = DEFAULT_VISIBILITY_TUNING,
): SelfVisibilityTerms {
  const level = blendedLight(inputs.lightSamples, tuning.light.peakWeight);
  const light = lightTerm(level, 0, tuning);
  const stance = tuning.stance[inputs.stance];
  const motion = motionTerm(inputs.speed, tuning);
  const profile = profileTerm(inputs.profile ?? {}, tuning);
  return {
    level,
    light,
    stance,
    motion,
    profile,
    value: clamp01(light * stance * motion * profile),
  };
}

/** How visible the target is with no particular observer, 0–1 (the HUD's light-exposure reading). */
export function selfVisibility(
  inputs: SelfVisibilityInputs,
  tuning: VisibilityTuning = DEFAULT_VISIBILITY_TUNING,
): number {
  return selfVisibilityTerms(inputs, tuning).value;
}

/** Every term of one observer-target visibility (see the file header). Pure; throws a RangeError. */
export function visibilityTerms(
  inputs: VisibilityInputs,
  tuning: VisibilityTuning = DEFAULT_VISIBILITY_TUNING,
): VisibilityTerms {
  const self = selfVisibilityTerms(inputs, tuning);
  const { losFraction: los, backgroundLight } = inputs;
  check(within(los, 1), `losFraction must be in [0, 1], got ${String(los)}`);
  check(
    backgroundLight === undefined || within(backgroundLight, 1),
    `backgroundLight must be in [0, 1], got ${String(backgroundLight)}`,
  );
  const { backgroundThreshold, darkTargetMax, bonus } = tuning.contrast;
  const silhouetted =
    backgroundLight !== undefined &&
    backgroundLight >= backgroundThreshold &&
    self.level <= darkTargetMax;
  let light = lightTerm(self.level, inputs.darkVision, tuning);
  if (silhouetted) light = Math.max(light, Math.min(light + bonus, curveAt(tuning.light.curve, 1)));
  const distance = distanceTerm(inputs.distance, tuning);
  const value = clamp01(light * self.stance * self.motion * self.profile * los * distance);
  return { ...self, light, los, distance, silhouetted, value };
}

/** How visible the target is to this observer, 0–1. Pure; throws a RangeError on bad input. */
export function visibility(
  inputs: VisibilityInputs,
  tuning: VisibilityTuning = DEFAULT_VISIBILITY_TUNING,
): number {
  return visibilityTerms(inputs, tuning).value;
}
