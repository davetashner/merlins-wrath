import { describe, expect, it } from 'vitest';
import { serializeContent } from '../schema.ts';
import { describeContent } from '../testing.ts';
import { BREAK_KINDS, breakableSchema } from './breakable.ts';

const problems = (value: unknown) =>
  (breakableSchema.safeParse(value).error?.issues ?? []).map(
    (i) => `${i.path.join('.')}: ${i.message}`,
  );

const base = {
  id: 'jar',
  name: 'Jar',
  notes: 'A test jar.',
  debris: { count: 2, size: 0.1 },
  breakLoudness: 60,
};

describe('breakable schema (mw-e03.11)', () => {
  it('defaults to no resistances and no crack telegraph', () => {
    const jar = breakableSchema.parse(base);
    expect(jar.resistances).toEqual({});
    expect(jar.crack).toBe(false);
  });

  it('takes a resistance per kind of hit, each 0–1', () => {
    expect(BREAK_KINDS).toEqual(['blunt', 'slash', 'pierce', 'force']);
    expect(problems({ ...base, resistances: { blunt: 1.5 } })).toEqual([
      'resistances.blunt: Too big: expected number to be <=1',
    ]);
    expect(problems({ ...base, resistances: { fire: 0.5 } })).toEqual([
      'resistances: Unrecognized key: "fire"',
    ]);
  });

  it('caps debris at 16 whole pieces of positive size', () => {
    expect(problems({ ...base, debris: { count: 17, size: 0.1 } })).toEqual([
      'debris.count: Too big: expected number to be <=16',
    ]);
    expect(problems({ ...base, debris: { count: 1.5, size: 0 } })).toHaveLength(2);
  });
});

describeContent('breakable', 'is valid, round-trips and is deeply frozen', (entry) => {
  expect(breakableSchema.parse(JSON.parse(serializeContent(entry)))).toEqual(entry);
  expect(Object.isFrozen(entry.debris)).toBe(true);
  expect(entry.notes.length).toBeGreaterThan(0);
});
