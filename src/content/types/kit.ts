// Greybox level kit (mw-e00.21): the modular primitives scenes are blocked out with (floor, wall,
// ramp, stairs, pillar, doorway, platform, crate). A piece is one or more parts (boxes, and wedges for
// slopes) placed relative to the piece's origin, which sits on the floor (y = 0) at the centre of its
// footprint, so pieces snap together on the scene grid. Each piece has a purpose that decides its
// colour-coded greybox material (walkable, blocking, climbable, interactive, hazard); a placement may
// override it (a floor tile marked as a hazard). Parts are solid unless `collider` is false.

import { z } from 'zod';
import { contentId } from '../schema.ts';

/** What a surface is for; drives the greybox colour code (style: see src/render/greybox). */
export const KIT_PURPOSES = ['walkable', 'blocking', 'climbable', 'interactive', 'hazard'] as const;
export type KitPurpose = (typeof KIT_PURPOSES)[number];

/**
 * Part shapes. `box` is an axis-aligned box. `wedge` is a ramp: its bounding box is `size`, and its
 * top face rises from the bottom at -z to the top at +z.
 */
export const KIT_SHAPES = ['box', 'wedge'] as const;
export type KitShape = (typeof KIT_SHAPES)[number];

/** Three numbers: x, y, z (metres, or grid cells where a schema says so). */
export const vec3Schema = z.tuple([z.number(), z.number(), z.number()]);
const positiveVec3 = z.tuple([z.number().positive(), z.number().positive(), z.number().positive()]);

export const kitPartSchema = z.strictObject({
  shape: z.enum(KIT_SHAPES).default('box').describe('box, or wedge (a ramp rising towards +z).'),
  size: positiveVec3.describe('Size of the part along x, y, z in metres (before placement scale).'),
  offset: vec3Schema
    .default([0, 0, 0])
    .describe(
      "Centre of the part relative to the piece's origin (floor, footprint centre), metres.",
    ),
  collider: z
    .boolean()
    .default(true)
    .describe('Whether the part is solid (gets a static collider).'),
});

export const kitSchema = z.strictObject({
  id: contentId,
  name: z.string().min(1).describe('Display name in tools and debug overlays.'),
  purpose: z
    .enum(KIT_PURPOSES)
    .describe('Default purpose (greybox colour); a scene placement may override it.'),
  parts: z.array(kitPartSchema).min(1).describe('The shapes the piece is made of.'),
});

export type KitDef = z.output<typeof kitSchema>;
export type KitDefInput = z.input<typeof kitSchema>;
export type KitPartDef = z.output<typeof kitPartSchema>;
