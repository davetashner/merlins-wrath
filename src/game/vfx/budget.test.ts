import { describe, expect, it } from 'vitest';
import { lodScale, ParticleBudget, VFX_LOD_TIERS, VFX_PARTICLE_CAPS } from './budget.ts';

interface Entry {
  readonly name: string;
  readonly priority: number;
  readonly cost: number;
  readonly seq: number;
}

let seq = 0;
const entry = (name: string, priority: number, cost: number): Entry => ({
  name,
  priority,
  cost,
  seq: seq++,
});
const names = (entries: readonly Entry[] | undefined) => entries?.map((e) => e.name);

describe('particle budget', () => {
  it('caps follow the style bible per-frame scene budget', () => {
    expect(VFX_PARTICLE_CAPS).toEqual({ high: 2000, low: 800 });
  });

  it('admits whatever fits without culling', () => {
    const budget = new ParticleBudget<Entry>(100);
    expect(budget.request(10, 60)).toEqual([]);
    budget.add(entry('a', 10, 60));
    expect(budget.request(10, 40)).toEqual([]);
    expect(budget.used).toBe(60);
    expect(budget.size).toBe(1);
  });

  it('AC-2: at the High cap of 4000, lower-priority effects are culled first and the new one is admitted only if its priority is higher', () => {
    const budget = new ParticleBudget<Entry>(4000);
    expect(budget.cap).toBe(4000);
    const low = entry('low', 10, 1500);
    const lowNewer = entry('low-newer', 10, 1000);
    const mid = entry('mid', 50, 1000);
    const high = entry('high', 90, 500);
    for (const e of [mid, lowNewer, high, low]) budget.add(e);
    expect(budget.used).toBe(4000);

    // Equal or lower priority never culls anything.
    expect(budget.request(10, 100)).toBeUndefined();
    expect(budget.request(5, 100)).toBeUndefined();

    // Priority 60 needing 2000: the two priority-10 effects go (oldest first), not the 50 or 90.
    expect(names(budget.request(60, 2000))).toEqual(['low', 'low-newer']);
    // Needing 1600: the oldest lowest is not enough alone, so the next lowest goes too.
    expect(names(budget.request(60, 1600))).toEqual(['low', 'low-newer']);
    // Needing 1000: the oldest lowest-priority effect alone frees enough.
    expect(names(budget.request(60, 1000))).toEqual(['low']);
    // Priority 60 needing 3600 would need the priority-90 effect too: refused, nothing culled.
    expect(budget.request(60, 3600)).toBeUndefined();

    // Carry one out: cull, then add.
    const incoming = entry('incoming', 60, 1000);
    for (const victim of [...(budget.request(60, 1000) ?? [])]) budget.remove(victim);
    budget.add(incoming);
    expect(budget.used).toBe(3500);
    expect(budget.size).toBe(4);
  });

  it('refuses an effect bigger than the whole cap', () => {
    const budget = new ParticleBudget<Entry>(100);
    expect(budget.request(100, 101)).toBeUndefined();
  });

  it('removing an entry that is not admitted does nothing', () => {
    const budget = new ParticleBudget<Entry>(100);
    budget.add(entry('a', 1, 10));
    budget.remove(entry('b', 1, 10));
    expect(budget.used).toBe(10);
  });

  it('a lower cap culls lowest priority, then oldest, until the rest fits', () => {
    const budget = new ParticleBudget<Entry>(2000);
    const a = entry('a', 50, 600);
    const b = entry('b', 20, 500);
    const c = entry('c', 20, 400);
    budget.add(a);
    budget.add(b);
    budget.add(c);
    expect(budget.setCap(3000)).toEqual([]);
    expect(names(budget.setCap(800))).toEqual(['b', 'c']);
    expect(budget.cap).toBe(800);
  });
});

describe('distance LOD', () => {
  it('AC-4: beyond 60 m an effect is culled (scale 0); nearer bands emit less with distance', () => {
    expect(VFX_LOD_TIERS.at(-1)?.within).toBe(60);
    expect(lodScale(0)).toBe(1);
    expect(lodScale(20)).toBe(1);
    expect(lodScale(30)).toBe(0.5);
    expect(lodScale(60)).toBe(0.25);
    expect(lodScale(70)).toBe(0);
    expect(lodScale(5, [{ within: 4, scale: 1 }])).toBe(0);
  });
});
