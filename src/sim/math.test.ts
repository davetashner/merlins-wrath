import { describe, expect, it } from 'vitest';
import * as simMath from './math';

describe('sim math wrappers', () => {
  it('delegate to the engine today (same build + same engine determinism target)', () => {
    expect(simMath.sin(1)).toBe(Math.sin(1));
    expect(simMath.cos(1)).toBe(Math.cos(1));
    expect(simMath.tan(1)).toBe(Math.tan(1));
    expect(simMath.atan2(1, 2)).toBe(Math.atan2(1, 2));
    expect(simMath.exp(1)).toBe(Math.exp(1));
    expect(simMath.log(2)).toBe(Math.log(2));
    expect(simMath.pow(2, 0.5)).toBe(Math.pow(2, 0.5));
    expect(simMath.hypot(3, 4)).toBe(5);
  });
});
