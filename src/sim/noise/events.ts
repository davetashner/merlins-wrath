// Noise events (mw-e03.11, the first emitter; mw-e03.25 adds the rest): one event every world system
// emits when it makes a sound worth hearing — a wall smashed, a pot shattered — so stealth's sound
// propagation (e09) and creature hearing (e11) listen to one channel instead of to each system.
// Loudness is a level in dB at 1 m from the source (e09 attenuates it with distance, doors and
// walls); audio playback stays with the cue sheets, which never read this event.

import type { EntityId } from '../core/component';
import { defineEvent } from '../core/events';
import type { Vec3 } from '../stimulus/shapes';

/** A sound made in the world. */
export interface NoiseEvent {
  readonly tick: number;
  /** Where the sound starts, metres. */
  readonly position: Vec3;
  /** Level 1 m from the source, dB. */
  readonly loudness: number;
  /** What made it, e.g. `break`. */
  readonly kind: string;
  /** The entity that sounded (the broken pot), or null. */
  readonly entity: EntityId | null;
  /** Who it is attributed to (the knight who smashed the pot), or null. */
  readonly source: EntityId | null;
}

/** Fired for every noise; stealth and AI hearing consume it. */
export const noiseEmitted = defineEvent<NoiseEvent>('noiseEmitted');
