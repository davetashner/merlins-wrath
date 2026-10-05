import { describe, expect, it } from 'vitest';
import { World } from '../core/world';
import { addInventory, InventoryRules } from '../inventory/inventory';
import { LootTables, type LootTableDef } from '../loot/tables';
import { DAY_CLOCK_FACTS, factDayClock } from '../rest/day-clock';
import { restCompleted } from '../rest/rest';
import { restockPeriodDays, RESTOCK_MAX_DAYS } from './restock';
import { Shops, type ShopItemDef, type ShopMerchantDef } from './shop';
import { merchantStoreOf, type MerchantState } from './shop-state';

const item = (
  id: string,
  value: number,
  extra: { unique?: boolean; stackable?: boolean } = {},
): ShopItemDef => ({
  id,
  category: 'misc',
  value,
  stackable: extra.stackable ?? true,
  maxStack: 999,
  flags: { unique: extra.unique ?? false, questItem: false },
});
const ITEMS = [
  item('arrow', 1),
  item('relic', 100, { unique: true, stackable: false }),
  item('gem', 50),
  item('apple', 4),
  item('bridge-toll', 20),
];
const TABLE: LootTableDef = {
  id: 'wares',
  guaranteed: [],
  rolls: { min: 1, max: 1 },
  noDuplicates: false,
  entries: [
    { item: { id: 'apple' }, weight: 3, count: { min: 1, max: 4 } },
    { item: { id: 'gem' }, weight: 1, count: { min: 1, max: 2 } },
  ],
};

const base = { buysCategories: ['misc'], markup: 1, buyRate: 0.5 } as const;
const shop: ShopMerchantDef = {
  ...base,
  id: 'shop',
  goldReserve: 200,
  goldRestockPerDay: 60,
  stock: [
    { item: { id: 'arrow' }, count: 3, restock: { everyHours: 24, amount: 3 } },
    { item: { id: 'relic' }, count: 1 },
    { item: { id: 'gem' }, count: 5, restock: { everyHours: 72, amount: 1 } },
    { lootTable: { id: 'wares' }, count: 4, restock: { everyHours: 24, amount: 1 } },
    { lootTable: { id: 'wares' }, count: 2 },
    {
      item: { id: 'bridge-toll' },
      count: 2,
      when: { fact: 'bridge.repaired' },
      restock: { everyHours: 24, amount: 2 },
    },
    { item: { id: 'relic' }, count: 1, when: { fact: 'bridge.repaired' } },
  ],
};

function setup() {
  const world = new World({ seed: 21 });
  for (const [key, spec] of Object.entries(DAY_CLOCK_FACTS)) world.facts.declare(key, spec);
  world.facts.declare('bridge.repaired', { type: 'bool', default: false });
  const actor = world.spawn();
  addInventory(world, actor, 500);
  const rules = new InventoryRules(ITEMS);
  const shops = new Shops([shop], ITEMS, rules, new LootTables([TABLE], ITEMS));
  const clock = factDayClock(world.facts);
  const state = (): MerchantState => shops.stateOf(world, 'shop');
  const units = (s: MerchantState, defId: string, entry?: number): number =>
    s.stock.reduce(
      (n, l) => n + (l.defId === defId && (entry === undefined || l.entry === entry) ? l.count : 0),
      0,
    );
  const buyAll = (defId: string, entry?: number): void => {
    for (const line of state().stock.filter(
      (l) => l.defId === defId && (entry === undefined || l.entry === entry),
    )) {
      expect(shops.buy(world, actor, 'shop', line.id, line.count).ok).toBe(true);
    }
  };
  /** Ends day `day` and restocks, as the game does when it hears `rest.completed`. */
  const passTo = (day: number): void => {
    clock.set({ day, minute: 6 * 60 });
    shops.restock(world, day);
  };
  return { world, actor, rules, shops, state, units, buyAll, passTo, clock };
}

describe('merchant restocking (mw-e20.5)', () => {
  it('AC-1: a restock entry of count 3 at stock 0 is back to 3 after a day tick', () => {
    const s = setup();
    s.buyAll('arrow');
    expect(s.units(s.state(), 'arrow')).toBe(0);
    s.passTo(2);
    expect(s.units(s.state(), 'arrow')).toBe(3);
  });

  it('refills by `amount` each period, never past count, on every period boundary crossed', () => {
    const s = setup();
    s.buyAll('gem'); // entry 2 sells gems; the loot table may also roll some, so count by entry
    expect(s.units(s.state(), 'gem', 2)).toBe(0);
    s.passTo(2); // 72 hours = 3 days: day 2 is not a boundary
    expect(s.units(s.state(), 'gem', 2)).toBe(0);
    s.passTo(3);
    expect(s.units(s.state(), 'gem', 2)).toBe(1);
    s.passTo(9); // days 4..9 cross 6 and 9
    expect(s.units(s.state(), 'gem', 2)).toBe(3);
    s.passTo(40);
    expect(s.units(s.state(), 'gem', 2)).toBe(5);
    expect(restockPeriodDays(1)).toBe(1);
    expect(restockPeriodDays(25)).toBe(2);
  });

  it('AC-2: the rotating stock for a merchant and day is identical on a re-roll or after a reload', () => {
    const roll = (): string => {
      const s = setup();
      s.state(); // the shop exists on day 1, then days pass
      s.passTo(5);
      return JSON.stringify(s.state().stock.filter((l) => l.entry === 3));
    };
    expect(roll()).toBe(roll());
    // A second world that skipped straight to day 5 matches one that slept each night.
    const nightly = setup();
    nightly.state();
    for (let day = 2; day <= 5; day++) nightly.passTo(day);
    expect(JSON.stringify(nightly.state().stock.filter((l) => l.entry === 3))).toBe(roll());
    // And the rotation really rotates: some day's stock differs from another's.
    const seen = new Set<string>();
    for (let day = 2; day <= 12; day++) {
      const s = setup();
      s.state();
      s.passTo(day);
      seen.add(JSON.stringify(s.state().stock.filter((l) => l.entry === 3)));
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it('a rotation replaces unsold units; an entry with no restock rule is rolled once and kept', () => {
    const s = setup();
    const fixed = JSON.stringify(s.state().stock.filter((l) => l.entry === 4));
    for (let day = 2; day <= 6; day++) s.passTo(day);
    expect(JSON.stringify(s.state().stock.filter((l) => l.entry === 4))).toBe(fixed);
    expect(s.state().stock.some((l) => l.entry === 3)).toBe(true);
  });

  it('AC-3: a sold-out unique item never reappears, however many days pass', () => {
    const s = setup();
    s.buyAll('relic');
    expect(s.units(s.state(), 'relic')).toBe(0);
    for (let day = 2; day <= 40; day++) s.passTo(day);
    s.passTo(500);
    expect(s.units(s.state(), 'relic')).toBe(0);
  });

  it('AC-4: stock gated on bridge.repaired appears on the next tick after the fact turns true, and stays', () => {
    const s = setup();
    expect(s.units(s.state(), 'bridge-toll')).toBe(0);
    s.passTo(2);
    expect(s.units(s.state(), 'bridge-toll')).toBe(0);
    s.world.facts.set('bridge.repaired', true);
    expect(s.units(s.state(), 'bridge-toll')).toBe(0); // not until a tick
    s.passTo(3);
    expect(s.units(s.state(), 'bridge-toll')).toBe(2);
    expect(s.units(s.state(), 'relic', 6)).toBe(1);
    // It stays when the fact flips back, restocks like any entry, and a gated unique does not return.
    s.world.facts.set('bridge.repaired', false);
    s.buyAll('bridge-toll');
    s.buyAll('relic', 6);
    s.passTo(4);
    expect(s.units(s.state(), 'bridge-toll')).toBe(2);
    expect(s.units(s.state(), 'relic', 6)).toBe(0);
    s.world.facts.set('bridge.repaired', true);
    s.passTo(5);
    expect(s.units(s.state(), 'relic', 6)).toBe(0);
  });

  it('a gated entry whose fact is already true opens when the shop is first created', () => {
    const world = new World({ seed: 1 });
    world.facts.set('bridge.repaired', true);
    const shops = new Shops(
      [shop],
      ITEMS,
      new InventoryRules(ITEMS),
      new LootTables([TABLE], ITEMS),
    );
    const state = shops.stateOf(world, 'shop');
    expect(state.opened).toEqual([5, 6]);
    expect(state.stock.some((l) => l.defId === 'bridge-toll')).toBe(true);
  });

  it('gold refills by goldRestockPerDay a day toward the reserve, clamped at it', () => {
    const s = setup();
    const store = merchantStoreOf(s.world);
    store.set('shop', { ...s.state(), gold: 0 });
    s.passTo(2);
    expect(s.state().gold).toBe(60);
    s.passTo(4); // two more days
    expect(s.state().gold).toBe(180);
    s.passTo(5);
    expect(s.state().gold).toBe(200);
    s.passTo(400);
    expect(s.state().gold).toBe(200);
    // Gold above the reserve (from the player's purchases) is left alone.
    store.set('shop', { ...s.state(), gold: 900 });
    s.passTo(401);
    expect(s.state().gold).toBe(900);
  });

  it('the buyback list clears onto the shelf', () => {
    const s = setup();
    s.rules.add(s.world, s.actor, 'apple', 3);
    const apple = s.rules.query(s.world, s.actor, { defId: 'apple' })[0]?.instanceId ?? 0;
    expect(s.shops.sell(s.world, s.actor, 'shop', apple, 3).ok).toBe(true);
    expect(s.state().buyback).toHaveLength(1);
    s.passTo(2);
    expect(s.state().buyback).toEqual([]);
    expect(s.state().stock.filter((l) => l.entry === null)).toMatchObject([
      { defId: 'apple', count: 3 },
    ]);
    // Sold-in goods have no authored entry, so they are never restocked.
    expect(s.state().stock.some((l) => l.entry === null && l.defId === 'apple')).toBe(true);
  });

  it('restocking the same day twice changes nothing; a past day does not rewind', () => {
    const s = setup();
    s.buyAll('arrow');
    s.passTo(2);
    const once = JSON.stringify(s.state());
    s.shops.restock(s.world, 2);
    expect(JSON.stringify(s.state())).toBe(once);
    s.shops.restock(s.world, 1);
    expect(s.units(s.state(), 'arrow')).toBe(3);
  });

  it('a long jump replays at most RESTOCK_MAX_DAYS days and agrees with going night by night', () => {
    const jump = setup();
    jump.buyAll('arrow');
    jump.buyAll('gem');
    jump.passTo(1 + 3 * RESTOCK_MAX_DAYS);
    const steps = setup();
    steps.buyAll('arrow');
    steps.buyAll('gem');
    for (let day = 2; day <= 1 + 3 * RESTOCK_MAX_DAYS; day++) steps.passTo(day);
    // Same shelves and till; the ids only count how many lines each path made on the way.
    const shelves = (st: MerchantState) =>
      st.stock.map(({ defId, count, entry }) => ({ defId, count, entry }));
    expect(shelves(jump.state())).toEqual(shelves(steps.state()));
    expect(jump.state().gold).toBe(steps.state().gold);
  });

  it('a merchant touched after days have passed catches up on its own, from the day fact', () => {
    const s = setup();
    s.buyAll('arrow');
    s.clock.set({ day: 4, minute: 0 });
    expect(s.units(s.state(), 'arrow')).toBe(3);
    expect(s.state().restockedDay).toBe(4);
  });

  it('a state saved before restocking is taken as current, and merchants without state are skipped', () => {
    const s = setup();
    const { gold, nextId, stock, buyback } = s.state();
    const old: MerchantState = { gold, nextId, stock, buyback };
    merchantStoreOf(s.world).set('shop', old);
    s.clock.set({ day: 9, minute: 0 });
    s.shops.restock(s.world, 9);
    expect(s.state().restockedDay).toBe(9);
    merchantStoreOf(s.world).set('stranger', old);
    s.shops.restock(s.world, 10); // a merchant with no definition in this build is left alone
    expect(merchantStoreOf(s.world).get('stranger')).toEqual(old);
  });

  it('a loot-table entry without LootTables fails clearly', () => {
    const world = new World({ seed: 1 });
    const shops = new Shops([shop], ITEMS, new InventoryRules(ITEMS));
    expect(() => shops.stateOf(world, 'shop')).toThrow(/pass LootTables/);
  });

  it('restockOnRest restocks on rest.completed and stops when unsubscribed', () => {
    const s = setup();
    s.buyAll('arrow');
    const stop = s.shops.restockOnRest(s.world);
    const wake = (day: number): void => {
      s.world.events.emit(restCompleted, {
        tick: 0,
        actor: s.actor,
        kind: 'inn',
        hours: 9,
        point: 'shop',
        wakes: { day, minute: 360 },
      });
      s.world.events.flush();
    };
    wake(2);
    expect(s.state().restockedDay).toBe(2);
    expect(s.units(s.state(), 'arrow')).toBe(3);
    stop();
    s.buyAll('arrow');
    wake(3);
    expect(s.state().restockedDay).toBe(2);
    expect(s.units(s.state(), 'arrow')).toBe(0);
  });
});
