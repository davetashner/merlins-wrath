import { describe, expect, it } from 'vitest';
import { serializeContent } from '../schema.ts';
import { describeContent } from '../testing.ts';
import { DOOR_KIND_IDS, doorSchema } from './door.ts';

const problems = (value: unknown) =>
  (doorSchema.safeParse(value).error?.issues ?? []).map((i) => `${i.path.join('.')}: ${i.message}`);

const base = {
  id: 'door',
  name: 'Door',
  notes: 'A test door.',
  kind: 'hinged',
  size: [1.2, 2.2, 0.06],
  seconds: 1,
  material: 'wood',
  blocks: { light: true, gas: true, sound: true },
  loudness: 50,
};

describe('door schema (mw-e03.18)', () => {
  it('names the door kinds', () => {
    expect(DOOR_KIND_IDS).toEqual(['hinged', 'sliding', 'portcullis', 'trapdoor']);
  });

  it('defaults to no crush, opened by hand', () => {
    const door = doorSchema.parse(base);
    expect(door.crush).toBe(0);
    expect(door.manual).toBe(true);
  });

  it('rejects unknown kinds, flat leaves and a stopped door', () => {
    expect(problems({ ...base, kind: 'revolving' })).toEqual([expect.stringMatching(/^kind: /)]);
    expect(problems({ ...base, size: [1.2, 0, 0.06], seconds: 0 })).toEqual([
      'size.1: Too small: expected number to be >0',
      'seconds: Too small: expected number to be >0',
    ]);
  });
});

describeContent('door', 'is valid, round-trips and names its material', (entry, content) => {
  expect(doorSchema.parse(JSON.parse(serializeContent(entry)))).toEqual(entry);
  expect(content.has('material', entry.material.id)).toBe(true);
  expect(entry.notes.length).toBeGreaterThan(0);
});
