// mw-ju8.19 AC-2: each Forgotten variant killed N times with a seeded roller - the loot table its
// creature definition names, rolled by the sim's roller in a world - yields a mean of crowns inside
// its tier's band of docs/design/economy.md (tier 1 1-4, tier 2 3-8, tier 3 8-20), never a pile
// outside it, and the gear it leaves sells for what the economy expects. AC-1 (the data) is
// src/content/forgotten-roster.test.ts.
import { describe, expect, it } from 'vitest';
import { loadGameContent } from '@content/index';
import { markExercised } from '@content/testing';
import { BUY_RATE_BAND, LootTables, World } from '@sim/index';

const content = loadGameContent();
const tables = new LootTables(content.all('loot-table'), content.all('item'));
const KILLS = 6_000;

interface Yield {
  readonly kills: number;
  readonly gold: readonly number[];
  readonly items: ReadonlyMap<string, number>;
}

/** `KILLS` deaths of creature `id` in one seeded world: the gold of each, and units of each item. */
function kill(id: string): Yield {
  const table = content.get('creature', id).loot;
  if (table === undefined) throw new Error(`${id} has no loot table`);
  const world = new World({ seed: 20261004 });
  const gold: number[] = [];
  const items = new Map<string, number>();
  for (let i = 0; i < KILLS; i++) {
    const { stacks, error } = tables.rollInWorld(world, table);
    expect(error).toBeUndefined();
    let coins = 0;
    for (const { item, count } of stacks) {
      if (item === 'gold') coins += count;
      else items.set(item, (items.get(item) ?? 0) + count);
    }
    gold.push(coins);
  }
  return { kills: KILLS, gold, items };
}

const mean = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
/** The share of kills that dropped at least `count` units of the items of `ids` on average. */
const perKill = (y: Yield, ...ids: string[]) =>
  ids.reduce((sum, id) => sum + (y.items.get(id) ?? 0), 0) / y.kills;

const BANDS = [
  { id: 'forgotten-miner', tier: 1, gold: [1, 4] },
  { id: 'forgotten-archer', tier: 2, gold: [3, 8] },
  { id: 'forgotten-shield-bearer', tier: 2, gold: [3, 8] },
  { id: 'forgotten-brute', tier: 3, gold: [8, 20] },
] as const;

describe('the Forgotten roster’s drops (mw-ju8.19)', () => {
  const yields = new Map<string, Yield>(BANDS.map((b) => [b.id, kill(b.id)]));
  const of = (id: string): Yield => yields.get(id) ?? expect.fail(id);

  for (const { id, tier, gold } of BANDS) {
    it(`AC-2: ${id} killed ${String(KILLS)} times yields a mean of tier ${String(tier)} crowns inside ${String(gold[0])}-${String(gold[1])}, never a pile outside it`, ({
      task,
    }) => {
      markExercised(task, 'creature', id);
      markExercised(task, 'loot-table', `${id}-drops`);
      const crowns = of(id).gold;
      expect(Math.min(...crowns)).toBe(gold[0]); // the band is used in full
      expect(Math.max(...crowns)).toBe(gold[1]);
      expect(mean(crowns)).toBeGreaterThanOrEqual(gold[0]);
      expect(mean(crowns)).toBeLessThanOrEqual(gold[1]);
      expect(mean(crowns)).toBeCloseTo((gold[0] + gold[1]) / 2, 0); // uniform: the band's middle
    });
  }

  it('AC-2: the miner leaves scrap 40% of the time, worth 5-15 each', ({ task }) => {
    markExercised(task, 'loot-table', 'forgotten-miner-scrap');
    const scrap = perKill(of('forgotten-miner'), 'bent-pick-head', 'rusted-lamp-hook');
    expect(scrap).toBeGreaterThan(0.36);
    expect(scrap).toBeLessThan(0.44);
  });

  it('AC-2: the archer drops arrows about half the time and a weapon or glove piece 30% of the time', ({
    task,
  }) => {
    markExercised(task, 'loot-table', 'forgotten-archer-arrows');
    markExercised(task, 'loot-table', 'forgotten-archer-gear');
    const archer = of('forgotten-archer');
    const arrows = archer.items.get('standard-arrow') ?? 0;
    expect(arrows / archer.kills).toBeGreaterThan(1.6); // 50% x 2-6 (mean 4) = 2
    expect(arrows / archer.kills).toBeLessThan(2.4);
    const gear = perKill(archer, 'rusted-knife', 'leather-gloves', 'shortbow');
    expect(gear).toBeGreaterThan(0.27);
    expect(gear).toBeLessThan(0.33);
  });

  it('AC-2: the shield-bearer drops a rusted blade or a shield 30% of the time, a kite shield rarely', ({
    task,
  }) => {
    markExercised(task, 'loot-table', 'forgotten-shield-bearer-gear');
    const bearer = of('forgotten-shield-bearer');
    const gear = perKill(
      bearer,
      'rusted-arming-sword',
      'wooden-shield',
      'small-buckler',
      'kite-shield',
    );
    expect(gear).toBeGreaterThan(0.27);
    expect(gear).toBeLessThan(0.33);
    expect(perKill(bearer, 'small-buckler')).toBeGreaterThan(0);
    expect(perKill(bearer, 'kite-shield')).toBeGreaterThan(0);
    expect(perKill(bearer, 'kite-shield')).toBeLessThan(0.05);
  });

  it('AC-2: the brute drops a piece of gear half the time, mostly helms, a fine kettle helm 5% of the time', ({
    task,
  }) => {
    markExercised(task, 'loot-table', 'forgotten-brute-gear');
    const brute = of('forgotten-brute');
    const gear = perKill(
      brute,
      'dented-iron-cap',
      'nasal-helm',
      'mail-gauntlets',
      'riveted-boots',
      'kettle-helm',
    );
    expect(gear).toBeGreaterThan(0.46);
    expect(gear).toBeLessThan(0.54);
    expect(perKill(brute, 'dented-iron-cap', 'nasal-helm', 'kettle-helm')).toBeGreaterThan(0.35);
    expect(perKill(brute, 'kettle-helm')).toBeGreaterThan(0.04);
    expect(perKill(brute, 'kettle-helm')).toBeLessThan(0.06);
  });

  it('AC-2: a kill is worth more the higher its tier, and a mixed valley of kills pays the economy’s ~4.4 crowns of coins each', () => {
    const coins = (id: string) => mean(of(id).gold);
    const sale = (id: string) => {
      const y = of(id);
      let worth = 0;
      for (const [item, count] of y.items) {
        worth += (count / y.kills) * content.get('item', item).value * BUY_RATE_BAND.default;
      }
      return coins(id) + worth;
    };
    expect(sale('forgotten-miner')).toBeLessThan(sale('forgotten-archer'));
    expect(sale('forgotten-shield-bearer')).toBeLessThan(sale('forgotten-brute'));
    expect(sale('forgotten-archer')).toBeLessThan(sale('forgotten-brute'));
    // 60% tier 1, 30% tier 2 (archers and shield-bearers alike), 10% tier 3 (economy doc).
    const mixed =
      0.6 * coins('forgotten-miner') +
      0.3 * ((coins('forgotten-archer') + coins('forgotten-shield-bearer')) / 2) +
      0.1 * coins('forgotten-brute');
    expect(mixed).toBeGreaterThan(4.2);
    expect(mixed).toBeLessThan(4.9);
  });
});
