// The VFX particle budget (mw-e29.1): spectacle has to fit the frame. Pure logic, no renderer, so the
// rules are unit-tested here and the runtime (system.ts) only asks.
//
// - A global cap on live particles per quality tier. An effect reserves its worst-case particle count
//   when it is admitted, so a running effect can never push the total over the cap.
// - Priority: when a new effect does not fit, strictly lower-priority effects are culled (lowest
//   first, then oldest) to make room. If culling every lower-priority effect is still not enough,
//   nothing is culled and the new effect is refused.
// - Distance: effects beyond the cull distance (60 m) are culled before they cost anything, and
//   nearer ones emit less with distance (LOD tiers).

import type { VfxQualityTier } from '@content/index';
import { at } from './indexing.ts';

/**
 * Live particle caps per quality tier: style bible §13.1 (the per-frame scene budget that
 * e32-perf-budgets enforces).
 */
export const VFX_PARTICLE_CAPS: Readonly<Record<VfxQualityTier, number>> = Object.freeze({
  high: 2000,
  low: 800,
});

/** A distance band: effects spawned within `within` metres of the camera emit at `scale`. */
export interface VfxLodTier {
  readonly within: number;
  readonly scale: number;
}

/** Distance LOD, nearest first. Beyond the last band (60 m) effects are culled. */
export const VFX_LOD_TIERS: readonly VfxLodTier[] = Object.freeze([
  { within: 20, scale: 1 },
  { within: 40, scale: 0.5 },
  { within: 60, scale: 0.25 },
]);

/**
 * Emission scale for an effect `distance` metres from the camera, or 0 when it is beyond the last
 * band and must be culled.
 */
export function lodScale(distance: number, tiers: readonly VfxLodTier[] = VFX_LOD_TIERS): number {
  for (const tier of tiers) if (distance <= tier.within) return tier.scale;
  return 0;
}

/** What the budget knows about an admitted effect. */
export interface BudgetEntry {
  /** 0–100; higher survives longer. */
  readonly priority: number;
  /** Particles reserved. */
  readonly cost: number;
  /** Admission order; older entries are culled first among equal priorities. */
  readonly seq: number;
}

/** Tracks admitted effects against a particle cap. */
export class ParticleBudget<E extends BudgetEntry> {
  #cap: number;
  #used = 0;
  readonly #entries: E[] = [];
  /** Reused result of `request` / `setCap`. */
  readonly #victims: E[] = [];

  constructor(cap: number) {
    this.#cap = cap;
  }

  get cap(): number {
    return this.#cap;
  }

  /** Particles reserved by admitted effects. */
  get used(): number {
    return this.#used;
  }

  /** Admitted effects. */
  get size(): number {
    return this.#entries.length;
  }

  /**
   * Whether an effect of `priority` costing `cost` particles may be admitted, and what must be culled
   * first. Returns the victims (possibly none) to `remove` before `add`ing the new effect, or
   * `undefined` when it is refused. The returned array is reused by the next call.
   */
  request(priority: number, cost: number): readonly E[] | undefined {
    this.#victims.length = 0;
    if (cost > this.#cap) return undefined;
    let free = this.#cap - this.#used;
    if (cost <= free) return this.#victims;
    for (const entry of this.#entries) if (entry.priority < priority) this.#victims.push(entry);
    this.#victims.sort(cullOrder);
    let take = 0;
    while (free < cost && take < this.#victims.length) {
      free += at(this.#victims, take).cost;
      take++;
    }
    if (free < cost) {
      this.#victims.length = 0;
      return undefined;
    }
    this.#victims.length = take;
    return this.#victims;
  }

  add(entry: E): void {
    this.#entries.push(entry);
    this.#used += entry.cost;
  }

  /** Removes an admitted entry (no-op if it is not admitted). */
  remove(entry: E): void {
    const index = this.#entries.indexOf(entry);
    if (index < 0) return;
    this.#entries.splice(index, 1);
    this.#used -= entry.cost;
  }

  /**
   * Changes the cap (a quality tier change) and returns the entries to cull so the reserved total
   * fits it, lowest priority then oldest first. The returned array is reused by the next call.
   */
  setCap(cap: number): readonly E[] {
    this.#cap = cap;
    this.#victims.length = 0;
    let over = this.#used - cap;
    if (over <= 0) return this.#victims;
    this.#victims.push(...this.#entries);
    this.#victims.sort(cullOrder);
    let take = 0;
    while (over > 0) {
      over -= at(this.#victims, take).cost;
      take++;
    }
    this.#victims.length = take;
    return this.#victims;
  }
}

/** Lowest priority first, then oldest. */
function cullOrder(a: BudgetEntry, b: BudgetEntry): number {
  return a.priority - b.priority || a.seq - b.seq;
}
