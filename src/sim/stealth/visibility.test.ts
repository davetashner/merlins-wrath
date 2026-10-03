import type { VisibilityTuning } from '@content/index';
import { describe, expect, it } from 'vitest';
import {
  blendedLight,
  DEFAULT_VISIBILITY_TUNING as T,
  distanceTerm,
  lightTerm,
  motionTerm,
  piecewise,
  profileTerm,
  selfVisibility,
  selfVisibilityTerms,
  visibility,
  visibilityTerms,
  type VisibilityInputs,
} from './visibility';

/** The humanoid sense profile's dark vision (src/content/data/sense/humanoid.json). */
const HUMANOID_DARK_VISION = 0.2;
const FOUR = (level: number): number[] => [level, level, level, level];

/** A guard 10 m away with the target fully in sight; the test overrides what it is about. */
const base: VisibilityInputs = {
  lightSamples: FOUR(0.5),
  stance: 'standing',
  speed: 0,
  darkVision: 0,
  losFraction: 1,
  distance: 10,
};

describe('visibility (mw-e09.2)', () => {
  it('AC-1: light 0.05 at every sample, crouched and still at 10 m → ≤ 0.1', () => {
    const shadow = { ...base, lightSamples: FOUR(0.05), stance: 'crouched', speed: 0 } as const;
    expect(visibility({ ...shadow, darkVision: 0 })).toBeLessThanOrEqual(0.1);
    expect(visibility({ ...shadow, darkVision: HUMANOID_DARK_VISION })).toBeLessThanOrEqual(0.1);
    expect(visibility({ ...shadow, darkVision: HUMANOID_DARK_VISION })).toBeGreaterThan(0);
  });

  it('AC-2: light 0.9, standing and sprinting at 10 m → ≥ 0.8', () => {
    const lit = { ...base, lightSamples: FOUR(0.9), stance: 'standing', speed: 7.5 } as const;
    expect(visibility({ ...lit, darkVision: 0 })).toBeGreaterThanOrEqual(0.8);
    expect(visibility({ ...lit, darkVision: HUMANOID_DARK_VISION })).toBeGreaterThanOrEqual(0.8);
  });

  it('AC-3: the same target at 20 m is strictly less visible than at 5 m, per the falloff curve', () => {
    const near = visibilityTerms({ ...base, distance: 5 });
    const far = visibilityTerms({ ...base, distance: 20 });
    expect(far.value).toBeLessThan(near.value);
    expect(near.distance).toBe(1);
    expect(far.distance).toBe(0.75);
    expect(far.value).toBeCloseTo(near.value * 0.75, 12);
    // Between points the curve interpolates; past the last it holds.
    expect(distanceTerm(14, T)).toBeCloseTo(0.875, 12);
    expect(distanceTerm(80, T)).toBe(0.1);
    expect(distanceTerm(500, T)).toBe(0.1);
  });

  it('AC-4: an observer with dark vision 1.0 sees a target in 0.0 light at light term 1.0', () => {
    const terms = visibilityTerms({ ...base, lightSamples: FOUR(0), darkVision: 1 });
    expect(terms.light).toBe(1);
    expect(terms.level).toBe(0);
    expect(lightTerm(0, 1, T)).toBe(1);
    // Partial dark vision lifts darkness part of the way: 0 seen with 0.2 reads as level 0.2.
    expect(lightTerm(0, 0.2, T)).toBeCloseTo(lightTerm(0.2, 0, T), 12);
    expect(lightTerm(0, 0, T)).toBe(0);
  });

  it('AC-5: a dark target against background light ≥ 0.7 gains the configured contrast bonus', () => {
    const dark = { ...base, lightSamples: FOUR(0.1), darkVision: HUMANOID_DARK_VISION };
    const plain = visibilityTerms(dark);
    const backlit = visibilityTerms({ ...dark, backgroundLight: 0.7 });
    expect(plain.silhouetted).toBe(false);
    expect(backlit.silhouetted).toBe(true);
    expect(backlit.light).toBeCloseTo(plain.light + T.contrast.bonus, 12);
    expect(backlit.value).toBeGreaterThan(plain.value);
    const others =
      backlit.stance * backlit.motion * backlit.profile * backlit.los * backlit.distance;
    expect(backlit.value - plain.value).toBeCloseTo(T.contrast.bonus * others, 12);

    // Below the threshold, or a lit target, gets no bonus.
    expect(visibilityTerms({ ...dark, backgroundLight: 0.69 }).silhouetted).toBe(false);
    const lit = { ...dark, lightSamples: FOUR(0.5), backgroundLight: 1 };
    expect(visibilityTerms(lit).silhouetted).toBe(false);
    // The bonus never lifts the light term above full light.
    const strong: VisibilityTuning = { ...T, contrast: { ...T.contrast, bonus: 2 } };
    expect(visibilityTerms({ ...dark, backgroundLight: 1 }, strong).light).toBe(1);
    // A term already above full light (a curve with a peak in the middle) is never lowered.
    const peaked: VisibilityTuning = {
      ...T,
      light: {
        ...T.light,
        curve: [
          { level: 0, term: 0 },
          { level: 0.2, term: 1.5 },
          { level: 1, term: 1 },
        ],
      },
    };
    const atPeak = { ...dark, lightSamples: FOUR(0.2), darkVision: 0, backgroundLight: 1 };
    expect(visibilityTerms(atPeak, peaked).light).toBe(1.5);
  });

  it('AC-6: LOS fraction 0 gives exactly 0 whatever the other terms', () => {
    const blazing = {
      ...base,
      lightSamples: FOUR(1),
      speed: 7.5,
      distance: 0,
      darkVision: 1,
      backgroundLight: 1,
      profile: { brightness: 2 },
    };
    expect(visibility({ ...blazing, losFraction: 0 })).toBe(0);
    expect(Object.is(visibility({ ...blazing, losFraction: 0 }), 0)).toBe(true);
    expect(visibility({ ...blazing, losFraction: 0.5 })).toBeGreaterThan(0);
  });

  it('any zero term hides the target; the product is clamped to 1', () => {
    expect(visibility({ ...base, profile: { brightness: 0 } })).toBe(0);
    expect(visibility({ ...base, lightSamples: FOUR(0) })).toBe(0);
    const zeroStance: VisibilityTuning = { ...T, stance: { ...T.stance, prone: 0 } };
    expect(visibility({ ...base, stance: 'prone' }, zeroStance)).toBe(0);
    const bright = { ...base, lightSamples: FOUR(1), speed: 7.5, profile: { brightness: 2 } };
    expect(visibility(bright)).toBe(1);
  });

  it('multiplies stance, motion and profile from the tuning', () => {
    const t = visibilityTerms({
      ...base,
      stance: 'prone',
      speed: 2,
      profile: { brightness: 1.5, cloaked: true, disguised: true },
    });
    expect([t.stance, t.motion]).toEqual([0.25, 0.9]);
    expect(t.profile).toBeCloseTo(1.5 * 0.7 * 0.8, 12);
    expect(t.value).toBeCloseTo(t.light * 0.25 * 0.9 * t.profile * 1 * t.distance, 12);
    expect(t.los).toBe(1);
    // Stance × motion reproduces the controller's stance × gait visibility (mw-e02.10).
    expect(T.stance.crouched * motionTerm(0, T)).toBe(0.4);
    expect(T.stance.crouched * motionTerm(2, T)).toBeCloseTo(0.45, 12);
  });

  it('motion picks the fastest band the speed reaches', () => {
    expect([0, 0.19, 0.2, 1.59, 1.6, 2.5, 6, 40].map((s) => motionTerm(s, T))).toEqual([
      0.8, 0.8, 0.85, 0.85, 0.9, 1, 1, 1,
    ]);
  });

  it('blends light samples between their mean and their brightest', () => {
    expect(blendedLight([0, 1], 0)).toBe(0.5);
    expect(blendedLight([0, 1], 1)).toBe(1);
    expect(blendedLight([0.2, 0.2, 0.2, 1], 0.5)).toBeCloseTo((0.4 + 1) / 2, 12);
    expect(blendedLight([0], 0.5)).toBe(0);
  });

  it('profile defaults to neutral', () => {
    expect(profileTerm({}, T)).toBe(1);
    expect(profileTerm({ cloaked: false, disguised: false }, T)).toBe(1);
  });

  it('piecewise holds below the first point and interpolates between points', () => {
    const pts = [
      { x: 1, y: 2 },
      { x: 3, y: 4 },
    ];
    expect([0, 1, 2, 3, 9].map((x) => piecewise(pts, x))).toEqual([2, 2, 3, 4, 4]);
  });

  it('self-visibility ignores the observer: no dark vision, LOS, distance or contrast', () => {
    const self = selfVisibilityTerms({ lightSamples: FOUR(0.5), stance: 'crouched', speed: 2 });
    expect(self).toEqual({
      level: 0.5,
      light: 0.45,
      stance: 0.5,
      motion: 0.9,
      profile: 1,
      value: 0.45 * 0.5 * 0.9,
    });
    expect(selfVisibility({ lightSamples: FOUR(0.05), stance: 'crouched', speed: 0 })).toBeLessThan(
      0.05,
    );
    expect(selfVisibility({ lightSamples: FOUR(0.95), stance: 'standing', speed: 7.5 })).toBe(
      lightTerm(0.95, 0, T),
    );
    // The same target to a nearby, clear-sighted observer without dark vision reads the same.
    expect(
      visibility({ ...base, lightSamples: FOUR(0.5), stance: 'crouched', speed: 2, distance: 5 }),
    ).toBe(self.value);
  });

  it('is deterministic: the same inputs give the same bits', () => {
    const inputs = { ...base, lightSamples: [0.13, 0.42, 0.07, 0.91], speed: 3.3, distance: 27.1 };
    expect(visibility(inputs)).toBe(visibility(inputs));
  });

  it('rejects inputs out of range', () => {
    expect(() => visibility({ ...base, lightSamples: [] })).toThrow(RangeError);
    expect(() => visibility({ ...base, lightSamples: [1.2] })).toThrow(/light samples/);
    expect(() => visibility({ ...base, lightSamples: [-0.1] })).toThrow(/light samples/);
    expect(() => visibility({ ...base, darkVision: 1.5 })).toThrow(/darkVision/);
    expect(() => visibility({ ...base, losFraction: -0.5 })).toThrow(/losFraction/);
    expect(() => visibility({ ...base, losFraction: 2 })).toThrow(/losFraction/);
    expect(() => visibility({ ...base, distance: -1 })).toThrow(/distance/);
    expect(() => visibility({ ...base, distance: Number.POSITIVE_INFINITY })).toThrow(/distance/);
    expect(() => visibility({ ...base, speed: Number.NaN })).toThrow(/speed/);
    expect(() => visibility({ ...base, speed: Number.POSITIVE_INFINITY })).toThrow(/speed/);
    expect(() => visibility({ ...base, backgroundLight: 1.1 })).toThrow(/backgroundLight/);
    expect(() => visibility({ ...base, profile: { brightness: 3 } })).toThrow(/brightness/);
  });
});
