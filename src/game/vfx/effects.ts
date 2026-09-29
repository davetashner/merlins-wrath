// Compiled effects (mw-e29.1): a loaded `vfx-effect` definition turned into what the runtime reads
// every frame (baked curves, sorted bursts, precomputed cone and flipbook numbers) and the particle
// counts the budget reserves. Pure: no renderer, no randomness.

import type { GameEntry, VfxBlendMode, VfxQualityTier } from '@content/index';
import { bakeColour, bakeScalar } from './curves.ts';

/** Which batch an emitter's particles are drawn in: same texture, blend and frame grid. */
export interface VfxBatchKey {
  readonly key: string;
  readonly texture: string;
  readonly blend: VfxBlendMode;
  readonly cols: number;
  readonly rows: number;
}

export interface CompiledEmitter {
  readonly id: string;
  readonly batch: VfxBatchKey;
  readonly rate: number;
  /** Bursts in time order. */
  readonly bursts: readonly { readonly at: number; readonly count: number }[];
  readonly lifeMin: number;
  readonly lifeMax: number;
  readonly speedMin: number;
  readonly speedMax: number;
  /** cos of the cone half-angle. */
  readonly cosCone: number;
  readonly spawnRadius: number;
  readonly gravity: number;
  readonly drag: number;
  readonly minTier: VfxQualityTier;
  readonly size: Float32Array;
  readonly colour: Float32Array;
  readonly alpha: Float32Array;
  /** Flipbook frame count (1 = a plain texture). */
  readonly frames: number;
  /** Flipbook frames per second; 0 = once over the particle's life. */
  readonly fps: number;
  /** Most particles alive at once at emission scale 1: the size of an instance's arrays. */
  readonly maxParticles: number;
}

export interface CompiledEffect {
  readonly id: string;
  readonly priority: number;
  readonly duration: number;
  readonly loop: boolean;
  readonly socket: string | undefined;
  readonly lowRateScale: number;
  readonly emitters: readonly CompiledEmitter[];
}

/** A loaded effect definition. */
export type VfxEffectEntry = GameEntry<'vfx-effect'>;

export function batchKey(emitter: VfxEffectEntry['emitters'][number]): VfxBatchKey {
  const cols = emitter.flipbook?.cols ?? 1;
  const rows = emitter.flipbook?.rows ?? 1;
  return {
    key: `${emitter.texture}|${emitter.blend}|${String(cols)}x${String(rows)}`,
    texture: emitter.texture,
    blend: emitter.blend,
    cols,
    rows,
  };
}

/** Particles one burst emits at emission `scale`. */
export function burstCount(count: number, scale: number): number {
  return Math.ceil(count * scale);
}

/**
 * Most particles an emitter can have alive at once at emission `scale`: the steady-state rate
 * population (plus one for the fractional accumulator) and every burst whose particles can still be
 * alive (a looping effect repeats its bursts each period).
 */
export function emitterCapacity(
  emitter: Pick<CompiledEmitter, 'rate' | 'bursts' | 'lifeMax'>,
  effect: Pick<CompiledEffect, 'duration' | 'loop'>,
  scale: number,
): number {
  if (scale <= 0) return 0;
  const rate = emitter.rate > 0 ? Math.ceil(emitter.rate * scale * emitter.lifeMax) + 1 : 0;
  const perPeriod = emitter.bursts.reduce((sum, b) => sum + burstCount(b.count, scale), 0);
  const periods = effect.loop ? Math.ceil(emitter.lifeMax / effect.duration) + 1 : 1;
  return rate + perPeriod * periods;
}

/** Whether an emitter runs on `tier`. */
export function runsOn(emitter: Pick<CompiledEmitter, 'minTier'>, tier: VfxQualityTier): boolean {
  return tier === 'high' || emitter.minTier === 'low';
}

/** Emission scale of the tier alone. */
export function tierScale(
  effect: Pick<CompiledEffect, 'lowRateScale'>,
  tier: VfxQualityTier,
): number {
  return tier === 'high' ? 1 : effect.lowRateScale;
}

/** Particles an effect reserves on `tier` at emission `scale` (tier scale included). */
export function effectCost(effect: CompiledEffect, tier: VfxQualityTier, scale: number): number {
  let cost = 0;
  for (const emitter of effect.emitters) {
    if (runsOn(emitter, tier)) cost += emitterCapacity(emitter, effect, scale);
  }
  return cost;
}

export function compileEffect(def: VfxEffectEntry): CompiledEffect {
  const base = { duration: def.duration, loop: def.loop };
  const emitters = def.emitters.map((e): CompiledEmitter => {
    const bursts = [...e.bursts].sort((a, b) => a.at - b.at);
    const partial = { rate: e.rate, bursts, lifeMax: e.lifetime.max };
    return {
      id: e.id,
      batch: batchKey(e),
      ...partial,
      lifeMin: e.lifetime.min,
      speedMin: e.speed.min,
      speedMax: e.speed.max,
      cosCone: Math.cos((e.coneDeg * Math.PI) / 180),
      spawnRadius: e.spawnRadius,
      gravity: e.gravity,
      drag: e.drag,
      minTier: e.minTier,
      size: bakeScalar(e.size),
      colour: bakeColour(e.color),
      alpha: bakeScalar(e.alpha),
      frames: (e.flipbook?.cols ?? 1) * (e.flipbook?.rows ?? 1),
      fps: e.flipbook?.fps ?? 0,
      maxParticles: emitterCapacity(partial, base, 1),
    };
  });
  return {
    id: def.id,
    priority: def.priority,
    ...base,
    socket: def.socket,
    lowRateScale: def.lowRateScale,
    emitters,
  };
}
