// Compiled rigs and clips for the animation runtime (mw-e02.20). Content (anim-graph, anim-clip) is
// compiled once into flat arrays: a rig's bone table and masks, and per clip one track per keyed bone
// with its key times and rotation quaternions. Sampling a clip then only walks arrays.
//
// Root motion policy: the sim owns position. A clip's root translation (anim-clip `root`) is never
// part of a pose — poses carry rotations only — so animation cannot move an entity. The root track is
// kept as `rootVelocity`, a velocity curve for tuning reference (e37-animation-pipeline AC-5).

import type { AnimBoneDef, AnimGraphDef, AnimMarkerKind, ContentRef, Frozen } from '@content/index';
import { nlerpInto, quatFromEulerDeg, type Pose } from './math';

/** A compiled skeleton. */
export interface Rig {
  readonly id: string;
  readonly bones: readonly string[];
  /** Parent bone index per bone (−1 for the root). */
  readonly parents: Int16Array;
  /** Rest offsets relative to the parent, [x, y, z] per bone. */
  readonly offsets: Float64Array;
  /** The bone definitions (grey-box shapes for the placeholder view). */
  readonly defs: readonly Frozen<AnimBoneDef>[];
  readonly index: ReadonlyMap<string, number>;
  /** Mask name → weight per bone (1 in the mask, 0 outside). */
  readonly masks: ReadonlyMap<string, Float64Array>;
}

/** One keyed bone of a clip. */
export interface Track {
  readonly bone: number;
  readonly times: Float64Array;
  /** Rotation per key, [x, y, z, w]. */
  readonly quats: Float64Array;
}

/** A marker of a compiled clip. */
export interface ClipMarker {
  readonly kind: AnimMarkerKind;
  readonly t: number;
}

/** A root velocity sample: the average velocity over one root segment, m/s, at its midpoint. */
export interface RootVelocitySample {
  readonly t: number;
  readonly velocity: readonly [number, number, number];
}

/** A compiled clip. */
export interface Clip {
  readonly id: string;
  readonly rig: string;
  readonly duration: number;
  readonly loop: boolean;
  readonly additive: boolean;
  readonly tracks: readonly Track[];
  readonly markers: readonly ClipMarker[];
  /** Time of the first hit marker, or null (the action time-warp aligns it). */
  readonly hitMarker: number | null;
  /** Root translation of the source clip as velocity, for reference only; never applied. */
  readonly rootVelocity: readonly RootVelocitySample[];
}

/** The graph fields a rig is compiled from. */
export type RigSource = Pick<Frozen<AnimGraphDef>, 'id' | 'skeleton' | 'masks'>;

/** Compiles a graph's skeleton and masks. */
export function compileRig(graph: RigSource): Rig {
  const bones = graph.skeleton.map((b) => b.bone);
  const index = new Map(bones.map((b, i) => [b, i]));
  const parents = new Int16Array(bones.length);
  const offsets = new Float64Array(bones.length * 3);
  graph.skeleton.forEach((bone, i) => {
    parents[i] = bone.parent === null ? -1 : (index.get(bone.parent) ?? -1);
    offsets.set(bone.offset, i * 3);
  });
  const masks = new Map<string, Float64Array>();
  for (const [name, members] of Object.entries(graph.masks)) {
    const weights = new Float64Array(bones.length);
    for (const bone of members) {
      const i = index.get(bone);
      if (i !== undefined) weights[i] = 1;
    }
    masks.set(name, weights);
  }
  return { id: graph.id, bones, parents, offsets, defs: graph.skeleton, index, masks };
}

/** The clip fields a clip is compiled from (a loaded anim-clip entry). */
export interface ClipSource {
  readonly id: string;
  readonly rig: ContentRef | { readonly id: string };
  readonly duration: number;
  readonly loop: boolean;
  readonly additive: boolean;
  readonly tracks: Readonly<
    Record<string, readonly { readonly t: number; readonly rot: readonly number[] }[]>
  >;
  readonly root?: readonly { readonly t: number; readonly pos: readonly number[] }[] | undefined;
  readonly markers: readonly { readonly kind: AnimMarkerKind; readonly t: number }[];
}

/** Compiles a clip for `rig` (tracks of bones the rig lacks are dropped). */
export function compileClip(source: ClipSource, rig: Rig): Clip {
  const tracks: Track[] = [];
  for (const [bone, keys] of Object.entries(source.tracks)) {
    const i = rig.index.get(bone);
    if (i === undefined) continue;
    const times = new Float64Array(keys.length);
    const quats = new Float64Array(keys.length * 4);
    keys.forEach((key, k) => {
      times[k] = key.t;
      quats.set(quatFromEulerDeg(key.rot[0] ?? 0, key.rot[1] ?? 0, key.rot[2] ?? 0), k * 4);
    });
    tracks.push({ bone: i, times, quats });
  }
  const markers = [...source.markers].sort((a, b) => a.t - b.t);
  return {
    id: source.id,
    rig: source.rig.id,
    duration: source.duration,
    loop: source.loop,
    additive: source.additive,
    tracks,
    markers,
    hitMarker: markers.find((m) => m.kind === 'hit')?.t ?? null,
    rootVelocity: rootVelocityOf(source.root ?? []),
  };
}

function rootVelocityOf(
  keys: readonly { readonly t: number; readonly pos: readonly number[] }[],
): RootVelocitySample[] {
  const samples: RootVelocitySample[] = [];
  for (let k = 1; k < keys.length; k++) {
    const a = keys[k - 1];
    const b = keys[k];
    if (a === undefined || b === undefined) continue;
    const dt = b.t - a.t;
    const v = (axis: number) => ((b.pos[axis] ?? 0) - (a.pos[axis] ?? 0)) / dt;
    samples.push({ t: (a.t + b.t) / 2, velocity: [v(0), v(1), v(2)] });
  }
  return samples;
}

/** A clip's local time for a running time `t` seconds: wrapped when it loops, else clamped. */
export function clipTime(clip: Clip, t: number): number {
  if (clip.loop) {
    const wrapped = t % clip.duration;
    return wrapped < 0 ? wrapped + clip.duration : wrapped;
  }
  return Math.min(Math.max(t, 0), clip.duration);
}

const scratch = new Float64Array(4);

/** Samples one track at clip time `t` into `scratch`. */
function sampleTrack(track: Track, t: number): Float64Array {
  const { times, quats } = track;
  const last = times.length - 1;
  if (t <= (times[0] ?? 0) || last === 0) {
    scratch.set(quats.subarray(0, 4));
    return scratch;
  }
  if (t >= (times[last] ?? 0)) {
    scratch.set(quats.subarray(last * 4, last * 4 + 4));
    return scratch;
  }
  let k = 1;
  while ((times[k] ?? Infinity) < t) k++;
  const t0 = times[k - 1] ?? 0;
  const t1 = times[k] ?? t0;
  nlerpInto(scratch, 0, quats, (k - 1) * 4, quats, k * 4, (t - t0) / (t1 - t0));
  return scratch;
}

/**
 * Samples `clip` at clip time `t` into `out` (a pose of the clip's rig): keyed bones get their
 * sampled rotation, every other bone identity (its rest rotation).
 */
export function sampleClip(clip: Clip, t: number, out: Pose): void {
  out.fill(0);
  for (let i = 3; i < out.length; i += 4) out[i] = 1;
  for (const track of clip.tracks) out.set(sampleTrack(track, t), track.bone * 4);
}

/** Adds `weight` × every rotation of `pose` to `acc`, each on the hemisphere of what `acc` holds. */
export function accumulatePose(acc: Pose, pose: Pose, weight: number): void {
  for (let o = 0; o < acc.length; o += 4) {
    const x = pose[o] ?? 0;
    const y = pose[o + 1] ?? 0;
    const z = pose[o + 2] ?? 0;
    const w = pose[o + 3] ?? 1;
    const dot =
      (acc[o] ?? 0) * x + (acc[o + 1] ?? 0) * y + (acc[o + 2] ?? 0) * z + (acc[o + 3] ?? 0) * w;
    const s = dot < 0 ? -weight : weight;
    acc[o] = (acc[o] ?? 0) + x * s;
    acc[o + 1] = (acc[o + 1] ?? 0) + y * s;
    acc[o + 2] = (acc[o + 2] ?? 0) + z * s;
    acc[o + 3] = (acc[o + 3] ?? 0) + w * s;
  }
}

/** Normalises every rotation of an accumulated pose (an empty one becomes identity). */
export function normalisePose(acc: Pose): void {
  for (let o = 0; o < acc.length; o += 4) {
    const x = acc[o] ?? 0;
    const y = acc[o + 1] ?? 0;
    const z = acc[o + 2] ?? 0;
    const w = acc[o + 3] ?? 0;
    const length = Math.hypot(x, y, z, w);
    if (length < 1e-9) {
      acc[o] = 0;
      acc[o + 1] = 0;
      acc[o + 2] = 0;
      acc[o + 3] = 1;
    } else {
      acc[o] = x / length;
      acc[o + 1] = y / length;
      acc[o + 2] = z / length;
      acc[o + 3] = w / length;
    }
  }
}
