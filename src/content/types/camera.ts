// Third-person camera tuning (mw-e02.4): the numbers behind how the orbit camera frames the player.
// Feel is found by iteration, so the field of view, shoulder offset, zoom range, pitch limits, look
// sensitivity and stick response, collision radius and recovery time live here as data, not in code. One file per rig,
// `src/content/data/camera/<id>.json`; the player uses `player`. Player-facing settings (sensitivity,
// invert, FOV) arrive with mw-e31.6 and override these defaults.
//
// The look settings (mouse sensitivity, stick response, invertY, pitch limits) feed the sim's PlayerLook (src/sim/player):
// yaw and pitch are sim state so replays reproduce them. Everything else is presentation, read by
// the orbit camera in src/game/camera.
//
// Units: metres, seconds, degrees, degrees per second; mouse sensitivity is radians per count.

import { z } from 'zod';
import { contentId } from '../schema.ts';

const metres = z.number().positive();

const distanceSchema = z
  .strictObject({
    min: metres.max(20).describe('Closest zoom, m from the shoulder pivot.'),
    max: metres.max(20).describe('Farthest zoom, m; at least min.'),
    initial: metres.max(20).describe('Zoom at spawn, m; between min and max.'),
    step: metres.max(5).describe('How far one mouse-wheel notch zooms, m.'),
  })
  .describe('Boom length behind the shoulder pivot (zoom), before collision pulls it in.');

const pitchSchema = z
  .strictObject({
    min: z.number().min(-89).max(0).describe('Lowest pitch, degrees (looking down); ≤ 0.'),
    max: z.number().min(0).max(89).describe('Highest pitch, degrees (looking up); ≥ 0.'),
    initial: z
      .number()
      .min(-89)
      .max(89)
      .describe('Pitch at spawn, degrees; between min and max. Negative looks down on the player.'),
  })
  .describe('Look pitch limits, degrees above the horizon. The sim clamps to them.');

const stickSchema = z
  .strictObject({
    deadzone: z
      .number()
      .min(0)
      .max(0.9)
      .describe('Radial deflection at or below this is ignored, 0–0.9.'),
    exponent: z
      .number()
      .min(1)
      .max(4)
      .describe('Response curve over the live range: 1 is linear, 2 gives finer aim near centre.'),
    yawRate: z.number().positive().max(1080).describe('Turn rate at full deflection, degrees/s.'),
    pitchRate: z
      .number()
      .positive()
      .max(1080)
      .describe('Pitch rate at full deflection, degrees/s.'),
  })
  .describe(
    'Rate-based look for an analog stick (gamepad, mw-e02.9): deflection → curve → degrees/s.',
  );

/** Every tuning value the camera and look read (a rig without its id, name and notes). */
const tuningShape = {
  fov: z.number().min(30).max(120).describe('Vertical field of view, degrees.'),
  near: metres.max(1).describe('Near clip plane, m.'),
  pivotHeight: metres
    .max(3)
    .describe(
      'Height above the feet the camera orbits, m (about the head). Lowered while crouched so it stays inside the capsule.',
    ),
  shoulder: z
    .number()
    .min(-2)
    .max(2)
    .describe('Sideways offset of the orbit pivot, m; positive is over the right shoulder.'),
  distance: distanceSchema,
  pitch: pitchSchema,
  mouseSensitivity: z
    .number()
    .positive()
    .max(0.1)
    .describe('Mouse look, radians per mouse count, both axes (a delta: no time scaling).'),
  stick: stickSchema,
  invertY: z.boolean().describe('Looking up (mouse or stick) looks down.'),
  collisionRadius: metres
    .max(1)
    .describe(
      'Radius of the sphere swept from the player to the camera, m. The camera stops this far in front of anything in the way, so the near plane never enters geometry.',
    ),
  recoveryTime: z
    .number()
    .positive()
    .max(2)
    .describe(
      'Seconds to ease back out to the zoom distance once nothing is in the way. Pulling in is instant.',
    ),
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
  const { distance, pitch } = t;
  if (distance.max < distance.min) {
    issue(['distance', 'max'], 'distance.max must not be lower than distance.min');
  } else if (distance.initial < distance.min || distance.initial > distance.max) {
    issue(['distance', 'initial'], 'distance.initial must be between distance.min and max');
  }
  if (pitch.initial < pitch.min || pitch.initial > pitch.max) {
    issue(['pitch', 'initial'], 'pitch.initial must be between pitch.min and pitch.max');
  }
  if (t.collisionRadius < t.near) {
    issue(['collisionRadius'], 'collisionRadius must be at least near');
  }
}

/** Camera tuning without the entry fields: what the orbit camera reads. */
export const cameraTuningSchema = z.strictObject(tuningShape).superRefine(checkTuning, whenValid);

/** Validated camera tuning (read frozen). */
export type CameraTuning = z.output<typeof cameraTuningSchema>;

/** One camera rig: `src/content/data/camera/<id>.json`. */
export const cameraSchema = z
  .strictObject({
    id: contentId.describe('Rig id, e.g. "player".'),
    name: z.string().min(1).describe('Display name (debug tools and docs).'),
    notes: z
      .string()
      .min(1)
      .describe('Why these values (feel targets, references), for owner review.'),
    ...tuningShape,
  })
  .superRefine(checkTuning, whenValid);

/** A camera rig as written in a data file. */
export type CameraDefInput = z.input<typeof cameraSchema>;
/** A loaded camera rig. */
export type CameraDef = z.output<typeof cameraSchema>;

/** Id of the rig the player's third-person camera uses. */
export const PLAYER_CAMERA_ID = 'player';
