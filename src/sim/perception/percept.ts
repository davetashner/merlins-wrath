// Percepts (mw-e11.5): what a creature's senses hand on, and the only way it learns about the world
// around it. Each evaluation of an agent's senses produces a list of typed stimuli
//   { source, kind, sense, position, strength 0–1, certainty 0–1 }
// raised as one `perceived` event per agent, which awareness (mw-e11.6) and memory (mw-e11.8) read.
// The world-stimulus API in src/sim/stimulus (fire, light, force acting on things) is a different
// concept; a perception stimulus is called a percept in code to keep the two apart.
//
// No omniscience (constitution: darkness, silence and cover genuinely protect the thief): a percept
// carries where the agent perceived something, not where it is. A heard noise is at the doorway it
// came through; a seen target is where it stood when seen. Its `source` names what was perceived as
// an opaque string, never an entity id, so code holding a percept cannot look the thing up in the
// world (`world.get(percept.source, …)` does not compile). Agent code (src/sim/ai) receives only
// percepts; tests/toolchain/perception-boundary.test.ts holds both halves of that line.

import type { EntityId } from '../core/component';
import { defineEvent } from '../core/events';
import type { Vec3 } from '../stimulus/shapes';

/** What a percept is about. */
export const PERCEPT_KINDS = ['seen-target', 'heard-noise', 'seen-anomaly', 'sensed-life'] as const;

/** What a percept is about. */
export type PerceptKind = (typeof PERCEPT_KINDS)[number];

declare const perceptSource: unique symbol;

/**
 * What a percept is of, as an opaque key: stable for one thing across evaluations (awareness keeps a
 * record per source), but not an entity id, so it cannot be used to read the world.
 */
export type PerceptSource = string & { readonly [perceptSource]: true };

/** The source key of an entity (a target seen, the pot that smashed). */
export function entitySource(entity: EntityId): PerceptSource {
  return `entity:${String(entity)}` as PerceptSource;
}

/** The source key of a world anomaly (an open door, a body), by the anomaly's own id. */
export function anomalySource(id: string): PerceptSource {
  return `anomaly:${id}` as PerceptSource;
}

/** The source key of a sound nobody is attributed with, by its kind (`throw`, `break`). */
export function soundSource(kind: string): PerceptSource {
  return `sound:${kind}` as PerceptSource;
}

/** One thing an agent perceived. Plain frozen data. */
export interface Percept {
  readonly source: PerceptSource;
  readonly kind: PerceptKind;
  /** The sense that perceived it: `sight`, `hearing` or a special-sense channel (`life-sense`). */
  readonly sense: string;
  /** Where the agent perceived it (not necessarily where it is), metres. */
  readonly position: Vec3;
  /** How strongly it registers, 0–1 (awareness builds from this). */
  readonly strength: number;
  /** How sure the agent is of what and where it is, 0–1. */
  readonly certainty: number;
}

/** One evaluation of one agent's senses. */
export interface PerceptionReport {
  /** The tick the senses were evaluated. */
  readonly tick: number;
  readonly agent: EntityId;
  /** Seconds since this agent's previous evaluation (its nominal period for the first one). */
  readonly seconds: number;
  /** Everything it perceived, in a fixed order: sight, anomalies, hearing, special senses. */
  readonly percepts: readonly Percept[];
}

/** Fired once per agent evaluation, with an empty list when it perceived nothing. */
export const perceived = defineEvent<PerceptionReport>('perceived');

/** A frozen percept (strength and certainty clamped to [0, 1]). */
export function percept(fields: Percept): Percept {
  return Object.freeze({
    ...fields,
    position: Object.freeze({ x: fields.position.x, y: fields.position.y, z: fields.position.z }),
    strength: clamp01(fields.strength),
    certainty: clamp01(fields.certainty),
  });
}

/** `n` clamped to [0, 1]. */
export function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}
