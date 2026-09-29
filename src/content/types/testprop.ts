// Example content type (mw-e00.18): a grey-box test prop. It exists to prove the content pipeline end
// to end (schema, JSON files, cross-reference, per-entry tests) before real types arrive (spells e06,
// creatures e12, items e17…). Game code must not depend on it, except that scenes spawn props with a
// `body` as physics objects (mw-e03.39) until real prop types replace it.

import { z } from 'zod';
import { contentId, ref } from '../schema.ts';

/**
 * A movable prop's rigid body (mw-e03.39): scenes spawn it as a physics object (src/sim/physics)
 * that falls, stacks and can be pushed. Its weight is the prop's `mass`; friction, bounciness and
 * impact sound come from `material`.
 */
export const testPropBodySchema = z.strictObject({
  size: z
    .tuple([z.number().positive(), z.number().positive(), z.number().positive()])
    .describe('Box size along x, y, z in metres; the spawn point is the middle of its base.'),
  material: ref('material').describe('Material preset (world properties) of the body.'),
});

export const testPropSchema = z.strictObject({
  id: contentId,
  name: z.string().min(1).describe('Display name for debug overlays.'),
  mass: z.number().positive().describe('Mass in kilograms.'),
  flammable: z.boolean().describe('World property: fire can ignite it.'),
  tags: z.array(z.string()).default([]).describe('Free-form tags for grey-box scenes.'),
  breaksInto: ref('testprop').optional().describe('Id of the testprop left when this one breaks.'),
  body: testPropBodySchema
    .optional()
    .describe('Makes the prop a movable physics object; without one it stays put.'),
});
