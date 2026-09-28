// Contract between layers (mw-e12.3): each frozen creature fixture spawns into a sim World, ticks 600
// frames and despawns cleanly. Content may import the sim only as types, so this runtime smoke test
// lives outside src/. Changing a fixture value requires updating the scenario tests that use it.

import { expect, it } from 'vitest';
import {
  deriveNavAgent,
  resolveLocomotion,
  resolveSenses,
  type NavAgent,
  type SenseProfile,
} from '@content/index';
import { FIXTURE_CREATURE_IDS, loadFixtureContent } from '@content/test-fixtures';
import { defineComponent, World } from '@sim/index';

const content = loadFixtureContent();

/** What the smoke test puts on a spawned fixture: its def id plus resolved senses and nav agent. */
interface FixtureCreature {
  readonly def: string;
  readonly senses: SenseProfile;
  readonly nav: NavAgent;
  ticks: number;
}

const Creature = defineComponent<FixtureCreature>('fixture-creature');

it.each(FIXTURE_CREATURE_IDS)(
  'AC-4: %s spawns, ticks 600 sim frames without error and despawns',
  (id) => {
    const def = content.get('creature', id);
    const world = new World({ seed: 1 }).register(Creature);
    world.addSystem({
      name: 'fixture-creature-tick',
      run: ({ world: w }) => {
        w.query(Creature).forEach((_entity, creature) => {
          creature.ticks += 1;
        });
      },
    });

    const entity = world.spawn();
    world.add(entity, Creature, {
      def: def.id,
      senses: resolveSenses(def.senses, content),
      nav: deriveNavAgent(resolveLocomotion(def.locomotion, content)),
      ticks: 0,
    });
    for (let tick = 0; tick < 600; tick += 1) world.step();

    expect(world.get(entity, Creature)?.ticks).toBe(600);
    world.destroy(entity);
    world.step();
    expect(world.isAlive(entity)).toBe(false);
  },
);
