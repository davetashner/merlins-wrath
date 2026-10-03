// mw-e18.3 AC-5: the testbed's supply chest as the game wires it (createGameWorld: Rapier physics,
// the player with interaction and an inventory, world items, mechanisms and containers), driven by
// ActionFrames. The player opens it with Interact and empties it with the container window's Take All
// command (mw-e18.4), the game saves through its save registry, a fresh
// world loads the save, and the chest is empty when the player opens it again: its table is not
// rolled a second time.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { createGameSaveRegistry } from '@game/save/sections';
import {
  actionButton,
  actionFrame,
  actionVector,
  containerActionCommand,
  containerOpened,
  hashWorld,
  interactionPrompt,
  inventoryOf,
  PlayerLook,
  teleportCommand,
  World,
  type ActionFrame,
  type ContainerOpened,
} from '@sim/index';
import { createGameWorld } from '@tools/replay/testbed-player-scenario';
import { describe, expect, it } from 'vitest';

const UP = actionButton(false, false, false);
const DOWN = actionButton(true, true, false);
function frame(interact: boolean): ActionFrame {
  const zero = actionVector(0, 0);
  return actionFrame({
    move: zero,
    look: zero,
    buttons: (action) => (action === 'interact' && interact ? DOWN : UP),
  });
}
const IDLE = frame(false);
const INTERACT = frame(true);

/** Yaw π faces +z: from (−2, 0, 0) the player looks at the chest at (−2, 0, 1). */
const FACE_SOUTH = Math.PI;

/** The testbed with the player standing a metre north of the supply chest, facing it. */
function atTheChest() {
  const game = createGameWorld<unknown>(RAPIER, { seed: 1, hz: 60 });
  const { world, player } = game;
  const sim = world as unknown as World<never>;
  const [chest] = game.containers;
  if (chest === undefined) throw new Error('the testbed has no container');
  world.step([teleportCommand(player, { x: -2, y: 0, z: 0 })]);
  world.set(player, PlayerLook, { yaw: FACE_SOUTH, pitch: 0 });
  for (let i = 0; i < 10; i++) world.step([IDLE]);
  const opened: ContainerOpened[] = [];
  world.events.on(containerOpened, (e) => opened.push(e));
  const units = (of: number) => {
    const pack = inventoryOf(sim, of);
    return (pack?.items ?? []).reduce((sum, item) => sum + item.count, 0) + (pack?.gold ?? 0);
  };
  return { world, sim, player, chest, opened, units };
}

const build = { gameVersion: '0.1.0', buildSha: 'deadbee', contentHash: 'c0ffee' };

describe('the testbed supply chest (mw-e18.3)', () => {
  it('AC-5: loot the chest, save, reload and open it again: it is empty', () => {
    const t = atTheChest();
    expect(interactionPrompt(t.sim, t.player)).toMatchObject({
      target: t.chest,
      verb: 'search',
      label: 'Search',
      available: true,
    });
    const before = t.units(t.player);
    t.world.step([INTERACT]);
    expect(t.opened).toHaveLength(1);
    expect(t.opened[0]?.first).toBe(true);
    expect(t.units(t.player)).toBe(before); // Search opens it; the window takes
    t.world.step([IDLE, containerActionCommand(t.player, t.chest, { op: 'take-all' })]);
    // Everything rolled is carried now (always a healing draught, then one or two picks).
    const rolled = t.opened[0]?.rolled ?? [];
    expect(rolled[0]).toEqual({ item: 'healing-draught', count: 1 });
    const total = rolled.reduce((sum, stack) => sum + stack.count, 0);
    expect(t.units(t.player) - before).toBe(total);
    expect(t.units(t.chest)).toBe(0);
    expect(t.world.facts.get('entity:testbed/supply-chest.looted')).toBe(true);

    const bytes = createGameSaveRegistry().write(t.world, {
      build,
      wallClockSavedAt: 1_790_000_000_000,
    });
    const back = atTheChest();
    expect(back.world.facts.has('entity:testbed/supply-chest.opened')).toBe(false);
    expect(createGameSaveRegistry().read(back.world, bytes)).toMatchObject({ ok: true });
    expect(hashWorld(back.world)).toBe(hashWorld(t.world));

    // The chest is empty: Search is greyed, and opening it rolls nothing.
    back.world.step([IDLE]);
    expect(interactionPrompt(back.sim, back.player)).toMatchObject({
      target: back.chest,
      verb: 'search',
      available: false,
      reason: 'Empty',
    });
    const carried = back.units(back.player);
    back.world.step([INTERACT]);
    expect(back.opened).toEqual([]);
    expect(t.opened).toHaveLength(2); // the take-all opened it too
    expect(back.units(back.chest)).toBe(0);
    expect(back.units(back.player)).toBe(carried);
  });
});
