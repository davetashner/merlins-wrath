// mw-e01.6: the vertical slice's loot (docs/design/vertical-slice.md B5–B7). AC-1 runs the loot
// validator (mw-e18.2) over the game content and checks the alcove chest's table names only items
// that exist. AC-2 and AC-3 load the slice headless as the game wires it (createGameWorld: Rapier
// physics, the player with interaction and an inventory, world items, the scene's mechanisms and
// containers, creatures and their drops) and drive it with ActionFrames: the rusted gallery key,
// dropped by the Forgotten miner where it dies (mw-e01.5) and taken from beside its body, opens the
// iron exit from the keyring in one press; the alcove chest, looted, saved and reloaded, is empty
// when opened again.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import {
  contentChecks,
  contentTypes,
  gameContentSources,
  loadContent,
  loadGameContent,
  lootTableProblems,
  type LoadedEntry,
} from '@content/index';
import { markExercised } from '@content/testing';
import { createGameSaveRegistry } from '@game/save/sections';
import {
  actionButton,
  actionFrame,
  actionVector,
  containerActionCommand,
  containerOpened,
  CreatureComponent,
  doorStatus,
  hashWorld,
  interacted,
  interactionPrompt,
  inventoryOf,
  killCommand,
  lockOpened,
  PlacementComponent,
  PlayerLook,
  SceneSpawnComponent,
  teleportCommand,
  WorldItemComponent,
  type ActionFrame,
  type ContainerOpened,
  type EntityId,
  type Interaction,
  type LockOpened,
  type Vec3,
  type World,
} from '@sim/index';
import { createGameWorld } from '@tools/replay/testbed-player-scenario';
import { describe, expect, it } from 'vitest';

const UP = actionButton(false, false, false);
const DOWN = actionButton(true, true, false);
function frame(forward: number, ...pressed: string[]): ActionFrame {
  return actionFrame({
    move: actionVector(0, forward),
    look: actionVector(0, 0),
    buttons: (action) => (pressed.includes(action) ? DOWN : UP),
  });
}
const IDLE = frame(0);
const INTERACT = frame(0, 'interact');
const FORWARD = frame(1);
/** Yaw π faces +z (north, towards the exit and the alcove's chest). */
const FACE_NORTH = Math.PI;

/** The slice headless as the game wires it, with what the tests watch. */
function slice() {
  const game = createGameWorld<unknown>(RAPIER, { seed: 1, hz: 60, scene: 'slice' });
  const { world, player } = game;
  const sim = world as unknown as World<never>;
  const spawn = (id: string): EntityId => {
    const found = world
      .query(SceneSpawnComponent)
      .ids()
      .find((entity) => world.get(entity, SceneSpawnComponent)?.id === id);
    if (found === undefined) throw new Error(`no slice spawn ${id}`);
    return found;
  };
  const step = (input: ActionFrame, ticks = 1): void => {
    for (let i = 0; i < ticks; i++) world.step([input]);
  };
  const teleport = (to: Vec3, yaw = FACE_NORTH): void => {
    world.step([teleportCommand(player, to)]);
    world.set(player, PlayerLook, { yaw, pitch: 0 });
    step(IDLE, 10);
  };
  const at = (): Vec3 => {
    const placement = world.get(player, PlacementComponent);
    if (placement === undefined) throw new Error('the player is not placed');
    return { x: placement.x, y: placement.y, z: placement.z };
  };
  const creature = (point: string): EntityId => {
    const found = world
      .query(CreatureComponent)
      .ids()
      .find((entity) => world.get(entity, CreatureComponent)?.origin.point === point);
    if (found === undefined) throw new Error(`no slice creature ${point}`);
    return found;
  };
  const worldItem = (defId: string): EntityId => {
    const found = world
      .query(WorldItemComponent)
      .ids()
      .find((entity) => world.get(entity, WorldItemComponent)?.defId === defId);
    if (found === undefined) throw new Error(`no ${defId} lies in the slice`);
    return found;
  };
  const interactions: Interaction[] = [];
  const opened: LockOpened[] = [];
  const searched: ContainerOpened[] = [];
  world.events.on(interacted, (e) => interactions.push(e));
  world.events.on(lockOpened, (e) => opened.push(e));
  world.events.on(containerOpened, (e) => searched.push(e));
  const pack = (of: EntityId = player) =>
    (inventoryOf(sim, of)?.items ?? []).map(({ defId, count }) => [defId, count]);
  const gold = (of: EntityId = player) => inventoryOf(sim, of)?.gold ?? 0;
  return {
    world,
    sim,
    player,
    containers: game.containers,
    spawn,
    creature,
    worldItem,
    step,
    teleport,
    at,
    interactions,
    opened,
    searched,
    pack,
    gold,
  };
}

/** The Forgotten miner's post by pillar B, where it rests and, killed there, drops the key (§4). */
const KEY_AT = { x: 2.5, z: 32.5 };
/** On the loot alcove's floor (1.4 m up), a step south of the chest at (8, 36.5). */
const BEFORE_CHEST = { x: 8, y: 1.4, z: 35.4 };

const build = { gameVersion: '0.1.0', buildSha: 'deadbee', contentHash: 'c0ffee' };

describe('the slice loot (mw-e01.6)', () => {
  it('AC-1: the slice loot table passes the loot validator and every entry names an existing item', ({
    task,
  }) => {
    markExercised(task, 'loot-table', 'slice-alcove-chest');
    let entries: readonly LoadedEntry[] = [];
    loadContent(contentTypes, gameContentSources(), [
      ...contentChecks,
      (loaded) => {
        entries = loaded;
        return [];
      },
    ]);
    const file = 'src/content/data/loot-table/slice-alcove-chest.json';
    const { errors, warnings } = lootTableProblems(entries);
    expect(errors).toEqual([]);
    // Referenced by the slice's chest, so not even the unreferenced-table warning.
    expect(warnings.filter((w) => w.file === file)).toEqual([]);

    const content = loadGameContent();
    const table = content.get('loot-table', 'slice-alcove-chest');
    const named = [
      ...table.guaranteed.map((g) => g.item.id),
      ...table.entries.map((e) => e.item?.id ?? e.table?.id),
    ];
    // A healing draught, the oddity and a few coins, every one an item content has.
    expect(named).toEqual(['healing-draught', 'miners-tally-stick', 'gold']);
    for (const id of named) expect(content.has('item', id ?? ''), id).toBe(true);
    expect(table.entries.every((e) => e.table === undefined)).toBe(true);
    expect(content.get('item', 'gold').category).toBe('currency');
    // The oddity's text follows the bible's item voice: one to three sentences.
    const oddity = content.get('item', 'miners-tally-stick');
    const sentences = (oddity.description ?? '').split(/(?<=[.!?])\s+/);
    expect(sentences.length).toBeGreaterThanOrEqual(1);
    expect(sentences.length).toBeLessThanOrEqual(3);
    // The chest in the alcove rolls it.
    const chest = content.get('scene', 'slice').spawns.find((s) => s.id === 'alcove-chest');
    expect(chest?.container?.loot?.id).toBe('slice-alcove-chest');
  });

  it('AC-2: holding the gallery key, Interact on the exit door unlocks and opens it with no menu', ({
    task,
  }) => {
    markExercised(task, 'item', 'rusted-gallery-key');
    const t = slice();
    const door = t.spawn('exit-door');
    expect(doorStatus(t.sim, door)).toBe('locked');

    // The miner dies at its post and drops the key it carries (mw-e01.5).
    t.world.step([IDLE, killCommand(t.creature('skeleton'))]);
    t.step(IDLE, 30);
    const key = t.worldItem('rusted-gallery-key');

    // Take the key from beside the body: it goes on the keyring.
    t.teleport({ x: KEY_AT.x, y: 0, z: KEY_AT.z - 1.2 });
    expect(interactionPrompt(t.sim, t.player)).toMatchObject({ target: key, available: true });
    t.step(INTERACT);
    expect(t.pack()).toEqual([['rusted-gallery-key', 1]]);
    expect(t.world.isAlive(key)).toBe(false);

    // A step in front of the iron door: Unlock is available now, and one press opens it.
    t.teleport({ x: 0, y: 0, z: 35.5 });
    expect(interactionPrompt(t.sim, t.player)).toMatchObject({
      target: door,
      verb: 'unlock',
      available: true,
    });
    t.step(INTERACT);
    expect(t.opened).toEqual([
      expect.objectContaining({
        entity: door,
        lock: 'slice-exit',
        keyId: 'rusted-gallery-key',
        actor: t.player,
        consumed: false,
      }),
    ]);
    t.step(IDLE, 90);
    expect(doorStatus(t.sim, door)).toBe('open');
    // Two presses, two interactions (take, unlock), nothing between them: no inventory, no choice.
    expect(t.interactions.map((e) => [e.verb, e.target])).toEqual([
      ['pick-up', key],
      ['unlock', door],
    ]);
    // The quest key stays on the ring.
    expect(t.pack()).toEqual([['rusted-gallery-key', 1]]);

    // Through the open doorway into the vestibule: the slice is complete.
    t.step(FORWARD, 60);
    t.step(IDLE, 10);
    expect(t.at().z).toBeGreaterThan(37.5);
    expect(t.world.facts.get('slice.complete')).toBe(true);
  });

  it('AC-3: loot the alcove chest, save, reload and open it again: it is empty', ({ task }) => {
    markExercised(task, 'item', 'miners-tally-stick');
    markExercised(task, 'item', 'gold');
    markExercised(task, 'item', 'healing-draught');
    const t = slice();
    const chest = t.spawn('alcove-chest');
    expect(t.containers).toEqual([chest]);
    t.teleport(BEFORE_CHEST);
    expect(t.at().y).toBeCloseTo(1.4, 1);
    expect(interactionPrompt(t.sim, t.player)).toMatchObject({
      target: chest,
      verb: 'search',
      available: true,
    });
    t.step(INTERACT);
    expect(t.searched).toHaveLength(1);
    expect(t.searched[0]?.first).toBe(true);
    t.world.step([IDLE, containerActionCommand(t.player, chest, { op: 'take-all' })]);
    // Always the draught and the tally stick, then a few coins.
    const rolled = t.searched[0]?.rolled ?? [];
    expect(rolled.slice(0, 2)).toEqual([
      { item: 'healing-draught', count: 1 },
      { item: 'miners-tally-stick', count: 1 },
    ]);
    expect(rolled[2]?.item).toBe('gold');
    const coins = rolled[2]?.count ?? 0;
    expect(coins).toBeGreaterThanOrEqual(3);
    expect(coins).toBeLessThanOrEqual(8);
    expect(t.pack()).toEqual([
      ['healing-draught', 1],
      ['miners-tally-stick', 1],
    ]);
    expect(t.gold()).toBe(coins);
    expect(t.pack(chest)).toEqual([]);
    expect(t.gold(chest)).toBe(0);
    expect(t.world.facts.get('entity:slice/alcove-chest.looted')).toBe(true);

    const bytes = createGameSaveRegistry().write(t.world, {
      build,
      wallClockSavedAt: 1_790_000_000_000,
    });
    const back = slice();
    const again = back.spawn('alcove-chest');
    expect(createGameSaveRegistry().read(back.world, bytes)).toMatchObject({ ok: true });
    expect(hashWorld(back.world)).toBe(hashWorld(t.world));

    // Opened again, it is empty: Search is greyed, and Interact rolls nothing more.
    back.world.step([IDLE]);
    expect(interactionPrompt(back.sim, back.player)).toMatchObject({
      target: again,
      verb: 'search',
      available: false,
      reason: 'Empty',
    });
    back.step(INTERACT);
    back.step(IDLE, 10);
    expect(back.searched).toEqual([]);
    expect(back.pack(again)).toEqual([]);
    expect(back.gold(again)).toBe(0);
    expect(back.gold()).toBe(coins);
  });
});
