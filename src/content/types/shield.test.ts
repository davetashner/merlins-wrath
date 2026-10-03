import { describe, expect, it } from 'vitest';
import { serializeContent } from '../schema.ts';
import { describeContent } from '../testing.ts';
import { compileShield, KNIGHT_SHIELD_ID, shieldSchema, type ShieldDefInput } from './shield.ts';

const valid = {
  id: 'test-shield',
  name: 'Test shield',
  notes: 'A shield for tests.',
  absorption: { slash: 85, fire: 30 },
  stability: 60,
  raiseTicks: 6,
  arcDegrees: 120,
  moveSpeedScale: 0.5,
} satisfies ShieldDefInput;

const problems = (value: unknown) =>
  (shieldSchema.safeParse(value).error?.issues ?? []).map(
    (i) => `${i.path.join('.')}: ${i.message}`,
  );

describe('shield schema (mw-e04.6)', () => {
  it('accepts a shield and compiles it to frozen runtime data', () => {
    const parsed = shieldSchema.parse(valid);
    expect(parsed).toEqual({ ...valid, kind: 'shield' });
    const runtime = compileShield(parsed);
    expect(runtime).toEqual({
      id: 'test-shield',
      kind: 'shield',
      absorption: { slash: 85, fire: 30 },
      stability: 60,
      raiseTicks: 6,
      arcDegrees: 120,
      moveSpeedScale: 0.5,
    });
    expect(Object.isFrozen(runtime)).toBe(true);
    expect(Object.isFrozen(runtime.absorption)).toBe(true);
  });

  it('rejects out-of-range percentages, unknown damage types and bad ticks, arcs and speeds', () => {
    expect(problems({ ...valid, absorption: { slash: 101 } })).toEqual([
      'absorption.slash: Too big: expected number to be <=100',
    ]);
    expect(problems({ ...valid, absorption: { ice: 10 } })).toHaveLength(1);
    expect(problems({ ...valid, stability: -1 })).toEqual([
      'stability: Too small: expected number to be >=0',
    ]);
    expect(problems({ ...valid, raiseTicks: 2.5 })).toHaveLength(1);
    expect(problems({ ...valid, arcDegrees: 0 })).toHaveLength(1);
    expect(problems({ ...valid, moveSpeedScale: 1.5 })).toHaveLength(1);
    expect(problems({ ...valid, extra: true })).toHaveLength(1);
    expect(problems({ ...valid, kind: 'bracer' })).toHaveLength(1);
  });

  it('a shieldless guard (mw-e04.14) is of kind "weapon"', () => {
    expect(compileShield(shieldSchema.parse({ ...valid, kind: 'weapon' })).kind).toBe('weapon');
  });
});

describeContent('shield', 'is valid, round-trips and compiles', (shield) => {
  expect(shieldSchema.parse(JSON.parse(serializeContent(shield)))).toEqual(shield);
  expect(compileShield(shield).id).toBe(shield.id);
});

describeContent('shield', 'AC-2: the wood shield has the bead’s numbers', (shield) => {
  if (shield.id !== KNIGHT_SHIELD_ID) return;
  expect(compileShield(shield)).toEqual({
    id: 'wood-shield',
    kind: 'shield',
    absorption: { slash: 85, pierce: 85, blunt: 85, fire: 30 },
    stability: 60,
    raiseTicks: 6,
    arcDegrees: 120,
    moveSpeedScale: 0.5,
  });
});
