import { describe, expect, it } from 'vitest';
import { serializeContent } from '../schema.ts';
import { describeContent } from '../testing.ts';
import { lockSchema, MAX_LOCK_TIER } from './lock.ts';

const problems = (value: unknown) =>
  (lockSchema.safeParse(value).error?.issues ?? []).map((i) => `${i.path.join('.')}: ${i.message}`);

const base = { id: 'tower', name: 'Tower', notes: 'A test lock.', tier: 2 };

describe('lock schema (mw-e03.18)', () => {
  it('defaults to unpickable, unsealed, untagged and "Locked."', () => {
    expect(lockSchema.parse(base)).toEqual({
      ...base,
      pickTier: null,
      sealed: false,
      tags: [],
      hint: 'Locked.',
    });
  });

  it('keeps tiers whole and within 0…5', () => {
    expect(MAX_LOCK_TIER).toBe(5);
    expect(problems({ ...base, tier: 6, pickTier: 1.5 })).toEqual([
      'tier: Too big: expected number to be <=5',
      'pickTier: Invalid input: expected int, received number',
    ]);
  });
});

describeContent('lock', 'is valid and round-trips', (entry) => {
  expect(lockSchema.parse(JSON.parse(serializeContent(entry)))).toEqual(entry);
  expect(entry.hint.length).toBeGreaterThan(0);
});
