// Creature repopulation (mw-ju8.29): the sim rules. AC-1 deterministic, AC-3 never within sight or
// too close in the live scene, AC-5 what the first life dropped stays. The saved/loaded round trip and
// the valley run are tests/integration/creature-repopulation.test.ts.
import type { CreatureTable, RuntimeCreature } from '@content/index';
import { describe, expect, it } from 'vitest';
import { HealthComponent } from '../combat/damage/components';
import { World } from '../core/world';
import type { LevelDeltas } from '../deltas/persistence';
import { installFactions } from '../factions/runtime';
import { buildFactionTable, UNALIGNED_FACTION } from '../factions/table';
import type { SceneSpawnPlacement } from '../scene/layout';
import { CreatureComponent } from './components';
import {
  clearKill,
  killedDayOf,
  repopulateLive,
  repopulateStored,
  repopulationDue,
  type LiveRepopulationOptions,
} from './repopulation';
import { installSlainFacts, killedDayFact, slainFact } from './slain';
import { Died } from '../combat/damage/events';
import { registerCreatureComponents, spawnCreature, type CreatureSpawnOptions } from './spawn';

const LEVEL = 'valley-01';

const def = {
  id: 'skeleton',
  stats: { health: 60, poise: 20, mass: 35, size: 'small' },
  attacks: [],
  resistances: {},
  poiseRegen: { delayTicks: 120, percentPerSecond: 25 },
  reactions: { knockbackImpulse: 300, knockdownImpulse: 900, launchSpeed: 2, replace: {} },
  disposition: {},
  behaviour: { profile: 'skeleton-profile', tuning: {} },
  needs: {},
} as unknown as RuntimeCreature['def'];
const skeleton: RuntimeCreature = Object.freeze({
  id: 'skeleton',
  def,
  senses: Object.freeze({ sight: { range: 20 } }) as unknown as RuntimeCreature['senses'],
  nav: Object.freeze({ mask: 1, radius: 0.4, height: 0.9 }) as unknown as RuntimeCreature['nav'],
  gaits: Object.freeze({ sneak: 1, walk: 1.5, run: 4 }),
});
const creatures: CreatureTable = new Map([[skeleton.id, skeleton]]);
const factions = buildFactionTable([
  {
    id: UNALIGNED_FACTION,
    towardPlayer: 'hostile',
    towardMembers: 'neutral',
    towardOthers: 'neutral',
    relations: [],
  },
]);
const spawnOptions: CreatureSpawnOptions = { creatures, factions };

const spawnAt = (id: string, x: number, over: Partial<SceneSpawnPlacement> = {}) => {
  const spawn: SceneSpawnPlacement = {
    id,
    position: { x, y: 0, z: 0 },
    yaw: 0,
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    prop: undefined,
    tags: [],
    creature: 'skeleton',
    repopulate: { afterDays: 1 },
    ...over,
  };
  return spawn;
};
/** `spawn` without its creature, or without its repopulation rule. */
const without = (spawn: SceneSpawnPlacement, field: 'creature' | 'repopulate') => {
  const { creature, repopulate, ...rest } = spawn;
  return (
    field === 'creature' ? { ...rest, repopulate } : { ...rest, creature }
  ) as SceneSpawnPlacement;
};

const spawns: SceneSpawnPlacement[] = [
  spawnAt('skel-a', 0),
  spawnAt('skel-b', 40),
  spawnAt('skel-slow', 80, { repopulate: { afterDays: 3 } }),
  without(spawnAt('skel-brute', 120), 'repopulate'),
  without(spawnAt('marker', 5), 'creature'),
];

const dead = { aspects: { 'actor.life': { current: 0 } } };

function deltas(): LevelDeltas {
  return {
    level: LEVEL,
    entities: [
      { id: 'creature:skel-a', ...dead },
      { id: 'creature:skel-b', destroyed: true },
      { id: 'creature:skel-slow', ...dead },
      { id: 'creature:skel-brute', ...dead },
      { id: 'spawn:crate', destroyed: true },
    ],
    spawned: [{ id: 'spawned:70', kind: 'item', data: { defId: 'rusted-knife' } }],
  };
}

function facts(world: World<never>, kills: Record<string, number>): void {
  for (const [point, day] of Object.entries(kills)) {
    world.facts.set(slainFact(LEVEL, point), true);
    world.facts.set(killedDayFact(LEVEL, point), day);
  }
}

const newWorld = () => new World<never>({ seed: 3 });

describe('kill records', () => {
  it('reads the day of a kill, counts an unrecorded kill as day 1, and nothing without a kill', () => {
    const world = newWorld();
    expect(killedDayOf(world.facts, LEVEL, 'skel-a')).toBeUndefined();
    world.facts.set(slainFact(LEVEL, 'skel-a'), true);
    expect(killedDayOf(world.facts, LEVEL, 'skel-a')).toBe(1);
    world.facts.set(killedDayFact(LEVEL, 'skel-a'), 4);
    expect(killedDayOf(world.facts, LEVEL, 'skel-a')).toBe(4);
    clearKill(world.facts, LEVEL, 'skel-a');
    expect(killedDayOf(world.facts, LEVEL, 'skel-a')).toBeUndefined();
    expect(world.facts.get(killedDayFact(LEVEL, 'skel-a'))).toBe(0);
  });

  it('is due once afterDays whole days have passed since the kill', () => {
    expect(repopulationDue(1, 2, 2)).toBe(false);
    expect(repopulationDue(1, 2, 3)).toBe(true);
    expect(repopulationDue(3, 2, 4)).toBe(false);
    expect(repopulationDue(3, 2, 5)).toBe(true);
  });

  it('records the world day of a kill with the slain fact', () => {
    const world = registerCreatureComponents(newWorld());
    installFactions(world);
    installSlainFacts(world, LEVEL);
    const result = spawnCreature(world, spawnOptions, {
      creature: 'skeleton',
      at: { x: 0, y: 0, z: 0 },
      facing: { x: 0, y: 0, z: -1 },
      point: 'skel-a',
    });
    if (!result.ok) throw new Error('spawn failed');
    world.facts.set('time.day', 3);
    world.events.emit(Died, {
      tick: 0,
      target: result.entity,
      killer: null,
      source: null,
      tags: [],
    });
    world.events.flush();
    expect(world.facts.get(slainFact(LEVEL, 'skel-a'))).toBe(true);
    expect(world.facts.get(killedDayFact(LEVEL, 'skel-a'))).toBe(3);
  });
});

describe('repopulateStored (a level about to be entered)', () => {
  it('AC-1: drops the dead entries that are due, keeps the rest, and is deterministic', () => {
    const run = () => {
      const world = newWorld();
      facts(world, { 'skel-a': 1, 'skel-b': 1, 'skel-slow': 1, 'skel-brute': 1 });
      const result = repopulateStored(deltas(), spawns, world.facts, 2);
      return { result, snapshot: world.facts.snapshot() };
    };
    const first = run();
    expect(first.result.returned).toEqual(['skel-a', 'skel-b']);
    expect(first.result.deltas.entities.map(({ id }) => id)).toEqual([
      'creature:skel-slow', // needs 3 days
      'creature:skel-brute', // never opted in
      'spawn:crate',
    ]);
    expect(run()).toEqual(first);
    // The kill facts of the ones that returned are cleared; the others keep theirs.
    expect(first.snapshot[slainFact(LEVEL, 'skel-a')]).toBe(false);
    expect(first.snapshot[slainFact(LEVEL, 'skel-slow')]).toBe(true);
  });

  it('AC-5: what the first life dropped stays in the level: spawned items are untouched', () => {
    const world = newWorld();
    facts(world, { 'skel-a': 1 });
    const { deltas: after } = repopulateStored(deltas(), spawns, world.facts, 9);
    expect(after.spawned).toEqual(deltas().spawned);
    expect(after.entities.some(({ id }) => id === 'spawn:crate')).toBe(true);
  });

  it('keeps a creature that is alive in the deltas, and one with no recorded kill', () => {
    const world = newWorld();
    facts(world, { 'skel-a': 1 });
    const alive: LevelDeltas = {
      level: LEVEL,
      entities: [
        { id: 'creature:skel-a', aspects: { 'actor.life': { current: 12 } } },
        { id: 'creature:skel-b', ...dead }, // no kill fact for it
      ],
      spawned: [],
    };
    const result = repopulateStored(alive, spawns, world.facts, 5);
    expect(result.returned).toEqual([]);
    expect(result.deltas).toBe(alive);
  });

  it('keeps a dead entry that has no life aspect to read (hurt only)', () => {
    const world = newWorld();
    facts(world, { 'skel-a': 1 });
    const odd: LevelDeltas = {
      level: LEVEL,
      entities: [{ id: 'creature:skel-a', aspects: { 'actor.disposition': {} } }],
      spawned: [],
    };
    expect(repopulateStored(odd, spawns, world.facts, 5).returned).toEqual([]);
  });
});

describe('repopulateLive (the loaded level)', () => {
  /** A world with the skeletons at all four spawns, the two nearest killed on day 1. */
  function level() {
    const world = installFactions(registerCreatureComponents(newWorld()));
    const entities = new Map<string, number>();
    for (const spawn of spawns) {
      if (spawn.creature === undefined) continue;
      const result = spawnCreature(world, spawnOptions, {
        creature: spawn.creature,
        at: spawn.position,
        facing: { x: 0, y: 0, z: -1 },
        point: spawn.id,
      });
      if (!result.ok) throw new Error('spawn failed');
      entities.set(spawn.id, result.entity);
    }
    for (const point of ['skel-a', 'skel-b', 'skel-slow', 'skel-brute']) {
      world.set(entities.get(point) ?? -1, HealthComponent, { max: 60, current: 0 });
    }
    facts(world, { 'skel-a': 1, 'skel-b': 1, 'skel-slow': 1, 'skel-brute': 1 });
    return { world, entities };
  }
  const options = (over: Partial<LiveRepopulationOptions> = {}): LiveRepopulationOptions => ({
    level: LEVEL,
    spawns,
    today: 2,
    spawnOptions,
    player: { x: 20, y: 0, z: 0 },
    minDistance: 15,
    canSee: () => false,
    ...over,
  });
  const point = (world: World<never>, id: string) =>
    world
      .query(CreatureComponent)
      .ids()
      .filter((entity) => world.get(entity, CreatureComponent)?.origin.point === id);

  it('spawns due, dead creatures fresh at their origin and removes the corpse', () => {
    const { world, entities } = level();
    const returned = repopulateLive(world, world.facts, options({ player: { x: 60, y: 0, z: 0 } }));
    expect(returned).toEqual(['skel-a', 'skel-b']);
    for (const id of returned) {
      const [fresh] = point(world, id);
      expect(point(world, id)).toHaveLength(1);
      expect(fresh).not.toBe(entities.get(id));
      expect(world.get(fresh ?? -1, HealthComponent)).toEqual({ max: 60, current: 60 });
      expect(world.isAlive(entities.get(id) ?? -1)).toBe(false);
    }
    // Not yet due (3 days) and not opted in: still their dead selves.
    expect(world.get(entities.get('skel-slow') ?? -1, HealthComponent)?.current).toBe(0);
    expect(world.get(entities.get('skel-brute') ?? -1, HealthComponent)?.current).toBe(0);
    expect(world.facts.get(slainFact(LEVEL, 'skel-a'))).toBe(false);
  });

  it('AC-3: not within sight of the player, and not too close: it waits until it is neither', () => {
    const { world } = level();
    const seen = repopulateLive(
      world,
      world.facts,
      options({ player: { x: 60, y: 0, z: 0 }, canSee: (p) => p.x === 0 }),
    );
    expect(seen).toEqual(['skel-b']); // skel-a is in sight
    const close = repopulateLive(world, world.facts, options({ player: { x: 5, y: 0, z: 0 } }));
    expect(close).toEqual([]); // skel-a is 5 m away
    expect(world.facts.get(slainFact(LEVEL, 'skel-a'))).toBe(true); // still waiting
    const later = repopulateLive(world, world.facts, options({ player: { x: 60, y: 0, z: 0 } }));
    expect(later).toEqual(['skel-a']);
  });

  it('with no player to see it, it returns; a day too early it does not', () => {
    const { world } = level();
    expect(repopulateLive(world, world.facts, options({ today: 1 }))).toEqual([]);
    expect(repopulateLive(world, world.facts, options({ player: undefined }))).toEqual([
      'skel-a',
      'skel-b',
    ]);
  });

  it('leaves a creature dead when it cannot be spawned (unknown creature)', () => {
    const { world } = level();
    const ghost = spawnAt('skel-a', 0, { creature: 'ghost' });
    const returned = repopulateLive(
      world,
      world.facts,
      options({ spawns: [ghost], player: undefined }),
    );
    expect(returned).toEqual([]);
    expect(world.facts.get(slainFact(LEVEL, 'skel-a'))).toBe(true);
  });

  it('a world with no corpse to remove still spawns (the dead entity left earlier)', () => {
    const world = installFactions(registerCreatureComponents(newWorld()));
    facts(world, { 'skel-a': 1 });
    const returned = repopulateLive(
      world,
      world.facts,
      options({ spawns: spawns.slice(0, 1), player: undefined }),
    );
    expect(returned).toEqual(['skel-a']);
    expect(point(world, 'skel-a')).toHaveLength(1);
  });
});
