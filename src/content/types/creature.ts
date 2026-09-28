// The creature content type (mw-e12.1): one validated CreatureDef envelope shared by AI, stealth,
// combat and the bestiary (constitution: enemies are creatures, not target dummies, and they are
// data). Only id, family, stats, senses and locomotion are required; every other section has a
// documented default filled at load, so later items (senses e12.2, attacks e12.5, locomotion e12.6,
// resistances e04.1/e12.7, factions e12.8, fears e12.10, personality e12.11, needs e12.12…) can
// extend their stub sub-schema here without touching existing creature files. The field reference
// in docs/content/creature-schema.md is generated from this file (`pnpm content:docs`).
//
// Units: metres, kilograms, degrees, metres per second. Anything timed in ticks says so in its name.

import { z } from 'zod';
import { contentId, ref } from '../schema.ts';

/** Current CreatureDef schema version; bump it (and add a migration) on breaking changes. */
export const CREATURE_SCHEMA_VERSION = 1;

/** Creature families, from the MVP roster (story bible §8) plus humans and ambient animals. */
export const CREATURE_FAMILIES = [
  'forgotten',
  'rootcellar-goblin',
  'hornfolk',
  'loom-spider',
  'briar-wolf',
  'hushling',
  'tallow-ooze',
  'mimic',
  'hollow-sentinel',
  'wraith',
  'human',
  'animal',
] as const;

/** Size classes, smallest first (used for grabs, knockback, hiding spots and nav agent radius). */
export const SIZE_CLASSES = ['tiny', 'small', 'medium', 'large', 'huge'] as const;

/** Damage types of the damage model (e04.1). */
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

/** Locomotion modes (e12.6). `stationary` is how a creature that never moves declares it. */
export const LOCOMOTION_MODES = [
  'walk',
  'climb',
  'fly',
  'swim',
  'burrow',
  'wallcrawl',
  'stationary',
] as const;

/** Stances one creature takes toward another or toward the player (e12.8). */
export const STANCES = [
  'ally',
  'friendly',
  'neutral',
  'wary',
  'hostile',
  'prey',
  'predator',
] as const;

/** Personality traits (e12.11), each 0–1. */
export const PERSONALITY_TRAITS = [
  'bravery',
  'curiosity',
  'aggression',
  'diligence',
  'sociability',
  'greed',
] as const;

const metres = z.number().nonnegative();
const unit = z.number().min(0).max(1);

const statsSchema = z
  .strictObject({
    health: z.int().positive().describe('Maximum health.'),
    poise: z
      .int()
      .nonnegative()
      .describe('Maximum poise; poise damage beyond it staggers the creature (0 = any hit).'),
    mass: z.number().positive().describe('Mass in kilograms (knockback, grabs, pressure plates).'),
    size: z.enum(SIZE_CLASSES).describe('Size class.'),
  })
  .describe('Core stats.');

/** Inline sense profile (stub; e12.2 owns the full sub-schema and the reusable `sense` profiles). */
export const senseProfileSchema = z.strictObject({
  sight: z
    .strictObject({
      range: metres.describe('Far sight range in metres.'),
      halfAngle: z.number().min(0).max(180).describe('Sight cone half-angle in degrees.'),
    })
    .optional()
    .describe('Absent = blind.'),
  hearing: z
    .strictObject({
      thresholdDb: z.number().describe('Quietest sound it hears, in dB at the listener.'),
      range: metres.describe('Hearing range cap in metres.'),
    })
    .optional()
    .describe('Absent = deaf.'),
  smell: z
    .strictObject({ range: metres.describe('Smell range in metres.') })
    .optional()
    .describe('Absent = no sense of smell.'),
});

const locomotionSchema = z
  .array(
    z.strictObject({
      mode: z.enum(LOCOMOTION_MODES).describe('How it moves.'),
      speed: metres.describe('Top speed in this mode, metres per second (0 when stationary).'),
    }),
  )
  .min(1)
  .refine((modes) => new Set(modes.map((m) => m.mode)).size === modes.length, {
    message: 'each locomotion mode may appear only once',
  })
  .describe('Locomotion modes (stub; e12.6 adds gaits, step/jump heights and nav permissions).');

const fearSchema = z.strictObject({
  kind: z.enum(['property', 'faction', 'event']).describe('What kind of stimulus it fears.'),
  stimulus: contentId.describe('The world property, faction id or event name, e.g. "burning".'),
  intensity: z.int().min(0).max(100).describe('Morale lost per perceived stimulus, 0–100.'),
});

const needSchema = z.strictObject({
  ratePerMinute: z.number().nonnegative().describe('Need gained per sim minute, 0–100 scale.'),
  threshold: z.number().min(0).max(100).describe('Need level that emits the need intent.'),
});

const personalityShape = Object.fromEntries(
  PERSONALITY_TRAITS.map((trait) => [trait, unit.default(0.5).describe(`${trait}, 0–1.`)]),
) as Record<(typeof PERSONALITY_TRAITS)[number], z.ZodDefault<z.ZodNumber>>;

/** Schema of one creature file, `src/content/data/creature/<id>.json`. */
export const creatureSchema = z.strictObject({
  id: contentId.describe(
    'Unique creature id, e.g. "forgotten-miner". Stable once shipped (saves).',
  ),
  schemaVersion: z
    .literal(CREATURE_SCHEMA_VERSION)
    .default(CREATURE_SCHEMA_VERSION)
    .describe('CreatureDef schema version, for future migrations.'),
  family: z.enum(CREATURE_FAMILIES).describe('Creature family (story bible §8).'),
  tags: z
    .array(contentId)
    .prefault([])
    .describe('Free-form tags read by AI and quests, e.g. "leader", "undead".'),
  stats: statsSchema,
  senses: z
    .union([ref('sense'), senseProfileSchema])
    .describe('A `sense` profile id, or an inline sense profile.'),
  locomotion: locomotionSchema,
  attacks: z
    .array(ref('attack'))
    .prefault([])
    .describe('Attack ids it can use (e12.5); none = it never attacks.'),
  properties: z
    .array(contentId)
    .prefault([])
    .describe('World-property tags (e03), e.g. "flammable", "conductive".'),
  resistances: z
    .partialRecord(z.enum(DAMAGE_TYPES), z.number().min(0).max(3))
    .prefault({})
    .describe(
      'Damage multiplier per damage type, 0–3: 0 = immune, below 1 resists, above 1 vulnerable. ' +
        'Unlisted types take 1.',
    ),
  faction: contentId
    .default('unaligned')
    .describe('Faction id (e12.8); "unaligned" = belongs to no faction.'),
  disposition: z
    .strictObject({
      towardPlayer: z
        .enum(STANCES)
        .default('hostile')
        .describe('Starting stance toward the player.'),
    })
    .prefault({})
    .describe('Default disposition; spawn points and runtime state can override it.'),
  fears: z.array(fearSchema).prefault([]).describe('Stimuli that lower its morale (e12.10).'),
  personality: z
    .strictObject(personalityShape)
    .prefault({})
    .describe('Personality trait defaults (e12.11).'),
  needs: z
    .record(contentId, needSchema)
    .prefault({})
    .describe('Needs by id, e.g. "hunger", "sleep", "fatigue" (e12.12); none = no needs.'),
  behaviour: z
    .strictObject({
      profile: contentId.default('default').describe('Behaviour profile id (E11).'),
      tuning: z
        .record(z.string().min(1), z.number())
        .prefault({})
        .describe('Numeric overrides of the profile’s tuning values.'),
    })
    .prefault({})
    .describe('Behaviour profile and tuning overrides.'),
  interactions: z
    .array(contentId)
    .prefault([])
    .describe('Non-hostile affordances offered to the player, e.g. "feed", "talk", "pet".'),
  loot: contentId.optional().describe('Loot table id (E18); absent = drops only what it carries.'),
  presentation: z
    .strictObject({
      mesh: contentId.default('placeholder-capsule').describe('Mesh id; grey-box capsule default.'),
      sfx: contentId.default('placeholder').describe('SFX set id.'),
    })
    .prefault({})
    .describe('Render and audio bindings.'),
});

/** A CreatureDef as written in JSON (optional sections may be omitted). */
export type CreatureDefInput = z.input<typeof creatureSchema>;
/** A validated CreatureDef with every default filled and refs parsed. */
export type CreatureDef = z.output<typeof creatureSchema>;
