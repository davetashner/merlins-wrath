// Character controller tuning (mw-e02.2): the numbers behind how the player moves. Feel is found by
// iteration, so every speed, acceleration time, jump height and timing window the kinematic
// controller (src/sim/character) reads lives here as data, not in code. One file per profile,
// `src/content/data/controller/<id>.json`; the player uses `player`. Per-class overrides, live
// editing and hot reload arrive with mw-e02.3.
//
// Units: metres, seconds, metres per second, metres per second squared, degrees; the two input
// timing windows are whole milliseconds so the sim converts them to ticks with `ReadonlyClock.ticksFor`.

import { z } from 'zod';
import { contentId } from '../schema.ts';

/** The longest coyote time the design allows (mw-e02.2: ≤ 120 ms). */
export const MAX_COYOTE_MS = 120;
/** The longest jump buffer the design allows (mw-e02.2: ≤ 150 ms). */
export const MAX_JUMP_BUFFER_MS = 150;

const metres = z.number().positive();
const speed = z.number().positive().max(50);
const seconds = z.number().positive().max(2);

const capsuleSchema = z
  .strictObject({
    radius: metres.max(1).describe('Capsule radius, m.'),
    height: metres
      .max(4)
      .describe('Standing capsule height, feet to crown, m; at least 2 × radius.'),
    crouchHeight: metres
      .max(4)
      .describe(
        'Crouched capsule height, m; at least 2 × radius and at most height. The feet stay put, the top lowers.',
      ),
  })
  .describe('The player’s collision capsule (vertical, feet at the character position).');

const speedsSchema = z
  .strictObject({
    run: speed.describe('Top speed with the move input fully deflected, m/s. Partial input walks.'),
    sprint: speed.describe('Top speed while sprint is held, m/s; at least run.'),
    crouch: speed.describe('Top speed while crouched, m/s; at most run.'),
  })
  .describe('Top ground speeds, m/s. Analog input scales them (half deflection = half speed).');

const footstepSchema = z
  .strictObject({
    walk: metres.max(5).describe('Walking, m.'),
    run: metres.max(5).describe('Running, m.'),
    sprint: metres.max(5).describe('Sprinting, m.'),
    crouch: metres.max(5).describe('Crouching, m.'),
  })
  .describe(
    'Ground distance between footsteps per gait, m (half a stride): footstep events come from the ' +
      'distance travelled, not from animation.',
  );

/**
 * How the sim names what the character is doing (mw-e02.6): the speeds at which the published
 * locomotion state turns from idle to walk to run, how long a hard landing shows, and how far apart
 * footsteps fall. Presentation reads these states and events; movement itself never does.
 */
export const gaitTuningSchema = z
  .strictObject({
    walkFrom: z
      .number()
      .positive()
      .max(10)
      .describe(
        'Horizontal speed from which a character with move input walks (below: idle), m/s.',
      ),
    runFrom: z
      .number()
      .positive()
      .max(20)
      .describe('Horizontal speed from which it runs (below: walk), m/s; above walkFrom.'),
    landingMs: z
      .int()
      .min(0)
      .max(1000)
      .describe('How long the landing state lasts after a hard landing, whole ms.'),
    hardLanding: z
      .number()
      .min(0)
      .max(50)
      .describe('Impact speed from which a landing counts as hard (shows the landing state), m/s.'),
    footstep: footstepSchema,
  })
  .describe(
    'Locomotion states and events (mw-e02.6): gait speed thresholds, landing and footstep spacing.',
  );

/** Gait thresholds, landing and footstep spacing (see gaitTuningSchema). */
export type GaitTuning = z.output<typeof gaitTuningSchema>;

/** The longest landing recovery after a staggering launch the design allows, ms. */
export const MAX_LAUNCH_RECOVERY_MS = 1000;

export const launchTuningSchema = z
  .strictObject({
    airControl: z
      .number()
      .min(0)
      .max(1)
      .describe(
        'Share of ground acceleration available while flying from an impulse the player chose (a self-cast Gust), 0–1; a staggering launch (a blast, a troll’s blow) has none.',
      ),
    recoveryMs: z
      .int()
      .min(0)
      .max(MAX_LAUNCH_RECOVERY_MS)
      .describe(
        `After a staggering launch lands, movement and jump input are ignored this long, whole ms (≤ ${String(MAX_LAUNCH_RECOVERY_MS)}).`,
      ),
  })
  .describe(
    'Being thrown by an impulse (mw-e02.15): explosions, Gust, Thunderclap and heavy blows launch the character into a ragdoll-free airborne state.',
  );

/** How being thrown handles (see launchTuningSchema). */
export type LaunchTuning = z.output<typeof launchTuningSchema>;

/** Every tuning value the controller reads (a profile without its id, name and notes). */
const tuningShape = {
  capsule: capsuleSchema,
  speeds: speedsSchema,
  accelTime: seconds.describe('Time to reach run speed from rest on the ground, s.'),
  decelTime: seconds.describe(
    'Time to stop from run speed on the ground once input is released, s.',
  ),
  airControl: z
    .number()
    .min(0)
    .max(1)
    .describe(
      'Share of ground acceleration available in the air, 0–1; with no input the player keeps momentum.',
    ),
  gravity: z.number().positive().max(100).describe('Downward acceleration, m/s².'),
  maxFallSpeed: speed.describe('Terminal falling speed, m/s.'),
  jumpApex: metres.max(5).describe('Jump height from standing, feet to feet, m.'),
  coyoteMs: z
    .int()
    .min(0)
    .max(MAX_COYOTE_MS)
    .describe(
      `After walking off a ledge a jump still works for this long, whole ms (≤ ${String(MAX_COYOTE_MS)}).`,
    ),
  jumpBufferMs: z
    .int()
    .min(0)
    .max(MAX_JUMP_BUFFER_MS)
    .describe(
      `A jump pressed this long before landing fires on landing, whole ms (≤ ${String(MAX_JUMP_BUFFER_MS)}).`,
    ),
  stepHeight: z
    .number()
    .min(0)
    .max(1)
    .describe(
      'Tallest step walked up without jumping, m; also how far the player snaps down to stay on stairs and ramps. Below crouchHeight.',
    ),
  slopeLimit: z
    .number()
    .gt(0)
    .lt(90)
    .describe('Steepest walkable slope, degrees; steeper ground is a wall the player slides off.'),
  gait: gaitTuningSchema
    .optional()
    .describe('Locomotion states and events; absent = the sim’s defaults (DEFAULT_GAIT_TUNING).'),
  launch: launchTuningSchema
    .optional()
    .describe('Being thrown by an impulse; absent = the sim’s defaults (DEFAULT_LAUNCH_TUNING).'),
};

/**
 * Runs a cross-field check only once every field passed its own bounds, so one bad value is reported
 * once (the same guard as locomotion.ts).
 */
const whenValid = {
  when: (payload: { issues: readonly unknown[] }) => payload.issues.length === 0,
};

type TuningFields = z.output<z.ZodObject<typeof tuningShape>>;

/** Adds an issue for every inconsistency between fields, naming them. */
function checkTuning(t: TuningFields, ctx: z.RefinementCtx): void {
  const issue = (path: (string | number)[], message: string) => {
    ctx.addIssue({ code: 'custom', path, message });
  };
  const { radius, height, crouchHeight } = t.capsule;
  if (height < 2 * radius) {
    issue(
      ['capsule', 'height'],
      `capsule.height (${String(height)} m) must be at least 2 × radius`,
    );
  }
  if (crouchHeight < 2 * radius || crouchHeight > height) {
    issue(
      ['capsule', 'crouchHeight'],
      `capsule.crouchHeight (${String(crouchHeight)} m) must be between 2 × radius and height`,
    );
  }
  if (t.speeds.sprint < t.speeds.run) {
    issue(['speeds', 'sprint'], 'speeds.sprint must not be lower than speeds.run');
  }
  if (t.speeds.crouch > t.speeds.run) {
    issue(['speeds', 'crouch'], 'speeds.crouch must not be higher than speeds.run');
  }
  if (t.stepHeight >= crouchHeight) {
    issue(['stepHeight'], 'stepHeight must be lower than capsule.crouchHeight');
  }
  if (t.gait !== undefined && t.gait.runFrom <= t.gait.walkFrom) {
    issue(['gait', 'runFrom'], 'gait.runFrom must be higher than gait.walkFrom');
  }
}

/** Controller tuning without the entry fields: what the sim's controller reads. */
export const controllerTuningSchema = z
  .strictObject(tuningShape)
  .superRefine(checkTuning, whenValid);

/** Validated controller tuning (the sim reads it frozen). */
export type ControllerTuning = z.output<typeof controllerTuningSchema>;

/** One controller profile: `src/content/data/controller/<id>.json`. */
export const controllerSchema = z
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

/** A controller profile as written in a data file. */
export type ControllerDefInput = z.input<typeof controllerSchema>;
/** A loaded controller profile. */
export type ControllerDef = z.output<typeof controllerSchema>;

/** Id of the profile the player character uses. */
export const PLAYER_CONTROLLER_ID = 'player';
