// mw-e17.7: world items in the testbed as the game wires them (createGameWorld: Rapier physics,
// the player with interaction and an inventory, the scene's item spawn), driven by ActionFrames; and
// the fixture quest item's real content flags.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { FIXTURE_ITEM_IDS, loadItemFixtureContent } from '@content/test-fixtures';
import { worldItemDef } from '@game/items/index';
import {
  actionButton,
  actionFrame,
  actionVector,
  addInventory,
  handlerView,
  inventoryOf,
  itemPickedUp,
  placementOf,
  PlayerLook,
  SceneSpawnComponent,
  WorldItemComponent,
  WorldItems,
  World,
  type ActionFrame,
  type EntityId,
  type ItemPickedUp,
} from '@sim/index';
import { createGameWorld } from '@tools/replay/testbed-player-scenario';
import { describe, expect, it } from 'vitest';

const UP = actionButton(false, false, false);
const DOWN = actionButton(true, true, false);
function frame(...pressed: string[]): ActionFrame {
  const zero = actionVector(0, 0);
  return actionFrame({
    move: zero,
    look: zero,
    buttons: (action) => (pressed.includes(action) ? DOWN : UP),
  });
}
const IDLE = frame();

/** The testbed with the player (at (0, 0, −1)) turned to face the draught lying at (1, 0, −1). */
function facingDraught() {
  const game = createGameWorld<ActionFrame>(RAPIER, { seed: 1, hz: 60 });
  const { world, player, items } = game;
  const draught = world
    .query(SceneSpawnComponent)
    .ids()
    .find((id) => world.get(id, SceneSpawnComponent)?.id === 'testbed-draught');
  if (draught === undefined) throw new Error('no testbed draught');
  // The draught alone: the closet key (mw-e17.5, keyring.test.ts) is taken out of the scene.
  const key = world
    .query(SceneSpawnComponent)
    .ids()
    .find((id) => world.get(id, SceneSpawnComponent)?.id === 'closet-key');
  if (key !== undefined) world.destroy(key);
  world.set(player, PlayerLook, { yaw: -Math.PI / 2, pitch: 0 }); // facing +x
  for (let i = 0; i < 5; i++) world.step([IDLE]);
  const picked: ItemPickedUp[] = [];
  world.events.on(itemPickedUp, (e) => picked.push(e));
  const sim = world as unknown as World<never>;
  const units = (): number => items.inventory.count(sim, player);
  const lying = (): readonly EntityId[] => world.query(WorldItemComponent).ids();
  return { world, sim, player, items, draught, picked, units, lying };
}

describe('world items in the testbed (mw-e17.7)', () => {
  it('AC-1: Interact on the draught in reach adds it to the pack and despawns it in that tick', () => {
    const { world, player, draught, picked, units, lying } = facingDraught();
    expect(lying()).toEqual([draught]);
    const tick = world.tick;
    world.step([frame('interact')]);
    expect(picked).toEqual([
      expect.objectContaining({ tick, actor: player, entity: draught, defId: 'healing-draught' }),
    ]);
    expect(units()).toBe(1);
    expect(world.isAlive(draught)).toBe(false);
    expect(lying()).toEqual([]);
  });

  it('AC-2: a dropped stolen stack spawns in front of the player with the same flags', () => {
    const { world, sim, player, items, lying } = facingDraught();
    world.step([frame('interact')]);
    const [taken] = inventoryOf(sim, player)?.items ?? [];
    if (taken === undefined) throw new Error('nothing taken');
    items.inventory.setFlags(sim, player, taken.instanceId, { stolen: true, ownerId: 'abbey' });
    const feet = handlerView(sim, player)?.feet;
    world.step([frame('drop')]);
    const [dropped] = lying();
    if (dropped === undefined || feet === undefined) throw new Error('nothing dropped');
    expect(world.get(dropped, WorldItemComponent)).toEqual({
      defId: 'healing-draught',
      count: 1,
      flags: { stolen: true, ownerId: 'abbey' },
      by: player,
    });
    for (let i = 0; i < 60; i++) world.step([IDLE]);
    expect(sim.has(dropped, SceneSpawnComponent)).toBe(false); // a new entity, not the spawn
    expect(items.inventory.count(sim, player)).toBe(0);
    // It came to rest on the floor in front (+x) of the player.
    const at = placementOf(sim, dropped);
    if (at === undefined) throw new Error('not placed');
    expect(at.x - feet.x).toBeGreaterThan(0.3);
    expect(Math.abs(at.z - feet.z)).toBeLessThan(0.3);
    expect(at.y).toBeLessThan(0.2);
  });

  it('AC-5: take, drop and take again: the pack ends where it was after the first take, no duplicate', () => {
    const { world, units, lying } = facingDraught();
    world.step([frame('interact')]);
    expect([units(), lying().length]).toEqual([1, 0]);
    world.step([frame('drop')]);
    expect([units(), lying().length]).toEqual([0, 1]);
    for (let i = 0; i < 30; i++) world.step([IDLE]);
    world.step([frame('interact')]);
    expect([units(), lying().length]).toEqual([1, 0]);
  });

  it('AC-4: the fixture quest item, flagged no-drop by content, cannot be dropped or thrown', () => {
    const content = loadItemFixtureContent();
    const items = new WorldItems(content.all('item').map(worldItemDef));
    const world = new World<never>({ seed: 1 });
    const actor = world.spawn();
    addInventory(world, actor);
    items.inventory.add(world, actor, FIXTURE_ITEM_IDS.quest, 1);
    const view = { feet: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0 };
    expect(items.drop(world, actor, view, { instanceId: 1 })).toEqual({
      ok: false,
      reason: 'no-drop',
    });
    expect(items.throw(world, actor, view, { instanceId: 1 })).toEqual({
      ok: false,
      reason: 'no-drop',
    });
    expect(items.inventory.count(world, actor)).toBe(1);
  });
});
