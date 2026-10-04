// The consumable stock (mw-ju8.4): food, potions, ingredients, breakable jars and spell scrolls.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { loadGameContent, type ItemEntry } from '@content/index';
import {
  addInventory,
  InteractableComponent,
  InventoryComponent,
  breakableBroken,
  box,
  installBreakables,
  installPhysicsObjects,
  installStimuli,
  inventoryOf,
  RapierPhysics,
  registerWorldProperties,
  stimulusSystem,
  World,
  WorldItemComponent,
  type BreakableBrokenInfo,
  type EntityId,
} from '@sim/index';
import { describe, expect, it } from 'vitest';
import { describeContent } from '../../content/testing.ts';
import { prepareWorldItems } from './index';

/** Economy base-value bands by stock group (docs/design/economy.md). */
const BANDS: Record<string, readonly [number, number]> = {
  food: [2, 6],
  'minor-potion': [15, 30],
  'standard-potion': [30, 60],
  'greater-potion': [60, 120],
  ingredient: [3, 15],
  jar: [4, 12],
  scroll: [40, 150],
};

const GROUPS: Record<string, string> = {
  'bread-loaf': 'food',
  'hard-cheese-wedge': 'food',
  'smoked-sausage': 'food',
  apple: 'food',
  'travelling-rations': 'food',
  'hot-pie': 'food',
  'healing-draught': 'minor-potion',
  'mana-draught': 'minor-potion',
  'stamina-tonic': 'minor-potion',
  'strong-healing-draught': 'standard-potion',
  'strong-mana-draught': 'standard-potion',
  'greater-healing-draught': 'greater-potion',
  'greater-mana-draught': 'greater-potion',
  'dried-nightshade': 'ingredient',
  'bellwort-root': 'ingredient',
  'glenstone-dust': 'ingredient',
  'spider-silk': 'ingredient',
  'mushroom-caps': 'ingredient',
  'red-clay': 'ingredient',
  'empty-glass-jar': 'jar',
  'jar-of-healing-tonic': 'jar',
  'scroll-of-mage-hand': 'scroll',
  'scroll-of-ember': 'scroll',
  'scroll-of-firebolt': 'scroll',
};

describe('consumable stock (mw-ju8.4)', () => {
  it('AC-1: every stock item is in the catalogue', () => {
    const ids = new Set(
      loadGameContent()
        .all('item')
        .map((i: ItemEntry) => i.id),
    );
    for (const id of Object.keys(GROUPS)) expect(ids.has(id), id).toBe(true);
  });
});

describeContent('item', 'AC-1: a stock item has a value inside its economy band', (item) => {
  const group = GROUPS[item.id];
  if (group === undefined) return; // not part of this stock
  const [min, max] = BANDS[group] ?? [0, 0];
  expect(item.value).toBeGreaterThanOrEqual(min);
  expect(item.value).toBeLessThanOrEqual(max);
  expect(item.stackable).toBe(true);
  if (group === 'ingredient') expect(item.use).toBeUndefined();
  if (group === 'jar') expect(item.breakable?.profile.id).toBe('pottery');
});

describe('breakable jars (mw-ju8.4)', () => {
  function setup() {
    const content = loadGameContent();
    const physics = new RapierPhysics(RAPIER);
    const world = installStimuli(registerWorldProperties(new World<never>({ seed: 4, physics })));
    world.register(WorldItemComponent, InventoryComponent, InteractableComponent);
    installPhysicsObjects(world);
    world.addSystem(stimulusSystem());
    installBreakables(world);
    physics.add(box({ x: -20, y: -1, z: -20 }, { x: 20, y: 0, z: 20 }));
    const items = prepareWorldItems(content);
    const broken: BreakableBrokenInfo[] = [];
    world.events.on(breakableBroken, (e) => broken.push(e));
    return { world, items, broken };
  }
  const run = (world: World<never>, ticks: number) => {
    for (let i = 0; i < ticks; i++) world.step();
  };
  const alive = (world: World<never>, entity: EntityId) => world.get(entity, WorldItemComponent);

  it('AC-2: a jar thrown from the pack breaks on impact, emits breakableBroken and is lost', () => {
    const { world, items, broken } = setup();
    const actor = world.spawn();
    addInventory(world, actor);
    items.inventory.add(world, actor, 'jar-of-healing-tonic', 2);
    const thrown = items.throw(
      world,
      actor,
      { feet: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0 },
      {
        instanceId: 1,
      },
    );
    expect(thrown.ok).toBe(true);
    const entity = (thrown as { entity: EntityId }).entity;
    run(world, 120);
    expect(broken).toHaveLength(1);
    expect(broken[0]).toMatchObject({
      entity,
      profile: 'pottery',
      material: 'glass',
      cause: 'impact',
      by: 'collision',
    });
    expect(world.isAlive(entity)).toBe(false);
    // Its contents are lost: nothing to pick up is left, and only the other unit remains in the pack.
    expect(world.query(WorldItemComponent).ids()).toEqual([]);
    expect(inventoryOf(world, actor)?.items.map((i) => i.count)).toEqual([1]);
  });

  it('AC-2: an empty jar dropped from a height breaks, but one set down gently does not', () => {
    const { world, items, broken } = setup();
    const gentle = items.spawn(world, {
      defId: 'empty-glass-jar',
      position: { x: 3, y: 0.1, z: 0 },
    });
    const fall = items.spawn(world, { defId: 'empty-glass-jar', position: { x: 0, y: 3, z: 0 } });
    run(world, 120);
    expect(broken.map((e) => e.entity)).toEqual([fall]);
    expect(alive(world, gentle)).toBeDefined();
    expect(alive(world, fall)).toBeUndefined();
  });

  it('a jar item without a profile in the lookup stays an ordinary item', () => {
    const { world } = setup();
    const content = loadGameContent();
    const plain = prepareWorldItems({
      all: (t) => content.all(t),
      get: (t, id) => content.get(t, id),
      has: () => false,
    });
    const entity = plain.spawn(world, { defId: 'empty-glass-jar', position: { x: 0, y: 3, z: 0 } });
    run(world, 120);
    expect(alive(world, entity)).toBeDefined();
  });
});
