// The socket track content type (mw-e04.26): the arc a move's hitbox sweeps along, one file per
// track at `src/content/data/socket-track/<id>.json`. A move's `hitbox.track` names one; the sim's
// swept hitboxes (mw-e04.2, src/sim/combat/hits) place the move's hit volume on the track's socket
// pose each active tick and sweep between consecutive keys, so a fast arc cannot skip a thin target.
//
// Keys are at tick resolution: key 0 is the socket's pose before the first active tick, key k its
// pose on active tick k (a track shorter than the window holds its last key). A pose is a position
// (metres) and a unit quaternion rotation in the attacker's frame (+z forward, +y up, +x right, as
// move data); the move's hit volume is authored at the identity pose. Tracks are sim data: the render
// animation follows them, never the reverse, so nothing here reads rigs or clips.
//
// Validation: the schema checks each track (1+ keys, finite numbers, unit rotations); `checkSocketTracks`
// runs on every load and fails it for a move naming a missing track, or a track with more keys than
// its move's active ticks + 1 (the extra keys would never be reached). `compileSocketTracks` turns
// loaded tracks into the lookup attack code passes to the sim (`moveTrack`, then `hitboxFromMove`).
// The field reference in docs/content/socket-track-schema.md is generated (`pnpm content:docs`).

import { z } from 'zod';
import type { ContentCheck, ContentIssue, Frozen, LoadedEntry } from '../loader.ts';
import { contentId } from '../schema.ts';
import type { MoveDef } from './move.ts';

/** How far a rotation's length may stray from 1 (authored values are rounded). */
export const SOCKET_ROTATION_TOLERANCE = 1e-3;

const finite = z.number();

/** A quaternion's length; plain sqrt (IEEE-exact), since Math.hypot can differ across engines. */
const lengthOf = (q: { x: number; y: number; z: number; w: number }): number =>
  Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w);

const keySchema = z
  .strictObject({
    position: z
      .strictObject({ x: finite, y: finite, z: finite })
      .describe('Socket position in the attacker’s frame, metres (+z forward, +y up, +x right).'),
    rotation: z
      .strictObject({ x: finite, y: finite, z: finite, w: finite })
      .refine(
        (q) => Math.abs(lengthOf(q) - 1) <= SOCKET_ROTATION_TOLERANCE,
        'must be a unit quaternion (length 1 within 0.001)',
      )
      .describe('Socket rotation in the attacker’s frame, a unit quaternion { x, y, z, w }.'),
  })
  .describe('A socket pose; the move’s hit volume is placed on it.');

/** Schema of one socket track file, `src/content/data/socket-track/<id>.json`. */
export const socketTrackSchema = z.strictObject({
  id: contentId.describe(
    'Unique track id, named by moves’ hitbox.track, e.g. "knight-sword-arc-light-1".',
  ),
  notes: z.string().min(1).describe('The arc in words (moves, pivot, angles), for owner review.'),
  keys: z
    .array(keySchema)
    .min(1)
    .describe(
      'Socket poses at tick resolution: key 0 before the first active tick, key k on active tick ' +
        'k. At most the move’s active ticks + 1; a shorter track holds its last key.',
    ),
});

/** A socket track as written in JSON. */
export type SocketTrackDefInput = z.input<typeof socketTrackSchema>;
/** A validated socket track. */
export type SocketTrackDef = z.output<typeof socketTrackSchema>;
/** A loaded (deeply frozen) socket track. */
export type SocketTrackEntry = Frozen<SocketTrackDef>;

/** A socket pose as the sim reads it (structurally the sim's `Pose`). */
export interface RuntimeSocketPose {
  readonly position: { readonly x: number; readonly y: number; readonly z: number };
  readonly rotation: {
    readonly x: number;
    readonly y: number;
    readonly z: number;
    readonly w: number;
  };
}

/** A socket track as the sim reads it (structurally the sim's `SocketTrack`). */
export interface RuntimeSocketTrack {
  readonly id: string;
  readonly keys: readonly RuntimeSocketPose[];
}

/** Every socket track by id (iteration in id order), frozen. */
export type SocketTrackTable = ReadonlyMap<string, RuntimeSocketTrack>;

/** The runtime form of one loaded track: rotations normalised to unit length. */
export function compileSocketTrack(track: SocketTrackEntry): RuntimeSocketTrack {
  const keys = track.keys.map(({ position, rotation: q }) => {
    const length = lengthOf(q);
    return Object.freeze({
      position,
      rotation: Object.freeze({
        x: q.x / length,
        y: q.y / length,
        z: q.z / length,
        w: q.w / length,
      }),
    });
  });
  return Object.freeze({ id: track.id, keys: Object.freeze(keys) });
}

/** The runtime track lookup built from loaded tracks (e.g. `content.all('socket-track')`). */
export function compileSocketTracks(tracks: Iterable<SocketTrackEntry>): SocketTrackTable {
  const table = new Map<string, RuntimeSocketTrack>();
  for (const track of [...tracks].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    table.set(track.id, compileSocketTrack(track));
  }
  return table;
}

interface Loaded<T> {
  readonly file: string;
  readonly value: T;
}

const tracksOf = (entries: readonly LoadedEntry[]) =>
  entries.filter((e) => e.type === 'socket-track') as unknown as readonly Loaded<SocketTrackDef>[];

const movesOf = (entries: readonly LoadedEntry[]) =>
  entries.filter((e) => e.type === 'move') as unknown as readonly Loaded<MoveDef>[];

/**
 * Every move's hitbox.track names a socket track, and no track has more keys than a move using it
 * has active ticks + 1.
 */
export const checkSocketTracks: ContentCheck = (entries) => {
  const issues: ContentIssue[] = [];
  const tracks = new Map(tracksOf(entries).map((t) => [t.value.id, t]));
  for (const { file, value: move } of movesOf(entries)) {
    if (move.hitbox === undefined) continue;
    const id = move.hitbox.track;
    const track = tracks.get(id);
    if (track === undefined) {
      issues.push({
        file,
        pointer: '/hitbox/track',
        message: `move "${move.id}" names socket track "${id}", which does not exist`,
      });
      continue;
    }
    const { active } = move.frames;
    const keys = track.value.keys.length;
    if (keys > active + 1) {
      issues.push({
        file: track.file,
        pointer: '/keys',
        message:
          `socket track "${id}" has ${String(keys)} keys but move "${move.id}" is active for ` +
          `${String(active)} ticks (at most ${String(active + 1)} keys: key 0 plus one per active tick)`,
      });
    }
  }
  return issues;
};
