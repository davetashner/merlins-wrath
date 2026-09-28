import { describe, expect, it } from 'vitest';
import {
  isDegenerateShape,
  normalize,
  normalizeShape,
  ORIGIN,
  shapeBounds,
  shapeFalloff,
  shapePush,
  STIMULUS_EDGE_FALLOFF,
  type StimulusShape,
  type Vec3,
} from './shapes';

const v = (x: number, y = 0, z = 0): Vec3 => ({ x, y, z });
const sphere = (radius: number): StimulusShape => ({ kind: 'sphere', center: ORIGIN, radius });
const cone: StimulusShape = {
  kind: 'cone',
  apex: ORIGIN,
  direction: v(2),
  length: 4,
  halfAngle: Math.PI / 4,
};
const capsule: StimulusShape = { kind: 'capsule', from: ORIGIN, to: v(4), radius: 1 };
const box: StimulusShape = { kind: 'box', center: ORIGIN, halfExtents: v(1, 2, 3) };

describe('normalizeShape', () => {
  it('copies known fields only', () => {
    const extra = { kind: 'point', at: { x: 1, y: 2, z: 3, w: 4 }, colour: 'red' };
    expect(normalizeShape(extra as unknown as StimulusShape)).toEqual({
      kind: 'point',
      at: v(1, 2, 3),
    });
    expect(normalizeShape(sphere(2))).toEqual(sphere(2));
    expect(normalizeShape(cone)).toEqual(cone);
    expect(normalizeShape(capsule)).toEqual(capsule);
    expect(normalizeShape(box)).toEqual(box);
    expect(normalizeShape({ kind: 'contact', target: 7 })).toEqual({ kind: 'contact', target: 7 });
  });

  it('rejects non-finite numbers, negative sizes and bad cones or targets', () => {
    expect(() => normalizeShape({ kind: 'point', at: v(Number.NaN) })).toThrow(/point.at.x/);
    expect(() => normalizeShape({ kind: 'point', at: v(0, Infinity) })).toThrow(/point.at.y/);
    expect(() => normalizeShape({ kind: 'point', at: v(0, 0, -Infinity) })).toThrow(/point.at.z/);
    expect(() => normalizeShape(sphere(-1))).toThrow(/sphere.radius must be ≥ 0/);
    expect(() => normalizeShape({ ...cone, direction: ORIGIN })).toThrow(/non-zero/);
    expect(() => normalizeShape({ ...cone, halfAngle: 2 })).toThrow(/≤ π\/2/);
    expect(() => normalizeShape({ ...cone, halfAngle: -0.1 })).toThrow(/≥ 0/);
    expect(() => normalizeShape({ ...box, halfExtents: v(1, -1, 1) })).toThrow(/halfExtents.y/);
    expect(() => normalizeShape({ kind: 'contact', target: 0 })).toThrow(/entity id/);
    expect(() => normalizeShape({ kind: 'contact', target: 1.5 })).toThrow(/entity id/);
  });
});

describe('isDegenerateShape', () => {
  it('flags zero-size spheres, capsules, cones and boxes only', () => {
    expect(isDegenerateShape(sphere(0))).toBe(true);
    expect(isDegenerateShape(sphere(1))).toBe(false);
    expect(isDegenerateShape({ ...capsule, radius: 0 })).toBe(true);
    expect(isDegenerateShape({ ...cone, length: 0 })).toBe(true);
    expect(isDegenerateShape({ ...cone, halfAngle: 0 })).toBe(true);
    expect(isDegenerateShape(cone)).toBe(false);
    expect(isDegenerateShape({ ...box, halfExtents: v(1, 1, 0) })).toBe(true);
    expect(isDegenerateShape({ ...box, halfExtents: v(1, 0, 1) })).toBe(true);
    expect(isDegenerateShape({ ...box, halfExtents: v(0, 1, 1) })).toBe(true);
    expect(isDegenerateShape(box)).toBe(false);
    expect(isDegenerateShape({ kind: 'point', at: ORIGIN })).toBe(false);
    expect(isDegenerateShape({ kind: 'contact', target: 1 })).toBe(false);
  });
});

describe('shapeFalloff', () => {
  it('point: hits targets whose bounding sphere contains it, uniformly', () => {
    const point: StimulusShape = { kind: 'point', at: v(1) };
    expect(shapeFalloff(point, 'linear', v(1))).toBe(1);
    expect(shapeFalloff(point, 'linear', v(2), 1)).toBe(1);
    expect(shapeFalloff(point, 'linear', v(2), 0.5)).toBeUndefined();
  });

  it('sphere: linear from 1 at the centre to the edge falloff at the rim, measured to the target surface', () => {
    expect(shapeFalloff(sphere(2), 'linear', ORIGIN)).toBe(1);
    expect(shapeFalloff(sphere(2), 'linear', v(1))).toBe(1 - (1 - STIMULUS_EDGE_FALLOFF) / 2);
    expect(shapeFalloff(sphere(2), 'linear', v(0, 2))).toBe(STIMULUS_EDGE_FALLOFF);
    expect(shapeFalloff(sphere(2), 'linear', v(0, 0, 2.01))).toBeUndefined();
    expect(shapeFalloff(sphere(2), 'linear', v(3), 1)).toBe(STIMULUS_EDGE_FALLOFF);
    expect(shapeFalloff(sphere(2), 'linear', v(0.5), 1)).toBe(1);
    expect(shapeFalloff(sphere(2), 'none', v(1.5))).toBe(1);
    expect(shapeFalloff(sphere(0), 'linear', ORIGIN, 5)).toBeUndefined();
  });

  it('cone: inside the opening falls off with distance from the apex; outside misses', () => {
    expect(shapeFalloff(cone, 'linear', ORIGIN)).toBe(1);
    expect(shapeFalloff(cone, 'linear', v(2))).toBe(1 - (1 - STIMULUS_EDGE_FALLOFF) / 2);
    expect(shapeFalloff(cone, 'none', v(2, 1))).toBe(1);
    expect(shapeFalloff(cone, 'linear', v(4.5))).toBeUndefined(); // beyond the reach
    expect(shapeFalloff(cone, 'linear', v(5), 1)).toBe(STIMULUS_EDGE_FALLOFF);
    // Beside the opening: ~0.707 m past the side.
    expect(shapeFalloff(cone, 'linear', v(1, 2), 0.5)).toBeUndefined();
    expect(shapeFalloff(cone, 'none', v(1, 2), 1)).toBe(1);
    // Behind the apex: the nearest point of the cone is the apex itself.
    expect(shapeFalloff(cone, 'none', v(-1), 1)).toBe(1);
    expect(shapeFalloff(cone, 'none', v(-1), 0.5)).toBeUndefined();
    expect(shapeFalloff({ ...cone, halfAngle: 0 }, 'none', v(1))).toBeUndefined();
  });

  it('capsule: linear with distance from the segment, including its end caps', () => {
    expect(shapeFalloff(capsule, 'linear', v(2))).toBe(1);
    expect(shapeFalloff(capsule, 'linear', v(2, 1))).toBe(STIMULUS_EDGE_FALLOFF);
    expect(shapeFalloff(capsule, 'linear', v(5))).toBe(STIMULUS_EDGE_FALLOFF);
    expect(shapeFalloff(capsule, 'linear', v(-1.5))).toBeUndefined();
    expect(shapeFalloff(capsule, 'linear', v(2, 1.5), 0.5)).toBe(STIMULUS_EDGE_FALLOFF);
    const dot: StimulusShape = { kind: 'capsule', from: v(1), to: v(1), radius: 1 };
    expect(shapeFalloff(dot, 'none', v(1, 0.5))).toBe(1);
    expect(shapeFalloff(dot, 'none', v(3))).toBeUndefined();
  });

  it('box: uniform inside, touching counts', () => {
    expect(shapeFalloff(box, 'linear', v(0.5, 1.5, -2.5))).toBe(1);
    expect(shapeFalloff(box, 'linear', v(2))).toBeUndefined();
    expect(shapeFalloff(box, 'linear', v(2), 1)).toBe(1);
  });

  it('contact: not spatial', () => {
    expect(shapeFalloff({ kind: 'contact', target: 1 }, 'none', ORIGIN, 10)).toBeUndefined();
  });
});

describe('shapePush', () => {
  it('pushes away from centres and along axes', () => {
    expect(shapePush({ kind: 'point', at: ORIGIN }, v(0, 3))).toEqual(v(0, 1));
    expect(shapePush(sphere(2), v(0, 0, -2))).toEqual(v(0, 0, -1));
    expect(shapePush(box, v(2))).toEqual(v(1));
    expect(shapePush(cone, v(0, 5))).toEqual(v(1));
    expect(shapePush(capsule, v(0, 5))).toEqual(v(1));
  });

  it('has no direction at the centre or for contacts', () => {
    expect(shapePush(sphere(2), ORIGIN)).toBeUndefined();
    expect(shapePush({ kind: 'contact', target: 1 }, ORIGIN)).toBeUndefined();
  });

  it('normalize returns undefined for the zero vector', () => {
    expect(normalize(ORIGIN)).toBeUndefined();
    expect(normalize(v(0, 0, 4))).toEqual(v(0, 0, 1));
  });
});

describe('shapeBounds', () => {
  it('encloses each shape', () => {
    expect(shapeBounds({ kind: 'point', at: v(1) })).toEqual({ min: v(1), max: v(1) });
    expect(shapeBounds(sphere(2))).toEqual({ min: v(-2, -2, -2), max: v(2, 2, 2) });
    expect(shapeBounds(cone)).toEqual({ min: v(-4, -4, -4), max: v(4, 4, 4) });
    expect(shapeBounds({ ...capsule, from: v(4, 1), to: v(0, -1) })).toEqual({
      min: v(-1, -2, -1),
      max: v(5, 2, 1),
    });
    expect(shapeBounds(box)).toEqual({ min: v(-1, -2, -3), max: v(1, 2, 3) });
    expect(shapeBounds({ kind: 'contact', target: 1 })).toBeUndefined();
  });
});
