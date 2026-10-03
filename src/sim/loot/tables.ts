// Loot tables (mw-e18.1): the deterministic roller behind containers (mw-e18.3) and creature drops.
// A table's `guaranteed` items always drop; then its `entries` are rolled a number of times drawn
// from `rolls`, each roll picking one eligible entry by weight. An item entry yields a count drawn
// from its range; a table entry rolls that table its count of times, one level deeper. Every draw
// comes from the RNG stream the caller passes (the world's `loot` stream for `rollInWorld`), in a
// fixed order, so the same table, stream state and context always yield the same stacks.
//
// An entry is eligible for a roll when its conditions hold, its weight is positive, it is not a
// unique item already obtained (or already dropped by this roll), and, in a `noDuplicates` table, it
// has not won before in this roll of the table. Ineligible entries are left out of the draw, so
// their weight is shared out among the rest in proportion; with nothing eligible the table's
// remaining rolls yield nothing. Unique items (`flags.unique`) drop one at a time and never while
// the context says they are obtained: by default the fact `item.<id>.obtained` (obtainedFactKey) is
// true. A guaranteed unique already obtained is skipped too.
//
// Nesting stops at LOOT_MAX_DEPTH (the root is depth 1). A table entry that would go deeper ends the
// whole roll: `loot.depthExceeded` is emitted with the chain of tables, and the stacks gathered so
// far are returned with the error, so a table that names itself can never loop.
//
// Conditions go through one predicate interface, `LootPredicate(conditions, context)`. The default,
// `simpleLootPredicate`, checks the player's class and a world-fact condition (mw-e27.5); the shared
// condition DSL (mw-e22) replaces it with the same signature and the roller does not change.
// Validating tables across files (references, uniques, cycles, weights) is mw-e18.2.

import { defineEvent } from '../core/events';
import type { EventType } from '../core/events';
import type { World } from '../core/world';
import { compileCondition, type CompiledCondition, type Condition } from '../facts/conditions';
import type { FactReader } from '../facts/conditions';
import type { Rng } from '../rng';

/** The deepest a chain of nested tables may go; the root table is depth 1. */
export const LOOT_MAX_DEPTH = 4;

/** The RNG stream `rollInWorld` draws from. */
export const LOOT_RNG_STREAM = 'loot';

/** A reference to a content entry by id (a loaded content ref satisfies it). */
export interface LootRef {
  readonly id: string;
}

/** A whole-number range, inclusive. */
export interface LootRange {
  readonly min: number;
  readonly max: number;
}

/** The predicates an entry may carry until the shared condition DSL (mw-e22) lands. */
export interface LootConditions {
  /** The player's class must be one of these. */
  readonly class?: readonly LootRef[] | undefined;
  /** A world-fact condition that must hold. */
  readonly when?: Condition | undefined;
}

/** One weighted entry: an item, or another table to roll. */
export interface LootEntry {
  readonly item?: LootRef | undefined;
  readonly table?: LootRef | undefined;
  readonly weight: number;
  /** Units of the item, or times the table is rolled. */
  readonly count: LootRange;
  readonly conditions?: LootConditions | undefined;
}

/** A loot table (the content type `loot-table` satisfies it). */
export interface LootTableDef {
  readonly id: string;
  readonly guaranteed: readonly { readonly item: LootRef; readonly count: number }[];
  readonly rolls: LootRange;
  readonly entries: readonly LootEntry[];
  readonly noDuplicates: boolean;
}

/** What the roller needs to know of an item (a content item satisfies it). */
export interface LootItemDef {
  readonly id: string;
  readonly flags?: { readonly unique?: boolean | undefined } | undefined;
}

/** Who the loot is for and the world it drops into. */
export interface LootContext {
  /** The player's class id, e.g. `thief`; absent: entries conditioned on a class never drop. */
  readonly classId?: string | undefined;
  /** World facts, read by fact conditions and the default obtained check. */
  readonly facts: FactReader;
  /** True when unique item `itemId` is already obtained; default: its obtained fact is true. */
  readonly isObtained?: ((itemId: string) => boolean) | undefined;
}

/**
 * Decides whether an entry's conditions hold. The shared condition DSL (mw-e22) implements this same
 * signature, so swapping it in leaves the roller unchanged.
 */
export type LootPredicate = (conditions: LootConditions, context: LootContext) => boolean;

/** Units of one item. */
export interface LootStack {
  readonly item: string;
  readonly count: number;
}

/** A chain of nested tables deeper than LOOT_MAX_DEPTH, which ended the roll. */
export interface LootDepthExceeded {
  readonly tick: number;
  /** The table that was rolled. */
  readonly table: string;
  /** The tables from the root to the one that was not rolled; its length is LOOT_MAX_DEPTH + 1. */
  readonly chain: readonly string[];
  readonly maxDepth: number;
}

/** Fired when a roll stops because nested tables went deeper than LOOT_MAX_DEPTH. */
export const lootDepthExceeded = defineEvent<LootDepthExceeded>('loot.depthExceeded');

/** The result of one roll. */
export interface LootRoll {
  /** Units per item, merged, in the order each item first dropped. */
  readonly stacks: readonly LootStack[];
  /** Set when the roll stopped early because nesting went too deep. */
  readonly error?: LootDepthExceeded;
}

/** Where `loot.depthExceeded` goes: anything with `emit` (the world's event bus), and the tick. */
export interface LootEventSink {
  readonly events: { emit<T>(type: EventType<T>, payload: T): void };
  readonly tick: number;
}

/** The fact that records unique item `itemId` as obtained, e.g. `item.ring-of-ash.obtained`. */
export function obtainedFactKey(itemId: string): string {
  return `item.${itemId}.obtained`;
}

/** Thrown when a roll reaches an id the tables or items do not define. */
export class LootReferenceError extends RangeError {
  override readonly name = 'LootReferenceError';
}

/** A value known to be present by construction (noUncheckedIndexedAccess can't see it). */
const known = <T>(value: T | undefined): T => value as T;

/** Compiled fact conditions, shared by every entry that holds the same condition object. */
const compiled = new WeakMap<Condition, CompiledCondition>();

function compiledOf(condition: Condition): CompiledCondition {
  let result = compiled.get(condition);
  if (result === undefined) {
    result = compileCondition(condition);
    compiled.set(condition, result);
  }
  return result;
}

/** The default predicate: the class is one of `class` (when given) and `when` holds (when given). */
export const simpleLootPredicate: LootPredicate = (conditions, context) =>
  (conditions.class === undefined || conditions.class.some((ref) => ref.id === context.classId)) &&
  (conditions.when === undefined || compiledOf(conditions.when).evaluate(context.facts));

/** One roll in progress. */
interface RollState {
  readonly rng: Rng;
  readonly context: LootContext;
  readonly obtained: (itemId: string) => boolean;
  /** Units per item, insertion-ordered. */
  readonly counts: Map<string, number>;
}

/** The loot tables and items one game rolls against. */
export class LootTables {
  readonly #tables: ReadonlyMap<string, LootTableDef>;
  readonly #items: ReadonlyMap<string, LootItemDef>;
  readonly #predicate: LootPredicate;

  /**
   * `tables` and `items`: every definition (the content registry's); ids must be unique.
   * `predicate`: how entry conditions are tested (default `simpleLootPredicate`).
   */
  constructor(
    tables: Iterable<LootTableDef>,
    items: Iterable<LootItemDef>,
    options: { readonly predicate?: LootPredicate } = {},
  ) {
    this.#tables = byId(tables, 'loot table');
    this.#items = byId(items, 'item');
    this.#predicate = options.predicate ?? simpleLootPredicate;
  }

  /**
   * Rolls table `tableId` with `rng` for `context`. With `sink`, a roll stopped by nesting deeper
   * than LOOT_MAX_DEPTH emits `loot.depthExceeded` there.
   * @throws LootReferenceError for a table or item id it does not define.
   */
  roll(tableId: string, rng: Rng, context: LootContext, sink?: LootEventSink): LootRoll {
    const { facts } = context;
    const state: RollState = {
      rng,
      context,
      obtained: context.isObtained ?? ((id) => facts.get(obtainedFactKey(id)) === true),
      counts: new Map(),
    };
    const tooDeep = this.#rollTable(tableId, [], state);
    const stacks = [...state.counts].map(([item, count]) => ({ item, count }));
    if (tooDeep === undefined) return { stacks };
    const error = {
      tick: sink?.tick ?? 0,
      table: tableId,
      chain: tooDeep,
      maxDepth: LOOT_MAX_DEPTH,
    };
    sink?.events.emit(lootDepthExceeded, error);
    return { stacks, error };
  }

  /**
   * Rolls `tableId` in `world`: draws from its `loot` stream, reads its facts and emits on its bus.
   * @throws LootReferenceError for a table or item id it does not define.
   */
  rollInWorld(world: World, tableId: string, context: Omit<LootContext, 'facts'> = {}): LootRoll {
    return this.roll(
      tableId,
      world.random(LOOT_RNG_STREAM),
      { ...context, facts: world.facts },
      world,
    );
  }

  /** Rolls one table; returns the chain of tables when nesting went too deep (the roll stops). */
  #rollTable(
    tableId: string,
    parents: readonly string[],
    state: RollState,
  ): readonly string[] | undefined {
    const chain = [...parents, tableId];
    if (chain.length > LOOT_MAX_DEPTH) return chain;
    const table = this.#tables.get(tableId);
    if (table === undefined) throw new LootReferenceError(`loot table "${tableId}" is not defined`);
    for (const { item, count } of table.guaranteed) {
      if (this.#mayDrop(item.id, state)) this.#add(item.id, count, state);
    }
    const won = new Set<LootEntry>();
    const rolls = state.rng.int(table.rolls.min, table.rolls.max);
    for (let i = 0; i < rolls; i++) {
      const eligible = table.entries.filter(
        (entry) =>
          entry.weight > 0 &&
          !(table.noDuplicates && won.has(entry)) &&
          (entry.item === undefined || this.#mayDrop(entry.item.id, state)) &&
          (entry.conditions === undefined || this.#predicate(entry.conditions, state.context)),
      );
      if (eligible.length === 0) break;
      const entry = state.rng.weighted(eligible.map((value) => ({ value, weight: value.weight })));
      won.add(entry);
      const count = state.rng.int(entry.count.min, entry.count.max);
      if (entry.item === undefined) {
        // An entry names an item or a table (the schema guarantees one of them).
        const nested = known(entry.table).id;
        for (let n = 0; n < count; n++) {
          const tooDeep = this.#rollTable(nested, chain, state);
          if (tooDeep !== undefined) return tooDeep;
        }
      } else {
        this.#add(entry.item.id, count, state);
      }
    }
    return undefined;
  }

  /** False for a unique item already obtained or already dropped by this roll. */
  #mayDrop(itemId: string, state: RollState): boolean {
    if (!this.#unique(itemId)) return true;
    return !state.counts.has(itemId) && !state.obtained(itemId);
  }

  /** Adds units; a unique item adds one at most. Zero units add nothing. */
  #add(itemId: string, count: number, state: RollState): void {
    const units = this.#unique(itemId) ? Math.min(count, 1) : count;
    if (units === 0) return;
    state.counts.set(itemId, (state.counts.get(itemId) ?? 0) + units);
  }

  #unique(itemId: string): boolean {
    const def = this.#items.get(itemId);
    if (def === undefined) throw new LootReferenceError(`item "${itemId}" is not defined`);
    return def.flags?.unique === true;
  }
}

function byId<T extends { readonly id: string }>(
  defs: Iterable<T>,
  what: string,
): ReadonlyMap<string, T> {
  const map = new Map<string, T>();
  for (const def of defs) {
    if (map.has(def.id)) throw new RangeError(`${what} "${def.id}" is defined twice`);
    map.set(def.id, def);
  }
  return map;
}
