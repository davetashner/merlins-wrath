// mw-e04.6: the knight's light chain and shield through the game's own testbed wiring (content moves,
// socket tracks and wood shield, setupTestbedPlayer, startTestbedCombat, the ActionSampler), against
// the testbed's training dummy — the combat sandbox's dummy creatures (mw-e04.9) take its place later.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it } from 'vitest';
import { HIT_STOP_ID, KNIGHT_SHIELD_ID, loadGameContent } from '@content/index';
import { markExercised } from '@content/testing';
import { ActionSampler } from '@game/input/index';
import {
  ActionStarted,
  DamageApplied,
  DamageModel,
  giveCombatant,
  GuardBroken,
  HurtboxComponent,
  PlayerLook,
  shieldGuard,
  staminaOf,
  type ActionStartInfo,
  type DamageResult,
} from '@sim/index';
import { createTestbedWorld } from '@tools/replay/testbed-player-scenario';

/** Ticks a light hit freezes the knight (mw-e04.11): each connecting move ends that much later. */
const LIGHT_HIT_STOP = loadGameContent().get('hit-stop', HIT_STOP_ID).ticks.light;

function testbed() {
  const world = createTestbedWorld(RAPIER, { seed: 1, hz: 60 });
  const [player] = world.query(PlayerLook).ids();
  // The knight has hurtboxes too (mw-e04.31): the dummy is the other one.
  const [dummy] = world
    .query(HurtboxComponent)
    .ids()
    .filter((id) => id !== player);
  if (player === undefined || dummy === undefined) throw new Error('no player or dummy');
  const sampler = new ActionSampler();
  const started: ActionStartInfo[] = [];
  const applied: DamageResult[] = [];
  world.events.on(ActionStarted, (e) => started.push(e));
  world.events.on(DamageApplied, (e) => applied.push(e));
  const step = (codes: readonly string[] = []) => {
    for (const code of codes) sampler.down(code);
    world.step(sampler.sampleCommands(world.tick));
    for (const code of codes) sampler.up(code);
  };
  const run = (ticks: number) => {
    for (let i = 0; i < ticks; i++) step();
  };
  return { world, player, dummy, sampler, started, applied, step, run };
}

describe('knight light chain in the testbed (mw-e04.6)', () => {
  it('AC-6: L1 lands DamageApplied on the dummy within its active window (move ticks 12–15)', ({
    task,
  }) => {
    markExercised(task, 'move', 'sword-light-1');
    const t = testbed();
    t.run(30); // settle
    t.step(['Mouse0']);
    t.run(40);
    const [l1] = t.started;
    expect(l1?.move).toBe('sword-light-1');
    expect(t.applied).toHaveLength(1);
    const [hit] = t.applied;
    const at = (hit?.tick ?? 0) - (l1?.tick ?? 0);
    expect(at).toBeGreaterThanOrEqual(12);
    expect(at).toBeLessThanOrEqual(15);
    expect(hit).toMatchObject({ target: t.dummy, total: 20 });
  });

  it('AC-1/AC-7 (headless): three presses run L1→L2→L3 for 44 stamina and take 72 from the dummy', ({
    task,
  }) => {
    for (const id of ['sword-light-1', 'sword-light-2', 'sword-light-3'])
      markExercised(task, 'move', id);
    const t = testbed();
    t.run(30);
    const before = staminaOf(t.world, t.player)?.current;
    t.step(['Mouse0']); // L1: 34 ticks, plus its hit-stop
    const afterL1 = staminaOf(t.world, t.player)?.current;
    t.run(29 + LIGHT_HIT_STOP);
    t.step(['Mouse0']); // buffered into L2
    t.run(33 + LIGHT_HIT_STOP);
    t.step(['Mouse0']); // L3
    t.run(60);
    t.step(['Mouse0']); // the chain is over: L1 again
    expect(t.started.map((e) => e.move)).toEqual([
      'sword-light-1',
      'sword-light-2',
      'sword-light-3',
      'sword-light-1',
    ]);
    expect((before ?? 0) - (afterL1 ?? 0)).toBe(12);
    expect(t.applied.slice(0, 3).map((r) => r.total)).toEqual([20, 22, 30]);
    const hp = t.applied[2]?.healthAfter;
    expect(hp).toBe(200 - 72);
  });

  it('AC-2 with the wood shield from content: a raised shield takes a frontal hit for 15% and 8 stamina', ({
    task,
  }) => {
    markExercised(task, 'shield', KNIGHT_SHIELD_ID);
    const t = testbed();
    t.sampler.down('Mouse2');
    t.run(30);
    const pool = staminaOf(t.world, t.player);
    expect(pool?.blocking).toBe(true);
    expect(pool?.current).toBe(100);
    giveCombatant(t.world, t.player, { health: 100 });
    t.run(1);
    const breaks: unknown[] = [];
    t.world.events.on(GuardBroken, (e) => breaks.push(e));
    const damage = new DamageModel();
    damage.register(shieldGuard());
    // The knight faces +z (the testbed's player start); the hit travels −z, into its shield.
    const hit = { amounts: { slash: 30 }, staminaDamage: 20, direction: { x: 0, y: 0, z: -1 } };
    const result = damage.apply(t.world, t.player, hit);
    expect(result?.total).toBe(4.5);
    expect(result?.healthAfter).toBe(95.5);
    expect(staminaOf(t.world, t.player)?.current).toBe(92);
    t.world.events.flush();
    expect(breaks).toEqual([]);
  });
});

describe('knight heavy and charged attacks in the testbed (mw-e04.13)', () => {
  /** Holds the heavy button (1) for `ticks` ticks from a settled start; returns the stamina it cost. */
  function heavy(t: ReturnType<typeof testbed>, ticks: number): number {
    t.run(30);
    const before = staminaOf(t.world, t.player)?.current ?? 0;
    t.sampler.down('Digit1');
    t.run(ticks);
    t.sampler.up('Digit1');
    t.run(1);
    const spent = before - (staminaOf(t.world, t.player)?.current ?? 0);
    t.run(80);
    return spent;
  }

  it('AC-1 (content): held 60 ticks, the charged heavy deals 1.8× the heavy and 3.5× light 1’s poise for 35 stamina', ({
    task,
  }) => {
    markExercised(task, 'move', 'sword-heavy-charged');
    const content = loadGameContent();
    const base = content.get('move', 'sword-heavy');
    const light = content.get('move', 'sword-light-1');
    const t = testbed();
    expect(heavy(t, 60)).toBe(35);
    expect(t.started.map((e) => e.move)).toEqual(['sword-heavy']);
    const [hit] = t.applied;
    expect(hit?.target).toBe(t.dummy);
    expect(hit?.amounts.slash).toBeCloseTo(1.8 * (base.damage?.amounts.slash ?? 0), 9);
    expect(hit?.poiseDamage).toBeCloseTo(3.5 * (light.damage?.poiseDamage ?? 0), 9);
    expect(hit?.packet.impactForce).toBe(2500);
  });

  it('AC-2 (content): let go after 8 ticks, it is an uncharged heavy: 1.6× light 1’s damage, 2.2× its poise', ({
    task,
  }) => {
    markExercised(task, 'move', 'sword-heavy');
    const light = loadGameContent().get('move', 'sword-light-1');
    const t = testbed();
    expect(heavy(t, 8)).toBe(25);
    const [hit] = t.applied;
    expect(hit?.amounts.slash).toBeCloseTo(1.6 * (light.damage?.amounts.slash ?? 0), 9);
    expect(hit?.poiseDamage).toBeCloseTo(2.2 * (light.damage?.poiseDamage ?? 0), 9);
    expect(hit?.packet.impactForce).toBe(1500);
  });
});
