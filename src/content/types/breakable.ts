// Breakable profiles (mw-e03.11): how a kind of breakable thing — a cracked old wall, a wooden
// barricade, pottery, a crate — takes hits. A profile is not a kind of object: scenes give a
// placement or a spawn one with `breakable`, and the thing's hit points and impact threshold stay
// world properties (`hp`, `fragile`) its material and placement set. The sim's breakables
// (src/sim/breakables) read the profile; nothing checks what hit it, only the kind of hit (blunt,
// slash, pierce, force), so a knight, an arrow, a spell or a rolling boulder all count.
// One file per profile, `src/content/data/breakable/<id>.json`.

import { z } from 'zod';
import { contentId } from '../schema.ts';

/** Kinds of hit a breakable resists (the sim's BREAK_TYPES). */
export const BREAK_KINDS = ['blunt', 'slash', 'pierce', 'force'] as const;

const share = z.number().min(0).max(1);

export const breakableSchema = z.strictObject({
  id: contentId,
  name: z.string().min(1).describe('Display name (debug tools and docs).'),
  notes: z
    .string()
    .min(1)
    .describe('Where the numbers come from (bead, design intent), for owner review.'),
  resistances: z
    .strictObject({
      blunt: share.optional().describe('Share of blunt damage ignored.'),
      slash: share.optional().describe('Share of slash damage ignored.'),
      pierce: share.optional().describe('Share of pierce damage ignored.'),
      force: share.optional().describe('Share of a shove (force) ignored.'),
    })
    .default({})
    .describe(
      'Share of each kind of hit the structure ignores, 0 (none) … 1 (immune); a kind left out is 0.',
    ),
  debris: z
    .strictObject({
      count: z.int().min(0).max(16).describe('Pieces of debris a break leaves.'),
      size: z.number().positive().max(1).describe('Edge of each piece, metres.'),
    })
    .describe('Debris a break leaves, made of the broken thing’s material (budgeted by the sim).'),
  breakLoudness: z
    .number()
    .min(0)
    .max(140)
    .describe('Noise of the break 1 m away, dB (stealth and AI hearing).'),
  crack: z
    .boolean()
    .default(false)
    .describe('Telegraphs a weak spot: the renderer draws cracks on it so a player can spot it.'),
});

/** A breakable profile as written in a data file. */
export type BreakableDefInput = z.input<typeof breakableSchema>;
/** A loaded breakable profile. */
export type BreakableDef = z.output<typeof breakableSchema>;
