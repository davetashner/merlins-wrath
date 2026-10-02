import { describe, expect, it } from 'vitest';
import { grownPool, POOL_STEP } from './index';

describe('light rig pools (mw-e03.37)', () => {
  it('a scene with no lit emitters adds no lights', () => {
    expect(grownPool(0, 0, 6)).toBe(0);
  });

  it('grows in whole steps to hold the lights wanted, up to the cap', () => {
    expect(POOL_STEP).toBe(2);
    expect(grownPool(0, 1, 6)).toBe(2);
    expect(grownPool(0, 3, 6)).toBe(4);
    expect(grownPool(2, 9, 6)).toBe(6);
    expect(grownPool(0, 1, 1)).toBe(1);
  });

  it('never shrinks, so materials do not recompile when lights go out', () => {
    expect(grownPool(4, 1, 6)).toBe(4);
    expect(grownPool(4, 0, 6)).toBe(4);
  });
});
