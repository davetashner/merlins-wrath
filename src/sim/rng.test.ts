import { describe, expect, it } from 'vitest';
import golden from './rng.golden.json';
import { EmptyChoiceError, Rng } from './rng';

const draw = (rng: Rng, n: number): number[] => Array.from({ length: n }, () => rng.nextU32());

describe('Rng core', () => {
  it('matches the xoshiro128** reference vector from state [1, 2, 3, 4]', () => {
    // Independent Python implementation of the published algorithm; 11520 is the canonical first output.
    const rng = Rng.restore({ seed: 0, state: [1, 2, 3, 4] });
    expect(draw(rng, 8)).toEqual([
      11520, 0, 5927040, 70819200, 2031721883, 1637235492, 1287239034, 3734860849,
    ]);
  });

  it('AC-1: seed 12345, stream "loot", 1,000 draws equal the committed golden sequence', () => {
    expect(golden.seed).toBe(12345);
    expect(draw(Rng.create(12345).stream('loot'), 1000)).toEqual(golden.values);
  });

  it('AC-2: serialized after 500 draws and restored, the next 500 match the original', () => {
    const original = Rng.create(12345).stream('loot');
    draw(original, 500);
    const restored = Rng.restore(structuredClone(original.serialize()));
    expect(draw(restored, 500)).toEqual(draw(original, 500));
    expect(restored.stream('x').nextU32()).toBe(original.stream('x').nextU32());
  });

  it('AC-3: extra draws on "ai" leave the "loot" sequence unchanged', () => {
    const quiet = Rng.create(12345);
    const busy = Rng.create(12345);
    draw(busy.stream('ai'), 250);
    draw(busy, 17); // even drawing from the root doesn't matter
    expect(draw(busy.stream('loot'), 100)).toEqual(draw(quiet.stream('loot'), 100));
  });

  it('streams differ by name, by seed and by nesting order', () => {
    const root = Rng.create(1);
    const first = (r: Rng) => draw(r, 4);
    expect(first(root.stream('loot'))).not.toEqual(first(root.stream('ai')));
    expect(first(root.stream('loot'))).not.toEqual(first(Rng.create(2).stream('loot')));
    expect(first(root.stream('a').stream('b'))).not.toEqual(first(root.stream('b').stream('a')));
    expect(first(root.stream('loot'))).not.toEqual(first(Rng.create(1)));
  });

  it('seed 0 still produces a live (non-zero) generator', () => {
    expect(draw(Rng.create(0), 4).some((v) => v !== 0)).toBe(true);
  });

  it.each([-1, 1.5, 2 ** 32, Number.NaN])('rejects seed %s', (seed) => {
    expect(() => Rng.create(seed)).toThrow(RangeError);
  });

  it.each([
    ['a bad seed', { seed: -1, state: [1, 2, 3, 4] }],
    ['the wrong length', { seed: 0, state: [1, 2, 3] }],
    ['a bad word', { seed: 0, state: [1, 2, 3, 2 ** 32] }],
    ['an all-zero state', { seed: 0, state: [0, 0, 0, 0] }],
  ])('restore rejects %s', (_name, state) => {
    expect(() => Rng.restore(state as never)).toThrow(RangeError);
  });
});

describe('Rng helpers', () => {
  const rng = () => Rng.create(99).stream('helpers');

  it('AC-4: int(5, 5) returns 5 and pick([]) throws EmptyChoiceError', () => {
    expect(rng().int(5, 5)).toBe(5);
    expect(() => rng().pick([])).toThrow(EmptyChoiceError);
    expect(() => rng().pick([])).toThrow(expect.objectContaining({ name: 'EmptyChoiceError' }));
  });

  it('AC-5: 1,000,000 float() draws fill 10 bins at 10% ± 0.5%', () => {
    const r = rng();
    const bins = new Array<number>(10).fill(0);
    let min = 1;
    let max = 0;
    for (let i = 0; i < 1_000_000; i++) {
      const f = r.float();
      if (f < min) min = f;
      if (f > max) max = f;
      const bin = Math.floor(f * 10);
      bins[bin] = (bins[bin] ?? 0) + 1;
    }
    expect(min).toBeGreaterThanOrEqual(0);
    expect(max).toBeLessThan(1);
    expect(bins).toHaveLength(10);
    for (const count of bins) expect(Math.abs(count / 1_000_000 - 0.1)).toBeLessThanOrEqual(0.005);
  });

  it('int covers the inclusive range, including ranges that need rejection sampling', () => {
    const r = rng();
    const seen = new Set(Array.from({ length: 200 }, () => r.int(-2, 2)));
    expect([...seen].sort()).toEqual([-1, -2, 0, 1, 2].sort());
    // 3 × 2^30 values: a quarter of raw draws are rejected, so this exercises the retry path.
    const big = Array.from({ length: 64 }, () => r.int(0, 3 * 2 ** 30 - 1));
    expect(big.every((v) => v >= 0 && v < 3 * 2 ** 30)).toBe(true);
    expect(r.int(0, 2 ** 32 - 1)).toBeLessThan(2 ** 32);
  });

  it.each([
    [0, 1.5],
    [Number.NaN, 1],
    [2, 1],
    [0, 2 ** 32],
  ])('int(%s, %s) throws RangeError', (min, max) => {
    expect(() => rng().int(min, max)).toThrow(RangeError);
  });

  it('chance honours 0 and 1 and rejects probabilities outside [0, 1]', () => {
    const r = rng();
    expect(Array.from({ length: 100 }, () => r.chance(0)).some(Boolean)).toBe(false);
    expect(Array.from({ length: 100 }, () => r.chance(1)).every(Boolean)).toBe(true);
    const hits = Array.from({ length: 10_000 }, () => r.chance(0.25)).filter(Boolean).length;
    expect(hits).toBeGreaterThan(2300);
    expect(hits).toBeLessThan(2700);
    for (const p of [-0.1, 1.1, Number.NaN]) expect(() => r.chance(p)).toThrow(RangeError);
  });

  it('pick and shuffle use every element; shuffle leaves its input alone', () => {
    const r = rng();
    const items = ['a', 'b', 'c', 'd'] as const;
    expect(new Set(Array.from({ length: 100 }, () => r.pick(items)))).toEqual(new Set(items));
    const input = [1, 2, 3, 4, 5, 6, 7, 8];
    const shuffled = r.shuffle(input);
    expect(input).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect([...shuffled].sort()).toEqual(input);
    expect(shuffled).not.toEqual(input);
    expect(r.shuffle([])).toEqual([]);
    expect(r.shuffle(['only'])).toEqual(['only']);
  });

  it('weighted follows integer weights, skips zero weights and reaches the last entry', () => {
    const r = rng();
    const table = [
      { value: 'common', weight: 3 },
      { value: 'never', weight: 0 },
      { value: 'rare', weight: 1 },
    ];
    const counts = { common: 0, never: 0, rare: 0 };
    for (let i = 0; i < 40_000; i++) counts[r.weighted(table) as keyof typeof counts] += 1;
    expect(counts.never).toBe(0);
    expect(Math.abs(counts.common / 40_000 - 0.75)).toBeLessThan(0.02);
    expect(r.weighted([{ value: 'solo', weight: 2 }])).toBe('solo');
  });

  it('weighted rejects empty or all-zero tables and non-integer or negative weights', () => {
    const r = rng();
    expect(() => r.weighted([])).toThrow(EmptyChoiceError);
    expect(() => r.weighted([{ value: 'x', weight: 0 }])).toThrow(EmptyChoiceError);
    expect(() => r.weighted([{ value: 'x', weight: 1.5 }])).toThrow(RangeError);
    expect(() => r.weighted([{ value: 'x', weight: -1 }])).toThrow(RangeError);
  });
});
