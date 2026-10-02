// mw-e05.21 AC-1: the bow in the game world. The testbed built through the game's own wiring
// (createGameWorld: the sim's Rapier physics, the scene loader, setupTestbedPlayer with the testbed
// combat's shortbow and quiver, startTestbedCombat with the arrow system over RapierCollisionWorld),
// driven by the real ActionSampler: 4 takes the bow out, the left button held 48 ticks draws it
// fully, and letting go looses an arrow from the nock point.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it } from 'vitest';
import { ARCHER_BOW_ID } from '@content/index';
import { markExercised } from '@content/testing';
import { TESTBED_BOW_BUTTONS } from '@game/combat/index';
import { ActionSampler } from '@game/input/index';
import {
  ArrowComponent,
  ArrowFired,
  ArrowRestComponent,
  BowDrawEnded,
  DEFAULT_BOW_NOCK,
  lookAim,
  quiverCount,
  type ActionFrame,
  type ArrowFiredInfo,
  type BowDrawEndInfo,
} from '@sim/index';
import { createGameWorld } from '@tools/replay/testbed-player-scenario';

describe('the bow in the testbed (mw-e05.21)', () => {
  it('AC-1: toggle, fire held 48 ticks and released looses an arrow from the nock point and emits ArrowFired', ({
    task,
  }) => {
    markExercised(task, 'bow', ARCHER_BOW_ID);
    markExercised(task, 'scene', 'testbed');
    markExercised(task, 'arrow', 'standard');
    expect(TESTBED_BOW_BUTTONS).toMatchObject({ fire: 'primaryAttack', toggle: 'ability4' });
    const { world, player } = createGameWorld<ActionFrame>(RAPIER, { seed: 1, hz: 60 });
    const fired: ArrowFiredInfo[] = [];
    const ended: BowDrawEndInfo[] = [];
    world.events.on(ArrowFired, (event) => fired.push(event));
    world.events.on(BowDrawEnded, (event) => ended.push(event));
    const sampler = new ActionSampler();
    const step = (down: readonly string[] = [], up: readonly string[] = []) => {
      for (const code of down) sampler.down(code);
      for (const code of up) sampler.up(code);
      world.step(sampler.sampleCommands(world.tick));
    };
    for (let i = 0; i < 10; i++) step(); // settle on the floor
    step(['Digit4']); // take the bow out
    step([], ['Digit4']);
    step(['Mouse0']); // fire pressed: the draw starts (tick 0)
    for (let i = 0; i < 47; i++) step(); // held: 48 ticks in all
    expect(fired).toEqual([]);
    // Where the arrow must leave from: the player's nock point along its look, at full draw.
    const shot = lookAim(DEFAULT_BOW_NOCK)(world, player, 60);
    step([], ['Mouse0']); // let go
    expect(fired).toHaveLength(1);
    const [event] = fired;
    expect(event).toMatchObject({ shooter: player, arrow: 'standard', origin: shot?.origin });
    expect(ended).toMatchObject([{ reason: 'fired', ticks: 48, speed: 60 }]);
    expect(quiverCount(world, player, 'standard')).toBe(19);
    // The arrow is an entity in flight at the nock point, and flies on from there.
    const arrow = event?.entity ?? -1;
    expect(world.get(arrow, ArrowComponent)?.position).toEqual(shot?.origin);
    step();
    const flying = world.get(arrow, ArrowComponent);
    const resting = world.get(arrow, ArrowRestComponent);
    const now = flying?.position ?? resting?.position;
    expect(now).toBeDefined();
    expect(now).not.toEqual(shot?.origin);
  });
});
