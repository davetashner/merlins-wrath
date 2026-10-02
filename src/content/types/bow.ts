// The bow content type (mw-e05.3): how a bow draws, holds and looses, one file per bow at
// `src/content/data/bow/<id>.json`. The sim's bow rule (src/sim/combat/bow) reads the compiled form:
// holding fire draws for `fullDrawTicks`; a release launches the nocked arrow at a speed that lerps
// from `minLaunchFraction` to all of `maxLaunchSpeed` by how far the bow was drawn; a release before
// `minDrawTicks` cancels the shot and returns the arrow. Starting a draw costs `drawStaminaCost`, and
// holding full draw past `holdTicks` drains `holdDrainPerSecond` until the draw collapses at 0.
// While drawn the archer walks at `walkScale` of its speed. `aim` is presentation: the camera's
// field of view while drawn (the orbit camera's over-shoulder view narrows to it).
//
// Units: sim ticks (60 Hz), m/s, stamina points and points per second, degrees, seconds. The field
// reference in docs/content/bow-schema.md is generated (`pnpm content:docs`).

import { z } from 'zod';
import type { Frozen } from '../loader.ts';
import { contentId } from '../schema.ts';

/** The archer's starting bow (the testbed's bow until class data, mw-e02.3). */
export const ARCHER_BOW_ID = 'shortbow';

const ticks = z.int().nonnegative().max(3600);

/** Schema of one bow file, `src/content/data/bow/<id>.json`. */
export const bowSchema = z
  .strictObject({
    id: contentId.describe('Unique bow id, e.g. "shortbow".'),
    name: z.string().min(1).describe('Player-facing name.'),
    notes: z.string().min(1).describe('What the bow is for, and where its numbers come from.'),
    fullDrawTicks: ticks
      .positive()
      .describe('Sim ticks (60 Hz) of holding fire to reach full draw (48 = 800 ms).'),
    minDrawTicks: ticks.describe(
      'A release before this many ticks of draw cancels the shot and returns the arrow; ≤ fullDrawTicks.',
    ),
    maxLaunchSpeed: z.number().positive().max(200).describe('Launch speed at full draw, m/s.'),
    minLaunchFraction: z
      .number()
      .min(0)
      .max(1)
      .describe(
        'Fraction of maxLaunchSpeed at zero draw, 0–1; the speed lerps linearly to 1 at full draw.',
      ),
    drawStaminaCost: z
      .number()
      .nonnegative()
      .max(100)
      .describe('Stamina spent when a draw starts (never refunded).'),
    holdTicks: ticks.describe(
      'Ticks full draw may be held for free; past them stamina drains and at 0 the draw collapses.',
    ),
    holdDrainPerSecond: z
      .number()
      .nonnegative()
      .max(100)
      .describe('Stamina drained per second while full draw is held past holdTicks.'),
    walkScale: z
      .number()
      .min(0)
      .max(1)
      .describe('Movement speed while drawn, as a fraction of the run speed (0–1); no sprint.'),
    aim: z
      .strictObject({
        fov: z
          .number()
          .min(20)
          .max(120)
          .describe('Camera vertical field of view at full draw, degrees (the camera’s is 70).'),
        time: z
          .number()
          .positive()
          .max(2)
          .describe(
            'Seconds for the field of view to ease about two thirds of the way in (and back out).',
          ),
      })
      .describe('Presentation: the over-shoulder aim view while drawn (src/game/camera).'),
  })
  .refine((bow) => bow.minDrawTicks <= bow.fullDrawTicks, {
    message: 'minDrawTicks must be ≤ fullDrawTicks',
    path: ['minDrawTicks'],
  });

/** A bow as written in JSON. */
export type BowDefInput = z.input<typeof bowSchema>;
/** A validated bow. */
export type BowDef = z.output<typeof bowSchema>;
/** A loaded (deeply frozen) bow. */
export type BowEntry = Frozen<BowDef>;

/** A bow as the sim's bow rule reads it (the rules; `aim` stays presentation). */
export interface RuntimeBow {
  readonly id: string;
  readonly fullDrawTicks: number;
  readonly minDrawTicks: number;
  readonly maxLaunchSpeed: number;
  readonly minLaunchFraction: number;
  readonly drawStaminaCost: number;
  readonly holdTicks: number;
  readonly holdDrainPerSecond: number;
  readonly walkScale: number;
}

/** The runtime form of one loaded bow (plain, frozen data). */
export function compileBow(bow: BowEntry): RuntimeBow {
  return Object.freeze({
    id: bow.id,
    fullDrawTicks: bow.fullDrawTicks,
    minDrawTicks: bow.minDrawTicks,
    maxLaunchSpeed: bow.maxLaunchSpeed,
    minLaunchFraction: bow.minLaunchFraction,
    drawStaminaCost: bow.drawStaminaCost,
    holdTicks: bow.holdTicks,
    holdDrainPerSecond: bow.holdDrainPerSecond,
    walkScale: bow.walkScale,
  });
}
