// Creature condition and persistence (mw-e12.14): knocking out and waking by the clock; capturing
// every creature component opaquely and writing it back; upgrading creatures saved without a condition.
import { describe, expect, it } from 'vitest';
import { BrainComponent, type Brain } from '../ai/components';
import { World } from '../core/world';
import { PerceptionAgentComponent } from '../perception/system';
import { hashWorld } from '../snapshot';
import { CreatureComponent, CREATURE_COMPONENTS, type Creature } from './components';
import {
  conditionOf,
  CreatureConditionComponent,
  FRESH_CONDITION,
  FULL_MORALE,
  isUnconscious,
  knockOut,
  wakeTicksLeft,
} from './condition';
import {
  applyCreatures,
  captureCreatures,
  CREATURE_SAVE_COMPONENTS,
  giveMissingConditions,
} from './persistence';

const creature: Creature = Object.freeze({
  origin: Object.freeze({
    creature: 'hound',
    at: Object.freeze({ x: 1, y: 0, z: 2 }),
    facing: Object.freeze({ x: 0, y: 0, z: 1 }),
  }),
  behaviour: 'hound-profile',
  tuning: Object.freeze({}),
  needs: Object.freeze({ hunger: 40 }),
});

/** A world with creature components registered and one creature (entity 1) with a condition. */
function withCreature(hz = 60): { world: World<never>; hound: number } {
  const world = new World<never>({ seed: 3, hz });
  world.register(...CREATURE_COMPONENTS);
  const hound = world.spawn();
  world.add(hound, CreatureComponent, creature);
  world.add(hound, CreatureConditionComponent, FRESH_CONDITION);
  return { world, hound };
}

describe('creature condition (mw-e12.14)', () => {
  it('starts at full morale and awake', () => {
    expect(FRESH_CONDITION).toEqual({ morale: FULL_MORALE, unconsciousUntil: -1 });
    expect(FULL_MORALE).toBe(100);
    const { world, hound } = withCreature();
    expect(isUnconscious(world, hound)).toBe(false);
    expect(wakeTicksLeft(world, hound)).toBe(0);
  });

  it('a knocked-out creature is unconscious until its wake tick, by the clock', () => {
    const { world, hound } = withCreature(30);
    world.step();
    expect(knockOut(world, hound, 2)).toBe(true);
    expect(conditionOf(world, hound)).toEqual({ morale: 100, unconsciousUntil: 61 });
    expect(Object.isFrozen(conditionOf(world, hound))).toBe(true);
    expect(wakeTicksLeft(world, hound)).toBe(60);
    for (let i = 0; i < 59; i++) world.step();
    expect(isUnconscious(world, hound)).toBe(true);
    expect(wakeTicksLeft(world, hound)).toBe(1);
    world.step();
    expect(isUnconscious(world, hound)).toBe(false);
    expect(wakeTicksLeft(world, hound)).toBe(0);
  });

  it('knocking out again keeps whichever wake tick is later; a sliver of a second is one tick', () => {
    const { world, hound } = withCreature();
    knockOut(world, hound, 10);
    knockOut(world, hound, 1);
    expect(wakeTicksLeft(world, hound)).toBe(600);
    knockOut(world, hound, 20);
    expect(wakeTicksLeft(world, hound)).toBe(1200);
    const other = withCreature();
    knockOut(other.world, other.hound, 0.001);
    expect(wakeTicksLeft(other.world, other.hound)).toBe(1);
  });

  it('refuses bad durations, and anything without a condition', () => {
    const { world, hound } = withCreature();
    for (const seconds of [0, -1, Infinity, NaN]) {
      expect(() => knockOut(world, hound, seconds)).toThrow(RangeError);
    }
    const crate = world.spawn();
    expect(knockOut(world, crate, 5)).toBe(false);
    expect(conditionOf(world, crate)).toBeUndefined();
    const bare = new World<never>({ seed: 1 });
    const thing = bare.spawn();
    expect(conditionOf(bare, thing)).toBeUndefined();
    expect(isUnconscious(bare, thing)).toBe(false);
  });
});

describe('creature persistence (mw-e12.14)', () => {
  it('saves the creature, condition, brain and perception components', () => {
    expect(CREATURE_SAVE_COMPONENTS.map((type) => type.name)).toEqual([
      'creature.creature',
      'creature.senses',
      'creature.nav',
      'creature.condition',
      'ai.brain',
      'perception.agent',
    ]);
  });

  it('captures every saved component as detached data, by entity, and writes it back exactly', () => {
    const { world, hound } = withCreature();
    world.register(BrainComponent, PerceptionAgentComponent);
    const thinker = world.spawn();
    // Brains are opaque to persistence: a field it does not know round-trips too.
    const brain = { behaviour: 'x', state: 'searching', future: { memory: [1, 2] } };
    world.add(thinker, BrainComponent, brain as unknown as Brain);
    world.add(hound, PerceptionAgentComponent, { heard: [], evaluated: 4, queued: -1 });
    knockOut(world, hound, 3);
    const data = captureCreatures(world);
    expect(data.creatures.map((c) => c.entity)).toEqual([hound, thinker]);
    expect(data.creatures[1]?.components).toEqual({ 'ai.brain': brain });
    expect(data.creatures[1]?.components['ai.brain']).not.toBe(brain);

    const loaded = new World<never>({ seed: 3 });
    loaded.register(...CREATURE_COMPONENTS);
    loaded.spawn();
    loaded.spawn();
    loaded.restore({ ...loaded.snapshot(), clock: world.snapshot().clock });
    applyCreatures(loaded, data);
    expect(loaded.isRegistered(BrainComponent)).toBe(true);
    expect(loaded.isRegistered(PerceptionAgentComponent)).toBe(true);
    expect(captureCreatures(loaded)).toEqual(data);
    expect(hashWorld(loaded)).toBe(hashWorld(world));
  });

  it('captures nothing from a world without creature components', () => {
    expect(captureCreatures(new World<never>({ seed: 1 }))).toEqual({ creatures: [] });
  });

  it('refuses a component it does not save', () => {
    const { world, hound } = withCreature();
    expect(() => {
      applyCreatures(world, { creatures: [{ entity: hound, components: { 'combat.health': 1 } }] });
    }).toThrow(/entity 1: "combat.health" is not a creature component/);
  });

  it('gives creatures saved before conditions existed a fresh one', () => {
    const world = new World<never>({ seed: 1 });
    expect(giveMissingConditions(world)).toBe(0);
    world.register(CreatureComponent);
    const a = world.spawn();
    const b = world.spawn();
    world.add(a, CreatureComponent, creature);
    world.add(b, CreatureComponent, creature);
    expect(giveMissingConditions(world)).toBe(2);
    expect(conditionOf(world, a)).toEqual(FRESH_CONDITION);
    knockOut(world, b, 1);
    expect(giveMissingConditions(world)).toBe(0);
    expect(isUnconscious(world, b)).toBe(true);
  });
});
