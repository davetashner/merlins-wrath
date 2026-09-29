// Load-time animation checks (mw-e02.20) and the marker drift validator. After every file has
// parsed (so every clip and rig reference resolves), `checkAnimation` reports what no single schema
// can see: a clip keying a bone its rig does not have, a graph playing another rig's clip, and a clip
// whose additive flag does not match its layer. `animMarkerDrift` compares clip markers with move
// frame data: the runtime time-warps a move's clip so its first hit marker lands on the move's first
// active tick, and a marker more than a tick away from that at the clip's natural speed is reported
// so the clip gets retimed (large warps look wrong). Drift is a report, never a load failure:
// placeholder clips may lag the move data.

import type { ContentCheck, ContentIssue, LoadedEntry } from './loader.ts';
import type { AnimClipDef } from './types/anim-clip.ts';
import { motionClips, type AnimGraphDef } from './types/anim-graph.ts';

/** Sim ticks per second (the fixed 60 Hz step every frame number is counted in). */
export const ANIM_SIM_HZ = 60;
/** Most ticks a clip's hit marker may sit from the move's first active tick without a report. */
export const ANIM_MAX_MARKER_DRIFT_TICKS = 1;

const clipsOf = (entries: readonly LoadedEntry[]) =>
  entries.filter((e) => e.type === 'anim-clip') as unknown as readonly {
    readonly file: string;
    readonly value: AnimClipDef;
  }[];

const graphsOf = (entries: readonly LoadedEntry[]) =>
  entries.filter((e) => e.type === 'anim-graph') as unknown as readonly {
    readonly file: string;
    readonly value: AnimGraphDef;
  }[];

const escape = (key: string) => key.replaceAll('~', '~0').replaceAll('/', '~1');

/** Clip bones exist on the rig; graphs play only their own rig's clips, additive in additive layers. */
export const checkAnimation: ContentCheck = (entries) => {
  const issues: ContentIssue[] = [];
  const graphs = new Map(graphsOf(entries).map((g) => [g.value.id, g.value]));
  const clips = new Map(clipsOf(entries).map((c) => [c.value.id, c.value]));

  for (const { file, value: clip } of clipsOf(entries)) {
    const rig = graphs.get(clip.rig.id);
    if (rig === undefined) continue; // the loader already reported the missing reference
    const bones = new Set(rig.skeleton.map((b) => b.bone));
    for (const bone of Object.keys(clip.tracks)) {
      if (!bones.has(bone)) {
        issues.push({
          file,
          pointer: `/tracks/${escape(bone)}`,
          message: `clip "${clip.id}" keys bone "${bone}", which rig "${rig.id}" does not have`,
        });
      }
    }
  }

  for (const { file, value: graph } of graphsOf(entries)) {
    graph.layers.forEach((layer, l) => {
      layer.states.forEach((state, s) => {
        for (const id of motionClips(state.motion)) {
          const clip = clips.get(id);
          if (clip === undefined) continue; // reported as a missing reference
          const pointer = `/layers/${String(l)}/states/${String(s)}/motion`;
          if (clip.rig.id !== graph.id) {
            issues.push({
              file,
              pointer,
              message: `graph "${graph.id}" state "${state.id}" plays clip "${id}" of rig "${clip.rig.id}"`,
            });
          }
          if (clip.additive !== (layer.mode === 'additive')) {
            issues.push({
              file,
              pointer,
              message: clip.additive
                ? `additive clip "${id}" is played by override layer "${layer.id}"`
                : `clip "${id}" is not additive but layer "${layer.id}" is`,
            });
          }
        }
      });
    });
  }
  return issues;
};

/** The move fields the drift check reads (a MoveEntry or RuntimeMove-shaped value). */
export interface DriftMove {
  readonly id: string;
  readonly frames: { readonly startup: number; readonly active: number };
  readonly hitbox?: unknown;
  readonly presentation: { readonly anim: string };
}

/** The clip fields the drift check reads. */
export interface DriftClip {
  readonly id: string;
  readonly markers: readonly { readonly kind: string; readonly t: number }[];
}

/** A clip whose hit marker does not line up with its move's first active tick. */
export interface AnimMarkerDrift {
  readonly move: string;
  readonly clip: string;
  /** The move's first active tick (= its startup). */
  readonly activeTick: number;
  /** The first hit marker's time in ticks at the clip's natural speed, or null when it has none. */
  readonly markerTick: number | null;
  /** |markerTick − activeTick| in ticks, or null when there is no hit marker. */
  readonly drift: number | null;
  readonly message: string;
}

/**
 * Every move whose clip (its presentation.anim, when the manifest has it) has its first hit marker
 * more than ANIM_MAX_MARKER_DRIFT_TICKS from the move's first active tick, or a hitting move whose
 * clip has no hit marker. Moves whose clip is not in the manifest are skipped (moveWarnings reports
 * unknown ids). Ordered by move.
 */
export function animMarkerDrift(
  moves: Iterable<DriftMove>,
  clips: Iterable<DriftClip>,
  hz: number = ANIM_SIM_HZ,
): AnimMarkerDrift[] {
  const byId = new Map([...clips].map((c) => [c.id, c]));
  const drifts: AnimMarkerDrift[] = [];
  for (const move of [...moves].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const clip = byId.get(move.presentation.anim);
    if (clip === undefined) continue;
    const activeTick = move.frames.startup;
    const marker = clip.markers.find((m) => m.kind === 'hit');
    if (marker === undefined) {
      if (move.hitbox == null) continue;
      drifts.push({
        move: move.id,
        clip: clip.id,
        activeTick,
        markerTick: null,
        drift: null,
        message: `move "${move.id}" can hit but clip "${clip.id}" has no hit marker`,
      });
      continue;
    }
    const markerTick = Math.round(marker.t * hz * 1000) / 1000;
    const drift = Math.round(Math.abs(markerTick - activeTick) * 1000) / 1000;
    if (drift <= ANIM_MAX_MARKER_DRIFT_TICKS) continue;
    drifts.push({
      move: move.id,
      clip: clip.id,
      activeTick,
      markerTick,
      drift,
      message:
        `clip "${clip.id}" hit marker at ${String(marker.t)} s (tick ${String(markerTick)}) drifts ` +
        `${String(drift)} ticks from move "${move.id}"'s first active tick ${String(activeTick)}`,
    });
  }
  return drifts;
}
