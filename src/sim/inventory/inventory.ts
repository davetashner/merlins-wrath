// The inventory model (mw-e17.3, ADR-0003): what an actor carries, as item instances plus a gold
// counter. The pack is weightless and uncapped: there is no capacity, slot count or carry limit.
// `maxStack` only chunks units into display stacks (3 then 4 of a maxStack-5 item hold 5 + 2); a
// full stack starts a new one. The only clamps are gold (at the configured maximum, emitting
// `gold.capped`) and the technical guard of 9,999 units per definition, which bounds save size and
// refuses an add with `stack-limit`.
//
// Instances, not bare counts, so stolen and owner flags and unique artifacts are tracked one by one.
// An instance is `{ instanceId, defId, count, flags }`; units only stack with units of the same
// definition and the same flags, so stolen and clean units never merge. Unique items and items that
// are not stackable are one unit per instance. Instance ids come from a counter in the inventory
// itself, so they are deterministic and survive saves (unique within one inventory).
//
// Quest items (`flags.questItem` on the definition) are removed only by an effect with
// `force: true`; anything else is refused with reason `quest-item`. Every add and remove checks first
// and only then changes state, so a refusal (including removing more units than are held) changes
// nothing.
//
// The keyring, bookshelf, quest, artifact and consumable views are queries over the one list, in
// stable acquisition order; nothing is moved between them. The inventory screen's tabs (mw-e17.10)
// group categories on top of these.
//
// State is plain data on the actor (`inventory.pack`), so snapshots, saves, replays and the state
// hash carry it like any component. The component is added once (`addInventory`, at install, since
// structural changes during a tick are deferred); operations then replace its value immediately, so
// several in one tick compose. Equip slots (mw-e17.4), world pickup and drop (mw-e17.7) and the
// inventory screen (mw-e17.10) build on this.

import type { ItemCategory } from '../../content/types/item';
import { defineComponent, type EntityId } from '../core/component';
import { defineEvent } from '../core/events';
import type { World } from '../core/world';

/** ADR-0003's technical guard: units of one definition an inventory may hold (bounds save size). */
export const INVENTORY_UNIT_GUARD = 9999;

/** The default gold cap: the largest signed 32-bit integer. */
export const DEFAULT_GOLD_MAX = 2 ** 31 - 1;

/** Per-instance flags. Absent keys mean false / no owner. */
export interface ItemInstanceFlags {
  /** Taken without the owner's consent; never stacks with clean units. */
  readonly stolen?: boolean;
  /** Whose it was (a stolen item's victim), e.g. a faction or character id. */
  readonly ownerId?: string;
  /** Bound to its holder (cannot be traded). */
  readonly bound?: boolean;
}

/** One inventory entry: some units of one definition sharing flags. */
export interface ItemInstance {
  /** Unique within its inventory, never reused. */
  readonly instanceId: number;
  /** The item definition id (`src/content/data/item/<id>.json`). */
  readonly defId: string;
  /** Units in this stack: 1..maxStack, or 1 for an item that does not stack. */
  readonly count: number;
  readonly flags: ItemInstanceFlags;
}

/** An actor's inventory (`inventory.pack`; a snapshot and save key, never renamed). */
export interface InventoryState {
  readonly gold: number;
  /** The id the next new instance gets. */
  readonly nextInstanceId: number;
  /** Instances in acquisition order. */
  readonly items: readonly ItemInstance[];
}

export const InventoryComponent = defineComponent<InventoryState>('inventory.pack');

/**
 * What the inventory reads from an item definition. A loaded item (`ItemEntry`, mw-e17.2) is one;
 * tests may pass smaller literals.
 */
export interface InventoryItemDef {
  readonly id: string;
  readonly category: ItemCategory;
  readonly stackable: boolean;
  readonly maxStack?: number | undefined;
  readonly flags: { readonly unique: boolean; readonly questItem: boolean };
  readonly grants?: readonly { readonly capability: string }[];
  /**
   * A key's data: the lock ids it opens, the lock tag a master key opens (mw-e03.18), and whether it
   * is used up when it opens one (mw-e17.5).
   */
  readonly key?: {
    readonly opens: readonly string[];
    readonly opensTag?: string | undefined;
    readonly singleUse?: boolean | undefined;
  };
}

/** The views over an inventory (keys on the keyring, books on the bookshelf, and so on). */
export const INVENTORY_VIEWS = [
  'keyring',
  'bookshelf',
  'quest',
  'artifacts',
  'consumables',
] as const;
export type InventoryView = (typeof INVENTORY_VIEWS)[number];

const inView: Readonly<Record<InventoryView, (def: InventoryItemDef) => boolean>> = {
  keyring: (def) => def.category === 'key',
  bookshelf: (def) => def.category === 'book',
  quest: (def) => def.flags.questItem,
  artifacts: (def) => def.category === 'artifact',
  consumables: (def) => def.category === 'consumable',
};

/** What to select from an inventory; every given criterion must match. */
export interface InventoryQuery {
  readonly category?: ItemCategory;
  readonly view?: InventoryView;
  /** Instances whose definition grants this capability (equipped or carried). */
  readonly capability?: string;
  readonly defId?: string;
  /** Only stolen (true) or only clean (false) units. */
  readonly stolen?: boolean;
}

/** Why an add was refused. */
export type AddRefusal =
  /** It would take the definition past INVENTORY_UNIT_GUARD units. */
  | 'stack-limit'
  /** A unique item already held, or more than one unit of it. */
  | 'unique-held'
  /** Currency is a counter, not an item: use `addGold`. */
  | 'currency';

/** Why a remove was refused. */
export type RemoveRefusal =
  /** A quest item, without `force: true`. */
  | 'quest-item'
  /** Fewer matching units are held than asked for (nothing was removed). */
  | 'not-enough'
  /** No instance with that id. */
  | 'no-instance';

export type AddResult =
  | { readonly ok: true; readonly instanceIds: readonly number[] }
  | { readonly ok: false; readonly reason: AddRefusal };

export type RemoveResult =
  | { readonly ok: true; readonly instanceIds: readonly number[] }
  | { readonly ok: false; readonly reason: RemoveRefusal };

/** A remove: units of a definition (newest stacks first) or units of one instance. */
export type RemoveRequest = (
  | {
      readonly defId: string;
      /** Only stolen (true) or only clean (false) units; absent = any. */
      readonly stolen?: boolean;
    }
  | { readonly instanceId: number }
) & {
  readonly count: number;
  /** Set only by effects allowed to take quest items (ADR-0003). */
  readonly force?: boolean;
};

/** Units of one definition entered an inventory. */
export interface ItemAdded {
  readonly tick: number;
  readonly actor: EntityId;
  readonly defId: string;
  readonly count: number;
  readonly flags: ItemInstanceFlags;
  /** The instances that received units, in acquisition order. */
  readonly instanceIds: readonly number[];
}

/** Units of one definition left an inventory. */
export interface ItemRemoved {
  readonly tick: number;
  readonly actor: EntityId;
  readonly defId: string;
  readonly count: number;
  /** The instances that lost units (emptied ones are gone), in the order they were taken from. */
  readonly instanceIds: readonly number[];
  readonly forced: boolean;
}

/** An instance's flags changed (stolen goods fenced, an item bound). */
export interface ItemFlagChanged {
  readonly tick: number;
  readonly actor: EntityId;
  readonly instanceId: number;
  readonly defId: string;
  readonly before: ItemInstanceFlags;
  readonly after: ItemInstanceFlags;
}

/** An actor's gold changed. */
export interface GoldChanged {
  readonly tick: number;
  readonly actor: EntityId;
  readonly before: number;
  readonly after: number;
}

/** An add of gold hit the cap; `lost` units did not fit. */
export interface GoldCapped {
  readonly tick: number;
  readonly actor: EntityId;
  readonly max: number;
  readonly lost: number;
}

export const itemAdded = defineEvent<ItemAdded>('item.added');
export const itemRemoved = defineEvent<ItemRemoved>('item.removed');
export const itemFlagChanged = defineEvent<ItemFlagChanged>('item.flagChanged');
export const goldChanged = defineEvent<GoldChanged>('gold.changed');
export const goldCapped = defineEvent<GoldCapped>('gold.capped');

/**
 * Gives `actor` an empty inventory (and `gold`). Call once per actor, when it is installed: the
 * operations need it in place, and adding it is a structural change, deferred to the end of the
 * tick in a step.
 */
export function addInventory(world: World, actor: EntityId, gold = 0): void {
  if (!world.isRegistered(InventoryComponent)) world.register(InventoryComponent);
  world.add(actor, InventoryComponent, { gold, nextInstanceId: 1, items: [] });
}

/** `actor`'s inventory, or undefined when it has none. */
export function inventoryOf(world: World, actor: EntityId): InventoryState | undefined {
  return world.isRegistered(InventoryComponent) ? world.get(actor, InventoryComponent) : undefined;
}

/** Flags as stored: only the keys that are set, in a fixed order (stable snapshots and hashes). */
function normalFlags(flags: ItemInstanceFlags): ItemInstanceFlags {
  return {
    ...(flags.stolen === true && { stolen: true }),
    ...(flags.ownerId !== undefined && { ownerId: flags.ownerId }),
    ...(flags.bound === true && { bound: true }),
  };
}

const sameFlags = (a: ItemInstanceFlags, b: ItemInstanceFlags): boolean =>
  a.stolen === b.stolen && a.ownerId === b.ownerId && a.bound === b.bound;

const isStolen = (item: ItemInstance): boolean => item.flags.stolen === true;

function positiveCount(count: number, what: string): void {
  if (!Number.isSafeInteger(count) || count < 1) {
    throw new RangeError(`${what} must be a positive integer, got ${String(count)}`);
  }
}

/** The item definitions and limits every inventory operation goes through. */
export class InventoryRules {
  readonly #defs: ReadonlyMap<string, InventoryItemDef>;
  /** Units of one definition an inventory may hold. */
  readonly unitGuard: number;
  /** The gold cap. */
  readonly goldMax: number;

  /** `items`: every item definition (the content registry's); ids must be unique. */
  constructor(
    items: Iterable<InventoryItemDef>,
    options: { readonly goldMax?: number; readonly unitGuard?: number } = {},
  ) {
    const defs = new Map<string, InventoryItemDef>();
    for (const def of items) {
      if (defs.has(def.id)) throw new RangeError(`item "${def.id}" is defined twice`);
      defs.set(def.id, def);
    }
    this.#defs = defs;
    this.goldMax = options.goldMax ?? DEFAULT_GOLD_MAX;
    this.unitGuard = options.unitGuard ?? INVENTORY_UNIT_GUARD;
    positiveCount(this.goldMax, 'goldMax');
    positiveCount(this.unitGuard, 'unitGuard');
  }

  /** The definition of `defId`. @throws RangeError for an id it does not know. */
  def(defId: string): InventoryItemDef {
    const def = this.#defs.get(defId);
    if (def === undefined) throw new RangeError(`item "${defId}" is not defined`);
    return def;
  }

  /**
   * Adds `count` units of `defId` with `flags`. Units first fill this actor's non-full stacks with
   * the same definition and flags (in acquisition order), then open new stacks of at most
   * `maxStack`; an item that does not stack gets one instance per unit. Emits one `item.added`.
   * Refused, changing nothing, past the unit guard, for a second unique, or for currency.
   * @throws RangeError for an unknown item, a bad count, or an actor without an inventory.
   */
  add(
    world: World,
    actor: EntityId,
    defId: string,
    count: number,
    flags: ItemInstanceFlags = {},
  ): AddResult {
    const def = this.def(defId);
    positiveCount(count, 'count');
    const state = this.#state(world, actor);
    if (def.category === 'currency') return { ok: false, reason: 'currency' };
    const held = units(state.items, (item) => item.defId === defId);
    if (def.flags.unique && held + count > 1) return { ok: false, reason: 'unique-held' };
    if (held + count > this.unitGuard) return { ok: false, reason: 'stack-limit' };

    const stored = normalFlags(flags);
    const perStack = def.stackable ? (def.maxStack ?? 1) : 1;
    const touched: number[] = [];
    let left = count;
    const items = state.items.map((item) => {
      const room = perStack - item.count;
      if (left === 0 || room <= 0 || item.defId !== defId || !sameFlags(item.flags, stored)) {
        return item;
      }
      const take = Math.min(room, left);
      left -= take;
      touched.push(item.instanceId);
      return { ...item, count: item.count + take };
    });
    let nextInstanceId = state.nextInstanceId;
    while (left > 0) {
      const take = Math.min(perStack, left);
      left -= take;
      touched.push(nextInstanceId);
      items.push({ instanceId: nextInstanceId++, defId, count: take, flags: stored });
    }
    world.set(actor, InventoryComponent, { ...state, nextInstanceId, items });
    world.events.emit(itemAdded, {
      tick: world.tick,
      actor,
      defId,
      count,
      flags: stored,
      instanceIds: touched,
    });
    return { ok: true, instanceIds: touched };
  }

  /**
   * Removes units: of a definition (newest stacks first, optionally only stolen or only clean
   * units) or of one instance. Atomic: when fewer matching units are held, or the item is a quest
   * item and `force` is not set, it is refused and nothing changes. Emits one `item.removed`.
   * @throws RangeError for an unknown item, a bad count, or an actor without an inventory.
   */
  remove(world: World, actor: EntityId, request: RemoveRequest): RemoveResult {
    positiveCount(request.count, 'count');
    const state = this.#state(world, actor);
    let matches: (item: ItemInstance) => boolean;
    let defId: string;
    if ('instanceId' in request) {
      const instance = state.items.find((item) => item.instanceId === request.instanceId);
      if (instance === undefined) return { ok: false, reason: 'no-instance' };
      defId = instance.defId;
      matches = (item) => item === instance;
    } else {
      defId = request.defId;
      const { stolen } = request;
      matches = (item) =>
        item.defId === defId && (stolen === undefined || isStolen(item) === stolen);
    }
    const def = this.def(defId);
    const force = request.force === true;
    if (def.flags.questItem && !force) return { ok: false, reason: 'quest-item' };
    if (units(state.items, matches) < request.count) return { ok: false, reason: 'not-enough' };

    const touched: number[] = [];
    let left = request.count;
    const kept: ItemInstance[] = [];
    for (const item of [...state.items].reverse()) {
      if (left === 0 || !matches(item)) {
        kept.push(item);
        continue;
      }
      const take = Math.min(item.count, left);
      left -= take;
      touched.push(item.instanceId);
      if (take < item.count) kept.push({ ...item, count: item.count - take });
    }
    world.set(actor, InventoryComponent, { ...state, items: kept.reverse() });
    world.events.emit(itemRemoved, {
      tick: world.tick,
      actor,
      defId,
      count: request.count,
      instanceIds: touched,
      forced: force,
    });
    return { ok: true, instanceIds: touched };
  }

  /**
   * Replaces one instance's flags (a fence clears `stolen`, a ritual sets `bound`). The instance
   * keeps its id and units and does not merge with other stacks. Emits `item.flagChanged` when
   * the flags differ; returns false (and changes nothing) for an unknown instance or equal flags.
   * @throws RangeError for an actor without an inventory.
   */
  setFlags(world: World, actor: EntityId, instanceId: number, flags: ItemInstanceFlags): boolean {
    const state = this.#state(world, actor);
    const instance = state.items.find((item) => item.instanceId === instanceId);
    const after = normalFlags(flags);
    if (instance === undefined || sameFlags(instance.flags, after)) return false;
    const items = state.items.map((item) => (item === instance ? { ...item, flags: after } : item));
    world.set(actor, InventoryComponent, { ...state, items });
    world.events.emit(itemFlagChanged, {
      tick: world.tick,
      actor,
      instanceId,
      defId: instance.defId,
      before: instance.flags,
      after,
    });
    return true;
  }

  /**
   * Instances matching `query`, in acquisition order (a copy; empty for an actor without an
   * inventory). An empty query returns every instance.
   */
  query(world: World, actor: EntityId, query: InventoryQuery = {}): readonly ItemInstance[] {
    const items = inventoryOf(world, actor)?.items ?? [];
    return items.filter((item) => {
      const def = this.def(item.defId);
      return (
        (query.defId === undefined || item.defId === query.defId) &&
        (query.category === undefined || def.category === query.category) &&
        (query.view === undefined || inView[query.view](def)) &&
        (query.capability === undefined ||
          (def.grants ?? []).some((grant) => grant.capability === query.capability)) &&
        (query.stolen === undefined || isStolen(item) === query.stolen)
      );
    });
  }

  /** Units held matching `query` (0 for an actor without an inventory). */
  count(world: World, actor: EntityId, query: InventoryQuery = {}): number {
    return units(this.query(world, actor, query), () => true);
  }

  /**
   * Adds gold, clamped at `goldMax`; at the cap it emits `gold.capped` with the units that did not
   * fit. Emits `gold.changed` when the amount changed. Returns the gold now held.
   * @throws RangeError for a bad amount or an actor without an inventory.
   */
  addGold(world: World, actor: EntityId, amount: number): number {
    positiveCount(amount, 'amount');
    const state = this.#state(world, actor);
    const after = Math.min(this.goldMax, state.gold + amount);
    const lost = state.gold + amount - after;
    this.#setGold(world, actor, state, after);
    if (lost > 0) {
      world.events.emit(goldCapped, { tick: world.tick, actor, max: this.goldMax, lost });
    }
    return after;
  }

  /**
   * Spends gold. Returns false, changing nothing, when fewer than `amount` are held; otherwise
   * emits `gold.changed` and returns true.
   * @throws RangeError for a bad amount or an actor without an inventory.
   */
  spendGold(world: World, actor: EntityId, amount: number): boolean {
    positiveCount(amount, 'amount');
    const state = this.#state(world, actor);
    if (state.gold < amount) return false;
    this.#setGold(world, actor, state, state.gold - amount);
    return true;
  }

  #setGold(world: World, actor: EntityId, state: InventoryState, after: number): void {
    if (after === state.gold) return;
    world.set(actor, InventoryComponent, { ...state, gold: after });
    world.events.emit(goldChanged, { tick: world.tick, actor, before: state.gold, after });
  }

  #state(world: World, actor: EntityId): InventoryState {
    const state = inventoryOf(world, actor);
    if (state === undefined) {
      throw new RangeError(
        `entity ${String(actor)} has no inventory: call addInventory when installing it`,
      );
    }
    return state;
  }
}

/** Units across `items` that `matches` selects. */
function units(items: readonly ItemInstance[], matches: (item: ItemInstance) => boolean): number {
  let total = 0;
  for (const item of items) if (matches(item)) total += item.count;
  return total;
}
