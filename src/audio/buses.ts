// Mix bus graph (mw-e28.1): master → music, sfx (→ combat, footsteps, creatures), ambience, ui.
// Assets arrive at fixed file loudness (audio bible §5.1); the mixer balances categories with bus
// gains (mw-e28.5) and a limiter on master keeps true peak under −1 dBTP.
import type { BusId, PlayableBusId } from './manifest.ts';
import type { AudioContextLike, DynamicsCompressorNodeLike, GainNodeLike } from './web-audio.ts';

/** Each bus's parent; master feeds the limiter. */
export const BUS_PARENT: Readonly<Record<PlayableBusId, BusId>> = {
  music: 'master',
  sfx: 'master',
  combat: 'sfx',
  footsteps: 'sfx',
  creatures: 'sfx',
  ambience: 'master',
  ui: 'master',
};

/** Master limiter settings: brick-wall-ish at −1 dB (audio bible §5.1 master target). */
export const LIMITER = { threshold: -1, knee: 0, ratio: 20, attack: 0.003, release: 0.25 } as const;

export interface BusGraph {
  readonly buses: Readonly<Record<BusId, GainNodeLike>>;
  readonly limiter: DynamicsCompressorNodeLike;
}

/** Builds the bus graph on a context, all gains at unity. */
export function buildBusGraph(ctx: AudioContextLike): BusGraph {
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = LIMITER.threshold;
  limiter.knee.value = LIMITER.knee;
  limiter.ratio.value = LIMITER.ratio;
  limiter.attack.value = LIMITER.attack;
  limiter.release.value = LIMITER.release;
  limiter.connect(ctx.destination);

  const master = ctx.createGain();
  master.connect(limiter);
  const buses = { master } as Record<BusId, GainNodeLike>;
  // BUS_PARENT lists parents before children, so each parent exists when its child connects.
  for (const [bus, parent] of Object.entries(BUS_PARENT) as [PlayableBusId, BusId][]) {
    const node = ctx.createGain();
    node.connect(buses[parent]);
    buses[bus] = node;
  }
  return { buses, limiter };
}

/** Converts decibels to a linear gain factor. */
export function dbToGain(db: number): number {
  return 10 ** (db / 20);
}
