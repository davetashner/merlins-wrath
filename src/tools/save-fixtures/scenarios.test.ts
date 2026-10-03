import { describe, expect, it } from 'vitest';
import {
  brainOf,
  CreatureComponent,
  isUnconscious,
  replayScenarios,
  Rng,
  World,
  type EntityId,
} from '@sim/index';
import { creatureGuardsScenario, FIXTURE_SCENARIOS, knockOutSleeper } from './scenarios';

/** The creature spawned at fixture point `point`. */
function creatureAt(world: World<never>, point: string): EntityId {
  const found = world
    .query(CreatureComponent)
    .ids()
    .find((entity) => world.get(entity, CreatureComponent)?.origin.point === point);
  if (found === undefined) throw new Error(`no creature at ${point}`);
  return found;
}

describe('save fixture scenarios (mw-e12.14)', () => {
  it('holds every replay scenario and the creature guards', () => {
    expect(Object.keys(FIXTURE_SCENARIOS)).toEqual([
      ...Object.keys(replayScenarios),
      'creature-guards',
    ]);
    expect(FIXTURE_SCENARIOS['creature-guards']).toBe(creatureGuardsScenario);
    expect(creatureGuardsScenario.usesContent).toBe(true);
    expect(creatureGuardsScenario.command.safeParse({ any: 'thing' }).success).toBe(true);
  });

  it('creature-guards: after 15 s the guard searches where the alarm sent it, aware of a noise; the sleeper can be knocked out', () => {
    const world = creatureGuardsScenario.create({ seed: 23, hz: 60 });
    const rng = Rng.create(23).stream('replay-driver');
    for (let tick = 0; tick < 900; tick++) {
      world.step(creatureGuardsScenario.drive({ tick, world, rng }));
    }
    const w = world as World<never>;
    const guard = brainOf(w, creatureAt(w, 'guard'));
    expect(guard?.state).toBe('searching');
    expect(guard?.blackboard.lkp).toEqual({ x: 3, y: 0, z: 8 });
    expect(guard?.awareness.length).toBeGreaterThan(0);
    const sleeper = creatureAt(w, 'sleeper');
    expect(brainOf(w, sleeper)?.state).toBe('unaware');
    knockOutSleeper(world);
    expect(isUnconscious(w, sleeper)).toBe(true);
    expect(isUnconscious(w, creatureAt(w, 'guard'))).toBe(false);
  });

  it('drives a world it did not create with no commands', () => {
    const world = new World({ seed: 1 });
    const rng = Rng.create(1).stream('replay-driver');
    expect(creatureGuardsScenario.drive({ tick: 0, world, rng })).toEqual([]);
  });
});
