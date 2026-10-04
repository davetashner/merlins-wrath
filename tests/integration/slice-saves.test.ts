// mw-e01.7: saving and reloading the vertical slice with its world state intact (docs/design/
// vertical-slice.md B2–B8, §6). The slice is built headless as the game wires it (createGameWorld:
// Rapier physics, the player, mechanisms, containers, creatures with perception and AI on the
// slice's navmesh) and driven with ActionFrames and debug commands. Saves go through the game's save
// registry; autosaves through the game's autosave wiring (GameAutosave) over the slice's checkpoint
// volumes, its slice.complete milestone and the creatures' combat veto, into real save slots.
//
// The Forgotten miner is the one slice.json places (mw-e01.5): spawn `skeleton`, at its post by
// pillar B, (2.5, 0, 32.5), facing the doorway; killed, it drops the gallery key it carries.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { loadGameContent, type GameContent } from '@content/index';
import { markExercised } from '@content/testing';
import { createCapabilityRegistry } from '@game/capabilities';
import { applyClass, createClassRules } from '@game/classes';
import { combatVeto, COMBAT_VETO_ID } from '@game/creatures/index';
import { sceneCheckpoints } from '@game/mechanisms/index';
import { GameAutosave, type AutosaveEvent } from '@game/save/autosave/index';
import { describeSave } from '@game/save/describe';
import { createGameSaveRegistry } from '@game/save/sections';
import { AUTOSAVE_SLOTS, SaveSlots } from '@game/save/slots/index';
import { MemorySaveStore } from '@game/save/storage/index';
import {
  actionButton,
  actionFrame,
  actionVector,
  BrainComponent,
  classOf,
  containerActionCommand,
  CreatureComponent,
  hashWorld,
  HealthComponent,
  interactionPrompt,
  inventoryOf,
  killCommand,
  PlayerLook,
  SceneSpawnComponent,
  teleportCommand,
  WorldItemComponent,
  type ActionFrame,
  type EntityId,
  type Vec3,
  type World,
} from '@sim/index';
import { createGameWorld } from '@tools/replay/testbed-player-scenario';
import { describe, expect, it } from 'vitest';

const UP = actionButton(false, false, false);
const DOWN = actionButton(true, true, false);
function frame(...pressed: string[]): ActionFrame {
  return actionFrame({
    move: actionVector(0, 0),
    look: actionVector(0, 0),
    buttons: (action) => (pressed.includes(action) ? DOWN : UP),
  });
}
const IDLE = frame();
const INTERACT = frame('interact');
/** Yaw π faces +z (north: up the corridor, into the arena). */
const FACE_NORTH = Math.PI;

let content: GameContent | undefined;
/** The game's content, loaded once. */
function sliceContent(): GameContent {
  content ??= loadGameContent();
  return content;
}

/** The slice headless as the game wires it, with the skeleton at its post. */
function slice() {
  const game = createGameWorld<unknown>(RAPIER, {
    seed: 1,
    hz: 60,
    scene: 'slice',
    content: sliceContent(),
  });
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
  const creatures = (): readonly EntityId[] => world.query(CreatureComponent).ids();
  const skeleton = (): EntityId => {
    const found = creatures().find(
      (entity) => world.get(entity, CreatureComponent)?.origin.point === 'skeleton',
    );
    if (found === undefined) throw new Error('the skeleton is not in the slice');
    return found;
  };
  const alive = (entity: EntityId): boolean =>
    (world.get(entity, HealthComponent)?.current ?? 0) > 0;
  const alertState = (): string | undefined => world.get(skeleton(), BrainComponent)?.state;
  const step = (input: ActionFrame, ticks = 1): void => {
    for (let i = 0; i < ticks; i++) world.step([input]);
  };
  const teleport = (to: Vec3, yaw = FACE_NORTH): void => {
    world.step([teleportCommand(player, to)]);
    world.set(player, PlayerLook, { yaw, pitch: 0 });
    step(IDLE, 10);
  };
  const pack = (of: EntityId = player) =>
    (inventoryOf(sim, of)?.items ?? []).map(({ defId, count }) => [defId, count]);
  const gold = (of: EntityId = player) => inventoryOf(sim, of)?.gold ?? 0;
  return {
    game,
    world,
    sim,
    player,
    spawn,
    creatures,
    skeleton,
    alive,
    alertState,
    step,
    teleport,
    pack,
    gold,
  };
}

/** On the loot alcove's floor (1.4 m up), a step south of the chest at (8, 36.5). */
const BEFORE_CHEST = { x: 8, y: 1.4, z: 35.4 };
/** Inside the arena doorway, in the skeleton's view (7.9 m from its post, vertical-slice §4). */
const ARENA_DOORWAY = { x: 0, y: 0, z: 26 };
/** In CP-2, the trigger volume at the corridor's end (x −1…1, z 22…24). */
const IN_CP2 = { x: 0, y: 0, z: 23 };

const build = { gameVersion: '0.1.0', buildSha: 'deadbee', contentHash: 'c0ffee' };
const NOW = 1_790_000_000_000;

describe('saving and reloading the slice (mw-e01.7)', () => {
  it('AC-1: with the skeleton dead and the chest looted, a save reloads with the skeleton still dead, the chest empty and the same state hash', ({
    task,
  }) => {
    markExercised(task, 'creature', 'forgotten-miner');
    markExercised(task, 'scene', 'slice');
    const t = slice();
    // A new game as the knight (class selection registers the class components only now; the
    // fresh slice the save loads into has none).
    applyClass(
      t.sim,
      t.player,
      'knight',
      createClassRules(sliceContent(), createCapabilityRegistry(sliceContent(), true)),
    );
    const skeleton = t.skeleton();
    expect(t.alive(skeleton)).toBe(true);

    // The skeleton dies (its fight is the encounter's, mw-e01.5): its slain fact is set.
    t.world.step([IDLE, killCommand(skeleton)]);
    t.step(IDLE, 5);
    expect(t.alive(skeleton)).toBe(false);
    expect(t.world.facts.get('entity:slice/skeleton.slain')).toBe(true);

    // Loot the alcove chest with Take All.
    const chest = t.spawn('alcove-chest');
    t.teleport(BEFORE_CHEST);
    t.step(INTERACT);
    t.world.step([IDLE, containerActionCommand(t.player, chest, { op: 'take-all' })]);
    t.step(IDLE, 5);
    expect(t.pack(chest)).toEqual([]);
    expect(t.gold(chest)).toBe(0);
    const carried = t.pack();
    const coins = t.gold();
    // The knight's kit, then what the chest held.
    expect(carried.map(([item]) => item)).toEqual(
      expect.arrayContaining(['healing-draught', 'miners-tally-stick']),
    );
    expect(t.world.facts.get('entity:slice/alcove-chest.looted')).toBe(true);

    // Save, and load into a freshly built slice (where the skeleton stands alive at its post).
    const registry = createGameSaveRegistry();
    const bytes = registry.write(t.world, { build, wallClockSavedAt: NOW });
    const back = slice();
    expect(back.alive(back.skeleton())).toBe(true);
    const loaded = registry.read(back.world, bytes);
    if (!loaded.ok) throw loaded.error;
    expect(loaded.warnings).toEqual([]);
    expect(hashWorld(back.world)).toBe(hashWorld(t.world));

    // The skeleton has not respawned: the one placed creature is the dead skeleton, and stays so.
    expect(back.creatures()).toEqual([back.skeleton()]);
    expect(classOf(back.sim, back.player)).toBe('knight');
    expect(back.alive(back.skeleton())).toBe(false);
    expect(back.world.facts.get('entity:slice/skeleton.slain')).toBe(true);
    // The key it dropped still lies by its body (mw-e01.5), once.
    const lying = (w: typeof back.world) =>
      w
        .query(WorldItemComponent)
        .ids()
        .map((entity) => w.get(entity, WorldItemComponent)?.defId);
    expect(lying(t.world)).toEqual(['rusted-gallery-key']);
    expect(lying(back.world)).toEqual(['rusted-gallery-key']);
    // The chest is empty: Search is greyed with "Empty", and Interact rolls nothing more.
    const again = back.spawn('alcove-chest');
    back.step(IDLE);
    expect(interactionPrompt(back.sim, back.player)).toMatchObject({
      target: again,
      verb: 'search',
      available: false,
      reason: 'Empty',
    });
    back.step(INTERACT);
    expect(back.pack(again)).toEqual([]);
    expect(back.pack()).toEqual(carried);
    expect(back.gold()).toBe(coins);

    // And the reloaded run goes on exactly as the saved one does, given the same input.
    t.step(IDLE);
    t.step(INTERACT);
    t.step(IDLE, 120);
    back.step(IDLE, 120);
    expect(back.alive(back.skeleton())).toBe(false);
    expect(hashWorld(back.world)).toBe(hashWorld(t.world));
  });

  it('AC-2: entering CP-2 while the skeleton is in Combat defers the autosave until combat ends', async ({
    task,
  }) => {
    markExercised(task, 'signal-graph', 'slice');
    const t = slice();
    const slots = new SaveSlots({
      store: new MemorySaveStore(),
      registry: createGameSaveRegistry(),
      build,
      now: () => NOW,
    });
    const events: AutosaveEvent[] = [];
    // As src/main.ts wires it.
    const autosave = new GameAutosave({
      world: t.sim,
      slots,
      describe: () => describeSave(t.sim, t.player, sliceContent(), 'slice'),
      isCheckpoint: sceneCheckpoints(t.game.scene.layout),
      milestones: ['slice.complete'],
      vetoes: { [COMBAT_VETO_ID]: combatVeto(t.sim) },
      publish: (event) => events.push(event),
    });
    /** Steps `ticks` ticks, giving the autosave its turn after each, as the game loop does. */
    const play = async (input: ActionFrame, ticks: number): Promise<void> => {
      for (let i = 0; i < ticks; i++) {
        t.world.step([input]);
        await autosave.afterStep();
      }
    };

    // Into the arena doorway, in the skeleton's sight: it wakes and enters Combat.
    expect(t.alertState()).toBe('unaware');
    t.teleport(ARENA_DOORWAY);
    for (let i = 0; i < 600 && t.alertState() !== 'combat'; i++) await play(IDLE, 1);
    expect(t.alertState()).toBe('combat');

    // Back into CP-2 with the skeleton still fighting: the checkpoint asks, the veto holds it.
    t.world.step([teleportCommand(t.player, IN_CP2)]);
    await play(IDLE, 30);
    expect(t.alertState()).toBe('combat');
    expect(autosave.scheduler.pending).toEqual({ kind: 'checkpoint', source: 'slice/cp-2' });
    expect(autosave.scheduler.vetoes.active()).toEqual([
      { id: 'combat', reason: "Can't save during combat" },
    ]);
    expect(events).toEqual([]);
    expect((await slots.list(AUTOSAVE_SLOTS)).map((slot) => slot.state)).toEqual([
      'empty',
      'empty',
      'empty',
    ]);

    // Combat ends (the skeleton falls): the deferred autosave is written, once.
    t.world.step([IDLE, killCommand(t.skeleton())]);
    await play(IDLE, 5);
    expect(events.map((event) => [event.type, event.trigger.source])).toEqual([
      ['saving', 'slice/cp-2'],
      ['saved', 'slice/cp-2'],
    ]);
    const [first] = await slots.list(AUTOSAVE_SLOTS);
    expect(first?.state === 'ready' && first.details?.areaId).toBe('slice');
    expect(autosave.scheduler.pending).toBeNull();
  });
});
