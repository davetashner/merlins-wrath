// The events breaking emits (mw-e03.11). `breakableBroken` is the one every consumer reads — audio
// and VFX cue sheets, quests and crime (the source), persistence of broken state (e27), nav (the space
// it cleared) — and is emitted the tick the hit lands, before the broken entity, its colliders and
// body leave the world at the end of that tick.

import type { EntityId } from '../core/component';
import { defineEvent } from '../core/events';
import type { BreakType } from '../properties/spec';
import type { Vec3 } from '../stimulus/shapes';

/** Why it broke: one impact at or over its `fragile` threshold, or its structure (`hp`) worn to 0. */
export type BreakCause = 'impact' | 'structure';

/** One break. */
export interface BreakableBrokenInfo {
  readonly tick: number;
  readonly entity: EntityId;
  readonly profile: string;
  readonly material: string;
  readonly cause: BreakCause;
  /** The kind of hit that broke it; `collision` for a physics impact (thrown, fallen, struck). */
  readonly by: BreakType | 'collision';
  /** Who broke it (the striker, archer or thrower), or null. */
  readonly source: EntityId | null;
  /** Its centre, metres. */
  readonly position: Vec3;
  /** The box it no longer blocks (nav hook), metres. */
  readonly cleared: { readonly min: Vec3; readonly max: Vec3 };
  /** Debris it left, ascending id (some may already be culled by the budget). */
  readonly debris: readonly EntityId[];
  /** Props it spilled, in content order. */
  readonly spilled: readonly EntityId[];
  /** The passage it revealed, or null. */
  readonly reveals: string | null;
  /** Noise of the break 1 m away, dB. */
  readonly loudness: number;
}

export const breakableBroken = defineEvent<BreakableBrokenInfo>('breakableBroken');

/** A break opened a configured passage (a smashed wall onto a hidden room). */
export interface PassageRevealed {
  readonly tick: number;
  readonly passage: string;
  /** The entity that broke. */
  readonly entity: EntityId;
  readonly source: EntityId | null;
  readonly position: Vec3;
}

export const passageRevealed = defineEvent<PassageRevealed>('passageRevealed');

/** The debris budget removed the oldest pieces to make room for new ones. */
export interface DebrisCulled {
  readonly tick: number;
  readonly budget: number;
  /** Removed pieces, oldest first. */
  readonly culled: readonly EntityId[];
}

export const debrisCulled = defineEvent<DebrisCulled>('debrisCulled');
