// mw-ju8.6: the Sleeping Ox (src/content/data/scene/sleeping-ox.json), loaded headless as the game
// wires it, and the room for the night run through the real content: the merchant, its service, the
// day clock's facts and the player's health. The shop window's own flow is in
// src/game/shop/shop-window.test.ts; the browser run is e2e/sleeping-ox.spec.ts.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it } from 'vitest';
import { loadGameContent } from '@content/index';
import { markExercised } from '@content/testing';
import { installFactRegistry } from '@game/facts';
import { SafetyVetoes } from '@game/save/autosave/index';
import {
  actionButton,
  actionFrame,
  actionVector,
  CreatureComponent,
  factDayClock,
  FactionMemberComponent,
  HealthComponent,
  interactionPrompt,
  InventoryRules,
  inventoryOf,
  MORNING_MINUTE,
  PlacementComponent,
  PlayerLook,
  restCompleted,
  SceneSpawnComponent,
  Shops,
  teleportCommand,
  type EntityId,
  type RestCompleted,
  type Vec3,
  type World,
} from '@sim/index';
import { createGameWorld } from '@tools/replay/testbed-player-scenario';

const UP = actionButton(false, false, false);
const IDLE = actionFrame({
  move: actionVector(0, 0),
  look: actionVector(0, 0),
  buttons: () => UP,
});
/** Yaw π faces +z (north, towards the bar). */
const FACE_NORTH = Math.PI;

const content = loadGameContent();
const ROOM = 'room-for-the-night';

/** The inn headless as the game wires it, with the shop engine and the day clock. */
function inn(crowns: number) {
  const game = createGameWorld<unknown>(RAPIER, { seed: 1, hz: 60, scene: 'sleeping-ox' });
  const { world, player } = game;
  const sim = world as unknown as World<never>;
  installFactRegistry(sim.facts, content, true);
  const rules = new InventoryRules(content.all('item'));
  const have = inventoryOf(sim, player)?.gold ?? 0;
  if (crowns > have) rules.addGold(sim, player, crowns - have);
  else rules.spendGold(sim, player, have - crowns);
  const shops = new Shops(content.all('merchant'), content.all('item'), rules);
  const clock = factDayClock(sim.facts);
  clock.set({ day: 1, minute: 21 * 60 });
  const maxHealth = sim.get(player, HealthComponent)?.max ?? 0;
  sim.set(player, HealthComponent, { max: maxHealth, current: 1 });
  const rested: RestCompleted[] = [];
  sim.events.on(restCompleted, (e) => rested.push(e));
  const tags = (id: string): readonly string[] =>
    game.scene.layout.spawns.find((s) => s.id === id)?.tags ?? [];
  const spawn = (id: string): EntityId => {
    const found = world
      .query(SceneSpawnComponent)
      .ids()
      .find((entity) => world.get(entity, SceneSpawnComponent)?.id === id);
    if (found === undefined) throw new Error(`no sleeping-ox spawn ${id}`);
    return found;
  };
  const where = (entity: EntityId): Vec3 => {
    const placement = world.get(entity, PlacementComponent);
    if (placement === undefined) throw new Error('not placed');
    return { x: placement.x, y: placement.y, z: placement.z };
  };
  const step = (ticks = 1): void => {
    for (let i = 0; i < ticks; i++) world.step([IDLE]);
  };
  return {
    game,
    world,
    sim,
    player,
    rules,
    shops,
    clock,
    maxHealth,
    rested,
    tags,
    spawn,
    where,
    step,
    gold: () => inventoryOf(sim, player)?.gold ?? 0,
    health: () => sim.get(player, HealthComponent)?.current ?? 0,
  };
}

describe('the Sleeping Ox scene, headless (mw-ju8.6)', () => {
  it('the inn loads with Dot behind the bar, friendly, and she stays at her post', ({ task }) => {
    markExercised(task, 'scene', 'sleeping-ox');
    markExercised(task, 'creature', 'npc-dot');
    markExercised(task, 'behaviour', 'shopkeeper');
    markExercised(task, 'faction', 'townsfolk');
    const t = inn(100);
    const dot = t.world
      .query(CreatureComponent)
      .ids()
      .find((entity) => t.world.get(entity, CreatureComponent)?.origin.creature === 'npc-dot');
    if (dot === undefined) throw new Error('Dot is not in the inn');
    t.step(600);
    const at = t.where(dot);
    expect(Math.hypot(at.x + 2, at.z - 3)).toBeLessThan(0.75);
    expect(t.world.get(dot, FactionMemberComponent)).toMatchObject({
      faction: 'townsfolk',
      toward: { player: 'friendly' },
    });
  });

  it('the bar prompts Trade / Rooms and names the sleeping-ox merchant, whose service is a room', ({
    task,
  }) => {
    markExercised(task, 'merchant', 'sleeping-ox');
    const t = inn(100);
    const counter = t.spawn('bar-counter');
    t.world.step([teleportCommand(t.player, { x: -2, y: 0, z: -0.25 })]);
    t.world.set(t.player, PlayerLook, { yaw: FACE_NORTH, pitch: 0 });
    t.step(10);
    expect(interactionPrompt(t.sim, t.player)).toMatchObject({
      target: counter,
      verb: 'talk',
      label: 'Trade / Rooms',
      available: true,
    });
    const tag = t.tags('bar-counter').find((x) => x.startsWith('merchant:'));
    const merchant = content.get('merchant', tag?.slice('merchant:'.length) ?? '');
    expect(merchant.id).toBe('sleeping-ox');
    expect(merchant.npcId).toBe('npc-dot');
    expect(merchant.services.map((s) => [s.id, s.kind])).toEqual([[ROOM, 'rest']]);
    // The shop engine opens it with its authored food stock.
    expect(t.shops.stateOf(t.sim, merchant.id).stock.length).toBe(merchant.stock.length);
  });
});

describe('a night at the Sleeping Ox (mw-ju8.6)', () => {
  it('AC-1: with enough crowns, buying the room drops crowns by the price, passes time to morning and heals fully', ({
    task,
  }) => {
    markExercised(task, 'fact', 'time');
    const t = inn(100);
    const price = content.get('merchant', 'sleeping-ox').services[0]?.price ?? 0;
    expect(price).toBeGreaterThanOrEqual(8);
    expect(price).toBeLessThanOrEqual(15);
    expect(t.health()).toBe(1);
    const result = t.shops.buyService(t.sim, t.player, 'sleeping-ox', ROOM);
    expect(result).toMatchObject({ ok: true, price });
    expect(t.gold()).toBe(100 - price);
    expect(t.clock.now()).toEqual({ day: 2, minute: MORNING_MINUTE });
    expect(t.health()).toBe(t.maxHealth);
    t.sim.events.flush();
    expect(t.rested).toMatchObject([{ kind: 'inn', hours: 9, point: 'sleeping-ox' }]);
  });

  it('AC-2: with too few crowns the purchase is refused and nothing changes', () => {
    const t = inn(7);
    const result = t.shops.buyService(t.sim, t.player, 'sleeping-ox', ROOM);
    expect(result).toEqual({ ok: false, reason: 'cannot-afford' });
    expect(t.gold()).toBe(7);
    expect(t.clock.now()).toEqual({ day: 1, minute: 21 * 60 });
    expect(t.health()).toBe(1);
    t.sim.events.flush();
    expect(t.rested).toEqual([]);
  });

  it('the autosave veto registry holds a night back: no sleeping with hostiles alerted, no charge', () => {
    const t = inn(100);
    const vetoes = new SafetyVetoes();
    vetoes.register('combat', () => 'enemies are hunting you');
    const result = t.shops.buyService(t.sim, t.player, 'sleeping-ox', ROOM, {
      safety: () => vetoes.active()[0]?.reason ?? null,
    });
    expect(result).toEqual({ ok: false, reason: 'unsafe', detail: 'enemies are hunting you' });
    expect(t.gold()).toBe(100);
    expect(t.clock.now().day).toBe(1);
    expect(t.health()).toBe(1);
  });

  it('the day survives a save: the clock is world facts, so a snapshot restores the morning', () => {
    const t = inn(100);
    t.shops.buyService(t.sim, t.player, 'sleeping-ox', ROOM);
    const saved = t.sim.facts.snapshot();
    expect(saved['time.day']).toBe(2);
    expect(saved['time.minute']).toBe(MORNING_MINUTE);
  });
});
