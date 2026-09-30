// Targetables (mw-e02.16): what the player can lock on to, and where on it the lock sits. A
// targetable is a profile, not a kind of thing: creatures, shootable mechanisms and interactables
// flagged lockable (a distant bell an archer wants to hit) all name one. Scenes give a spawn one with
// `targetable`; creatures will reference one from their own data. One file per profile,
// `src/content/data/targetable/<id>.json`.
//
// Lock points are offsets from the entity's origin (its feet or base), metres, in world axes; the
// first is where the lock and the HUD marker sit, the others are fallbacks line of sight may use when
// the first is hidden (a head above a low wall). Weak-point targeting on bows is separate (e05).

import { z } from 'zod';
import { contentId } from '../schema.ts';
import { vec3Schema } from './kit.ts';

const lockPointSchema = z.strictObject({
  id: contentId.describe('Name of the point, unique on the profile (e.g. "chest").'),
  at: vec3Schema.describe('Offset from the entity’s origin, metres (x, y, z).'),
});

export const targetableSchema = z
  .strictObject({
    id: contentId,
    name: z.string().min(1).describe('Display name (debug tools and docs).'),
    points: z
      .array(lockPointSchema)
      .min(1)
      .max(8)
      .describe('Lock points; the first is the main one (the lock and HUD marker sit there).'),
    priority: z
      .number()
      .int()
      .min(-10)
      .max(10)
      .default(0)
      .describe(
        'Pick preference: higher is picked over a lower one at a similar angle and distance (a bell is lower than a foe).',
      ),
  })
  .superRefine((profile, ctx) => {
    const seen = new Set<string>();
    profile.points.forEach((point, index) => {
      if (seen.has(point.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['points', index, 'id'],
          message: `lock point "${point.id}" is named twice`,
        });
      }
      seen.add(point.id);
    });
  });

/** The training dummies' profile: the room's and arena's dummies and the combat sandbox's. */
export const TRAINING_DUMMY_TARGETABLE_ID = 'training-dummy';

/** A targetable profile as written in a data file. */
export type TargetableDefInput = z.input<typeof targetableSchema>;
/** A loaded targetable profile. */
export type TargetableDef = z.output<typeof targetableSchema>;
