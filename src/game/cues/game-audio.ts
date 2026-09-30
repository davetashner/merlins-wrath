// Game audio wiring (mw-e28.2): the cue bridge on a world's event bus, playing the game's sound
// manifest through the audio engine, so sim events (hits, stagger, physics impacts…) are heard in
// the testbed. Presentation only: the bridge reads events and material lookups and never writes to
// the sim. Nothing plays before the autoplay policy lets the context run (the first user gesture,
// see installGestureUnlock), so sounds from the scene settling at load are dropped, not queued.

import type { PlayOptions } from '@audio/index';
import type { CueRuleDef, MaterialDef } from '@content/index';
import type { EntityId, World } from '@sim/index';
import type { SimView, Transform } from '../loop/render-sync.ts';
import {
  AudioCueBridge,
  soundVariantCount,
  worldCueLookups,
  type CuePlayer,
} from './audio-bridge.ts';

/** The engine as the wiring uses it (the AudioEngine satisfies it). */
export interface GameAudioEngine extends CuePlayer {
  readonly context: { readonly state: string } | undefined;
}

export interface GameAudioOptions {
  readonly world: World<never>;
  readonly engine: GameAudioEngine;
  /** Variant counts per cue (the engine's SoundRegistry satisfies it). */
  readonly registry: { get(id: string): { readonly variants: readonly string[] } | undefined };
  readonly sheets: readonly { readonly rules: readonly CueRuleDef[] }[];
  readonly materials: readonly Pick<MaterialDef, 'id' | 'impactSound'>[];
  /** Presentation clock in ms. */
  readonly now: () => number;
  /** Called with each cue actually sent to the engine (debug overlays, e2e probes). */
  readonly onPlay?: (cue: string, options: PlayOptions) => void;
}

/** Attaches the cue bridge to the world's events; returns a function that detaches it. */
export function attachGameAudio(options: GameAudioOptions): () => void {
  const { engine, onPlay } = options;
  const player: CuePlayer = {
    play: (cue, playOptions) => {
      if (engine.context?.state !== 'running') return null;
      onPlay?.(cue, playOptions);
      return engine.play(cue, playOptions);
    },
  };
  const bridge = new AudioCueBridge({
    sheets: options.sheets,
    player,
    now: options.now,
    lookups: worldCueLookups(options.world, options.materials),
    variantCount: soundVariantCount(options.registry),
  });
  return bridge.attach(options.world.events);
}

/** Reads an entity's transform, if it has the component the reader knows. */
export type EntityTransformReader = (view: SimView, entity: EntityId) => Transform | undefined;

/**
 * Where an entity's sounds come from: the first reader that knows the entity (physics objects,
 * placed characters, static scene pieces…).
 */
export function soundPositions(
  view: SimView,
  readers: readonly EntityTransformReader[],
): (entity: EntityId) => Transform['position'] | undefined {
  return (entity) => {
    for (const read of readers) {
      const transform = read(view, entity);
      if (transform !== undefined) return transform.position;
    }
    return undefined;
  };
}
