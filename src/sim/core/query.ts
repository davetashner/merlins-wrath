// Cached component queries (mw-e00.15). A query's match list is rebuilt only when the world's
// structure (entities or component membership) has changed since it was last read, so steady-state
// ticks iterate a flat list. Stores keep ascending id order, and the match list is built by walking
// the smallest store, so iteration order is always ascending entity id.

import type { ComponentStore, ComponentType, EntityId } from './component';

/**
 * `items[index]` for indices that are in range by construction. noUncheckedIndexedAccess can't see
 * that and lint forbids `!`, so the assertion lives here once. Kept module-local (not imported):
 * it runs per entity per component in every query, and a local function is trivially inlined.
 */
function at<T>(items: readonly T[], index: number): T {
  return items[index] as T;
}

/** A non-empty list of component types. */
export type ComponentList = readonly [ComponentType<unknown>, ...ComponentType<unknown>[]];

/** The value types of a component list, position for position. */
export type ComponentValues<Ts extends ComponentList> = {
  [K in keyof Ts]: Ts[K] extends ComponentType<infer V> ? V : never;
};

/** Shared counter the world bumps on every structural change. */
export interface StructureVersion {
  version: number;
}

export class Query<Ts extends ComponentList> {
  private seen = -1;
  private matched: EntityId[] = [];
  /** Dense slots per component: columns[k][i] is match i's slot in store k. */
  private columns: number[][] = [];

  /** @internal Created by `World.query`, which caches one Query per component list. */
  constructor(
    private readonly structure: StructureVersion,
    private readonly stores: readonly ComponentStore<unknown>[],
  ) {}

  /** Matching entity ids, ascending. Valid until the world's structure next changes. */
  ids(): readonly EntityId[] {
    this.refresh();
    return this.matched;
  }

  /** Number of matching entities. */
  get count(): number {
    return this.ids().length;
  }

  /**
   * Calls `fn(id, ...values)` for each match in ascending id order. Values are the live stored
   * values, so mutating a plain-object component in place is visible to later systems.
   */
  forEach(fn: (id: EntityId, ...values: ComponentValues<Ts>) => void): void {
    this.refresh();
    const { matched, columns, stores } = this;
    const n = matched.length;
    // Every system iterates queries every tick, so the common widths avoid building an argument
    // array per entity. Columns and stores line up with the component list, so indices are in range.
    switch (stores.length) {
      case 1: {
        const f = fn as (id: EntityId, a: unknown) => void;
        const [va, ca] = [at(stores, 0).values, at(columns, 0)];
        for (let i = 0; i < n; i++) f(at(matched, i), at(va, at(ca, i)));
        return;
      }
      case 2: {
        const f = fn as (id: EntityId, a: unknown, b: unknown) => void;
        const [va, ca, vb, cb] = [
          at(stores, 0).values,
          at(columns, 0),
          at(stores, 1).values,
          at(columns, 1),
        ];
        for (let i = 0; i < n; i++) f(at(matched, i), at(va, at(ca, i)), at(vb, at(cb, i)));
        return;
      }
      case 3: {
        const f = fn as (id: EntityId, a: unknown, b: unknown, c: unknown) => void;
        const [va, ca, vb, cb] = [
          at(stores, 0).values,
          at(columns, 0),
          at(stores, 1).values,
          at(columns, 1),
        ];
        const [vc, cc] = [at(stores, 2).values, at(columns, 2)];
        for (let i = 0; i < n; i++) {
          f(at(matched, i), at(va, at(ca, i)), at(vb, at(cb, i)), at(vc, at(cc, i)));
        }
        return;
      }
      default: {
        const f = fn as (...args: unknown[]) => void;
        for (let i = 0; i < n; i++) {
          f(at(matched, i), ...stores.map((store, k) => at(store.values, at(at(columns, k), i))));
        }
      }
    }
  }

  private refresh(): void {
    if (this.seen === this.structure.version) return;
    const { stores } = this;
    for (const store of stores) store.sort(); // stores sort lazily (see World.settle)
    let driver = at(stores, 0); // a query has at least one component
    for (const store of stores) if (store.size < driver.size) driver = store;
    const matched: EntityId[] = [];
    const columns: number[][] = stores.map(() => []);
    for (const id of driver.ids) {
      const row: number[] = [];
      for (const store of stores) {
        const slot = store.slot(id);
        if (slot === undefined) break;
        row.push(slot);
      }
      if (row.length < stores.length) continue;
      matched.push(id);
      row.forEach((slot, k) => at(columns, k).push(slot));
    }
    this.matched = matched;
    this.columns = columns;
    this.seen = this.structure.version;
  }
}
