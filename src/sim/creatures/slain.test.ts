// Slain facts (mw-e01.7): a placed creature's death sets entity:<level>/<point>.slain; console spawns,
// other combatants and worlds without creatures set nothing.
import { describe, expect, it } from 'vitest';
import { Died } from '../combat/damage/events';
import { World } from '../core/world';
import { CreatureComponent, CREATURE_COMPONENTS, type Creature } from './components';
import { installSlainFacts, SLAIN_FACT, slainFact } from './slain';

function creature(point?: string): Creature {
  return Object.freeze({
    origin: Object.freeze({
      creature: 'forgotten-miner',
      at: Object.freeze({ x: 2.5, y: 0, z: 32.5 }),
      facing: Object.freeze({ x: 0, y: 0, z: -1 }),
      ...(point !== undefined && { point }),
    }),
    behaviour: 'forgotten',
    tuning: Object.freeze({}),
    needs: Object.freeze({}),
  });
}

const die = (world: World<never>, target: number): void => {
  world.events.emit(Died, { tick: world.tick, target, killer: null, source: null, tags: [] });
  world.events.flush();
};

describe('slain facts (mw-e01.7)', () => {
  it('names the fact entity:<level>/<point>.slain', () => {
    expect(SLAIN_FACT).toBe('slain');
    expect(slainFact('slice', 'skeleton')).toBe('entity:slice/skeleton.slain');
  });

  it('sets the slain fact of a placed creature that dies, and nothing for unplaced ones', () => {
    const world = new World<never>({ seed: 1 });
    world.register(...CREATURE_COMPONENTS);
    const stop = installSlainFacts(world, 'slice');
    const placed = world.spawn();
    world.add(placed, CreatureComponent, creature('skeleton'));
    const consoleSpawn = world.spawn();
    world.add(consoleSpawn, CreatureComponent, creature());
    const dummy = world.spawn();

    die(world, consoleSpawn);
    die(world, dummy);
    expect(world.facts.snapshot()).toEqual({});
    die(world, placed);
    expect(world.facts.get('entity:slice/skeleton.slain')).toBe(true);

    stop();
    world.facts.set('entity:slice/skeleton.slain', false);
    die(world, placed);
    expect(world.facts.get('entity:slice/skeleton.slain')).toBe(false);
  });

  it('ignores deaths in a world without creatures', () => {
    const world = new World<never>({ seed: 1 });
    installSlainFacts(world, 'slice');
    die(world, world.spawn());
    expect(world.facts.snapshot()).toEqual({});
  });
});
