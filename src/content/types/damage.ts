// Damage-model schema fragments (mw-e04.1). The sim's damage model (src/sim/combat/damage) resolves
// every hit — swords, arrows, spells, falling rocks — through one rule set, so the data that feeds it
// (damage types, resistance multipliers, poise tuning) is defined once here and reused by every
// content type that describes something that can be hurt: creatures today (e12.1), arrows (e05.1),
// attack moves (e04.3) and breakables (e03.11) later. This is a fragment module, not a content type:
// it has no data folder of its own.

import { z } from 'zod';

/** Damage types of the damage model, in canonical (breakdown) order. */
export const DAMAGE_TYPES = [
  'slash',
  'pierce',
  'blunt',
  'fire',
  'frost',
  'shock',
  'arcane',
  'poison',
] as const;

/** One damage type. */
export type DamageTypeName = (typeof DAMAGE_TYPES)[number];

/** The largest resistance multiplier (3 = takes triple damage). */
export const MAX_RESISTANCE = 3;

/**
 * Resistance multipliers per damage type, 0–3 (0 immune, below 1 resists, above 1 vulnerable);
 * unlisted types take 1. Unknown damage types fail validation at this map's path.
 */
export const resistancesSchema = z
  .partialRecord(z.enum(DAMAGE_TYPES), z.number().min(0).max(MAX_RESISTANCE))
  .prefault({})
  .describe(
    'Damage multiplier per damage type, 0–3: 0 = immune, below 1 resists, above 1 vulnerable. ' +
      'Unlisted types take 1.',
  );

/** Poise regeneration tuning; the defaults are the damage model's (2 s pause, then 25% of max/s). */
export const poiseRegenSchema = z
  .strictObject({
    delayTicks: z
      .int()
      .nonnegative()
      .default(120)
      .describe('Sim ticks (60 Hz) without poise damage before poise starts to regenerate.'),
    percentPerSecond: z
      .number()
      .min(0)
      .max(100)
      .default(25)
      .describe('Poise regained per second once regenerating, as a percentage of max poise.'),
  })
  .prefault({})
  .describe('How poise recovers after poise damage.');
