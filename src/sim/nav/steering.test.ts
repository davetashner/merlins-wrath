import { describe, expect, it } from 'vitest';
import { NAV_SEPARATION_GAIN, separation } from './steering';

describe('local avoidance (mw-e11.4)', () => {
  it('pushes away from overlapping neighbours in proportion to the overlap', () => {
    const push = separation(0, 0, 0.35, [{ x: 0.5, z: 0, radius: 0.35 }], 10);
    expect(push.dx).toBeCloseTo(-(0.7 - 0.5) * NAV_SEPARATION_GAIN, 12);
    expect(push.dz).toBe(0);
  });

  it('ignores neighbours out of reach and clamps the push to the limit', () => {
    expect(separation(0, 0, 0.35, [{ x: 2, z: 0, radius: 0.35 }], 1)).toEqual({ dx: 0, dz: 0 });
    const push = separation(0, 0, 1, [{ x: 0, z: 0.1, radius: 1 }], 0.1);
    expect(Math.sqrt(push.dx ** 2 + push.dz ** 2)).toBeCloseTo(0.1, 12);
    expect(push.dz).toBeLessThan(0);
  });

  it('separates two agents on one spot along +x', () => {
    expect(separation(1, 1, 0.3, [{ x: 1, z: 1, radius: 0.3 }], 10)).toEqual({
      dx: 0.6 * NAV_SEPARATION_GAIN,
      dz: 0,
    });
  });
});
