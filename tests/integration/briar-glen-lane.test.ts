// mw-ju8.5: the Briar Glen shop lane (src/content/data/scene/briar-glen-lane.json) loaded headless
// as the game wires it (createGameWorld: Rapier physics, the player with interaction, creatures).
// AC-2: each counter prompts Trade and names a merchant whose stock the shop transactions can read;
// each keeper stands behind its counter, friendly and unarmed; the lane has an exit towards the
// bridge and one at Marsh's door. The browser run is e2e/briar-glen-lane.spec.ts.
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
  Shops,
  teleportCommand,
  type EntityId,
  type Vec3,
  type World,
} from '@sim/index';
import { createGameWorld } from '@tools/replay/testbed-player-scenario';

const IDLE = actionFrame({
  move: actionVector(0, 0),
  look: actionVector(0, 0),
  buttons: () => actionButton(false, false, false),
});
/** Facing east (+x), towards the counters: the mirror of yaw π/2, which faces west. */
const FACE_EAST = -Math.PI / 2;

const content = loadGameContent();
const SHOPS = [
  { merchant: 'brand-forge', keeper: 'npc-oswin', z: 16 },
  { merchant: 'fenn-fletchery-simples', keeper: 'npc-juniper', z: 24 },
  { merchant: 'pell-bakery', keeper: 'npc-hollis', z: 32 },
] as const;

function lane() {
  const game = createGameWorld<unknown>(RAPIER, { seed: 1, hz: 60, scene: 'briar-glen-lane' });
  const { world, player } = game;
  const sim = world as unknown as World<never>;
  const spawn = (id: string): EntityId => {
    const found = world
      .query(SceneSpawnComponent)
      .ids()
      .find((entity) => world.get(entity, SceneSpawnComponent)?.id === id);
    if (found === undefined) throw new Error(`no briar-glen-lane spawn ${id}`);
    return found;
  };
  const marker = (id: string): { position: Vec3; tags: readonly string[] } => {
    const found = game.scene.layout.spawns.find((s) => s.id === id);
    if (found === undefined) throw new Error(`no briar-glen-lane spawn ${id}`);
    return { position: found.position, tags: found.tags };
  };
  const keeper = (creature: string): EntityId => {
    const found = world
      .query(CreatureComponent)
      .ids()
      .find((entity) => world.get(entity, CreatureComponent)?.origin.creature === creature);
    if (found === undefined) throw new Error(`${creature} is not in the lane`);
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
  const teleport = (to: Vec3, yaw: number): void => {
    world.step([teleportCommand(player, to)]);
    world.set(player, PlayerLook, { yaw, pitch: 0 });
    step(10);
  };
  return { game, world, sim, player, spawn, marker, keeper, where, step, teleport };
}

describe('the Briar Glen shop lane, headless (mw-ju8.5)', () => {
  it('AC-2: loads with the player on the street, an exit towards the bridge and one at Marsh’s door', ({
    task,
  }) => {
    markExercised(task, 'scene', 'briar-glen-lane');
    const t = lane();
    expect(t.marker('player-start').tags).toContain('player-start');
    expect(t.where(t.player).x).toBeCloseTo(0, 0);
    const bridge = t.marker('bridge-town-end');
    expect(bridge.tags).toContain('area-exit');
    expect(bridge.position.z).toBeLessThan(t.marker('marsh-store-door').position.z);
    const door = t.marker('marsh-store-door');
    expect(door.tags).toEqual(expect.arrayContaining(['area-exit', 'scene:marsh-store']));
    expect(content.has('scene', 'marsh-store')).toBe(true);
    // The lane's far end is no further than ~40 m from the bridge.
    expect(t.marker('street-lantern-4').position.z).toBeGreaterThan(30);
  });

  for (const { merchant: id, keeper: npc } of SHOPS) {
    it(`AC-2: the ${id} counter prompts Trade and its merchant has its stock to hand`, ({
      task,
    }) => {
      markExercised(task, 'merchant', id);
      markExercised(task, 'creature', npc);
      const t = lane();
      const name = `${id}-counter`;
      const counter = t.spawn(name);
      const at = t.marker(name);
      t.teleport({ x: at.position.x - 0.5, y: 0, z: at.position.z }, FACE_EAST);
      expect(interactionPrompt(t.sim, t.player)).toMatchObject({
        target: counter,
        verb: 'talk',
        label: 'Trade',
        available: true,
      });
      const tag = at.tags.find((x) => x.startsWith('merchant:'));
      expect(tag).toBe(`merchant:${id}`);
      expect(at.tags).toContain('dev-crowns:400');
      const merchant = content.get('merchant', tag?.slice('merchant:'.length) ?? '');
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
  }

  for (const { keeper: npc, merchant: id, z } of SHOPS) {
    it(`AC-2: ${npc} stands behind the ${id} counter, friendly and unarmed`, ({ task }) => {
      markExercised(task, 'creature', npc);
      markExercised(task, 'behaviour', 'shopkeeper');
      markExercised(task, 'faction', 'townsfolk');
      const t = lane();
      const keeper = t.keeper(npc);
      const counterAt = t.marker(`${id}-counter`).position;
      // Behind: the customer's spot is west of the counter (x 4.5…5.5), the keeper east of it.
      expect(counterAt.x).toBeLessThan(4.5);
      expect(t.where(keeper).x).toBeGreaterThan(5.5);
      expect(Math.abs(t.where(keeper).z - z)).toBeLessThan(1);
      // She stays at her post.
      t.step(300);
      expect(Math.hypot(t.where(keeper).x - 7, t.where(keeper).z - z)).toBeLessThan(1);
      expect(t.world.get(keeper, FactionMemberComponent)).toMatchObject({
        faction: 'townsfolk',
        toward: { player: 'friendly' },
      });
      expect(content.get('creature', npc).attacks).toEqual([]);
    });
  }
});
