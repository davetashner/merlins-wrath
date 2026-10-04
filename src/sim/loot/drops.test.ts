// Creature drops (mw-e01.5): a dying creature drops what its spawn point carries, then its table's
// roll, as world items lying at its body, each with an `item.dropped` from the creature; the roll
// draws from the creature's own sub-stream of the loot stream; nothing else drops anything.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it } from 'vitest';
import { box } from '../character/greybox';
import { Died } from '../combat/damage/events';
import type { EntityId } from '../core/component';
import { World } from '../core/world';
import { CREATURE_COMPONENTS, CreatureComponent, type Creature } from '../creatures/components';
import {
  installWorldItems,
  ITEM_HALF_EXTENTS,
  itemDropped,
  WorldItemComponent,
  WorldItems,
  type ItemDropped,
  type WorldItemDef,
} from '../items/world-items';
import { installPhysicsObjects, PhysicsObjectComponent } from '../physics/objects';
import { RapierPhysics } from '../physics/rapier';
import { registerWorldProperties } from '../properties/components';
import { placeEntity } from '../stimulus/placement';
import type { Vec3 } from '../stimulus/shapes';
import { installStimuli } from '../stimulus/stimulus';
import {
  dropCreatureLoot,
  dropSpot,
  DROP_SCATTER_RADIUS,
  installCreatureDrops,
  type CreatureDropsOptions,
} from './drops';
import { LootTables, type LootStack, type LootTableDef } from './tables';

const v = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const flat = (a: Vec3, b: Vec3) => Math.sqrt((a.x - b.x) ** 2 + (a.z - b.z) ** 2);

const item = (id: string, category: WorldItemDef['category'], unique = false): WorldItemDef => ({
  id,
  category,
  stackable: category !== 'key',
  weightClass: 'light',
  flags: { unique, questItem: category === 'key', noDrop: category === 'key' },
});
const ITEMS = [
  item('gallery-key', 'key', true),
  item('bone', 'misc'),
  item('gold', 'currency'),
  item('lockpicks', 'tool'),
];

const ref = (id: string) => ({ id });
const TABLES: LootTableDef[] = [
  {
    // Random enough that two streams would almost surely differ.
    id: 'miner-scraps',
    guaranteed: [{ item: ref('bone'), count: 1 }],
    rolls: { min: 1, max: 1 },
    entries: [
      { item: ref('gold'), weight: 1, count: { min: 1, max: 999 } },
      // Only for a thief who did the killing.
      {
        item: ref('lockpicks'),
        weight: 1000000,
        count: { min: 1, max: 1 },
        conditions: { class: [ref('thief')] },
      },
    ],
    noDuplicates: false,
  },
];

function creature(point?: string): Creature {
  return Object.freeze({
    origin: Object.freeze({
      creature: 'forgotten-miner',
      at: Object.freeze(v(2.5, 0, 32.5)),
      facing: Object.freeze(v(0, 0, -1)),
      ...(point !== undefined && { point }),
    }),
    behaviour: 'forgotten',
    tuning: Object.freeze({}),
    needs: Object.freeze({}),
  });
}

/** A world on a floor (top at y = 0) with physics objects and world items. */
function setup(seed = 7) {
  const physics = new RapierPhysics(RAPIER);
  const world = installStimuli(registerWorldProperties(new World<never>({ seed, physics })));
  world.register(...CREATURE_COMPONENTS);
  installPhysicsObjects(world);
  physics.add(box(v(-20, -1, -20), v(20, 0, 20)));
  const items = new WorldItems(ITEMS);
  installWorldItems(world, items);
  const dropped: ItemDropped[] = [];
  world.events.on(itemDropped, (e) => dropped.push(e));
  const spawnCreature = (at: Vec3, point?: string): EntityId => {
    const entity = world.spawn();
    placeEntity(world, entity, at, 0.35);
    world.add(entity, CreatureComponent, creature(point));
    return entity;
  };
  const die = (target: EntityId, killer: EntityId | null = null): void => {
    world.step([]);
    world.events.emit(Died, { tick: world.tick, target, killer, source: null, tags: [] });
    world.events.flush();
  };
  const lying = () =>
    world
      .query(WorldItemComponent, PhysicsObjectComponent)
      .ids()
      .map((entity) => {
        const at = world.get(entity, PhysicsObjectComponent)?.position ?? v(99, 99, 99);
        const { defId, count, by } = world.get(entity, WorldItemComponent) ?? {};
        return { entity, item: defId, count, by, at: v(at.x, at.y, at.z) };
      });
  return { world, items, dropped, spawnCreature, die, lying };
}

const CARRIED = new Map<string, readonly LootStack[]>([
  ['skeleton', [{ item: 'gallery-key', count: 1 }]],
]);

function options(items: WorldItems, extra: Partial<CreatureDropsOptions> = {}) {
  return {
    level: 'slice',
    items,
    loot: new LootTables(TABLES, ITEMS),
    tableOf: (id: string) => (id === 'forgotten-miner' ? 'miner-scraps' : undefined),
    carried: (point: string) => CARRIED.get(point),
    ...extra,
  } satisfies CreatureDropsOptions;
}

describe('creature drops (mw-e01.5)', () => {
  it('lays the first drop at the feet and the rest on a ring within 1 m', () => {
    const feet = v(2, 0.5, -3);
    expect(dropSpot(feet, 0, 3)).toEqual(feet);
    expect(dropSpot(feet, 1, 1)).toEqual(feet);
    for (let i = 1; i < 6; i++) {
      const spot = dropSpot(feet, i, 6);
      expect(flat(spot, feet)).toBeCloseTo(DROP_SCATTER_RADIUS, 9);
      expect(spot.y).toBe(feet.y);
    }
    expect(dropSpot(feet, 1, 3)).not.toEqual(dropSpot(feet, 2, 3));
    expect(DROP_SCATTER_RADIUS).toBeLessThan(1);
  });

  it('AC-2: on Died a placed creature drops what it carries, then its table’s roll, as world items at its body', () => {
    const s = setup();
    installCreatureDrops(s.world, options(s.items));
    const skeleton = s.spawnCreature(v(1.5, 0, 4), 'skeleton');
    s.die(skeleton);
    const items = s.lying();
    expect(items.map((i) => i.item)).toEqual(['gallery-key', 'bone', 'gold']);
    // The key first, at its feet, resting on the floor; everything within 1 m.
    expect(items[0]?.at).toEqual(v(1.5, ITEM_HALF_EXTENTS.key.y, 4));
    for (const lying of items) {
      expect(flat(lying.at, v(1.5, 0, 4))).toBeLessThanOrEqual(1);
      expect(lying.by).toBe(skeleton);
    }
    expect(s.dropped.map((e) => [e.actor, e.entity, e.defId, e.thrown])).toEqual(
      items.map((i) => [skeleton, i.entity, i.item, false]),
    );
    expect(s.dropped[0]).toMatchObject({ count: 1, flags: {}, tick: s.world.tick });
    // They settle where they were laid.
    for (let i = 0; i < 60; i++) s.world.step([]);
    for (const lying of s.lying()) expect(flat(lying.at, v(1.5, 0, 4))).toBeLessThanOrEqual(1);
  });

  it('rolls from the creature’s own sub-stream: the same death drops the same loot, and other draws never shift', () => {
    const roll = (spawnFirst: boolean) => {
      const s = setup(11);
      installCreatureDrops(s.world, options(s.items));
      if (spawnFirst) s.world.random('loot').float();
      const skeleton = s.spawnCreature(v(0, 0, 0), 'skeleton');
      s.die(skeleton);
      return s.lying().map((i) => [i.item, i.count]);
    };
    expect(roll(false)).toEqual(roll(true));
    // An unplaced creature (a console spawn) rolls from a stream named for its entity instead.
    const s = setup(11);
    installCreatureDrops(s.world, options(s.items));
    const stray = s.spawnCreature(v(0, 0, 0));
    s.die(stray);
    const strayLoot = s.lying().map((i) => [i.item, i.count]);
    expect(strayLoot.map(([id]) => id)).toEqual(['bone', 'gold']);
    expect(strayLoot).not.toEqual(roll(false).slice(1));
  });

  it('class-conditioned entries read the killer’s class', () => {
    const s = setup();
    const killers: (EntityId | null)[] = [];
    installCreatureDrops(
      s.world,
      options(s.items, {
        classOf: (_world, killer) => {
          killers.push(killer);
          return 'thief';
        },
      }),
    );
    const thief = s.world.spawn();
    s.die(s.spawnCreature(v(0, 0, 0)), thief);
    expect(s.lying().map((i) => i.item)).toEqual(['bone', 'lockpicks']);
    // With no killer the class is never asked for.
    s.die(s.spawnCreature(v(5, 0, 0)));
    expect(killers).toEqual([thief]);
  });

  it('drops only what it carries without a table or loot tables, and nothing at all when it carries nothing', () => {
    const s = setup();
    const noTable = options(s.items, { tableOf: () => undefined });
    expect(
      dropCreatureLoot(s.world, noTable, s.spawnCreature(v(0, 0, 0), 'skeleton')),
    ).toHaveLength(1);
    const { level, items, tableOf, carried } = options(s.items);
    const noLoot = { level, items, tableOf, carried };
    expect(dropCreatureLoot(s.world, noLoot, s.spawnCreature(v(2, 0, 0), 'skeleton'))).toHaveLength(
      1,
    );
    const bare = { level: 'slice', items: s.items };
    expect(dropCreatureLoot(s.world, bare, s.spawnCreature(v(4, 0, 0), 'skeleton'))).toEqual([]);
    expect(dropCreatureLoot(s.world, noTable, s.spawnCreature(v(6, 0, 0), 'nobody'))).toEqual([]);
    expect(s.lying().map((i) => i.item)).toEqual(['gallery-key', 'gallery-key']);
  });

  it('nothing drops for something that is not a placed creature, or in a world without creatures', () => {
    const s = setup();
    const stop = installCreatureDrops(s.world, options(s.items));
    const rock = s.world.spawn();
    placeEntity(s.world, rock, v(0, 0, 0), 0.2);
    s.die(rock);
    const ghost = s.world.spawn();
    s.world.add(ghost, CreatureComponent, creature('skeleton'));
    s.die(ghost); // no placement
    expect(s.lying()).toEqual([]);
    // Uninstalled, a death drops nothing.
    stop();
    s.die(s.spawnCreature(v(0, 0, 0), 'skeleton'));
    expect(s.lying()).toEqual([]);

    const bare = new World<never>({ seed: 1 });
    const thing = bare.spawn();
    expect(dropCreatureLoot(bare, options(s.items), thing)).toEqual([]);
  });
});
