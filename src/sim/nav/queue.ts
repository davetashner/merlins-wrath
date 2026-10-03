// The path request queue (mw-e11.4): many agents may ask for paths in the same tick, but a tick may
// only spend a bounded share of the frame on path searches. Requests wait in submission order;
// `update()` runs once per tick and works through them, resuming a half-finished search first, until
// the tick's budget is spent. Whatever is left waits for the next tick (AC-5).
//
// The budget is counted in work units, not milliseconds: the sim never reads a clock, and a budget
// in units makes which request finishes on which tick deterministic (replays and state hashes stay
// identical on any machine). A unit is one polygon expansion; a search's set-up and its finishing
// (string pulling) are charged in units too (NavPathSearch.step). NAV_UNITS_PER_MS converts a time
// budget into units; it is calibrated on the reference machine, and tests/bench/nav-queue.bench.ts
// holds the line that a tick spending its whole budget stays within the time it stands for.

import { NavPathSearch, type NavPathRequest, type NavPathResult } from './path';
import type { NavMesh } from './mesh';
import { at } from './util';

/**
 * Work units a path search gets through per millisecond on the reference machine (M1 Pro), with a
 * safety margin (see ADR-0006 for the measurement).
 */
export const NAV_UNITS_PER_MS = 800;

/** The default per-tick budget, milliseconds (mw-e11.4 AC-5). */
export const NAV_DEFAULT_BUDGET_MS = 0.5;

/** Work units a tick may spend for a budget of `ms` milliseconds (at least one). */
export function navBudgetUnits(ms: number): number {
  return Math.max(1, Math.floor(ms * NAV_UNITS_PER_MS));
}

/** How the queue is set up. */
export interface NavQueueOptions {
  /** Work units per tick; defaults to `navBudgetUnits(NAV_DEFAULT_BUDGET_MS)`. */
  readonly unitsPerTick?: number;
}

interface Pending {
  readonly id: number;
  readonly request: NavPathRequest;
  search: NavPathSearch | undefined;
}

export class NavPathQueue {
  /** Work units each `update()` may spend. */
  readonly unitsPerTick: number;
  private readonly waiting: Pending[] = [];
  private readonly results = new Map<number, NavPathResult>();
  private nextId = 1;
  /** Work units the last `update()` spent (a finishing search may overrun the budget a little). */
  lastUnits = 0;

  constructor(
    readonly mesh: NavMesh,
    options: NavQueueOptions = {},
  ) {
    const budget = options.unitsPerTick ?? navBudgetUnits(NAV_DEFAULT_BUDGET_MS);
    if (!(budget >= 1)) throw new RangeError('unitsPerTick must be at least 1');
    this.unitsPerTick = budget;
  }

  /** Requests waiting or being searched. */
  get pending(): number {
    return this.waiting.length;
  }

  /** Queues a request and returns its id (ids count up from 1). */
  submit(request: NavPathRequest): number {
    const id = this.nextId++;
    this.waiting.push({ id, request, search: undefined });
    return id;
  }

  /** Whether request `id` is waiting or being searched. */
  isPending(id: number): boolean {
    return this.waiting.some((p) => p.id === id);
  }

  /** Drops a waiting request, or forgets a finished one's result. */
  cancel(id: number): void {
    const index = this.waiting.findIndex((p) => p.id === id);
    if (index >= 0) this.waiting.splice(index, 1);
    this.results.delete(id);
  }

  /** The result of request `id` once it has finished (kept until taken or cancelled). */
  result(id: number): NavPathResult | undefined {
    return this.results.get(id);
  }

  /** The result of request `id`, forgetting it; undefined while it is not finished. */
  take(id: number): NavPathResult | undefined {
    const result = this.results.get(id);
    this.results.delete(id);
    return result;
  }

  /**
   * Spends one tick's budget on waiting requests, in order, and returns the ids that finished. A
   * request already answered when it was set up (a start off the mesh) costs nothing.
   */
  update(): number[] {
    const finished: number[] = [];
    let left = this.unitsPerTick;
    while (this.waiting.length > 0) {
      const head = at(this.waiting, 0);
      head.search ??= new NavPathSearch(this.mesh, head.request);
      if (!head.search.done) {
        if (left <= 0) break;
        left -= head.search.step(left);
      }
      const { result } = head.search;
      if (result === undefined) break;
      this.waiting.shift();
      this.results.set(head.id, result);
      finished.push(head.id);
    }
    this.lastUnits = this.unitsPerTick - left;
    return finished;
  }
}
