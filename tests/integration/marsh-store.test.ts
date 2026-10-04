// mw-ju8.9: Marsh's General Store (src/content/data/scene/marsh-store.json), loaded headless as the
// game wires it (createGameWorld: Rapier physics, the player with interaction, the scene's door,
// creatures and shop counters). AC-1: the interior loads with the shopkeeper behind the counter and
// she stays there, friendly (the browser run is e2e/marsh-store.spec.ts). AC-2: using the counter
// requests the shop for her merchant, whose stock the shop transactions can read. AC-3: the player
// walks up the stair to the upstairs room, where the bed and the table are.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it } from 'vitest';
import { loadGameContent } from '@content/index';
import { markExercised } from '@content/testing';
import {
  actionButton,
  actionFrame,
  actionVector,
  CreatureComponent,
  FactionMemberComponent,
  interactionPrompt,
  InventoryRules,
  PlacementComponent,
  PlayerLook,
  SceneSpawnComponent,
  shopOpenRequested,
  Shops,
  teleportCommand,
  type ActionFrame,
  type EntityId,
  type ShopOpenRequest,
  type Vec3,
  type World,
} from '@sim/index';
import { createGameWorld } from '@tools/replay/testbed-player-scenario';

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
/** Yaw π faces +z (north, towards the counter and the stair top); yaw π/2 faces −x (west). */
const FACE_NORTH = Math.PI;
const FACE_WEST = Math.PI / 2;

const content = loadGameContent();

/** The store headless as the game wires it, with what the tests watch. */
function store() {
  const game = createGameWorld<unknown>(RAPIER, { seed: 1, hz: 60, scene: 'marsh-store' });
  const { world, player } = game;
  const sim = world as unknown as World<never>;
  const spawn = (id: string): EntityId => {
    const found = world
      .query(SceneSpawnComponent)
      .ids()
      .find((entity) => world.get(entity, SceneSpawnComponent)?.id === id);
    if (found === undefined) throw new Error(`no marsh-store spawn ${id}`);
    return found;
  };
  /** A spawn's authored position (markers have no placement of their own). */
  const marker = (id: string): Vec3 => {
    const found = game.scene.layout.spawns.find((s) => s.id === id);
    if (found === undefined) throw new Error(`no marsh-store spawn ${id}`);
    return found.position;
  };
  const keeper = (): EntityId => {
    const found = world
      .query(CreatureComponent)
      .ids()
      .find((entity) => world.get(entity, CreatureComponent)?.origin.creature === 'npc-ottilie');
    if (found === undefined) throw new Error('Ottilie is not in the shop');
    return found;
  };
  const where = (entity: EntityId): Vec3 => {
    const placement = world.get(entity, PlacementComponent);
    if (placement === undefined) throw new Error('not placed');
    return { x: placement.x, y: placement.y, z: placement.z };
  };
  const step = (input: ActionFrame, ticks = 1): void => {
    for (let i = 0; i < ticks; i++) world.step([input]);
  };
  const teleport = (to: Vec3, yaw: number): void => {
    world.step([teleportCommand(player, to)]);
    world.set(player, PlayerLook, { yaw, pitch: 0 });
    step(IDLE, 10);
  };
  const requests: ShopOpenRequest[] = [];
  world.events.on(shopOpenRequested, (request) => requests.push(request));
  return { world, sim, player, spawn, marker, keeper, where, step, teleport, requests };
}

describe('Marsh’s General Store, headless (mw-ju8.9)', () => {
  it('AC-1: the interior loads, the shopkeeper stands behind the counter and stays at her post', ({
    task,
  }) => {
    markExercised(task, 'scene', 'marsh-store');
    markExercised(task, 'creature', 'npc-ottilie');
    markExercised(task, 'behaviour', 'shopkeeper');
    markExercised(task, 'faction', 'townsfolk');
    const t = store();
    const ottilie = t.keeper();
    // Behind the counter: the customer side is z < 1, the counter spans z 1…2, she is at z 3.
    expect(t.where(ottilie).z).toBeGreaterThan(2);
    expect(t.marker('shop-counter').z).toBeLessThan(1);
    // She idles for ten seconds at her post: no wandering out into the shop.
    t.step(IDLE, 600);
    expect(t.where(ottilie).z).toBeGreaterThan(2);
    expect(Math.hypot(t.where(ottilie).x + 2, t.where(ottilie).z - 3)).toBeLessThan(0.75);
    // Friendly to the player, by faction.
    expect(t.world.get(ottilie, FactionMemberComponent)).toMatchObject({
      faction: 'townsfolk',
      toward: { player: 'friendly' },
    });
    // The player starts inside, by the front door, which is unlocked.
    expect(t.where(t.player).z).toBeLessThan(-2);
  });

  it('AC-2: using the counter requests the shop for marsh-general-store, with its stock to hand', ({
    task,
  }) => {
    markExercised(task, 'merchant', 'marsh-general-store');
    const t = store();
    const counter = t.spawn('shop-counter');
    t.teleport({ x: -2, y: 0, z: -0.25 }, FACE_NORTH);
    expect(interactionPrompt(t.sim, t.player)).toMatchObject({
      target: counter,
      verb: 'use',
      label: 'Trade',
      available: true,
    });
    expect(t.requests).toEqual([]);
    t.step(INTERACT);
    t.step(IDLE, 5);
    expect(t.requests.map(({ actor, entity, merchant }) => ({ actor, entity, merchant }))).toEqual([
      { actor: t.player, entity: counter, merchant: 'marsh-general-store' },
    ]);
    // The request names a real merchant: the shop transactions open it with its authored stock.
    const request = t.requests[0];
    const merchant = content.get('merchant', request?.merchant ?? '');
    const shops = new Shops(
      content.all('merchant'),
      content.all('item'),
      new InventoryRules(content.all('item')),
    );
    const state = shops.stateOf(t.world, merchant.id);
    expect(state.gold).toBe(merchant.goldReserve);
    expect(state.stock.map((line) => line.defId).sort()).toEqual(
      merchant.stock.map((line) => line.item?.id ?? '').sort(),
    );
  });

  it('AC-3: climbing the stair reaches the upstairs room, with the bed and the table in it', () => {
    const t = store();
    // The foot of the stair, facing north up the 3 m flight (12 steps of 0.25 m over 6 m).
    t.teleport({ x: 4, y: 0, z: -3.5 }, FACE_NORTH);
    let top = 0;
    for (let i = 0; i < 900 && t.where(t.player).z < 3.2; i++) {
      t.step(FORWARD);
      top = Math.max(top, t.where(t.player).y);
    }
    // On the landing at second-floor height, not stuck on the flight.
    expect(t.where(t.player).y).toBeGreaterThan(2.9);
    expect(t.where(t.player).z).toBeGreaterThan(2.5);
    expect(top).toBeLessThan(3.3);
    // On into the room, west through the gap in the stair wall.
    t.world.set(t.player, PlayerLook, { yaw: FACE_WEST, pitch: 0 });
    for (let i = 0; i < 120; i++) t.step(FORWARD);
    expect(t.where(t.player).x).toBeLessThan(2);
    expect(t.where(t.player).y).toBeGreaterThan(2.9);
    // And back down: the way is not one-way (facing south, yaw 0, down the flight).
    t.teleport({ x: 4, y: 3, z: 3.5 }, 0);
    for (let i = 0; i < 600 && t.where(t.player).y > 0.5; i++) t.step(FORWARD);
    expect(t.where(t.player).y).toBeLessThan(0.5);
    expect(t.where(t.player).z).toBeLessThan(-2);
    // The bed and the table are up here with it.
    for (const id of ['bed', 'table']) expect(t.marker(id).y).toBeGreaterThanOrEqual(3);
  });
});
