// mw-ju8.29: the game glue of creature repopulation, on the real valley-01 scene headless. The
// valley run through saves and rests is tests/integration/creature-repopulation.test.ts.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it } from 'vitest';
import {
  CreatureComponent,
  Died,
  FakeSightWorld,
  HealthComponent,
  isDead,
  levelDeltasOf,
  registerPersistence,
  sceneAuthoredEntities,
  WorldPersistence,
  PlacementComponent,
  restCompleted,
  slainFact,
} from '@sim/index';
import { createGameWorld } from '@tools/replay/testbed-player-scenario';
import { installRepopulationOnRest, repopulateOnArrival } from './repopulation';

const LEVEL = 'valley-01';
const MINER = 'skel-valley-01-bend-miner';

function game() {
  const g = createGameWorld<never>(RAPIER, { seed: 4, hz: 60, scene: LEVEL });
  const miner = (): number | undefined =>
    g.world
      .query(CreatureComponent)
      .ids()
      .find((e) => g.world.get(e, CreatureComponent)?.origin.point === MINER);
  const kill = (): void => {
    const e = miner() ?? expect.fail('no miner');
    g.world.set(e, HealthComponent, { max: 1, current: 0 });
    g.world.events.emit(Died, { tick: 0, target: e, killer: null, source: null, tags: [] });
    g.world.step();
  };
  const sleep = (): void => {
    g.world.facts.set('time.day', 2);
    g.world.events.emit(restCompleted, {
      tick: 0,
      actor: g.player,
      kind: 'inn',
      hours: 8,
      point: 'sleeping-ox',
      wakes: { day: 2, minute: 360 },
    });
    g.world.step();
  };
  const alive = (): boolean => {
    const living = g.world
      .query(CreatureComponent)
      .ids()
      .filter(
        (e) => g.world.get(e, CreatureComponent)?.origin.point === MINER && !isDead(g.world, e),
      );
    return living.length === 1;
  };
  const install = (player: number | undefined, onReturned?: (p: readonly string[]) => void) =>
    installRepopulationOnRest(g.world, {
      level: LEVEL,
      spawns: g.scene.layout.spawns,
      spawnOptions: g.creatures.spawn,
      // A long wall across x = 100: the player behind it cannot see the spawn at x = 0.
      sight: new FakeSightWorld([
        {
          kind: 'box',
          min: { x: 100, y: -10, z: -1000 },
          max: { x: 101, y: 50, z: 1000 },
        },
      ]),
      player,
      ...(onReturned !== undefined && { onReturned }),
    });
  const placePlayer = (x: number): void => {
    g.world.set(g.player, PlacementComponent, { x, y: 0, z: 0, radius: 0.4 });
  };
  return { g, kill, sleep, alive, install, placePlayer };
}

describe('repopulation glue (mw-ju8.29)', () => {
  it('on arrival, a level with no stored deltas repopulates nothing', () => {
    const { g } = game();
    expect(repopulateOnArrival(g.world, LEVEL, g.scene.layout.spawns)).toEqual([]);
  });

  it('on arrival, a stored dead miner leaves the deltas once a day has passed, and not before', () => {
    const { g, kill } = game();
    registerPersistence(g.world);
    const store = levelDeltasOf(g.world);
    store.enter(g.world, new WorldPersistence(), LEVEL, sceneAuthoredEntities(g.world, g.scene));
    kill();
    store.leave(g.world);
    const spawns = g.scene.layout.spawns;
    expect(repopulateOnArrival(g.world, LEVEL, spawns)).toEqual([]);
    expect(store.deltas(LEVEL)?.entities.some((e) => e.id === `creature:${MINER}`)).toBe(true);
    g.world.facts.set('time.day', 2);
    expect(repopulateOnArrival(g.world, LEVEL, spawns)).toEqual([MINER]);
    expect(store.deltas(LEVEL)?.entities.some((e) => e.id === `creature:${MINER}`)).toBe(false);
  });

  it('on rest, a creature returns when the player is far away, and says which', () => {
    const { g, kill, sleep, alive, install, placePlayer } = game();
    const told: (readonly string[])[] = [];
    install(g.player, (points) => told.push(points));
    kill();
    expect(alive()).toBe(false);
    placePlayer(500);
    sleep();
    g.world.step();
    expect(alive()).toBe(true);
    expect(told).toEqual([[MINER]]);
    expect(g.world.facts.get(slainFact(LEVEL, MINER))).toBe(false);
  });

  it('on rest, a creature the player can see from afar waits', () => {
    const { g, kill, sleep, alive, install, placePlayer } = game();
    install(g.player);
    kill();
    placePlayer(50);
    sleep();
    expect(alive()).toBe(false);
  });

  it('on rest, a creature near the player waits, and with nothing returned nobody is told', () => {
    const { g, kill, sleep, alive, install, placePlayer } = game();
    const told: (readonly string[])[] = [];
    install(g.player, (points) => told.push(points));
    kill();
    placePlayer(0); // the miner stands at x 0
    sleep();
    expect(alive()).toBe(false);
    expect(told).toEqual([]);
  });

  it('with no player entity there is nobody to see the spawn: it returns, no listener needed', () => {
    const { g, kill, sleep, alive, install } = game();
    install(undefined);
    kill();
    sleep();
    g.world.step();
    expect(alive()).toBe(true);
  });

  it('a player without a placement cannot see anything either', () => {
    const { g, kill, sleep, alive, install } = game();
    install(g.world.spawn());
    kill();
    sleep();
    g.world.step();
    expect(alive()).toBe(true);
  });
});
