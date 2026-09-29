// The shield content type (mw-e04.6): what a raised shield does to a hit, one file per shield at
// `src/content/data/shield/<id>.json`. The sim's guard rule (src/sim/combat/guard) reads the compiled
// form: a hit that lands inside the shield's frontal arc once it has been raised long enough loses
// `absorption` percent of each damage type, and drains the blocker's stamina by the hit's stamina
// damage × (1 − stability / 100). Running out of stamina on a block is a guard break.
//
// Units: percentages 0–100, sim ticks (60 Hz), degrees. The field reference in
// docs/content/shield-schema.md is generated (`pnpm content:docs`).

import { z } from 'zod';
import type { Frozen } from '../loader.ts';
import { contentId } from '../schema.ts';
import { DAMAGE_TYPES, type DamageTypeName } from './damage.ts';

/** The knight's starting shield. */
export const KNIGHT_SHIELD_ID = 'wood-shield';

const percent = z.number().min(0).max(100);

/** Schema of one shield file, `src/content/data/shield/<id>.json`. */
export const shieldSchema = z.strictObject({
  id: contentId.describe('Unique shield id, e.g. "wood-shield".'),
  name: z.string().min(1).describe('Player-facing name.'),
  notes: z.string().min(1).describe('What the shield is for, and where its numbers come from.'),
  absorption: z
    .partialRecord(z.enum(DAMAGE_TYPES), percent)
    .describe(
      'Percentage of each damage type a blocked hit loses, 0–100; unlisted types pass through ' +
        '(0%). The rest of the hit (the unabsorbed remainder) still lands.',
    ),
  stability: percent.describe(
    'Stamina a block saves, 0–100: the blocker loses the hit’s staminaDamage × (1 − stability/100).',
  ),
  raiseTicks: z
    .int()
    .nonnegative()
    .max(60)
    .describe('Sim ticks (60 Hz) the shield must be held up before it blocks (6 = 100 ms).'),
  arcDegrees: z
    .number()
    .positive()
    .max(360)
    .describe('Width of the frontal arc the shield covers, degrees, centred on the facing.'),
  moveSpeedScale: z
    .number()
    .min(0)
    .max(1)
    .describe('Movement speed while the shield is up, as a fraction of the run speed (0–1).'),
});

/** A shield as written in JSON. */
export type ShieldDefInput = z.input<typeof shieldSchema>;
/** A validated shield. */
export type ShieldDef = z.output<typeof shieldSchema>;
/** A loaded (deeply frozen) shield. */
export type ShieldEntry = Frozen<ShieldDef>;

/** A shield as the sim's guard rule reads it. */
export interface RuntimeShield {
  readonly id: string;
  /** Absorbed percentage per damage type (0–100); unlisted types 0. */
  readonly absorption: Readonly<Partial<Record<DamageTypeName, number>>>;
  readonly stability: number;
  readonly raiseTicks: number;
  readonly arcDegrees: number;
  readonly moveSpeedScale: number;
}

/** The runtime form of one loaded shield (plain, frozen data). */
export function compileShield(shield: ShieldEntry): RuntimeShield {
  return Object.freeze({
    id: shield.id,
    absorption: Object.freeze({ ...shield.absorption }),
    stability: shield.stability,
    raiseTicks: shield.raiseTicks,
    arcDegrees: shield.arcDegrees,
    moveSpeedScale: shield.moveSpeedScale,
  });
}
