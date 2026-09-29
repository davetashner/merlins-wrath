// The animation clip manifest (mw-e02.20): `src/content/data/anim-clip/<clip-id>.json`, one entry per
// clip. Until the animation pipeline (e37) imports real clips, an entry carries its keyframes
// directly, so grey-box placeholder rigs animate from data: per-bone rotation keys (Euler degrees,
// XYZ order), an optional root translation track and alignment markers.
//
// Root motion policy: the sim is authoritative for position. Clips play in place; the root track is
// never applied to an entity and is kept only as a velocity reference for tuning (the runtime
// extracts it, see src/render/animation). Markers (footstep, hit, release, cast) are for alignment
// only: gameplay timing comes from sim events. A move's clip is time-warped so its first hit marker
// lands on the move's first active tick, and `animMarkerDrift` (anim-checks.ts) reports clips whose
// marker sits more than a tick away from the move data.

import { z } from 'zod';
import { ref } from '../schema.ts';
import { ANIM_ID_PATTERN } from './move.ts';

/** Kinds of clip marker (alignment only; the sim emits the gameplay events). */
export const ANIM_MARKER_KINDS = ['footstep', 'hit', 'release', 'cast'] as const;
/** A marker kind. */
export type AnimMarkerKind = (typeof ANIM_MARKER_KINDS)[number];

const finite = z.number();
const time = z.number().min(0).describe('Seconds from the clip start.');

const rotationKeySchema = z.strictObject({
  t: time,
  rot: z
    .tuple([finite, finite, finite])
    .describe('Local rotation from the rest pose, Euler degrees [x, y, z] (XYZ order).'),
});

const rootKeySchema = z.strictObject({
  t: time,
  pos: z.tuple([finite, finite, finite]).describe('Root translation in the source clip, metres.'),
});

const markerSchema = z.strictObject({
  kind: z.enum(ANIM_MARKER_KINDS).describe('footstep, hit, release or cast.'),
  t: time,
});

/** Times must be ascending (equal allowed only for the first key) and inside the clip. */
function checkKeys(
  keys: readonly { readonly t: number }[],
  duration: number,
  path: readonly (string | number)[],
  ctx: z.RefinementCtx,
): void {
  keys.forEach((key, i) => {
    const previous = keys[i - 1];
    if (key.t > duration) {
      ctx.addIssue({
        code: 'custom',
        path: [...path, i, 't'],
        message: `key time ${String(key.t)} s is past the clip's duration (${String(duration)} s)`,
      });
    } else if (previous !== undefined && key.t <= previous.t) {
      ctx.addIssue({
        code: 'custom',
        path: [...path, i, 't'],
        message: 'key times must be strictly ascending',
      });
    }
  });
}

/** Schema of one clip, `src/content/data/anim-clip/<id>.json`. */
export const animClipSchema = z
  .strictObject({
    id: z
      .string()
      .regex(ANIM_ID_PATTERN, 'must be an animation id, e.g. "anim-knight-sword-light-1"')
      .describe('Clip id (style bible §15.1), e.g. "anim-knight-sword-light-1".'),
    notes: z.string().min(1).describe('What the clip shows and where it comes from.'),
    rig: ref('anim-graph').describe('The rig (animation graph) whose skeleton the clip animates.'),
    duration: z.number().positive().describe('Clip length, seconds.'),
    loop: z.boolean().default(false).describe('Loops (locomotion) or plays once and holds.'),
    additive: z
      .boolean()
      .default(false)
      .describe('Rotations are offsets added on top of lower layers (hit reactions).'),
    tracks: z
      .record(z.string().min(1), z.array(rotationKeySchema).min(1))
      .describe('Rotation keys per bone name; bones without a track keep their rest rotation.'),
    root: z
      .array(rootKeySchema)
      .optional()
      .describe(
        'Root translation found in the source clip. Never applied (clips play in place); kept as a velocity reference.',
      ),
    markers: z
      .array(markerSchema)
      .prefault([])
      .describe(
        'Alignment markers; the first hit marker is warped onto the move’s first active tick.',
      ),
  })
  .superRefine((clip, ctx) => {
    for (const [bone, keys] of Object.entries(clip.tracks)) {
      checkKeys(keys, clip.duration, ['tracks', bone], ctx);
    }
    if (clip.root !== undefined) checkKeys(clip.root, clip.duration, ['root'], ctx);
    clip.markers.forEach((marker, i) => {
      if (marker.t > clip.duration) {
        ctx.addIssue({
          code: 'custom',
          path: ['markers', i, 't'],
          message: `marker at ${String(marker.t)} s is past the clip's duration (${String(clip.duration)} s)`,
        });
      }
    });
  });

/** A clip as written in JSON. */
export type AnimClipDefInput = z.input<typeof animClipSchema>;
/** A validated clip. */
export type AnimClipDef = z.output<typeof animClipSchema>;
