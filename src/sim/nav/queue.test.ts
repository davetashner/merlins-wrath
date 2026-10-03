import { describe, expect, it } from 'vitest';
import { IN_A, IN_B, ON_PLATFORM, OPENER, twoRooms, WALKER } from './fixtures';
import { NavPathSearch, type NavPathRequest } from './path';
import { NAV_DEFAULT_BUDGET_MS, NAV_UNITS_PER_MS, navBudgetUnits, NavPathQueue } from './queue';

const open = () => 'open' as const;

/** 30 requests across both rooms, the platform and back: varied lengths. */
function thirty(): NavPathRequest[] {
  const ends = [IN_A, IN_B, ON_PLATFORM, { x: 12, y: 0, z: 5 }, { x: 3, y: 0, z: 3 }];
  return Array.from({ length: 30 }, (_, n) => ({
    start: ends[n % ends.length] ?? IN_A,
    goal: ends[(n * 3 + 1) % ends.length] ?? IN_B,
    agent: OPENER,
    doors: open,
  }));
}

describe('path request queue (mw-e11.4)', () => {
  it('AC-5: 30 requests in one tick at a 0.5 ms budget: excess deferred, all done within 10 ticks', () => {
    const mesh = twoRooms();
    const queue = new NavPathQueue(mesh, { unitsPerTick: navBudgetUnits(0.5) });
    // Cost of the whole batch if it ran unbounded, in the queue's units.
    const total = thirty().reduce((sum, r) => {
      const search = new NavPathSearch(mesh, r);
      search.run();
      return sum + search.iterations;
    }, 0);
    const ids = thirty().map((r) => queue.submit(r));
    const done: number[][] = [];
    for (let tick = 0; tick < 10 && queue.pending > 0; tick++) {
      done.push(queue.update());
      // A finishing search may overrun by its path's length, never by a whole search.
      expect(queue.lastUnits).toBeLessThanOrEqual(queue.unitsPerTick + mesh.polyCount);
    }
    // Deferred: the first tick could not answer everything...
    expect((done[0] ?? []).length).toBeLessThan(30);
    expect(total).toBeGreaterThan(queue.unitsPerTick);
    // ...and everything is answered within 10 ticks, in submission order.
    expect(done.length).toBeLessThanOrEqual(10);
    expect(done.flat()).toEqual(ids);
    for (const id of ids) expect(queue.result(id)?.status).toBe('found');
  });

  it('AC-5: which request finishes on which tick is the same on every run', () => {
    const run = () => {
      const queue = new NavPathQueue(twoRooms(), { unitsPerTick: 20 });
      for (const r of thirty()) queue.submit(r);
      const ticks: number[][] = [];
      while (queue.pending > 0) ticks.push(queue.update());
      return ticks;
    };
    expect(run()).toEqual(run());
  });

  it('converts a time budget into expansions, at least one', () => {
    expect(NAV_DEFAULT_BUDGET_MS).toBe(0.5);
    expect(navBudgetUnits(0.5)).toBe(Math.floor(0.5 * NAV_UNITS_PER_MS));
    expect(navBudgetUnits(0)).toBe(1);
    expect(new NavPathQueue(twoRooms()).unitsPerTick).toBe(navBudgetUnits(0.5));
    expect(() => new NavPathQueue(twoRooms(), { unitsPerTick: 0 })).toThrow(
      new RangeError('unitsPerTick must be at least 1'),
    );
  });

  it('resumes a half-done search on the next tick and answers off-mesh starts at once', () => {
    const queue = new NavPathQueue(twoRooms(), { unitsPerTick: 1 });
    const long = queue.submit({ start: IN_A, goal: IN_B, agent: OPENER, doors: open });
    const off = queue.submit({ start: { x: 99, y: 0, z: 99 }, goal: IN_A, agent: WALKER });
    expect(queue.update()).toEqual([]);
    expect(queue.isPending(long)).toBe(true);
    let ticks = 1;
    while (queue.isPending(long)) {
      queue.update();
      ticks++;
    }
    expect(ticks).toBeGreaterThan(1);
    expect(queue.result(long)?.status).toBe('found');
    // The off-mesh start costs nothing: it finished in the same update as the long search.
    expect(queue.pending).toBe(0);
    expect(queue.take(off)).toEqual({ status: 'off-mesh' });
    expect(queue.take(off)).toBeUndefined();
  });

  it('cancels waiting requests and forgets finished ones', () => {
    const queue = new NavPathQueue(twoRooms(), { unitsPerTick: 1000 });
    const a = queue.submit({ start: IN_A, goal: IN_B, agent: OPENER, doors: open });
    const b = queue.submit({ start: IN_A, goal: IN_B, agent: OPENER, doors: open });
    queue.cancel(a);
    expect(queue.isPending(a)).toBe(false);
    expect(queue.update()).toEqual([b]);
    queue.cancel(b);
    expect(queue.result(b)).toBeUndefined();
    expect(queue.update()).toEqual([]);
    expect(queue.lastUnits).toBe(0);
  });
});
