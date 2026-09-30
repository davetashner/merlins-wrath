import { describe, expect, it } from 'vitest';
import { serializeContent } from '../schema.ts';
import { describeContent } from '../testing.ts';
import {
  compileHitStop,
  HIT_STOP_ID,
  HIT_STOP_TIERS,
  hitStopSchema,
  MAX_HIT_STOP_TICKS,
  type HitStopDefInput,
} from './hit-stop.ts';
import { compileMove, moveSchema } from './move.ts';

const valid = {
  id: 'test-hit-stop',
  notes: 'A table for tests.',
  ticks: { light: 3, heavy: 5, charged: 6, parry: 8, critical: 10 },
} satisfies HitStopDefInput;

const problems = (value: unknown) =>
  (hitStopSchema.safeParse(value).error?.issues ?? []).map(
    (i) => `${i.path.join('.')}: ${i.message}`,
  );

describe('hit-stop schema (mw-e04.11)', () => {
  it('accepts a table and compiles it to frozen ticks per tier', () => {
    const table = compileHitStop(hitStopSchema.parse(valid));
    expect(table).toEqual(valid.ticks);
    expect(Object.isFrozen(table)).toBe(true);
    expect(Object.keys(table)).toEqual([...HIT_STOP_TIERS]);
  });

  it('rejects missing or unknown tiers and bad tick counts', () => {
    const missing: Partial<typeof valid.ticks> = { ...valid.ticks };
    delete missing.critical;
    expect(problems({ ...valid, ticks: missing })).toHaveLength(1);
    expect(problems({ ...valid, ticks: { ...valid.ticks, stun: 4 } })).toHaveLength(1);
    expect(problems({ ...valid, ticks: { ...valid.ticks, light: 2.5 } })).toHaveLength(1);
    expect(problems({ ...valid, ticks: { ...valid.ticks, light: -1 } })).toHaveLength(1);
    expect(
      problems({ ...valid, ticks: { ...valid.ticks, critical: MAX_HIT_STOP_TICKS + 1 } }),
    ).toEqual(['ticks.critical: Too big: expected number to be <=30']);
  });

  it('a move names its tier; a hitting move without one is light, a non-hitting one has none', () => {
    const swing = {
      id: 'swing',
      notes: 'A swing for tests.',
      verb: 'attack',
      frames: { startup: 10, active: 3, recovery: 10 },
      damage: { amounts: { slash: 10 } },
      hitbox: {
        track: 'swing-track',
        shape: { kind: 'sphere', center: { x: 0, y: 1, z: 1 }, radius: 0.3 },
        reach: 'short',
        swing: 'thrust',
      },
      presentation: { anim: 'anim-swing' },
    } as const;
    expect(compileMove(moveSchema.parse(swing)).hitStop).toBe('light');
    expect(compileMove(moveSchema.parse({ ...swing, hitStop: 'heavy' })).hitStop).toBe('heavy');
    const roll = {
      id: 'roll',
      notes: 'A roll for tests.',
      verb: 'dodge',
      frames: { startup: 2, active: 10, recovery: 10 },
      presentation: { anim: 'anim-roll' },
    } as const;
    expect(compileMove(moveSchema.parse(roll)).hitStop).toBeNull();
    const bad = moveSchema.safeParse({ ...roll, hitStop: 'light' }).error?.issues ?? [];
    expect(bad.map((i) => i.message)).toEqual([
      'move "roll": only a move with a hitbox has a hit-stop tier',
    ]);
  });
});

describeContent('hit-stop', 'is valid, round-trips and compiles', (table) => {
  expect(hitStopSchema.parse(JSON.parse(serializeContent(table)))).toEqual(table);
  expect(Object.keys(compileHitStop(table))).toEqual([...HIT_STOP_TIERS]);
});

describeContent('hit-stop', 'the game table has the bead’s (placeholder) numbers', (table) => {
  if (table.id !== HIT_STOP_ID) return;
  expect(compileHitStop(table)).toEqual({ light: 3, heavy: 5, charged: 6, parry: 8, critical: 10 });
  expect(table.notes).toMatch(/PLACEHOLDER/);
});
