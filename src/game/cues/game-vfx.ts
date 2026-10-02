// Game VFX wiring (mw-e29.3): the VFX cue bridge on a world's event bus, spawning content effects
// through the VFX runtime, so hits, parries, impacts, breaks and fires are seen where they are
// heard. Presentation only: the bridge reads events, material and facing lookups and entity
// transforms, and never writes to the sim.

import type { ArrowDefinition } from '@content/index';
import type { EntityId, World } from '@sim/index';
import type { VfxAnchor } from '../vfx/index.ts';
import { worldCueLookups, type CueMaterial } from './audio-bridge.ts';
import { VfxCueBridge, type VfxCueRule, type VfxSpawner } from './vfx-bridge.ts';

export interface GameVfxOptions {
  readonly world: World<never>;
  /** The VFX runtime (the VfxSystem satisfies it). */
  readonly vfx: VfxSpawner;
  readonly sheets: readonly { readonly id: string; readonly rules: readonly VfxCueRule[] }[];
  readonly materials: readonly CueMaterial[];
  /** Arrows, for their own impact effects (arrowImpact's `vfx` fact). */
  readonly arrows?: readonly Pick<ArrowDefinition, 'id' | 'cues'>[];
  /** Where an entity is right now (the runtime's anchor resolver). */
  readonly locate: (entity: EntityId) => VfxAnchor | undefined;
  /** Presentation clock in ms. */
  readonly now: () => number;
  /** Dev build (warn about placeholder effect ids); default: the Vite build mode. */
  readonly dev?: boolean;
}

/** Attaches the VFX cue bridge to the world's events; returns a function that detaches it. */
export function attachGameVfx(options: GameVfxOptions): () => void {
  const bridge = new VfxCueBridge({
    sheets: options.sheets,
    vfx: options.vfx,
    now: options.now,
    locate: options.locate,
    lookups: worldCueLookups(options.world, options.materials, {
      ...(options.arrows !== undefined && { arrows: options.arrows }),
    }),
    ...(options.dev !== undefined && { dev: options.dev }),
  });
  return bridge.attach(options.world.events);
}
