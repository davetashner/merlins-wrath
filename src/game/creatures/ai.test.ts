import { describe, expect, it } from 'vitest';
import { loadGameContent } from '@content/index';
import {
  entitySource,
  FakeSightWorld,
  giveBrain,
  placeEntity,
  registerCreatureComponents,
  straightLineNavigation,
  World,
  type EntityId,
} from '@sim/index';
import {
  AiWatch,
  formatPerceptionStats,
  installCreatureAi,
  playerTarget,
  sceneDoors,
  sceneNavMesh,
  SceneNavigation,
  watchCreatureAi,
  type CreatureAi,
} from './ai';

const content = loadGameContent();

function aiWorld(player?: EntityId): { world: World<never>; ai: CreatureAi } {
  const world = registerCreatureComponents(new World<never>({ seed: 1, hz: 60 }));
  const ai = installCreatureAi(world, new Map(), {
    content,
    player,
    light: { levelAt: () => 1 },
    sight: new FakeSightWorld(),
    navigation: straightLineNavigation,
  });
  return { world, ai };
}

describe('creature AI glue (mw-e11.21, mw-e11.23)', () => {
  it('installs perception and every behaviour in content; without a player, perception targets every character', () => {
    const { world, ai } = aiWorld();
    expect(ai.behaviours.has('forgotten')).toBe(true);
    expect(ai.perception.unitsPerTick).toBeGreaterThan(0);
    world.step();
    expect(ai.perception.lastUnits).toBe(0);
  });

  it('awareness resolves only the player’s source to a target', () => {
    expect(playerTarget(7)(entitySource(7))).toBe(7);
    expect(playerTarget(7)(entitySource(8))).toBeUndefined();
    expect(playerTarget(undefined)(entitySource(7))).toBeUndefined();
  });

  it('finds the navmesh baked for a scene and the door spawns of a loaded scene', () => {
    expect(sceneNavMesh(content, 'testbed')?.doors).toEqual(['closet-door']);
    expect(sceneNavMesh(content, 'mechanism-room')).toBeUndefined();
    const door = { id: 'gate', door: { profile: 'wooden-door' } };
    const loaded = {
      spawns: [
        { entity: 3, spawn: door },
        { entity: 4, spawn: { id: 'start' } },
      ],
    } as unknown as Parameters<typeof sceneDoors>[0];
    expect([...sceneDoors(loaded)]).toEqual([['gate', 3]]);
  });

  it('watches thinking creatures: off-mesh agent-ticks, perception’s peak, and a readout for the e2e', () => {
    const { world, ai } = aiWorld();
    const navigation = new SceneNavigation();
    expect(watchCreatureAi(world, undefined, navigation)).toBeUndefined();
    const watch = watchCreatureAi(world, ai, navigation);
    expect(watch).toBeInstanceOf(AiWatch);
    if (watch === undefined) return;
    const miner = world.spawn();
    placeEntity(world, miner, { x: 100, y: 0, z: 100 }, 0.4);
    giveBrain(world, miner, { behaviour: 'forgotten' });
    // No navmesh: nothing is off it.
    watch.step();
    expect(watch.readout()).toMatchObject({
      navmesh: false,
      offMesh: 0,
      agents: [{ entity: miner, state: 'unaware', at: [100, 0, 100], onMesh: true }],
    });
    // On the testbed's navmesh, 100 m out is off it, once per step.
    const mesh = sceneNavMesh(content, 'testbed');
    if (mesh === undefined) throw new Error('the testbed has a navmesh');
    Object.defineProperty(navigation, 'mesh', { get: () => mesh });
    watch.step();
    watch.step();
    const readout = watch.readout();
    expect(readout).toMatchObject({ navmesh: true, offMesh: 2, agents: [{ onMesh: false }] });
    expect(formatPerceptionStats(readout)).toBe(
      `perception 0/${String(ai.perception.unitsPerTick)} units (peak 0) · 1 thinking`,
    );
  });

  it('travels in straight lines without a navmesh, and by navmesh paths with one', () => {
    const world = registerCreatureComponents(new World<never>({ seed: 1, hz: 60 }));
    const navigation = new SceneNavigation();
    const walker = world.spawn();
    placeEntity(world, walker, { x: 0, y: 0, z: -1 }, 0.4);
    expect(navigation.distance(world, walker, { x: 3, y: 0, z: 3 })).toBe(5);
    const step = { goal: { x: 3, y: 0, z: 3 }, within: 0.1, speed: 1, dt: 1 };
    expect(navigation.travel(world, walker, step)).toBe('running');
    const testbed = { id: 'testbed', spawns: [] } as unknown as Parameters<
      SceneNavigation['load']
    >[2];
    navigation.load(world, content, testbed);
    expect(navigation.navmesh).toBeDefined();
    // Room to arena: round the doorways, longer than the straight line.
    const arena = { x: 0, y: 0, z: 24 };
    expect(navigation.distance(world, walker, arena)).toBeGreaterThan(24);
    expect(navigation.travel(world, walker, { ...step, goal: arena })).toBe('running');
  });
});
