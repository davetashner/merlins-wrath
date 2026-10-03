// Lootable containers (mw-e18.3): roll once on the first open (and never again, across a save and
// reload), take all or one stack into the inventory, put items in, refuse while locked, and persist
// what is inside through level deltas and world facts. Interact is driven through the real
// interaction system, and locks through the mechanisms' keyring, as the game wires them.
import { describe, expect, it } from 'vitest';
import { initialCharacterState } from '../character/controller';
import { CharacterController } from '../character/system';
import type { EntityId } from '../core/component';
import { World } from '../core/world';
import { registerPersistence, WorldPersistence } from '../deltas/persistence';
import type { LevelDeltas } from '../deltas/persistence';
import type { FactSnapshot } from '../facts/store';
import { actionButton, actionFrame, actionVector, type ActionFrame } from '../input/action-frame';
import {
  addInteractor,
  InteractableComponent,
  installInteraction,
  interacted,
  interactionPrompt,
} from '../interaction/system';
import {
  addInventory,
  InventoryComponent,
  inventoryOf,
  InventoryRules,
  type InventoryItemDef,
} from '../inventory/inventory';
import { LockComponent, type DoorProfile, type LockSpec } from '../mechanisms/components';
import { lockRefused, type LockRefused } from '../mechanisms/events';
import { keyring } from '../mechanisms/keys';
import {
  installMechanisms,
  LOCKPICK_CAPABILITY,
  makeDoor,
  refreshAffordances,
} from '../mechanisms/system';
import { PlayerLook } from '../player/player';
import { registerWorldProperties } from '../properties/components';
import { PlacementComponent } from '../stimulus/placement';
import { installStimuli } from '../stimulus/stimulus';
import {
  addSceneContainers,
  ContainerComponent,
  containerEmpty,
  containerFact,
  containerLooted,
  containerOpened,
  Containers,
  EMPTY_REASON,
  installContainers,
  refreshContainerAffordances,
  type ContainerLooted,
  type ContainerOpened,
  type ContainerSpec,
} from './containers';
import { LootTables, type LootTableDef } from './tables';

const UP = actionButton(false, false, false);
function frame(interact: boolean): ActionFrame {
  const zero = actionVector(0, 0);
  return actionFrame({
    move: zero,
    look: zero,
    buttons: (action) => (action === 'interact' && interact ? actionButton(true, true, false) : UP),
  });
}
const IDLE = frame(false);
const PRESS = frame(true);

const def = (
  id: string,
  category: InventoryItemDef['category'],
  extra: Partial<InventoryItemDef> = {},
): InventoryItemDef => ({
  id,
  category,
  stackable: false,
  flags: { unique: false, questItem: false },
  ...extra,
});
const ITEMS: InventoryItemDef[] = [
  def('bread', 'consumable', { stackable: true, maxStack: 5 }),
  def('arrow', 'ammo', { stackable: true, maxStack: 50 }),
  def('gold', 'currency', { stackable: true }),
  def('crown', 'artifact', { flags: { unique: true, questItem: false } }),
  def('letter', 'quest', { flags: { unique: false, questItem: true } }),
  def('lockpicks', 'tool'),
  def('chest-key', 'key', { key: { opens: ['iron-chest'] } }),
];

const ref = (id: string) => ({ id });
const TABLES: LootTableDef[] = [
  {
    // Random enough that a second roll would almost surely differ.
    id: 'supplies',
    guaranteed: [{ item: ref('bread'), count: 2 }],
    rolls: { min: 1, max: 3 },
    entries: [
      { item: ref('arrow'), weight: 3, count: { min: 1, max: 40 } },
      { item: ref('gold'), weight: 2, count: { min: 1, max: 99 } },
      { item: ref('bread'), weight: 1, count: { min: 1, max: 9 } },
    ],
    noDuplicates: false,
  },
  {
    id: 'regalia',
    guaranteed: [{ item: ref('crown'), count: 1 }],
    rolls: { min: 0, max: 0 },
    entries: [],
    noDuplicates: false,
  },
  {
    id: 'thief-stash',
    guaranteed: [],
    rolls: { min: 1, max: 1 },
    entries: [
      {
        item: ref('lockpicks'),
        weight: 1,
        count: { min: 1, max: 1 },
        conditions: { class: [ref('thief')] },
      },
    ],
    noDuplicates: false,
  },
];

const IRON_CHEST: LockSpec = {
  id: 'iron-chest',
  tier: 1,
  pickTier: 1,
  sealed: false,
  tags: [],
  hint: 'Locked. The key must be about.',
};

const DOOR: DoorProfile = {
  id: 'wooden-door',
  kind: 'hinged',
  size: { x: 1.2, y: 2.2, z: 0.06 },
  seconds: 1,
  crush: 0,
  manual: true,
  blocks: { light: true, gas: true, sound: true },
  loudness: 50,
};

const LEVEL = 'cellar';

interface SetupOptions {
  /** Overrides of the chest; `loot: null` gives it no table (default: supplies). */
  readonly chest?: Omit<Partial<ContainerSpec>, 'loot'> & { readonly loot?: string | null };
  readonly carry?: readonly string[];
  readonly capabilities?: readonly string[];
  readonly classId?: string;
  readonly unitGuard?: number;
}

/**
 * A player at (0, 0, 1.5) facing −z towards a chest at the origin, with interaction, mechanisms
 * (and the keyring) and containers installed as the game does, and the chest's level baseline taken.
 */
function setup(options: SetupOptions = {}) {
  const world = installStimuli(registerWorldProperties(new World<ActionFrame>({ seed: 11 })));
  world.register(CharacterController, PlayerLook);
  installInteraction(world);
  registerPersistence(world);
  const rules = new InventoryRules(ITEMS, { unitGuard: options.unitGuard ?? 9999 });
  installMechanisms(world, { keys: keyring(rules) });
  const containers = new Containers(rules, new LootTables(TABLES, ITEMS), {
    classOf: () => options.classId,
  });
  const off = installContainers(world, containers);
  const sim = world as unknown as World<never>;
  const player = world.spawn();
  world.add(player, CharacterController, initialCharacterState({ x: 0, y: 0, z: 1.5 }));
  world.add(player, PlayerLook, { yaw: 0, pitch: 0 });
  addInteractor(world, player, { capabilities: options.capabilities ?? [] });
  addInventory(world, player);
  const chest = world.spawn();
  const { loot = 'supplies', ...chestSpec } = options.chest ?? {};
  containers.make(sim, chest, {
    level: LEVEL,
    id: 'chest',
    position: { x: 0, y: 0, z: 0 },
    ...chestSpec,
    ...(loot !== null && { loot }),
  });
  for (const item of options.carry ?? []) rules.add(sim, player, item, 1);
  const persistence = new WorldPersistence();
  const baseline = persistence.baseline(sim, LEVEL, [['spawn:chest', chest]]);
  world.step([IDLE]); // focus on the chest
  const opened: ContainerOpened[] = [];
  const looted: ContainerLooted[] = [];
  const refused: LockRefused[] = [];
  world.events.on(containerOpened, (e) => opened.push(e));
  world.events.on(containerLooted, (e) => looted.push(e));
  world.events.on(lockRefused, (e) => refused.push(e));
  const inside = () =>
    inventoryOf(sim, chest)?.items.map(({ defId, count }) => [defId, count] as const);
  const carried = () =>
    inventoryOf(sim, player)?.items.map(({ defId, count }) => [defId, count] as const);
  const save = () => ({
    deltas: persistence.capture(sim, baseline),
    facts: world.facts.snapshot(),
  });
  /** Delivers queued events, then returns what `list` heard. */
  const heard =
    <T>(list: T[]) =>
    (): T[] => {
      world.events.flush();
      return list;
    };
  return {
    world,
    sim,
    rules,
    containers,
    off,
    player,
    chest,
    opened: heard(opened),
    looted: heard(looted),
    refused: heard(refused),
    inside,
    carried,
    save,
    persistence,
    baseline,
    prompt: () => interactionPrompt(sim, player),
  };
}

type Setup = ReturnType<typeof setup>;

/** A fresh world as built, with `saved`'s facts and the chest's level deltas loaded into it. */
function reload(
  saved: { deltas: LevelDeltas; facts: FactSnapshot },
  options: SetupOptions = {},
): Setup {
  const t = setup(options);
  t.world.facts.prepareRestore(saved.facts)();
  const report = t.persistence.apply(t.sim, t.baseline, saved.deltas);
  expect(report.skipped).toEqual([]);
  t.world.step([IDLE]);
  return t;
}

const opens = (t: Setup) => t.containers.open(t.sim, t.chest, t.player);

describe('lootable containers (mw-e18.3)', () => {
  it('AC-1: a chest with a loot table rolls once: opened twice across a save and reload, the contents are identical', () => {
    const t = setup();
    expect(t.inside()).toEqual([]);
    const first = opens(t);
    expect(first).toMatchObject({ ok: true, first: true });
    const rolled = t.inside();
    expect(rolled?.[0]).toEqual(['bread', 2]); // the guaranteed draught of bread, then the rolls
    expect(t.opened()).toHaveLength(1);
    expect(t.opened()[0]?.rolled.length).toBeGreaterThan(0);
    expect(
      t.world.facts.get(containerFact({ level: LEVEL, id: 'chest', loot: null }, 'opened')),
    ).toBe(true);
    const gold = inventoryOf(t.sim, t.chest)?.gold;

    const back = reload(t.save());
    expect(back.inside()).toEqual(rolled);
    expect(inventoryOf(back.sim, back.chest)?.gold).toBe(gold);
    expect(opens(back)).toMatchObject({ ok: true, first: false });
    expect(back.inside()).toEqual(rolled);
    expect(back.opened()).toEqual([
      { tick: back.world.tick, entity: back.chest, actor: back.player, first: false, rolled: [] },
    ]);
  });

  it('AC-1: the roll comes from the chest’s own stream: the same chest rolls the same loot in any world with the seed, and no other draw moves', () => {
    const a = setup();
    const b = setup();
    b.world.random('loot').int(0, 100); // other loot drawn first
    const before = b.world.random('loot').serialize();
    opens(a);
    opens(b);
    expect(b.inside()).toEqual(a.inside());
    expect(b.world.random('loot').serialize()).toEqual(before);
  });

  it('AC-1: a class-conditioned entry drops for the opener’s class only', () => {
    const thief = setup({ classId: 'thief', chest: { loot: 'thief-stash' } });
    opens(thief);
    expect(thief.inside()).toEqual([['lockpicks', 1]]);
    const knight = setup({ classId: 'knight', chest: { loot: 'thief-stash' } });
    opens(knight);
    expect(knight.inside()).toEqual([]);
    const nobody = new Containers(knight.rules, knight.containers.loot); // no class lookup
    const crate = knight.sim.spawn();
    nobody.make(knight.sim, crate, {
      level: LEVEL,
      id: 'crate',
      position: { x: 3, y: 0, z: 0 },
      loot: 'thief-stash',
    });
    nobody.open(knight.sim, crate, knight.player);
    expect(inventoryOf(knight.sim, crate)?.items).toEqual([]);
  });

  it('AC-2: Interact takes all: the contents move to the inventory, the chest is empty and its looted fact is set', () => {
    const t = setup({ chest: { contents: [{ item: 'letter', count: 1 }] } });
    expect(t.prompt()).toMatchObject({
      target: t.chest,
      verb: 'search',
      label: 'Search',
      available: true,
    });
    t.world.step([PRESS]);
    expect(t.opened()).toHaveLength(1);
    const taken = t.opened()[0]?.rolled ?? [];
    expect(t.inside()).toEqual([]);
    expect(inventoryOf(t.sim, t.chest)?.gold).toBe(0);
    // Everything that was inside is carried now, the quest letter too (taking it is not losing it).
    const carried = Object.fromEntries(
      (t.carried() ?? []).map(([id]) => [id, t.rules.count(t.sim, t.player, { defId: id })]),
    );
    expect(carried['letter']).toBe(1);
    for (const { item, count } of taken.filter((s) => s.item !== 'gold')) {
      expect(carried[item]).toBeGreaterThanOrEqual(count);
    }
    const gold = taken.find((s) => s.item === 'gold')?.count ?? 0;
    expect(inventoryOf(t.sim, t.player)?.gold).toBe(gold);
    const fact = `entity:${LEVEL}/chest.looted`;
    expect(t.world.facts.get(fact)).toBe(true);
    expect(t.looted()).toEqual([
      { tick: t.world.tick - 1, entity: t.chest, actor: t.player, fact },
    ]);

    // Empty now: Search is greyed with the reason, and Interact does nothing more.
    t.world.step([IDLE]);
    expect(t.prompt()).toMatchObject({ verb: 'search', available: false, reason: EMPTY_REASON });
    t.world.step([PRESS]);
    expect(t.opened()).toHaveLength(1);
  });

  it('AC-2: take all reports what moved, gold included; a stack the inventory refuses stays inside', () => {
    const t = setup({
      chest: {
        loot: 'regalia',
        contents: [
          { item: 'gold', count: 30 },
          { item: 'bread', count: 7 },
        ],
      },
      carry: ['crown'],
    });
    expect(inventoryOf(t.sim, t.chest)?.gold).toBe(30);
    const result = t.containers.takeAll(t.sim, t.chest, t.player);
    expect(result).toEqual({
      ok: true,
      moved: [
        { item: 'gold', count: 30 },
        { item: 'bread', count: 5 },
        { item: 'bread', count: 2 },
      ],
    });
    // The rolled crown is unique and the player has one: it stays, so the chest is not looted.
    expect(t.inside()).toEqual([['crown', 1]]);
    expect(t.looted()).toEqual([]);
    expect(containerEmpty(t.sim, t.chest)).toBe(false);
    expect(t.rules.count(t.sim, t.player, { defId: 'bread' })).toBe(7);
  });

  it('AC-2: take one moves one stack (or part of it), and the last take sets the looted fact', () => {
    const t = setup({
      chest: {
        loot: null,
        contents: [
          { item: 'bread', count: 3 },
          { item: 'arrow', count: 10 },
        ],
      },
    });
    const [bread, arrows] = inventoryOf(t.sim, t.chest)?.items ?? [];
    const take = (instanceId: number, count?: number) =>
      t.containers.take(t.sim, t.chest, t.player, instanceId, count);
    expect(take(arrows?.instanceId ?? 0, 4)).toEqual({
      ok: true,
      moved: [{ item: 'arrow', count: 4 }],
    });
    expect(t.inside()).toEqual([
      ['bread', 3],
      ['arrow', 6],
    ]);
    expect(take(arrows?.instanceId ?? 0, 7)).toEqual({ ok: false, reason: 'not-enough' });
    expect(take(99)).toEqual({ ok: false, reason: 'no-instance' });
    expect(() => take(arrows?.instanceId ?? 0, 0)).toThrow(RangeError);
    expect(take(arrows?.instanceId ?? 0)).toEqual({
      ok: true,
      moved: [{ item: 'arrow', count: 6 }],
    });
    expect(t.looted()).toEqual([]);
    expect(take(bread?.instanceId ?? 0)).toEqual({
      ok: true,
      moved: [{ item: 'bread', count: 3 }],
    });
    expect(t.looted()).toHaveLength(1);
    expect(t.carried()).toEqual([
      ['arrow', 10],
      ['bread', 3],
    ]);
  });

  it('AC-2: a refused take changes nothing', () => {
    const t = setup({ chest: { loot: 'regalia' }, carry: ['crown'] });
    opens(t);
    const [crown] = inventoryOf(t.sim, t.chest)?.items ?? [];
    expect(t.containers.take(t.sim, t.chest, t.player, crown?.instanceId ?? 0)).toEqual({
      ok: false,
      reason: 'unique-held',
    });
    expect(t.inside()).toEqual([['crown', 1]]);
    expect(t.looted()).toEqual([]);
  });

  it('AC-3: a locked chest without a key refuses with reason locked and does not roll its table', () => {
    const t = setup({ chest: { lock: IRON_CHEST } });
    // Its prompt is the lock's: Unlock greyed with the hint, Pick lock needing lockpicks.
    expect(t.prompt()).toMatchObject({
      verb: 'unlock',
      available: false,
      reason: IRON_CHEST.hint,
      options: [
        { verb: 'unlock', available: false },
        { verb: 'pick-lock', available: false },
      ],
    });
    t.world.step([PRESS]); // nothing usable: nothing happens
    expect(opens(t)).toEqual({ ok: false, reason: 'locked' });
    expect(t.containers.takeAll(t.sim, t.chest, t.player)).toEqual({ ok: false, reason: 'locked' });
    expect(t.containers.take(t.sim, t.chest, t.player, 1)).toEqual({ ok: false, reason: 'locked' });
    expect(t.containers.put(t.sim, t.chest, t.player, 1)).toEqual({ ok: false, reason: 'locked' });
    expect(t.refused().map((e) => e.reason)).toEqual(['locked', 'locked', 'locked', 'locked']);
    expect(t.refused()[0]).toEqual({
      tick: t.world.tick,
      entity: t.chest,
      lock: 'iron-chest',
      reason: 'locked',
      hint: IRON_CHEST.hint,
      source: t.player,
    });
    expect(t.inside()).toEqual([]);
    expect(t.opened()).toEqual([]);
    expect(t.world.facts.has(`entity:${LEVEL}/chest.opened`)).toBe(false);
  });

  it('AC-3: the key on the keyring unlocks the chest through the same path as a door; then Search takes all', () => {
    const t = setup({ chest: { lock: IRON_CHEST }, carry: ['chest-key'] });
    expect(t.prompt()).toMatchObject({ verb: 'unlock', available: true });
    t.world.step([PRESS]);
    expect(t.world.get(t.chest, LockComponent)?.locked).toBe(false);
    expect(t.opened()).toEqual([]); // unlocking is not opening
    t.world.step([IDLE]);
    expect(t.prompt()).toMatchObject({ verb: 'search', available: true });
    t.world.step([PRESS]);
    expect(t.opened()).toHaveLength(1);
    expect(t.inside()).toEqual([]);

    // The unlocked lock is part of the level's changes: after a reload the chest offers Search.
    const back = reload(t.save(), { chest: { lock: IRON_CHEST } });
    expect(back.world.get(back.chest, LockComponent)?.locked).toBe(false);
    expect(back.prompt()).toMatchObject({ verb: 'search', available: false, reason: EMPTY_REASON });
  });

  it('AC-3: lockpicks pick the chest’s lock; a lockless or unpickable lock offers what it can', () => {
    const t = setup({ chest: { lock: IRON_CHEST }, capabilities: [LOCKPICK_CAPABILITY] });
    expect(t.prompt()).toMatchObject({ verb: 'pick-lock', available: true });
    t.world.step([PRESS]);
    expect(t.world.get(t.chest, LockComponent)?.locked).toBe(false);
    const open = setup({ chest: { lock: IRON_CHEST, locked: false } });
    expect(open.prompt()).toMatchObject({ verb: 'search', available: true });
  });

  it('AC-3: a door’s lock opening leaves containers alone', () => {
    const t = setup({ carry: ['chest-key'] });
    const door = t.sim.spawn();
    makeDoor(t.sim, door, DOOR, { origin: { x: 5, y: 0, z: 0 }, lock: IRON_CHEST });
    refreshAffordances(t.sim, door);
    t.world.events.emit(interacted, {
      actor: t.player,
      target: door,
      verb: 'unlock',
      affordance: 0,
    });
    t.world.events.flush();
    expect(t.world.get(door, LockComponent)?.locked).toBe(false);
    expect(t.world.get(t.chest, InteractableComponent)?.affordances.map((a) => a.verb)).toEqual([
      'search',
    ]);
  });

  it('AC-4: an item put into a chest is still inside after a save and reload', () => {
    const t = setup({ chest: { loot: null }, carry: ['crown', 'letter'] });
    const [crown, letter] = inventoryOf(t.sim, t.player)?.items ?? [];
    const put = (instanceId: number, count?: number) =>
      t.containers.put(t.sim, t.chest, t.player, instanceId, count);
    expect(put(letter?.instanceId ?? 0)).toEqual({ ok: false, reason: 'quest-item' });
    expect(put(99)).toEqual({ ok: false, reason: 'no-instance' });
    expect(put(crown?.instanceId ?? 0)).toEqual({ ok: true, moved: [{ item: 'crown', count: 1 }] });
    expect(t.inside()).toEqual([['crown', 1]]);
    expect(t.carried()).toEqual([['letter', 1]]);

    const saved = t.save();
    expect(saved.deltas.entities).toEqual([
      { id: 'spawn:chest', aspects: { container: inventoryOf(t.sim, t.chest) } },
    ]);
    const back = reload(saved);
    expect(back.inside()).toEqual([['crown', 1]]);
    expect(back.prompt()).toMatchObject({ verb: 'search', available: true });
  });

  it('AC-4: a put the chest refuses changes nothing', () => {
    const t = setup({
      chest: { loot: null, contents: [{ item: 'bread', count: 10 }] },
      unitGuard: 10,
    });
    t.rules.add(t.sim, t.player, 'bread', 1);
    const [bread] = inventoryOf(t.sim, t.player)?.items ?? [];
    expect(t.containers.put(t.sim, t.chest, t.player, bread?.instanceId ?? 0)).toEqual({
      ok: false,
      reason: 'stack-limit',
    });
    expect(t.carried()).toEqual([['bread', 1]]);
  });

  it('a roll the pack refuses leaves that stack out of what was rolled', () => {
    // The chest already holds the crown its table guarantees: the second one cannot go in.
    const t = setup({ chest: { loot: 'regalia', contents: [{ item: 'crown', count: 1 }] } });
    opens(t);
    expect(t.opened()[0]?.rolled).toEqual([]);
    expect(t.inside()).toEqual([['crown', 1]]);
  });

  it('an empty chest with nothing to roll is empty before it is opened; a non-container never is', () => {
    const t = setup({ chest: { loot: null } });
    expect(containerEmpty(t.sim, t.chest)).toBe(true);
    expect(t.prompt()).toMatchObject({ available: false, reason: EMPTY_REASON });
    expect(containerEmpty(t.sim, t.player)).toBe(false);
    const rolls = setup();
    expect(containerEmpty(rolls.sim, rolls.chest)).toBe(false);
    expect(() => t.containers.open(t.sim, t.player, t.player)).toThrow(/is not a container/);
  });

  it('Interact ignores other verbs, other targets and actors without an inventory; the subscriptions come off', () => {
    const t = setup();
    const emit = (actor: EntityId, target: EntityId, verb: 'search' | 'use') => {
      t.world.events.emit(interacted, { actor, target, verb, affordance: 0 });
    };
    emit(t.player, t.chest, 'use');
    emit(t.player, t.player, 'search');
    const stranger = t.sim.spawn();
    emit(stranger, t.chest, 'search');
    expect(t.opened()).toEqual([]);
    t.off();
    emit(t.player, t.chest, 'search');
    expect(t.opened()).toEqual([]);
  });

  it('works without interaction or mechanisms: placed at its anchor, no prompt, no lock', () => {
    const world = new World<never>({ seed: 2 });
    world.register(InventoryComponent, PlacementComponent);
    const rules = new InventoryRules(ITEMS);
    const containers = new Containers(rules, new LootTables(TABLES, ITEMS));
    installContainers(world, containers);
    const chest = world.spawn();
    containers.make(world, chest, { level: LEVEL, id: 'chest', position: { x: 1, y: 0, z: 2 } });
    expect(world.get(chest, PlacementComponent)).toMatchObject({
      x: 1,
      y: 0.35,
      z: 2,
      radius: 0.4,
    });
    const actor = world.spawn();
    addInventory(world, actor);
    expect(containers.open(world, chest, actor)).toEqual({ ok: true, first: true, items: [] });
    refreshContainerAffordances(world, chest); // no interaction: nothing to refresh
    world.register(InteractableComponent);
    refreshContainerAffordances(world, chest); // made before interaction: it has no prompt
    expect(world.has(chest, InteractableComponent)).toBe(false);
    refreshContainerAffordances(new World<never>({ seed: 3 }), chest); // no containers at all
  });

  it('places a scene’s container spawns with their loot, contents and locks', () => {
    const t = setup();
    const at = { x: 4, y: 0, z: 0 };
    const spawns = [
      { entity: t.sim.spawn(), spawn: { id: 'marker', position: at } },
      {
        entity: t.sim.spawn(),
        spawn: {
          id: 'strongbox',
          position: at,
          container: {
            loot: 'regalia',
            contents: [{ item: 'bread', count: 2 }],
            lock: 'iron-chest',
            locked: true,
          },
        },
      },
      { entity: t.sim.spawn(), spawn: { id: 'barrel', position: at, container: { contents: [] } } },
    ];
    const locks = (id: string) => (id === IRON_CHEST.id ? IRON_CHEST : undefined);
    const made = addSceneContainers(t.sim, t.containers, 'vault', spawns, locks);
    const [, strongbox, barrel] = spawns.map((s) => s.entity);
    expect(made).toEqual([strongbox, barrel]);
    expect(t.world.get(strongbox ?? 0, ContainerComponent)).toEqual({
      loot: 'regalia',
      level: 'vault',
      id: 'strongbox',
    });
    expect(t.world.get(strongbox ?? 0, LockComponent)?.locked).toBe(true);
    expect(inventoryOf(t.sim, strongbox ?? 0)?.items.map((i) => i.defId)).toEqual(['bread']);
    expect(t.world.get(barrel ?? 0, ContainerComponent)?.loot).toBeNull();
    expect(t.world.has(barrel ?? 0, LockComponent)).toBe(false);
    const unknown = [
      {
        entity: t.sim.spawn(),
        spawn: { id: 'x', position: at, container: { contents: [], lock: 'nope' } },
      },
    ];
    expect(() => addSceneContainers(t.sim, t.containers, 'vault', unknown, locks)).toThrow(
      'unknown lock "nope"',
    );
  });
});
