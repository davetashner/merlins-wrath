import { describe, expect, it } from 'vitest';
import { serializeContent } from '../schema.ts';
import { describeContent } from '../testing.ts';
import {
  DEFAULT_ENVIRONMENT_DAMAGE_ID,
  environmentDamageSchema,
  environmentDamageTuningSchema,
  HAZARD_PROPERTIES,
  type EnvironmentDamageDefInput,
} from './environment-damage.ts';

const valid = {
  id: 'test',
  name: 'Test',
  notes: 'Test rules.',
  fall: { safeHeight: 4, lethalHeight: 14, deepWater: 1.5 },
  kinetic: { minSpeed: 6, joulesPerPoint: 20 },
  hazards: [{ when: 'burning', perSecond: { fire: 8 }, reach: 0.75, pulseMs: 250 }],
} satisfies EnvironmentDamageDefInput;

const problems = (value: unknown) =>
  (environmentDamageSchema.safeParse(value).error?.issues ?? []).map(
    (i) => `${i.path.join('.')}: ${i.message}`,
  );

describe('environment-damage schema (mw-e04.19)', () => {
  it('accepts the bead numbers; the tuning schema is the same without id fields', () => {
    expect(environmentDamageSchema.parse(valid)).toEqual(valid);
    const entryFields = new Set(['id', 'name', 'notes']);
    const tuning = Object.fromEntries(Object.entries(valid).filter(([k]) => !entryFields.has(k)));
    expect(environmentDamageTuningSchema.parse(tuning)).toEqual(tuning);
    expect(HAZARD_PROPERTIES).toEqual(['burning']);
  });

  it('rejects out-of-range values and unknown hazards or damage types with the field path', () => {
    expect(
      problems({
        ...valid,
        kinetic: { minSpeed: -1, joulesPerPoint: 0 },
        hazards: [{ when: 'wet', perSecond: { heat: 1 }, reach: 0.5, pulseMs: 0 }],
      }),
    ).toEqual([
      'kinetic.minSpeed: Too small: expected number to be >=0',
      'kinetic.joulesPerPoint: Too small: expected number to be >0',
      'hazards.0.when: Invalid input: expected "burning"',
      'hazards.0.perSecond: Unrecognized key: "heat"',
      'hazards.0.pulseMs: Too small: expected number to be >0',
    ]);
  });

  it('rejects a lethal height not above the safe one and a hazard that deals nothing', () => {
    expect(
      problems({
        ...valid,
        fall: { safeHeight: 4, lethalHeight: 4, deepWater: 1.5 },
        hazards: [{ when: 'burning', perSecond: {}, reach: 0.75, pulseMs: 250 }],
      }),
    ).toEqual([
      'fall.lethalHeight: fall.lethalHeight must be above fall.safeHeight',
      'hazards.0.perSecond: a hazard must deal at least one damage type',
    ]);
  });
});

describeContent(
  'environment-damage',
  'AC-1: is valid and round-trips; the default falls are safe to 4 m and lethal at 14 m',
  (entry, content) => {
    expect(environmentDamageSchema.parse(JSON.parse(serializeContent(entry)))).toEqual(entry);
    const rules = content.get('environment-damage', DEFAULT_ENVIRONMENT_DAMAGE_ID);
    expect(rules.fall).toEqual({ safeHeight: 4, lethalHeight: 14, deepWater: 1.5 });
    expect(rules.kinetic).toEqual({ minSpeed: 6, joulesPerPoint: 20 });
    expect(rules.hazards).toEqual([
      { when: 'burning', perSecond: { fire: 8 }, reach: 0.75, pulseMs: 250 },
    ]);
  },
);
