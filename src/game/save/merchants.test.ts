// The merchants save section (mw-e20.4 AC-6): stock, gold and buyback survive a save and load
// exactly; a removed item definition costs only that item; a v1 save loads at the current version.
import { loadGameContent } from '@content/index';
import {
  addInventory,
  hashWorld,
  inventoryOf,
  InventoryRules,
  merchantStoreOf,
  Shops,
  World,
  type ShopMerchantDef,
} from '@sim/index';
import { describe, expect, it, vi } from 'vitest';
import { migrateSection, validateSection } from './format';
import {
  droppedShopItemMessage,
  MERCHANTS_MIGRATIONS,
  MERCHANTS_SECTION_VERSION,
  merchantsSaveSection,
} from './merchants';
import { createGameSaveRegistry } from './sections';

const content = loadGameContent();
const items = content.all('item');
const rules = new InventoryRules(items);
const knownItem = (id: string): boolean => content.has('item', id);
const build = { gameVersion: '0.1.0', buildSha: 'deadbee', contentHash: 'c0ffee' };
const saveOptions = { build, wallClockSavedAt: 1_790_000_000_000 };

const merchant = (id: string, gold: number, stock: readonly string[]): ShopMerchantDef => ({
  id,
  buysCategories: ['weapon', 'consumable', 'misc'],
  goldReserve: gold,
  markup: 1.2,
  buyRate: 0.4,
  stock: stock.map((item) => ({ item: { id: item }, count: 3 })),
});

const MERCHANTS = [
  merchant('smith', 500, ['arming-sword', 'healing-draught']),
  merchant('herbalist', 80, ['healing-draught']),
];
const shops = new Shops(MERCHANTS, items, rules);

function shopWorld(seed: number) {
  const world = new World({ seed });
  const actor = world.spawn();
  addInventory(world, actor, 400);
  return { world, actor };
}

/** A world with real traffic: a buy, a sale of stolen-flagged goods and a partial buyback. */
function tradedWorld() {
  const { world, actor } = shopWorld(11);
  const smith = shops.stateOf(world, 'smith');
  const draught = smith.stock.find((l) => l.defId === 'healing-draught')?.id ?? 0;
  expect(shops.buy(world, actor, 'smith', draught, 2).ok).toBe(true);
  rules.add(world, actor, 'arming-sword', 1);
  const sword = rules.query(world, actor, { defId: 'arming-sword' })[0]?.instanceId ?? 0;
  expect(shops.sell(world, actor, 'smith', sword).ok).toBe(true);
  const entry = shops.stateOf(world, 'smith').buyback[0]?.id ?? 0;
  expect(shops.buyBack(world, actor, 'smith', entry).ok).toBe(true);
  shops.stateOf(world, 'herbalist');
  return { world, actor };
}

describe('merchants save section', () => {
  it('AC-6: stock, gold and buyback are unchanged after a save and load', () => {
    const { world, actor } = tradedWorld();
    // Leave a sale in the buyback list when saving.
    rules.add(world, actor, 'healing-draught', 1);
    const draught = rules.query(world, actor, { defId: 'healing-draught' }).at(-1)?.instanceId ?? 0;
    expect(shops.sell(world, actor, 'herbalist', draught).ok).toBe(true);
    const before = merchantStoreOf(world).capture();
    expect(before['herbalist']?.buyback).toHaveLength(1);
    expect(before['smith']?.gold).not.toBe(500);

    const bytes = createGameSaveRegistry({ knownItem }).write(world, saveOptions);
    const loaded = new World({ seed: 99 });
    const result = createGameSaveRegistry({ knownItem }).read(loaded, bytes);

    expect(result.ok).toBe(true);
    expect(merchantStoreOf(loaded).capture()).toEqual(before);
    expect(inventoryOf(loaded, actor)).toEqual(inventoryOf(world, actor));
    expect(hashWorld(loaded)).toBe(hashWorld(world));
    // The loaded shop carries on from the saved state.
    expect(shops.stateOf(loaded, 'smith')).toEqual(before['smith']);
  });

  it('a save with an item removed from the build drops it from stock and buyback, warns, and loads the rest', () => {
    const { world } = tradedWorld();
    const store = merchantStoreOf(world);
    const smith = store.get('smith');
    if (smith === undefined) throw new Error('expected a state');
    store.set('smith', {
      ...smith,
      stock: [
        ...smith.stock,
        { id: 90, defId: 'retired-lantern', count: 1, flags: {}, entry: null },
      ],
      buyback: [
        ...smith.buyback,
        { id: 91, defId: 'retired-lantern', count: 1, flags: {}, unitPrice: 4 },
      ],
    });
    const bytes = createGameSaveRegistry().write(world, saveOptions);

    const warn = vi.fn<(message: string) => void>();
    const loaded = new World({ seed: 5 });
    const result = createGameSaveRegistry({ knownItem, warn }).read(loaded, bytes);

    expect(result.ok).toBe(true);
    expect(merchantStoreOf(loaded).get('smith')).toEqual(smith);
    expect(merchantStoreOf(loaded).get('herbalist')).toEqual(store.get('herbalist'));
    expect(warn.mock.calls.map(([message]) => message)).toEqual([
      droppedShopItemMessage('smith', 'retired-lantern', 'stock'),
      droppedShopItemMessage('smith', 'retired-lantern', 'buyback'),
    ]);

    // Without a logger the load still drops quietly; without `knownItem` it keeps every item.
    const quiet = new World({ seed: 6 });
    expect(createGameSaveRegistry({ knownItem }).read(quiet, bytes).ok).toBe(true);
    expect(merchantStoreOf(quiet).get('smith')).toEqual(smith);
    const keepAll = new World({ seed: 7 });
    expect(createGameSaveRegistry().read(keepAll, bytes).ok).toBe(true);
    expect(merchantStoreOf(keepAll).capture()).toEqual(store.capture());
  });

  it('a save from before the section existed loads with no merchant state', () => {
    const { world } = tradedWorld();
    const fresh = new World({ seed: 3 });
    merchantStoreOf(fresh).set('smith', shops.stateOf(world, 'smith'));
    const section = merchantsSaveSection();
    section.missing?.(fresh, { warn: () => undefined, worldFacts: undefined });
    expect(merchantStoreOf(fresh).capture()).toEqual({});
  });

  it('v1 data passes through the migration runner and validates; bad data is refused', () => {
    const section = merchantsSaveSection();
    expect(MERCHANTS_SECTION_VERSION).toBe(2);
    expect(Object.keys(MERCHANTS_MIGRATIONS)).toEqual(['1']);
    const data = { merchants: merchantStoreOf(tradedWorld().world).capture() };
    const migrated = migrateSection(section, { version: 1, data });
    expect(migrated).toEqual({ ok: true, data });
    expect(validateSection(section, data).ok).toBe(true);
    expect(validateSection(section, { merchants: { smith: { gold: -1 } } }).ok).toBe(false);
  });

  it('mw-e20.5: restock bookkeeping saves, and restocking after a load equals restocking without one', () => {
    const keeper: ShopMerchantDef = {
      ...merchant('keeper', 100, []),
      goldRestockPerDay: 25,
      stock: [
        { item: { id: 'healing-draught' }, count: 4, restock: { everyHours: 24, amount: 4 } },
      ],
    };
    const restocking = new Shops([keeper], items, rules);
    const { world, actor } = shopWorld(5);
    const line = restocking.stateOf(world, 'keeper').stock[0]?.id ?? 0;
    expect(restocking.buy(world, actor, 'keeper', line, 4).ok).toBe(true);
    expect(merchantStoreOf(world).get('keeper')?.restockedDay).toBe(1);

    const bytes = createGameSaveRegistry({ knownItem }).write(world, saveOptions);
    const loaded = new World({ seed: 5 });
    expect(createGameSaveRegistry({ knownItem }).read(loaded, bytes).ok).toBe(true);
    expect(merchantStoreOf(loaded).capture()).toEqual(merchantStoreOf(world).capture());

    restocking.restock(world, 4);
    restocking.restock(loaded, 4);
    expect(merchantStoreOf(loaded).capture()).toEqual(merchantStoreOf(world).capture());
    const after = merchantStoreOf(loaded).get('keeper');
    expect(after?.stock[0]?.count).toBe(4);
    expect(after?.restockedDay).toBe(4);
  });
});
