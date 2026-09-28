import { describe, expect, it } from 'vitest';
import { loadGameContent } from '../game-content.ts';
import { serializeContent } from '../schema.ts';
import { describeContent } from '../testing.ts';
import { creatureSchema, type CreatureDefInput } from './creature.ts';
import {
  SPECIAL_SENSE_CHANNELS,
  SenseResolutionError,
  resolveSenses,
  senseProfileSchema,
  senseSchema,
  type SenseDefInput,
} from './sense.ts';

const content = loadGameContent();
const humanoid = content.get('sense', 'humanoid');

const sight = {
  nearRange: 8,
  farRange: 20,
  primaryHalfAngle: 35,
  peripheralHalfAngle: 80,
  verticalHalfAngle: 40,
  darkVision: 0.2,
  detectionSpeed: 1,
};
const lifeSense = {
  range: 3,
  minStrength: 0.5,
  requiresLineOfSight: false,
  requiresMovement: false,
};
const profile = {
  id: 'fixture',
  name: 'Fixture',
  notes: 'Test profile.',
  sight,
} satisfies SenseDefInput;

/** `path: message` of every issue parsing `value` with `schema`, or [] when it is valid. */
function problems(
  schema: { safeParse(v: unknown): { error?: { issues: Issue[] } } },
  value: unknown,
) {
  return (schema.safeParse(value).error?.issues ?? []).map(
    (i) => `${i.path.join('.')}: ${i.message}`,
  );
}
interface Issue {
  readonly path: readonly PropertyKey[];
  readonly message: string;
}

/** A creature with `senses`, parsed as the loader would. */
const creature = (senses: CreatureDefInput['senses']) =>
  creatureSchema.parse({
    id: 'fixture-creature',
    family: 'human',
    stats: { health: 10, poise: 0, mass: 70, size: 'medium' },
    senses,
    locomotion: [{ mode: 'walk', speed: 1.5 }],
  } satisfies CreatureDefInput);

/** The resolved profile of a creature with `senses`, against the game's sense profiles. */
const resolved = (senses: CreatureDefInput['senses']) =>
  resolveSenses(creature(senses).senses, content);

describeContent('sense', 'passes the schema, round-trips and explains its values', (entry) => {
  expect(senseSchema.parse(JSON.parse(serializeContent(entry)))).toEqual(entry);
  expect(entry.notes.length).toBeGreaterThan(80); // a real explanation of the numbers
  // Referenced as-is by a creature, it resolves to exactly its senses.
  const senses = resolveSenses(creature(entry.id).senses, content);
  expect({ id: entry.id, name: entry.name, notes: entry.notes, ...senses }).toEqual(entry);
});

describe('sense profiles', () => {
  it('AC-1: a primary half-angle wider than the peripheral one fails naming both fields', () => {
    const inverted = { ...sight, primaryHalfAngle: 90, peripheralHalfAngle: 60 };
    const message =
      'sight.primaryHalfAngle: sight.primaryHalfAngle (90°) must not exceed sight.peripheralHalfAngle (60°)';
    expect(problems(senseSchema, { ...profile, sight: inverted })).toEqual([message]);
    expect(problems(senseProfileSchema, { sight: inverted })).toEqual([message]);
    // An inline creature profile is checked the same way, under senses.
    expect(
      problems(creatureSchema, { ...creature('humanoid'), senses: { sight: inverted } }),
    ).toEqual([`senses.${message}`]);
  });

  it('AC-1: a near range beyond the far range fails naming both fields', () => {
    expect(problems(senseSchema, { ...profile, sight: { ...sight, nearRange: 25 } })).toEqual([
      'sight.nearRange: sight.nearRange (25 m) must not exceed sight.farRange (20 m)',
    ]);
  });

  it('AC-2: overriding sight.farRange changes only that field of the base profile', () => {
    const senses = resolved({ base: 'humanoid', sight: { farRange: 30 } });
    expect(senses.sight).toEqual({ ...humanoid.sight, farRange: 30 });
    expect(senses.hearing).toEqual(humanoid.hearing);
    expect(senses).not.toHaveProperty('smell');
    expect(senses).not.toHaveProperty('special');
  });

  it('AC-3: the baseline humanoid sits in the documented tuning band', () => {
    expect(humanoid.sight?.farRange).toBeGreaterThanOrEqual(15);
    expect(humanoid.sight?.farRange).toBeLessThanOrEqual(30);
    expect(humanoid.hearing?.thresholdDb).toBeGreaterThanOrEqual(20);
    expect(humanoid.hearing?.thresholdDb).toBeLessThanOrEqual(40);
    expect(humanoid.notes).toContain('15–30 m');
    expect(humanoid.notes).toContain('20–40 dB');
  });

  it('AC-4: an unknown special-sense channel fails listing the registered channels', () => {
    const message =
      'unknown special sense channel "echolocation"; registered channels: tremor, life-sense, magic-sense';
    expect(SPECIAL_SENSE_CHANNELS).toEqual(['tremor', 'life-sense', 'magic-sense']);
    expect(problems(senseSchema, { ...profile, special: { echolocation: lifeSense } })).toEqual([
      `special.echolocation: ${message}`,
    ]);
    const override = { base: 'humanoid', special: { echolocation: { range: 4 } } };
    expect(problems(creatureSchema, { ...creature('humanoid'), senses: override })).toEqual([
      `senses.special.echolocation: ${message}`,
    ]);
  });

  it('AC-5: negative ranges fail, in profiles and in creature overrides', () => {
    expect(
      problems(senseSchema, {
        ...profile,
        sight: { ...sight, nearRange: -1, farRange: -2 },
        hearing: { thresholdDb: 30, range: -1 },
        smell: { range: -1, windSensitive: true, tracksScentTrails: false },
        special: { tremor: { ...lifeSense, range: -1 } },
      }).map((p) => p.split(':')[0]),
    ).toEqual([
      'sight.nearRange',
      'sight.farRange',
      'hearing.range',
      'smell.range',
      'special.tremor.range',
    ]);
    const override = {
      base: 'humanoid',
      sight: { farRange: -5 },
      special: { tremor: { range: -1 } },
    };
    expect(
      problems(creatureSchema, { ...creature('humanoid'), senses: override }).map(
        (p) => p.split(':')[0],
      ),
    ).toEqual(['senses.sight.farRange', 'senses.special.tremor.range']);
  });

  it('rejects out-of-range angles, factors and thresholds', () => {
    expect(
      problems(senseProfileSchema, {
        sight: { ...sight, verticalHalfAngle: 91, darkVision: 1.5, detectionSpeed: 0 },
        hearing: { thresholdDb: -3, range: 10 },
      }).map((p) => p.split(':')[0]),
    ).toEqual([
      'sight.verticalHalfAngle',
      'sight.darkVision',
      'sight.detectionSpeed',
      'hearing.thresholdDb',
    ]);
  });

  it('an inline profile must be complete and is reported once per problem', () => {
    expect(
      problems(creatureSchema, { ...creature('humanoid'), senses: { sight: { farRange: 20 } } }),
    ).toEqual(
      expect.arrayContaining([
        'senses.sight.nearRange: Invalid input: expected number, received undefined',
      ]) as string[],
    );
    expect(
      problems(creatureSchema, {
        ...creature('humanoid'),
        senses: { sight: { ...sight, farRange: -1 } },
      }),
    ).toEqual(['senses.sight.farRange: Too small: expected number to be >=0']);
  });

  it('baseline profiles fit the canon and the downstream fixtures', () => {
    const beast = content.get('sense', 'beast');
    const undead = content.get('sense', 'undead');
    // e12.3 fixture-sentinel: undead sees in the dark and declares life-sense.
    expect(undead.sight?.darkVision).toBe(1);
    expect(Object.keys(undead.special ?? {})).toEqual(['life-sense']);
    // Undead ignore quiet players (story bible §8): deafer than a guard.
    expect(undead.hearing?.thresholdDb).toBeGreaterThan(humanoid.hearing?.thresholdDb ?? 0);
    // Beasts are hearing and smell dominant.
    expect(beast.hearing?.thresholdDb).toBeLessThan(humanoid.hearing?.thresholdDb ?? 0);
    expect(beast.smell).toMatchObject({ windSensitive: true, tracksScentTrails: true });
    expect(humanoid).not.toHaveProperty('special');
  });
});

describe('resolveSenses merge rules', () => {
  it('null removes a sense: a blind creature built on a sighted base', () => {
    const hushlingLike = resolved({ base: 'beast', sight: null, smell: null });
    expect(hushlingLike).toEqual({ hearing: content.get('sense', 'beast').hearing });
  });

  it('special senses merge channel by channel: add, override fields, remove with null', () => {
    const tremor = {
      range: 6,
      minStrength: 0.2,
      requiresLineOfSight: false,
      requiresMovement: true,
    };
    expect(resolved({ base: 'undead', special: { tremor } }).special).toEqual({
      'life-sense': lifeSense,
      tremor,
    });
    expect(resolved({ base: 'undead', special: { 'life-sense': { range: 5 } } }).special).toEqual({
      'life-sense': { ...lifeSense, range: 5 },
    });
    expect(resolved({ base: 'undead', special: { 'life-sense': null } }).special).toEqual({});
    expect(resolved({ base: 'humanoid', special: { tremor } }).special).toEqual({ tremor });
  });

  it('a sense the base lacks must be given in full', () => {
    const complete = { range: 10, windSensitive: false, tracksScentTrails: false };
    expect(resolved({ base: 'humanoid', smell: complete }).smell).toEqual(complete);
    expect(() => resolved({ base: 'humanoid', smell: { range: 10 } })).toThrow(
      /invalid senses based on sense:humanoid: smell\.windSensitive: .*; smell\.tracksScentTrails/,
    );
  });

  it('a merge that breaks a cross-field rule throws naming both fields', () => {
    const narrow = { base: 'humanoid', sight: { peripheralHalfAngle: 20 } } as const;
    expect(() => resolved(narrow)).toThrow(SenseResolutionError);
    expect(() => resolved(narrow)).toThrow(
      'invalid senses based on sense:humanoid: sight.primaryHalfAngle: sight.primaryHalfAngle (35°) must not exceed sight.peripheralHalfAngle (20°)',
    );
  });

  it('an inline profile resolves to itself, with null senses dropped', () => {
    const special = { 'magic-sense': { ...lifeSense, range: 12 } };
    expect(resolved({ sight, hearing: null, special })).toEqual({ sight, special });
  });

  it('returns a fresh, unfrozen profile each time', () => {
    const a = resolved('humanoid');
    expect(Object.isFrozen(a)).toBe(false);
    expect(a.sight).not.toBe(humanoid.sight);
    expect(resolved('humanoid')).not.toBe(a);
  });
});
