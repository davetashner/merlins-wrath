// @vitest-environment happy-dom
// The container window and pickup toasts in the game (mw-e18.4): a real world with content's items
// (plus the item fixtures, for a unique artifact), the sim's containers, the UI root, and the glue
// between them. Interact's Search opens the window; its Take, Take gold and Take All reach the sim as
// commands; pickups from containers and the world become toasts on the draw clock.
import { loadItemFixtureContent } from '@content/test-fixtures';
import {
  addInventory,
  containerTaken,
  Containers,
  installContainers,
  interacted,
  InventoryComponent,
  inventoryOf,
  isContainerActionCommand,
  itemPickedUp,
  LootTables,
  PlacementComponent,
  SceneSpawnComponent,
  World,
  type ContainerActionCommand,
  type EntityId,
  type LootStack,
} from '@sim/index';
import { DISCOVERY_TOAST_MS, PICKUP_TOAST_MS, PickupToasts, UiRoot } from '@ui/index';
import { rectFromData } from '@ui/testing/layout';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  ContainerWindowController,
  isDiscovery,
  LootViews,
  PickupNotifier,
  type LootContent,
  startContainerUi,
  takeRefusalText,
} from './container-window';
import { prepareWorldItems } from './index';

const content = loadItemFixtureContent();

beforeEach(() => {
  document.body.innerHTML = '';
});

/**
 * A world with containers, a player with an inventory, a chest holding `contents` (a scene spawn
 * named supply-chest unless `named` is false), and the container UI on a UI root, with a clock.
 */
function game(contents: readonly LootStack[], options: { named?: boolean } = {}) {
  const world = new World<unknown>({ seed: 3 });
  world.register(InventoryComponent, PlacementComponent, SceneSpawnComponent);
  const sim = world as unknown as World<never>;
  const items = prepareWorldItems(content);
  const containers = new Containers(items.inventory, new LootTables([], content.all('item')));
  installContainers(world, containers);
  const player = world.spawn();
  addInventory(sim, player);
  const chest = world.spawn();
  if (options.named !== false) {
    world.add(chest, SceneSpawnComponent, { id: 'supply-chest', tags: [] });
  }
  containers.make(sim, chest, {
    level: 'testbed',
    id: 'supply-chest',
    position: { x: 0, y: 0, z: 0 },
    contents,
  });
  const ui = new UiRoot(document.body, { unstyled: true, focus: { rectOf: rectFromData } });
  const queue: ContainerActionCommand[] = [];
  const published: Record<string, string> = {};
  let clock = 1000;
  const loot = startContainerUi({
    ui,
    world: sim,
    content,
    player,
    submit: (command) => queue.push(command),
    hudScale: 1,
    now: () => clock,
    publish: (key, value) => {
      published[key] = value;
    },
  });
  /** One frame: a sim step with the queued commands, the after-step hooks, then the draw. */
  const frame = (ms = 16) => {
    clock += ms;
    world.step(queue.splice(0));
    loot.afterStep();
    loot.frame(clock);
  };
  /** The player's Interact searched `target` (as the interaction system reports it). */
  const search = (target: EntityId = chest) => {
    world.events.emit(interacted, { actor: player, target, verb: 'search', affordance: 0 });
    frame();
  };
  const carried = () => inventoryOf(sim, player)?.items.map(({ defId, count }) => [defId, count]);
  const inside = () => inventoryOf(sim, chest)?.items.map(({ defId, count }) => [defId, count]);
  const rows = () => [
    ...document.querySelectorAll<HTMLButtonElement>(
      '[data-screen="container"] [data-container-item]',
    ),
  ];
  const button = (action: string) =>
    document.querySelector<HTMLButtonElement>(
      `[data-screen="container"] [data-action="${action}"]`,
    );
  return {
    world,
    sim,
    ui,
    loot,
    player,
    chest,
    containers,
    items,
    queue,
    published,
    frame,
    search,
    carried,
    inside,
    rows,
    button,
    advance: (ms: number) => {
      clock += ms;
      loot.frame(clock);
    },
    now: () => clock,
  };
}

describe('container window in the game (mw-e18.4)', () => {
  it('AC-1: Take All on an open container with 3 items puts all 3 in the inventory and closes the window the same frame', () => {
    const t = game([
      { item: 'healing-draught', count: 1 },
      { item: 'lockpicks', count: 1 },
      { item: 'arming-sword', count: 1 },
    ]);
    expect(t.published['containerWindow']).toBe('closed');
    t.search();
    expect(t.ui.top?.id).toBe('container');
    expect(t.published['containerWindow']).toBe('open');
    expect(t.rows().map((row) => row.getAttribute('aria-label'))).toEqual([
      'Take Healing draught',
      'Take Lockpicks',
      'Take Arming sword',
    ]);
    expect(document.querySelector('[data-screen="container"] h1')?.textContent).toBe(
      'Supply chest',
    );

    t.button('take-all')?.click();
    // The press closes the window at once; the same frame's step carries out the command.
    expect(t.ui.top).toBeUndefined();
    expect(t.published['containerWindow']).toBe('closed');
    expect(t.queue).toEqual([
      {
        kind: 'loot.containerAction',
        actor: t.player,
        entity: t.chest,
        action: { op: 'take-all' },
      },
    ]);
    expect(t.queue.every(isContainerActionCommand)).toBe(true);
    t.frame();
    expect(t.carried()).toEqual([
      ['healing-draught', 1],
      ['lockpicks', 1],
      ['arming-sword', 1],
    ]);
    expect(t.inside()).toEqual([]);
    expect(t.ui.top).toBeUndefined();
    expect(JSON.parse(t.published['pickups'] ?? '[]')).toEqual([
      { text: 'Healing draught', count: 1, discovery: false },
      { text: 'Lockpicks', count: 1, discovery: false },
      { text: 'Arming sword', count: 1, discovery: false },
    ]);
  });

  it('AC-2: six items picked up within a second show at most four toasts, duplicates merged with a count', () => {
    const t = game([
      { item: 'hunting-knife', count: 1 },
      { item: 'lockpicks', count: 1 },
      { item: 'wooden-shield', count: 1 },
      { item: 'leather-jerkin', count: 1 },
      { item: 'arming-sword', count: 2 }, // two swords: two stacks of one definition
    ]);
    t.search();
    expect(t.rows()).toHaveLength(6);
    t.button('take-all')?.click();
    t.frame();
    expect(t.carried()).toHaveLength(6);
    const shown = JSON.parse(t.published['pickups'] ?? '[]') as { text: string; count: number }[];
    expect(shown.length).toBeLessThanOrEqual(4);
    expect(shown).toEqual([
      { text: 'Lockpicks', count: 1, discovery: false },
      { text: 'Wooden shield', count: 1, discovery: false },
      { text: 'Leather jerkin', count: 1, discovery: false },
      { text: 'Arming sword ×2', count: 2, discovery: false },
    ]);
    expect(t.loot.toasts.element.querySelectorAll('.vb-pickup')).toHaveLength(4);
    // They go once their time is up.
    t.advance(PICKUP_TOAST_MS);
    expect(t.published['pickups']).toBe('[]');
  });

  it('AC-3: a unique artifact taken shows the discovery toast with its flavour line for at least 4 s', () => {
    const t = game([
      { item: 'fixture-lodestone-charm', count: 1 },
      { item: 'healing-draught', count: 1 },
    ]);
    t.search();
    t.rows()[0]?.click(); // Take the charm; the window stays open
    expect(t.queue).toEqual([
      {
        kind: 'loot.containerAction',
        actor: t.player,
        entity: t.chest,
        action: { op: 'take', instanceId: 1 },
      },
    ]);
    t.frame();
    expect(t.ui.top?.id).toBe('container');
    expect(t.rows().map((row) => row.getAttribute('aria-label'))).toEqual(['Take Healing draught']);
    const card = t.loot.toasts.element.querySelector('[data-kind="discovery"]');
    expect(card?.querySelector('.vb-pickup-name')?.textContent).toBe('Lodestone charm');
    expect(card?.querySelector('[data-part="flavour"]')?.textContent).toBe(
      'It points north, mostly. On Tuesdays it points at whoever owes you money.',
    );
    const taken = t.now();
    t.advance(4000);
    expect(t.now() - taken).toBe(4000);
    expect(JSON.parse(t.published['pickups'] ?? '[]')).toEqual([
      { text: 'Lodestone charm', count: 1, discovery: true },
    ]);
    t.advance(DISCOVERY_TOAST_MS - 4000);
    expect(t.published['pickups']).toBe('[]');
  });

  it('AC-4: a container emptied one take at a time shows "Empty" with Take All disabled', () => {
    const t = game([{ item: 'lockpicks', count: 1 }]);
    t.search();
    t.rows()[0]?.click();
    t.frame();
    expect(t.carried()).toEqual([['lockpicks', 1]]);
    expect(t.loot.controller.window?.empty).toBe(true);
    expect(document.querySelector<HTMLElement>('[data-testid="container-empty"]')?.hidden).toBe(
      false,
    );
    expect(t.button('take-all')?.disabled).toBe(true);
  });

  it('takes the gold; a refused take says why; the window closes when its container goes', () => {
    const t = game([
      { item: 'fixture-gold', count: 25 },
      { item: 'fixture-lodestone-charm', count: 1 },
    ]);
    t.items.inventory.add(t.sim, t.player, 'fixture-lodestone-charm', 1);
    t.search();
    expect(t.rows().map((row) => row.getAttribute('aria-label'))).toEqual([
      'Take 25 gold',
      'Take Lodestone charm',
    ]);
    t.rows()[0]?.click();
    t.frame();
    expect(inventoryOf(t.sim, t.player)?.gold).toBe(25);
    expect(JSON.parse(t.published['pickups'] ?? '[]')).toEqual([
      { text: '+25 gold', count: 25, discovery: false },
    ]);
    t.rows()[0]?.click(); // the charm: the player has one
    t.frame();
    expect(document.querySelector('[data-testid="container-status"]')?.textContent).toBe(
      'You already carry one of those.',
    );
    expect(t.loot.controller.entity).toBe(t.chest);
    // Nothing changed: no refresh needed.
    t.frame();
    t.world.destroy(t.chest);
    t.frame();
    expect(t.ui.top).toBeUndefined();
    expect(t.loot.controller.entity).toBeUndefined();
  });

  it('does not open over another screen, for another actor, or for a container that went', () => {
    const t = game([{ item: 'lockpicks', count: 1 }]);
    const other = t.ui.push({
      id: 'other',
      label: 'Other',
      content: document.createElement('div'),
    });
    t.search();
    expect(t.ui.top?.id).toBe('other');
    other.close();
    const stranger = t.world.spawn();
    addInventory(t.sim, stranger);
    t.world.events.emit(interacted, {
      actor: stranger,
      target: t.chest,
      verb: 'search',
      affordance: 0,
    });
    t.frame();
    expect(t.ui.top).toBeUndefined();
    // Searched, then gone before the window could open.
    t.world.events.emit(interacted, {
      actor: t.player,
      target: t.chest,
      verb: 'search',
      affordance: 0,
    });
    t.world.step([]);
    t.world.destroy(t.chest);
    t.loot.afterStep();
    expect(t.ui.top).toBeUndefined();
  });

  it('a nameless container is called Container; Close and dispose shut the window; other actors’ refusals are ignored', () => {
    const t = game([{ item: 'lockpicks', count: 1 }], { named: false });
    t.search();
    expect(document.querySelector('[data-screen="container"] h1')?.textContent).toBe('Container');
    t.button('close')?.click();
    expect(t.published['containerWindow']).toBe('closed');

    const controller = new ContainerWindowController({
      ui: t.ui,
      world: t.sim,
      player: t.player,
      views: new LootViews(content),
      submit: (command) => t.queue.push(command),
    });
    t.world.events.emit(interacted, {
      actor: t.player,
      target: t.chest,
      verb: 'search',
      affordance: 0,
    });
    t.world.step([]);
    controller.afterStep();
    expect(controller.window).toBeDefined();
    expect(t.ui.top?.id).toBe('container');
    // Another actor's refused take, and a take that worked, say nothing.
    const stranger = t.world.spawn();
    addInventory(t.sim, stranger);
    t.world.step([
      {
        kind: 'loot.containerAction',
        actor: stranger,
        entity: t.chest,
        action: { op: 'take', instanceId: 9 },
      },
      {
        kind: 'loot.containerAction',
        actor: t.player,
        entity: t.chest,
        action: { op: 'take-gold' },
      },
    ]);
    expect(document.querySelector('[data-testid="container-status"]')?.textContent).toBe('');
    controller.dispose();
    expect(t.ui.top).toBeUndefined();
    expect(controller.window).toBeUndefined();
  });
});

describe('pickup toasts in the game (mw-e18.4)', () => {
  it('toasts the player’s world-item pickups (gold as gold), never anyone else’s', () => {
    const t = game([]);
    t.world.events.emit(itemPickedUp, {
      tick: 0,
      actor: t.player,
      entity: 99,
      defId: 'healing-draught',
      count: 2,
      flags: {},
    });
    t.world.events.emit(itemPickedUp, {
      tick: 0,
      actor: t.chest,
      entity: 98,
      defId: 'oil-flask',
      count: 1,
      flags: {},
    });
    t.world.events.emit(containerTaken, {
      tick: 0,
      entity: t.chest,
      actor: t.chest,
      moved: [{ item: 'lockpicks', count: 1 }],
    });
    t.world.events.emit(containerTaken, {
      tick: 0,
      entity: t.chest,
      actor: t.player,
      moved: [{ item: 'gold', count: 4 }],
    });
    t.frame();
    expect(JSON.parse(t.published['pickups'] ?? '[]')).toEqual([
      { text: 'Healing draught ×2', count: 2, discovery: false },
      { text: '+4 gold', count: 4, discovery: false },
    ]);
    t.loot.setHudScale(1.5);
    expect(t.loot.toasts.element.style.fontSize).toBe('1.5em');

    // A disposed notifier toasts nothing.
    const toasts = new PickupToasts();
    new PickupNotifier(t.sim, t.player, new LootViews(content), toasts, t.now).dispose();
    t.world.events.emit(containerTaken, {
      tick: 0,
      entity: t.chest,
      actor: t.player,
      moved: [{ item: 'lockpicks', count: 1 }],
    });
    t.frame();
    expect(toasts.visible).toEqual([]);
  });

  it('words pickups from item data: unknown ids readable, discoveries only for unique artifacts', () => {
    const views = new LootViews(content);
    expect(views.pickup('mystery-box', 1)).toEqual({
      key: 'mystery-box',
      name: 'Mystery box',
      icon: 'misc',
      count: 1,
    });
    expect(views.pickup('fixture-gold', 3)).toMatchObject({ key: 'gold', gold: true, count: 3 });
    expect(views.pickup('fixture-bell-tongue', 1).discovery).toBeUndefined(); // unique, not an artifact
    expect(views.pickup('fixture-lodestone-charm', 1).discovery).toMatch(/points north/);
    expect(isDiscovery({ category: 'artifact', flags: { unique: false } } as never)).toBe(false);
    // A unique artifact without flavour text still gets a discovery toast, just its name.
    const charm = content.all('item').find((item) => item.id === 'fixture-lodestone-charm');
    const plain = new LootViews({
      all: (() => [{ ...charm, description: undefined }]) as LootContent['all'],
    });
    expect(plain.pickup('fixture-lodestone-charm', 1).discovery).toBe('');
    const world = new World<never>({ seed: 1 });
    world.register(InventoryComponent, SceneSpawnComponent);
    const bag = world.spawn();
    expect(views.windowModel(world, bag)).toEqual({ title: 'Container', gold: 0, items: [] });
    world.add(bag, InventoryComponent, {
      gold: 0,
      nextInstanceId: 2,
      items: [{ instanceId: 1, defId: 'mystery-box', count: 1, flags: {} }],
    });
    expect(views.windowModel(world, bag).items).toEqual([
      { id: 1, name: 'Mystery box', icon: 'misc', count: 1 },
    ]);
    expect(takeRefusalText('stack-limit')).toBe('You can’t carry any more of that.');
    expect(takeRefusalText('locked')).toBe('It’s locked.');
    expect(takeRefusalText('no-instance')).toBe('That didn’t work.');
  });
});
