// Example content type (mw-e00.18): a grey-box test prop. It exists to prove the content pipeline end
// to end (schema, JSON files, cross-reference, per-entry tests) before real types arrive (spells e06,
// creatures e12, items e17…). Game code must not depend on it.

import { z } from 'zod';
import { contentId, ref } from '../schema.ts';

export const testPropSchema = z.strictObject({
  id: contentId,
  name: z.string().min(1).describe('Display name for debug overlays.'),
  mass: z.number().positive().describe('Mass in kilograms.'),
  flammable: z.boolean().describe('World property: fire can ignite it.'),
  tags: z.array(z.string()).default([]).describe('Free-form tags for grey-box scenes.'),
  breaksInto: ref('testprop').optional().describe('Id of the testprop left when this one breaks.'),
});
