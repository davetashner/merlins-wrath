// Merchant runtime state (mw-e20.4): what a shop has left, apart from its authored definition. Per
// merchant id: the gold it carries, its stock lines (what is on the shelf now), and the buyback list
// (the last BUYBACK_LIMIT things the player sold it, repurchasable at the price paid until restock).
// The state is created the first time a merchant is touched (src/sim/economy/shop.ts) and held per
// world, outside the snapshot like the level delta store, so the `merchants` save section
// (src/game/save/merchants.ts) saves and restores it. All of it is plain data and every change
// replaces a merchant's whole record, so a transaction swaps state in one step.

import type { ItemInstanceFlags } from '../inventory/inventory';
import type { World } from '../core/world';

/** How many sales the buyback list remembers; the oldest falls onto the shelf past it. */
export const BUYBACK_LIMIT = 10;

/** Units of one item on the shelf. Ids come from the merchant's own counter and are never reused. */
export interface StockLine {
  readonly id: number;
  readonly defId: string;
  readonly count: number;
  /** Stolen / owner flags the units carry; they pass to the buyer's instance. */
  readonly flags: ItemInstanceFlags;
  /** The authored stock entry that supplied it (for restocking), or null for goods the player sold. */
  readonly entry: number | null;
}

/** One sale the player may undo. */
export interface BuybackEntry {
  readonly id: number;
  readonly defId: string;
  readonly count: number;
  readonly flags: ItemInstanceFlags;
  /** Whole gold per unit the merchant paid, which is also the price to buy it back. */
  readonly unitPrice: number;
}

/** One merchant's runtime state. */
export interface MerchantState {
  readonly gold: number;
  /** The id the next stock line or buyback entry gets. */
  readonly nextId: number;
  /** Lines in shelf order. */
  readonly stock: readonly StockLine[];
  /** Oldest sale first. */
  readonly buyback: readonly BuybackEntry[];
  /**
   * The world day the shop was last brought up to (mw-e20.5); restocking runs for the days after it.
   * Absent in states saved before restocking existed: such a shop is taken as current.
   */
  readonly restockedDay?: number;
  /** Indices of authored stock entries gated by a `when` that have appeared (and stay). */
  readonly opened?: readonly number[];
}

/** The saved form: merchant id → state. */
export type MerchantStates = Readonly<Record<string, MerchantState>>;

export const sameFlags = (a: ItemInstanceFlags, b: ItemInstanceFlags): boolean =>
  a.stolen === b.stolen && a.ownerId === b.ownerId && a.bound === b.bound;

/** Adds units to the shelf, merging with a line of the same item, flags and source. */
export function shelve(
  state: MerchantState,
  defId: string,
  count: number,
  flags: ItemInstanceFlags,
  entry: number | null,
): MerchantState {
  const at = state.stock.findIndex(
    (line) => line.defId === defId && line.entry === entry && sameFlags(line.flags, flags),
  );
  if (at >= 0) {
    const stock = state.stock.map((line, i) =>
      i === at ? { ...line, count: line.count + count } : line,
    );
    return { ...state, stock };
  }
  const line: StockLine = { id: state.nextId, defId, count, flags, entry };
  return { ...state, nextId: state.nextId + 1, stock: [...state.stock, line] };
}

/** Every merchant's state in one world. */
export class MerchantStore {
  readonly #states = new Map<string, MerchantState>();

  get(merchantId: string): MerchantState | undefined {
    return this.#states.get(merchantId);
  }

  set(merchantId: string, state: MerchantState): void {
    this.#states.set(merchantId, state);
  }

  /** The states by merchant id, in code-unit id order (canonical for saves). */
  capture(): MerchantStates {
    const out: Record<string, MerchantState> = {};
    for (const [id, state] of [...this.#states].sort(([a], [b]) => Number(a > b) - Number(a < b)))
      out[id] = state;
    return out;
  }

  /** Replaces everything with a save's states. */
  restore(states: MerchantStates): void {
    this.#states.clear();
    for (const [id, state] of Object.entries(states)) this.#states.set(id, state);
  }
}

const stores = new WeakMap<object, MerchantStore>();

/** The merchant states of `world`, created empty on first use. */
export function merchantStoreOf(world: World<never>): MerchantStore {
  let store = stores.get(world);
  if (store === undefined) {
    store = new MerchantStore();
    stores.set(world, store);
  }
  return store;
}
