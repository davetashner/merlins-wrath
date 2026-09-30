// Environmental damage tuning (mw-e04.19, mw-e02.15): the numbers behind falls, crushing objects and
// hazards. The sim (src/sim/combat/environment) turns each into a DamagePacket tagged `environment`
// that resolves through the same damage model as a sword, so these are the only numbers that make
// the world a weapon. One file per rule set, `src/content/data/environment-damage/<id>.json`; the
// game uses `default`.
//
// Falls are measured as the height of an equivalent drop, impact speed² / (2 × the character's
// gravity), so a fall, a launch slammed into the ground and a blast into a wall share one curve, and
// "a 9 m drop" means the same thing whatever gravity the controller is tuned to.
//
// Units: metres, metres per second, joules, damage points per second, milliseconds.

import { z } from 'zod';
import { contentId } from '../schema.ts';
import { DAMAGE_TYPES } from './damage.ts';

/** Id of the rule set the game uses. */
export const DEFAULT_ENVIRONMENT_DAMAGE_ID = 'default';

/** Boolean world properties that make an entity a hazard to creatures near it. */
export const HAZARD_PROPERTIES = ['burning'] as const;

/** A hazard property. */
export type HazardProperty = (typeof HAZARD_PROPERTIES)[number];

const metres = z.number().positive().max(100);

const fallSchema = z
  .strictObject({
    safeHeight: z
      .number()
      .min(0)
      .max(100)
      .describe('Equivalent drop at or below which a landing does no damage, m.'),
    lethalHeight: metres.describe(
      'Equivalent drop that deals 100% of max health, m; damage rises linearly from safeHeight. Above safeHeight.',
    ),
    deepWater: metres.describe('Landing in liquid at least this deep takes no fall damage, m.'),
  })
  .describe(
    'Fall and wall-impact damage: a fraction of max health from the equivalent drop height. Soft ground (impactAbsorb) takes off its share.',
  );

const kineticSchema = z
  .strictObject({
    minSpeed: z
      .number()
      .min(0)
      .max(100)
      .describe('Relative speed a physics object must exceed to hurt a creature it strikes, m/s.'),
    joulesPerPoint: z
      .number()
      .positive()
      .describe('Blunt damage = ½·m·v² / joulesPerPoint (kinetic energy of the strike, J).'),
  })
  .describe('Falling and thrown physics objects striking creatures.');

const hazardSchema = z
  .strictObject({
    when: z
      .enum(HAZARD_PROPERTIES)
      .describe('The boolean world property that makes an entity this hazard (e.g. burning).'),
    perSecond: z
      .partialRecord(z.enum(DAMAGE_TYPES), z.number().positive())
      .describe('Damage per second, per damage type, to a creature within reach.'),
    reach: z
      .number()
      .min(0)
      .max(10)
      .describe('How far beyond the hazard entity’s bounding sphere it hurts, m.'),
    pulseMs: z
      .int()
      .positive()
      .max(1000)
      .describe('Damage lands in pulses this far apart, whole ms (perSecond × pulse length each).'),
  })
  .describe('A hazard volume: anything with the property hurts creatures that overlap it.');

/** Every tuning value the environmental damage rules read (a rule set without id, name, notes). */
const tuningShape = {
  fall: fallSchema,
  kinetic: kineticSchema,
  hazards: z.array(hazardSchema).describe('Hazard volumes, by the property that makes them.'),
};

type TuningFields = z.output<z.ZodObject<typeof tuningShape>>;

function checkTuning(t: TuningFields, ctx: z.RefinementCtx): void {
  if (t.fall.lethalHeight <= t.fall.safeHeight) {
    ctx.addIssue({
      code: 'custom',
      path: ['fall', 'lethalHeight'],
      message: 'fall.lethalHeight must be above fall.safeHeight',
    });
  }
  t.hazards.forEach((hazard, i) => {
    if (Object.keys(hazard.perSecond).length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['hazards', i, 'perSecond'],
        message: 'a hazard must deal at least one damage type',
      });
    }
  });
}

/** Environmental damage tuning without the entry fields: what the sim reads. */
export const environmentDamageTuningSchema = z.strictObject(tuningShape).superRefine(checkTuning);

/** Validated environmental damage tuning (the sim reads it frozen). */
export type EnvironmentDamageTuning = z.output<typeof environmentDamageTuningSchema>;

/** One rule set: `src/content/data/environment-damage/<id>.json`. */
export const environmentDamageSchema = z
  .strictObject({
    id: contentId.describe('Rule set id, e.g. "default".'),
    name: z.string().min(1).describe('Display name (debug tools and docs).'),
    notes: z
      .string()
      .min(1)
      .describe('Why these values (design targets, references), for owner review.'),
    ...tuningShape,
  })
  .superRefine(checkTuning);

/** A rule set as written in a data file. */
export type EnvironmentDamageDefInput = z.input<typeof environmentDamageSchema>;
/** A loaded rule set. */
export type EnvironmentDamageDef = z.output<typeof environmentDamageSchema>;
