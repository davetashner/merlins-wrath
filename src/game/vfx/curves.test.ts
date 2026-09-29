import { describe, expect, it } from 'vitest';
import { at } from './indexing.ts';
import { Pool } from './pool.ts';
import { bakeColour, bakeScalar, CURVE_SAMPLES, parseHexColour, sampleIndex } from './curves.ts';

describe('curves', () => {
  it('bakes a constant into a flat table', () => {
    const table = bakeScalar(0.25);
    expect(table).toHaveLength(CURVE_SAMPLES);
    expect([...table].every((v) => v === 0.25)).toBe(true);
  });

  it('interpolates keys linearly and clamps before the first and after the last', () => {
    const table = bakeScalar([
      { t: 0.25, v: 1 },
      { t: 0.75, v: 3 },
    ]);
    expect(table[0]).toBe(1);
    expect(table[CURVE_SAMPLES - 1]).toBe(3);
    const mid = at(table, sampleIndex(0.5));
    expect(Math.abs(mid - 2)).toBeLessThan(0.1); // nearest baked sample
  });

  it('a step (two keys at the same time) jumps', () => {
    const table = bakeScalar([
      { t: 0, v: 0 },
      { t: 0.5, v: 0 },
      { t: 0.5, v: 1 },
      { t: 1, v: 1 },
    ]);
    expect(table[sampleIndex(0.4)]).toBe(0);
    expect(table[sampleIndex(0.6)]).toBe(1);
  });

  it('bakes colours from hex, constant or keyed', () => {
    expect(parseHexColour('#FF8000')).toEqual([1, 128 / 255, 0]);
    const constant = bakeColour('#FF0000');
    expect([...constant.slice(0, 3)]).toEqual([1, 0, 0]);
    const keyed = bakeColour([
      { t: 0, color: '#000000' },
      { t: 1, color: '#FFFFFF' },
    ]);
    expect(keyed[0]).toBe(0);
    expect(keyed[(CURVE_SAMPLES - 1) * 3 + 2]).toBe(1);
  });

  it('sample indices clamp to the table', () => {
    expect(sampleIndex(-1)).toBe(0);
    expect(sampleIndex(2)).toBe(CURVE_SAMPLES - 1);
  });
});

describe('pool', () => {
  it('warms, hands out idle instances first and counts every creation', () => {
    let made = 0;
    const pool = new Pool(() => ({ n: made++ }));
    pool.warm(2);
    expect(pool.idle).toBe(2);
    const a = pool.acquire();
    const b = pool.acquire();
    const c = pool.acquire(); // pool empty: creates one
    expect(pool.allocations).toBe(3);
    pool.release(a);
    expect(pool.acquire()).toBe(a);
    pool.release(b);
    pool.release(c);
    pool.warm(1);
    expect(pool.allocations).toBe(3);
  });
});
