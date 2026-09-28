import { describe, expect, it } from 'vitest';
import { ContentLoadError, loadContent } from '../loader.ts';
import { contentTypes } from '../registry.ts';
import { creatureSchema } from './creature.ts';
import { DAMAGE_TYPES, poiseRegenSchema, resistancesSchema } from './damage.ts';

const creature = {
  id: 'fixture-forgotten',
  family: 'forgotten',
  stats: { health: 60, poise: 30, mass: 60, size: 'medium' },
  senses: {
    sight: {
      nearRange: 6,
      farRange: 15,
      primaryHalfAngle: 30,
      peripheralHalfAngle: 60,
      verticalHalfAngle: 40,
      darkVision: 1,
      detectionSpeed: 1,
    },
  },
  locomotion: {
    agent: { radius: 0.35, height: 1.8 },
    modes: {
      walk: {
        speeds: { sneak: 1, walk: 1.2, run: 3 },
        stepHeight: 0.4,
        maxSlope: 45,
        jumpHeight: 0.5,
        maxDrop: 2,
        wadeDepth: 1,
      },
    },
  },
};

describe('damage schema fragments', () => {
  it('AC-7: unknown damage types or multipliers outside [0, 3] fail with the offending JSON path', () => {
    const text = JSON.stringify({
      ...creature,
      resistances: { blunt: 1.5, pierce: -0.5, fire: 3.01, holy: 1 },
    });
    let error: unknown;
    try {
      loadContent(contentTypes, [{ path: 'creature/fixture-forgotten.json', text }]);
    } catch (thrown) {
      error = thrown;
    }
    expect(error).toBeInstanceOf(ContentLoadError);
    const issues = (error as ContentLoadError).issues.map((issue) => issue.pointer);
    expect(issues).toEqual(['/resistances/pierce', '/resistances/fire', '/resistances']);
    expect((error as ContentLoadError).message).toMatch(/holy/);
  });

  it('accepts the Forgotten resistances and fills poise regen defaults', () => {
    const parsed = creatureSchema.parse({
      ...creature,
      resistances: { blunt: 1.5, pierce: 0.5, poison: 0 },
    });
    expect(parsed.resistances).toEqual({ blunt: 1.5, pierce: 0.5, poison: 0 });
    expect(parsed.poiseRegen).toEqual({ delayTicks: 120, percentPerSecond: 25 });
  });

  it('validates the fragments on their own', () => {
    expect(DAMAGE_TYPES).toHaveLength(8);
    expect(resistancesSchema.parse(undefined)).toEqual({});
    expect(resistancesSchema.parse({ arcane: 0, shock: 3 })).toEqual({ arcane: 0, shock: 3 });
    expect(poiseRegenSchema.parse({ percentPerSecond: 50 })).toEqual({
      delayTicks: 120,
      percentPerSecond: 50,
    });
    const bad = poiseRegenSchema.safeParse({ delayTicks: 1.5, percentPerSecond: 101 });
    expect(bad.error?.issues.map((issue) => issue.path.join('.'))).toEqual([
      'delayTicks',
      'percentPerSecond',
    ]);
  });
});
