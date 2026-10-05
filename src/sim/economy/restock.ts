// Merchant restocking (mw-e20.5): shops change as world days pass (docs/design/economy.md). One pure
// function, `restockMerchant(state, def, day, deps)`, brings a merchant's state up to world `day`;
// `Shops.restock` runs it for every merchant with state, on `rest.completed` and (as a catch-up, so a
// save loaded days later or a long sleep needs no event) whenever a merchant is next touched.
// mw-e27.12's clock calls the same function when it advances the day. Nothing here reads a wall
// clock or Math.random: the result depends only on the state, the definition, the day and the
// world seed, so reloading and re-rolling give identical shops.
//
// Rules, per elapsed day, oldest first (at most RESTOCK_MAX_DAYS of them; the gold refill and the
// buyback clear are arithmetic and cover every day):
// - An item entry with a `restock` rule gains `amount` units each `ceil(everyHours / 24)` days
//   (days divisible by the period), up to its authored `count`. An entry without `restock` never
//   refills, so a sold-out unique item never reappears. Goods the player sold into stock (entry
//   null) are never restocked.
// - A loot-table entry with a `restock` rule rotates on the same schedule: its unsold units are
//   replaced by `count` rolls of the table, drawn from a stream derived from (world seed, merchant
//   id, entry, day). Without a `restock` rule it is rolled once and kept.
// - Gold refills by `goldRestockPerDay` a day toward `goldReserve` (never past it, never reducing
//   gold above it).
// - The buyback list clears onto the shelf.
// - An entry with a `when` condition is absent until the condition holds, appears at the next
//   restock after that and stays, even if sold out (a gated unique never comes back).

import { compileCondition, type Condition, type FactReader } from '../facts/conditions';
import type { Rng } from '../rng';
import { shelve, type MerchantState } from './shop-state';

/** Most elapsed days a catch-up replays one by one; older days change nothing a later day would not. */
export const RESTOCK_MAX_DAYS = 30;

/** What restocking reads of a merchant definition (a `ShopMerchantDef` satisfies it). */
export interface RestockMerchantDef {
  readonly id: string;
  readonly goldReserve: number;
  readonly goldRestockPerDay?: number | undefined;
  readonly stock: readonly RestockEntryDef[];
}

export interface RestockEntryDef {
  readonly item?: { readonly id: string } | undefined;
  readonly lootTable?: { readonly id: string } | undefined;
  readonly count: number;
  readonly restock?: { readonly everyHours: number; readonly amount: number } | undefined;
  readonly when?: Condition | undefined;
}

/** What restocking needs from the world. */
export interface RestockDeps {
  readonly facts: FactReader;
  /** The seed-derived stream named `name` (a pure function of the world seed and the name). */
  stream(name: string): Rng;
  /** Rolls `tableId` `rolls` times with `rng` and totals the units by item id. */
  roll(tableId: string, rolls: number, rng: Rng): ReadonlyMap<string, number>;
}

/** Days between restocks for a rule: `everyHours` rounded up to whole days. */
export const restockPeriodDays = (everyHours: number): number => Math.ceil(everyHours / 24);

/** Name of the stream a rotating entry is rolled with on `day`. */
export const restockStream = (merchantId: string, entry: number, day: number): string =>
  `shop.restock.${merchantId}.${String(entry)}.${String(day)}`;

/** Name of the stream a gated entry is rolled with when it opens. */
const openStream = (merchantId: string, entry: number): string =>
  `shop.open.${merchantId}.${String(entry)}`;

/** Puts entry `index`'s authored stock on the shelf (items directly, loot tables rolled). */
export function stockEntry(
  state: MerchantState,
  def: RestockMerchantDef,
  index: number,
  deps: RestockDeps,
  rng: Rng,
): MerchantState {
  const [entry] = def.stock.slice(index, index + 1) as [RestockEntryDef];
  if (entry.item !== undefined) return shelve(state, entry.item.id, entry.count, {}, index);
  let next = state;
  const tableId = (entry.lootTable as { readonly id: string }).id;
  for (const [item, count] of deps.roll(tableId, entry.count, rng)) {
    next = shelve(next, item, count, {}, index);
  }
  return next;
}

/** Opens every gated entry whose condition now holds (the shelf gets its authored stock). */
export function openGatedStock(
  state: MerchantState,
  def: RestockMerchantDef,
  deps: RestockDeps,
): MerchantState {
  let next = state;
  def.stock.forEach((entry, index) => {
    if (entry.when === undefined || (next.opened ?? []).includes(index)) return;
    if (!compileCondition(entry.when).evaluate(deps.facts)) return;
    next = stockEntry(next, def, index, deps, deps.stream(openStream(def.id, index)));
    next = { ...next, opened: [...(next.opened ?? []), index] };
  });
  return next;
}

/** The state of `def`'s shop on world `day`, given its state on an earlier one. */
export function restockMerchant(
  state: MerchantState,
  def: RestockMerchantDef,
  day: number,
  deps: RestockDeps,
): MerchantState {
  const from = state.restockedDay ?? day;
  let next = openGatedStock(state, def, deps);
  if (day > from) {
    const elapsed = day - from;
    const perDay = def.goldRestockPerDay ?? 0;
    if (next.gold < def.goldReserve) {
      next = { ...next, gold: Math.min(def.goldReserve, next.gold + perDay * elapsed) };
    }
    for (const entry of next.buyback) {
      next = shelve(next, entry.defId, entry.count, entry.flags, null);
    }
    next = { ...next, buyback: [] };
    for (let d = Math.max(from + 1, day - RESTOCK_MAX_DAYS + 1); d <= day; d++) {
      next = restockDay(next, def, d, deps);
    }
  }
  return { ...next, restockedDay: Math.max(from, day) };
}

/** One day's refills and rotations of the entries that are open. */
function restockDay(
  state: MerchantState,
  def: RestockMerchantDef,
  day: number,
  deps: RestockDeps,
): MerchantState {
  let next = state;
  def.stock.forEach((entry, index) => {
    const { restock } = entry;
    if (restock === undefined || day % restockPeriodDays(restock.everyHours) !== 0) return;
    if (entry.when !== undefined && !(next.opened ?? []).includes(index)) return;
    if (entry.item !== undefined) {
      const have = next.stock.reduce((n, l) => n + (l.entry === index ? l.count : 0), 0);
      const add = Math.min(restock.amount, entry.count - have);
      if (add > 0) next = shelve(next, entry.item.id, add, {}, index);
      return;
    }
    next = { ...next, stock: next.stock.filter((line) => line.entry !== index) };
    next = stockEntry(next, def, index, deps, deps.stream(restockStream(def.id, index, day)));
  });
  return next;
}
