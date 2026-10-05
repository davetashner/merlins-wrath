// mw-e20.5 against the real content: sell a lot to Ottilie Marsh to drain her till and buy out her
// arrows, then sleep a night at the Sleeping Ox. The rest ends on day 2, and she has refilled by her
// goldRestockPerDay with the arrows back on the shelf; Dot's own till and larder refill too.

import { describe, expect, it } from 'vitest';
import { loadGameContent } from '@content/index';
import {
  addInventory,
  DAMAGE_COMPONENTS,
  DAY_CLOCK_FACTS,
  factDayClock,
  giveCombatant,
  giveStamina,
  InventoryRules,
  LootTables,
  merchantStoreOf,
  Shops,
  StaminaComponent,
  World,
} from '@sim/index';

const content = loadGameContent();
const items = content.all('item');
const rules = new InventoryRules(items);
const shops = new Shops(
  content.all('merchant'),
  items,
  rules,
  new LootTables(content.all('loot-table'), items),
);
const marsh = content.get('merchant', 'marsh-general-store');
const arrowEntry = marsh.stock.findIndex((e) => e.item?.id === 'standard-arrow');

describe('merchant restock overnight (mw-e20.5)', () => {
  it('sleeping at the Sleeping Ox refills a drained till and sold-out restockable stock, by the authored amounts', () => {
    const world = new World({ seed: 31 });
    for (const [key, spec] of Object.entries(DAY_CLOCK_FACTS)) world.facts.declare(key, spec);
    world.register(...DAMAGE_COMPONENTS, StaminaComponent);
    const player = world.spawn();
    addInventory(world, player, 400);
    giveCombatant(world, player, { health: 40 });
    giveStamina(world, player);
    factDayClock(world.facts).set({ day: 1, minute: 21 * 60 });
    shops.restockOnRest(world);

    // Buy every arrow, then sell swords until Marsh's till is nearly empty.
    const arrows = shops
      .stateOf(world, 'marsh-general-store')
      .stock.find((l) => l.entry === arrowEntry);
    expect(arrows?.count).toBe(40);
    expect(shops.buy(world, player, 'marsh-general-store', arrows?.id ?? 0, 40).ok).toBe(true);
    for (let i = 0; i < 40; i++) {
      rules.add(world, player, 'arming-sword', 1);
      const sword = rules.query(world, player, { defId: 'arming-sword' }).at(-1)?.instanceId ?? 0;
      if (!shops.sell(world, player, 'marsh-general-store', sword).ok) break;
    }
    const drained = shops.stateOf(world, 'marsh-general-store');
    expect(drained.gold).toBeLessThan(20);
    expect(drained.stock.some((l) => l.entry === arrowEntry)).toBe(false);
    expect(drained.buyback.length).toBeGreaterThan(0);

    // Dot's larder and till: touched, then drawn down (the room's price goes into her till).
    const ox = shops.buyService(world, player, 'sleeping-ox', 'room-for-the-night');
    expect(ox.ok).toBe(true);
    world.events.flush();

    expect(factDayClock(world.facts).now().day).toBe(2);
    const morning = shops.stateOf(world, 'marsh-general-store');
    expect(morning.gold).toBe(drained.gold + marsh.goldRestockPerDay);
    // The arrows come back by the rule's `amount` a day (20), not all at once.
    const rule = marsh.stock[arrowEntry]?.restock;
    expect(rule?.amount).toBe(20);
    expect(morning.stock.find((l) => l.entry === arrowEntry)?.count).toBe(rule?.amount);
    expect(morning.buyback).toEqual([]);
    expect(merchantStoreOf(world).get('sleeping-ox')?.restockedDay).toBe(2);
  });
});
