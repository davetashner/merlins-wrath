// Keeps a stress scene's props moving (mw-e32.1). The perf-baseline scene measures frame time with
// N physics props in motion, but props dropped into a room settle within seconds. Spawns tagged
// `perf-agitator` are markers; this sets off a force blast at one of them at a time, round-robin,
// through the sim's debug `blast` command — the same force stimulus a spell or explosion uses, so
// the props are pushed by the one stimulus API rather than scripted. Deterministic: the blast for a
// tick depends only on the tick.

import { blastCommand, type BlastCommand, type Vec3 } from '@sim/index';

/** The tag that makes a scene spawn an agitator marker. */
export const AGITATOR_TAG = 'perf-agitator';

export interface AgitatorTuning {
  /** Seconds between two blasts (anywhere in the scene). */
  readonly intervalS: number;
  /** Blast radius, m. */
  readonly radius: number;
  /** Impulse at the blast's centre, N·s (falls off linearly to the radius). */
  readonly intensity: number;
}

/**
 * Sized for the perf-baseline room (tested in agitator.test.ts): with a marker every 4 m and a 4 m
 * radius every point of the floor is in reach of one, a 12 kg crate on top of a marker is shoved off
 * at about 9 m/s and one at the edge of the radius barely slides, so 15 s in most crates are still
 * moving every second and none clears the 6 m walls.
 */
export const DEFAULT_AGITATOR_TUNING: AgitatorTuning = Object.freeze({
  intervalS: 0.25,
  radius: 4,
  intensity: 110,
});

/** A scene spawn as far as the agitator cares. */
export interface AgitatorSpawn {
  readonly position: Vec3;
  readonly tags: readonly string[];
}

export class SceneAgitator {
  private readonly period: number;

  constructor(
    private readonly markers: readonly Vec3[],
    hz: number,
    private readonly tuning: AgitatorTuning = DEFAULT_AGITATOR_TUNING,
  ) {
    this.period = Math.max(1, Math.round(tuning.intervalS * hz));
  }

  /** Marker positions, in scene order. */
  get points(): readonly Vec3[] {
    return this.markers;
  }

  /** The blast to queue after `tick`, or undefined between blasts (and always without markers). */
  commandFor(tick: number): BlastCommand | undefined {
    if (tick % this.period !== 0) return undefined;
    const at = this.markers[(tick / this.period) % this.markers.length];
    return at === undefined
      ? undefined
      : blastCommand(at, this.tuning.radius, this.tuning.intensity);
  }
}

/** The scene's agitator, or undefined when it has no `perf-agitator` markers (every other scene). */
export function sceneAgitator(
  spawns: readonly AgitatorSpawn[],
  hz: number,
  tuning?: AgitatorTuning,
): SceneAgitator | undefined {
  const markers = spawns
    .filter((spawn) => spawn.tags.includes(AGITATOR_TAG))
    .map((spawn) => spawn.position);
  return markers.length === 0 ? undefined : new SceneAgitator(markers, hz, tuning);
}
