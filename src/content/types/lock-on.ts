// Lock-on tuning (mw-e02.16): the numbers behind how the player picks, keeps, cycles and frames a
// target. Feel is found by iteration, so ranges, the selection cone, the weighting between "nearest
// the view" and "nearest the player", the lost-sight grace, the flick thresholds and the camera
// framing live here as data, not in code. One file per profile, `src/content/data/lock-on/<id>.json`;
// the player uses `player`.
//
// Everything above `framing` is a rule of the game, read by the sim's lock-on system
// (src/sim/targeting). `framing` is presentation, read by the orbit camera (src/game/camera).
//
// Units: metres, degrees, degrees per second, seconds; the lost-sight grace is whole milliseconds so
// the sim converts it to ticks with `ReadonlyClock.ticksFor`; mouse thresholds are raw mouse counts
// per tick.

import { z } from 'zod';
import { contentId } from '../schema.ts';

const metres = z.number().positive().max(100);

const flickSchema = z
  .strictObject({
    stickThreshold: z
      .number()
      .min(0.1)
      .max(1)
      .describe('Right-stick sideways deflection that counts as a flick, 0.1–1.'),
    stickRest: z
      .number()
      .min(0)
      .max(0.9)
      .describe(
        'The stick must come back within this sideways deflection before the next flick, 0–0.9; below stickThreshold.',
      ),
    mouseCounts: z
      .number()
      .int()
      .positive()
      .max(10000)
      .describe('Sideways mouse movement in one tick that counts as a flick, counts.'),
    mouseRest: z
      .number()
      .int()
      .min(0)
      .max(10000)
      .describe(
        'Sideways mouse movement in one tick at or below which the mouse is at rest, counts; below mouseCounts.',
      ),
  })
  .describe(
    'Cycling by flicking look input sideways while locked on: the right stick (the pad has no cycle button) or a fast mouse swipe.',
  );

const framingSchema = z
  .strictObject({
    time: z
      .number()
      .positive()
      .max(2)
      .describe(
        'Seconds for the camera to swing about two thirds of the way to its lock-on framing (exponential ease), and back on release.',
      ),
    targetWeight: z
      .number()
      .min(0)
      .max(1)
      .describe(
        'Where between the player’s head (0) and the target’s lock point (1) the camera aims.',
      ),
    pitchOffset: z
      .number()
      .min(-45)
      .max(45)
      .describe(
        'Added to the aim pitch, degrees; negative looks further down so the player stays in frame.',
      ),
  })
  .describe(
    'Camera framing while locked (presentation only): keeps the player and target in view.',
  );

/** Every tuning value lock-on reads (a profile without its id, name and notes). */
const tuningShape = {
  selectRange: metres.describe(
    'Farthest a target can be picked or cycled to, m (eye to lock point).',
  ),
  coneAngle: z
    .number()
    .positive()
    .max(180)
    .describe('Pick and cycle only targets within this angle of the camera forward, degrees.'),
  breakRange: metres.describe(
    'The lock breaks once the target is farther than this, m; ≥ selectRange.',
  ),
  lostSightMs: z
    .number()
    .int()
    .positive()
    .max(10000)
    .describe(
      'The lock breaks once the target has been out of sight this long, ms; sight returning sooner keeps it.',
    ),
  switchRange: metres.describe(
    'When the locked target dies, the lock moves to the best other target this close, m, or releases.',
  ),
  eyeHeight: metres
    .max(3)
    .describe('Height above the player’s feet that sight lines and angles are measured from, m.'),
  minVisibility: z
    .number()
    .positive()
    .max(1)
    .describe('A lock point is in sight when at least this much of its sight line is clear, 0–1.'),
  distanceWeight: z
    .number()
    .min(0)
    .max(10)
    .describe(
      'Picking scores angle ÷ coneAngle + distanceWeight × distance ÷ selectRange (lowest wins); 0 ignores distance.',
    ),
  priorityWeight: z
    .number()
    .min(0)
    .max(10)
    .describe('Each point of a target’s priority takes this much off its pick score.'),
  turnRate: z
    .number()
    .positive()
    .max(3600)
    .describe('How fast the locked player turns to face the target, degrees/s.'),
  flick: flickSchema,
  framing: framingSchema,
};

const whenValid = {
  when: (payload: { issues: readonly unknown[] }) => payload.issues.length === 0,
};

type TuningFields = z.output<z.ZodObject<typeof tuningShape>>;

/** Adds an issue for every inconsistency between fields, naming them. */
function checkTuning(t: TuningFields, ctx: z.RefinementCtx): void {
  const issue = (path: string[], message: string) => {
    ctx.addIssue({ code: 'custom', path, message });
  };
  if (t.breakRange < t.selectRange) {
    issue(['breakRange'], 'breakRange must not be lower than selectRange');
  }
  if (t.flick.stickRest >= t.flick.stickThreshold) {
    issue(['flick', 'stickRest'], 'flick.stickRest must be below flick.stickThreshold');
  }
  if (t.flick.mouseRest >= t.flick.mouseCounts) {
    issue(['flick', 'mouseRest'], 'flick.mouseRest must be below flick.mouseCounts');
  }
}

/** Lock-on tuning without the entry fields: what the sim and the camera read. */
export const lockOnTuningSchema = z.strictObject(tuningShape).superRefine(checkTuning, whenValid);

/** Validated lock-on tuning (read frozen). */
export type LockOnTuning = z.output<typeof lockOnTuningSchema>;

/** One lock-on profile: `src/content/data/lock-on/<id>.json`. */
export const lockOnSchema = z
  .strictObject({
    id: contentId.describe('Profile id, e.g. "player".'),
    name: z.string().min(1).describe('Display name (debug tools and docs).'),
    notes: z
      .string()
      .min(1)
      .describe('Why these values (feel targets, references), for owner review.'),
    ...tuningShape,
  })
  .superRefine(checkTuning, whenValid);

/** A lock-on profile as written in a data file. */
export type LockOnDefInput = z.input<typeof lockOnSchema>;
/** A loaded lock-on profile. */
export type LockOnDef = z.output<typeof lockOnSchema>;

/** Id of the profile the player uses. */
export const PLAYER_LOCK_ON_ID = 'player';
