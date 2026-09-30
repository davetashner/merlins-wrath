// The hit-stop content type (mw-e04.11): how long a hit freezes attacker and victim, per hit tier, one
// file per table at `src/content/data/hit-stop/<id>.json` (the game has one, `hit-stop`). A move
// names its tier (`hitStop` in move.ts; a hitting move without one is `light`); a parry (e04.12) and
// a riposte or critical (e04.12) use theirs. The sim's hit-stop rule (src/sim/combat/hitstop) reads
// the compiled form and freezes both entities' local time for that many ticks.
//
// Units: sim ticks (60 Hz): 3 ticks = 50 ms. The field reference in docs/content/hit-stop-schema.md
// is generated (`pnpm content:docs`).

import { z } from 'zod';
import type { Frozen } from '../loader.ts';
import { contentId } from '../schema.ts';

/** The game's hit-stop table (`src/content/data/hit-stop/hit-stop.json`). */
export const HIT_STOP_ID = 'hit-stop';

/**
 * Hit tiers, lightest first: a light attack, a heavy, a charged heavy, a parry's deflection and a
 * riposte or critical hit.
 */
export const HIT_STOP_TIERS = ['light', 'heavy', 'charged', 'parry', 'critical'] as const;

/** A hit tier. */
export type HitStopTier = (typeof HIT_STOP_TIERS)[number];

/** The most a single hit may freeze an entity: 30 ticks, half a second. */
export const MAX_HIT_STOP_TICKS = 30;

const freeze = z
  .int()
  .nonnegative()
  .max(MAX_HIT_STOP_TICKS)
  .describe('Sim ticks attacker and victim are frozen (0 = no hit-stop), at most 30.');

/** Schema of one hit-stop file, `src/content/data/hit-stop/<id>.json`. */
export const hitStopSchema = z.strictObject({
  id: contentId.describe('Unique table id; the game reads "hit-stop".'),
  notes: z.string().min(1).describe('Where the numbers come from (bead, tuning status).'),
  ticks: z
    .strictObject({
      light: freeze.describe('A light attack (the default tier of a hitting move).'),
      heavy: freeze.describe('A heavy attack.'),
      charged: freeze.describe('A charged heavy.'),
      parry: freeze.describe('A parry deflecting an attack (both fighters).'),
      critical: freeze.describe('A riposte or other critical hit.'),
    } satisfies Record<HitStopTier, typeof freeze>)
    .describe(
      'Freeze length per hit tier, sim ticks: light, heavy, charged, parry and critical (a ' +
        'riposte). Overlapping freezes take the longest, never the sum.',
    ),
});

/** A hit-stop table as written in JSON. */
export type HitStopDefInput = z.input<typeof hitStopSchema>;
/** A validated hit-stop table. */
export type HitStopDef = z.output<typeof hitStopSchema>;
/** A loaded (deeply frozen) hit-stop table. */
export type HitStopEntry = Frozen<HitStopDef>;

/** Freeze ticks per hit tier, as the sim's hit-stop rule reads them. */
export type HitStopTable = Readonly<Record<HitStopTier, number>>;

/** The runtime form of one loaded hit-stop table (plain, frozen data). */
export function compileHitStop(table: HitStopEntry): HitStopTable {
  return Object.freeze({ ...table.ticks });
}
