import { describe, expect, it } from 'vitest';
import { serializeContent } from '../schema.ts';
import { describeContent } from '../testing.ts';
import { ARCHER_BOW_ID, bowSchema, compileBow, type BowDefInput } from './bow.ts';

const valid = {
  id: 'test-bow',
  name: 'Test bow',
  notes: 'A bow for tests.',
  fullDrawTicks: 48,
  minDrawTicks: 12,
  maxLaunchSpeed: 60,
  minLaunchFraction: 0.3,
  drawStaminaCost: 6,
  holdTicks: 120,
  holdDrainPerSecond: 8,
  walkScale: 0.5,
  aim: { fov: 55, time: 0.15 },
} satisfies BowDefInput;

const problems = (value: unknown) =>
  (bowSchema.safeParse(value).error?.issues ?? []).map((i) => `${i.path.join('.')}: ${i.message}`);

describe('bow schema (mw-e05.3)', () => {
  it('accepts a bow and compiles its rules to frozen runtime data', () => {
    const parsed = bowSchema.parse(valid);
    expect(parsed).toEqual(valid);
    const runtime = compileBow(parsed);
    expect(runtime).toEqual({
      id: 'test-bow',
      fullDrawTicks: 48,
      minDrawTicks: 12,
      maxLaunchSpeed: 60,
      minLaunchFraction: 0.3,
      drawStaminaCost: 6,
      holdTicks: 120,
      holdDrainPerSecond: 8,
      walkScale: 0.5,
    });
    expect(Object.isFrozen(runtime)).toBe(true);
  });

  it('rejects bad ticks, speeds, fractions and a minimum draw past full draw', () => {
    expect(problems({ ...valid, fullDrawTicks: 0 })).not.toEqual([]);
    expect(problems({ ...valid, fullDrawTicks: 2.5 })).not.toEqual([]);
    expect(problems({ ...valid, minDrawTicks: 60 })).toEqual([
      'minDrawTicks: minDrawTicks must be ≤ fullDrawTicks',
    ]);
    expect(problems({ ...valid, maxLaunchSpeed: 0 })).not.toEqual([]);
    expect(problems({ ...valid, minLaunchFraction: 1.2 })).not.toEqual([]);
    expect(problems({ ...valid, walkScale: -0.1 })).not.toEqual([]);
    expect(problems({ ...valid, aim: { fov: 10, time: 0.1 } })).not.toEqual([]);
    expect(problems({ ...valid, extra: true })).not.toEqual([]);
  });
});

describeContent('bow', 'is valid, round-trips and compiles', (bow) => {
  expect(bowSchema.parse(JSON.parse(serializeContent(bow)))).toEqual(bow);
  expect(compileBow(bow).id).toBe(bow.id);
});

describeContent('bow', 'the shortbow has the bead’s numbers', (bow) => {
  if (bow.id !== ARCHER_BOW_ID) return;
  expect(compileBow(bow)).toMatchObject({
    fullDrawTicks: 48,
    minDrawTicks: 12,
    maxLaunchSpeed: 60,
    minLaunchFraction: 0.3,
    drawStaminaCost: 6,
    holdTicks: 120,
    holdDrainPerSecond: 8,
    walkScale: 0.5,
  });
  expect(bow.aim.fov).toBe(55);
});
