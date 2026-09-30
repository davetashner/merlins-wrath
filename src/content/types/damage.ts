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

/**
 * Hit reactions the sim chooses (mw-e04.7), weakest first: none (hyperarmor absorbed it, or it
 * carried no poise damage or push), flinch, stagger, knockback, knockdown.
 */
export const HIT_REACTION_KINDS = ['none', 'flinch', 'stagger', 'knockback', 'knockdown'] as const;

/** A hit reaction. */
export type HitReactionKind = (typeof HIT_REACTION_KINDS)[number];

/** The reactions a hit can cause, which a creature may replace (every kind but none). */
export const HIT_REACTION_TIERS = ['flinch', 'stagger', 'knockback', 'knockdown'] as const;

/** A reaction tier. */
export type HitReactionTier = (typeof HIT_REACTION_TIERS)[number];

/** Which side of the victim a hit came from, relative to its facing (mw-e04.7). */
export const HIT_DIRECTIONS = ['front', 'back', 'left', 'right'] as const;

/** A hit direction quadrant. */
export type HitDirection = (typeof HIT_DIRECTIONS)[number];

/**
 * The hit-reaction defaults (mw-e04.7). `knockbackImpulse` comes from the bead; `knockdownImpulse`
 * and `launchSpeed` are placeholder tuning until the combat sandbox (e04.9) tunes them.
 */
export const HIT_REACTION_DEFAULTS = Object.freeze({
  knockbackImpulse: 300,
  knockdownImpulse: 900,
  launchSpeed: 2,
});

/** How a creature reacts to hits: the impulse thresholds and any replaced tiers. */
export const hitReactionsSchema = z
  .strictObject({
    knockbackImpulse: z
      .number()
      .positive()
      .default(HIT_REACTION_DEFAULTS.knockbackImpulse)
      .describe('Hit impulse (N·s) at or above which a hit knocks it back (60 ticks, pushed).'),
    knockdownImpulse: z
      .number()
      .positive()
      .default(HIT_REACTION_DEFAULTS.knockdownImpulse)
      .describe(
        'Hit impulse (N·s) at or above which a hit knocks it down (90 ticks grounded, then ' +
          '20 invulnerable wake-up ticks). Placeholder until the combat sandbox tunes it.',
      ),
    launchSpeed: z
      .number()
      .nonnegative()
      .default(HIT_REACTION_DEFAULTS.launchSpeed)
      .describe(
        'Upward speed (m/s) a knockback or knockdown adds so the push leaves the ground and ' +
          'carries it over ledges. Placeholder until the combat sandbox tunes it.',
      ),
    replace: z
      .partialRecord(z.enum(HIT_REACTION_TIERS), z.enum(HIT_REACTION_KINDS))
      .prefault({})
      .describe(
        'Reactions it never takes, each replaced by another, e.g. a troll that is never knocked ' +
          'down: {"knockdown": "knockback"}.',
      ),
  })
  .prefault({})
  .describe('How it reacts to hits: flinch, stagger, knockback and knockdown (mw-e04.7).');
