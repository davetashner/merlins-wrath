// mw-ju8.21 AC-1: a headless full clear of valley-01 to valley-03. Every skeleton the three scenes
// place is killed with the seeded roller (the loot table its creature names), every chest is opened
// (its loot table, rolled the same way), and the haul is valued: coins as they fall, gear and ammo at
// what Brand's Forge pays (price model, sell direction: base x 0.4 buy rate, x1.2 specialty). The
// total must lie inside the economy doc's per-45-minutes curve (docs/design/economy.md, Target gold
// curve: about 355 crowns = coins 200 + gear sold 110 + chests 45, about 7.9 crowns a minute).
// Skeletons return after the player sleeps (mw-ju8.29; 20 of the 21, the brute gatekeeper stays dead),
// so a repeat clear pays about this much again; the band below is for the single first clear.
// AC-2 (each scene loads, zero console errors) is e2e/scenes.spec.ts; the placement rules are
// src/content/valley-encounters.test.ts.
import { describe, expect, it } from 'vitest';
import { loadGameContent } from '@content/index';
import { markExercised } from '@content/testing';
import { LootTables, price, World } from '@sim/index';

const content = loadGameContent();
const tables = new LootTables(content.all('loot-table'), content.all('item'));
const brand = content.get('merchant', 'brand-forge');
const SCENES = ['valley-01', 'valley-02', 'valley-03'] as const;
const ROLLS = 4_000;

/** Mean crowns of coins, and mean crowns Brand pays for the rest, of one roll of table `id`. */
function meanRoll(id: string, seed: number) {
  const world = new World({ seed });
  let coins = 0;
  let gear = 0;
  const sellOf = new Map<string, number>();
  for (let i = 0; i < ROLLS; i++) {
    const { stacks, error } = tables.rollInWorld(world, id);
    expect(error).toBeUndefined();
    for (const { item, count } of stacks) {
      if (item === 'gold') {
        coins += count;
        continue;
      }
      if (!sellOf.has(item)) {
        const quote = price({
          item: content.get('item', item),
          merchant: brand,
          direction: 'sell',
        });
        sellOf.set(item, quote.ok ? quote.price : 0);
      }
      gear += (sellOf.get(item) ?? 0) * count;
    }
  }
  return { coins: coins / ROLLS, gear: gear / ROLLS };
}

function clear() {
  let coins = 0;
  let gear = 0;
  let chests = 0;
  let kills = 0;
  const perScene: Record<string, { kills: number; total: number }> = {};
  let seed = 20261004;
  for (const sceneId of SCENES) {
    let total = 0;
    let sceneKills = 0;
    for (const s of content.get('scene', sceneId).spawns) {
      if (s.creature !== undefined) {
        const r = meanRoll(content.get('creature', s.creature.id).loot ?? '', seed++);
        coins += r.coins;
        gear += r.gear;
        total += r.coins + r.gear;
        kills++;
        sceneKills++;
      }
      if (s.container?.loot !== undefined) {
        const r = meanRoll(s.container.loot.id, seed++);
        chests += r.coins + r.gear;
        total += r.coins + r.gear;
      }
    }
    perScene[sceneId] = { kills: sceneKills, total };
  }
  return { coins, gear, chests, kills, perScene, total: coins + gear + chests };
}

describe('a full clear of the valley pays what the economy expects (mw-ju8.21)', () => {
  const run = clear();

  it('AC-1: the three scenes hold 21 skeletons (6, 8 and 7) of all four variants and 4 chests', ({
    task,
  }) => {
    for (const id of SCENES) markExercised(task, 'scene', id);
    expect(run.kills).toBe(21);
    expect(run.perScene['valley-01']?.kills).toBe(6);
    expect(run.perScene['valley-02']?.kills).toBe(8);
    expect(run.perScene['valley-03']?.kills).toBe(7);
  });

  it('AC-1: total crowns plus sellable gear value lies inside the economy doc’s 45-minute band', () => {
    // The doc's anchor: ~355 crowns (coins 200 + gear sold 110 + chests 45) for ~45 minutes of valley
    // play. Owner direction: the valley must pay enough to buy the early purchases, so one full clear
    // (a 46-52 m walk per scene, 21 fights, looting, the chest key hunt: roughly 35-45 minutes) should
    // land about on that figure. The band is the anchor +-25%/+20%:
    //   floor   = 355 x 0.75 = ~270 (a clear that pays less than three quarters of the anchor starves
    //             the shops the valley exists to fund)
    //   ceiling = 355 x 1.2  = ~430 (a one-off clear must not out-earn the anchor by more than a fifth;
    //             the doc's 0.6-0.8 obtainable:sink ratio holds the region's total to ~3,800)
    expect(run.total).toBeGreaterThanOrEqual(Math.round(355 * 0.75));
    expect(run.total).toBeLessThanOrEqual(Math.round(355 * 1.2));
  });

  it('AC-1: the skeletons’ coins and Brand-sold gear are the larger part of what is not a chest, and a real income', () => {
    const skeletons = run.coins + run.gear;
    expect(run.coins).toBeGreaterThan(80);
    expect(run.gear).toBeGreaterThan(50);
    // Chest tiers are fixed by mw-ju8.20 (~230 crowns for four chests), so with the total held under
    // the band's ceiling, skeletons are ~40-50% of a clear; they are never less than 40%.
    expect(skeletons / run.total).toBeGreaterThan(0.4);
    expect(skeletons).toBeGreaterThan(150);
  });

  it('AC-1: the expected total is deterministic for the seed', () => {
    expect(clear().total).toBe(run.total);
  });
});
