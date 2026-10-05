// mw-ju8.19 AC-3: each Forgotten variant, placed in the skeleton pen (scene skeleton-pen) and
// seeing the player, enters Combat and uses its signature move: the archer keeps its distance and
// looses arrows (and shoves when closed on), the shield-bearer raises its shield, blocks a frontal
// blow and then bashes, the brute winds up a heavy swing with a long telegraph. Through the game's
// own wiring (createGameWorld: Rapier physics, the pen's navmesh, perception by the light field,
// awareness and AI on the content behaviours). AC-1 (data) is src/content/forgotten-roster.test.ts;
// AC-2 (drop yields) is tests/integration/forgotten-drops.test.ts.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it } from 'vitest';
import { markExercised } from '@content/testing';
import { ActionSampler } from '@game/input/index';
import {
  AttackEnded,
  AttackProjectileLaunched,
  brainOf,
  CreatureComponent,
  DamageApplied,
  GuardComponent,
  PlacementComponent,
  teleportCommand,
  TelegraphStarted,
  type EntityId,
  type Vec3,
  type World,
} from '@sim/index';
import { createGameWorld } from '@tools/replay/testbed-player-scenario';

const HZ = 60;

/**
 * A pen with the player teleported `distance` m south of the variant at spawn point `point`, which
 * faces south. `step(codes)` advances a tick with those keys pressed.
 */
function pen(point: string, distance: number) {
  const game = createGameWorld<unknown>(RAPIER, { seed: 1, hz: HZ, scene: 'skeleton-pen' });
  const sim = game.world as unknown as World<never>;
  const found = game.sceneCreatures.entities.find(
    (entity) => game.world.get(entity, CreatureComponent)?.origin.point === point,
  );
  if (found === undefined) throw new Error(`the pen has no ${point}`);
  const creature: EntityId = found;
  const at = game.world.get(creature, PlacementComponent);
  if (at === undefined) throw new Error('not placed');
  const post: Vec3 = { x: at.x, y: 0, z: at.z };
  const sampler = new ActionSampler();
  const stand = (metres: number) =>
    teleportCommand(game.player, { x: post.x, y: 0, z: post.z - metres });
  const step = (codes: readonly string[] = [], extra: readonly unknown[] = []) => {
    for (const code of codes) sampler.down(code);
    game.world.step([...sampler.sampleCommands(game.world.tick), ...extra]);
    for (const code of codes) sampler.up(code);
  };
  step([], [stand(distance)]);
  const distanceToPlayer = (): number => {
    const a = game.world.get(creature, PlacementComponent) as Vec3;
    const b = game.world.get(game.player, PlacementComponent) as Vec3;
    return Math.hypot(a.x - b.x, a.z - b.z);
  };
  return { ...game, sim, creature, post, step, stand, distanceToPlayer };
}

describe('the Forgotten roster fights (mw-ju8.19)', () => {
  it('AC-3: the archer sees the player, enters Combat, looses an arrow from range and backs away from it', ({
    task,
  }) => {
    markExercised(task, 'creature', 'forgotten-archer');
    markExercised(task, 'behaviour', 'forgotten-archer');
    markExercised(task, 'attack', 'forgotten-archer-shot');
    const { sim, creature, step, distanceToPlayer, player } = pen('pen-archer', 5);
    const launched: string[] = [];
    const telegraphs: number[] = [];
    let hurt = 0;
    sim.events.on(AttackProjectileLaunched, (e) => {
      if (e.attacker === creature) launched.push(e.attack);
    });
    sim.events.on(TelegraphStarted, (e) => {
      if (e.attacker === creature && e.move === 'forgotten-archer-shot') telegraphs.push(e.tick);
    });
    sim.events.on(DamageApplied, (e) => {
      if (e.target === player && e.packet.source !== null) hurt++;
    });
    let farthest = 0;
    for (let tick = 0; tick < 12 * HZ; tick++) {
      step();
      farthest = Math.max(farthest, distanceToPlayer());
    }
    expect(brainOf(sim, creature)?.state).toBe('combat');
    expect(launched.length).toBeGreaterThanOrEqual(2);
    expect(new Set(launched)).toEqual(new Set(['forgotten-archer-shot']));
    expect(telegraphs.length).toBeGreaterThanOrEqual(2);
    // Closed on at 5 m it backed away (towards its 9 m ring) between shots, and the arrows reached the knight.
    expect(farthest).toBeGreaterThan(6);
    expect(hurt).toBeGreaterThan(0);
  });

  it('AC-3: closed on, the archer falls back to its melee shove', ({ task }) => {
    markExercised(task, 'attack', 'forgotten-archer-shove');
    const { sim, creature, step, stand } = pen('pen-archer', 1.2);
    const moves: string[] = [];
    sim.events.on(TelegraphStarted, (e) => {
      if (e.attacker === creature) moves.push(e.move);
    });
    for (let tick = 0; tick < 4 * HZ; tick++) step([], [stand(1.2)]);
    expect(moves[0]).toBe('forgotten-archer-shove');
  });

  it('AC-3: the shield-bearer raises its shield, then bashes (shield down for the swing)', ({
    task,
  }) => {
    markExercised(task, 'creature', 'forgotten-shield-bearer');
    markExercised(task, 'behaviour', 'forgotten-shield-bearer');
    markExercised(task, 'attack', 'forgotten-shield-bash');
    markExercised(task, 'shield', 'forgotten-board-shield');
    const { world, sim, creature, step } = pen('pen-shield-bearer', 5);
    let raised = -1;
    let bash = -1;
    let heldAtBash: boolean | undefined;
    sim.events.on(TelegraphStarted, (e) => {
      if (e.attacker !== creature || e.move !== 'forgotten-shield-bash' || bash >= 0) return;
      bash = e.tick;
      heldAtBash = world.get(creature, GuardComponent)?.held;
    });
    for (let tick = 0; tick < 12 * HZ; tick++) {
      step();
      if (raised < 0 && world.get(creature, GuardComponent)?.raisedAt != null) raised = world.tick;
    }
    expect(brainOf(sim, creature)?.state).toBe('combat');
    expect(raised).toBeGreaterThan(0);
    expect(bash).toBeGreaterThan(raised);
    expect(heldAtBash).toBe(false);
  });

  it('AC-3: the shield-bearer’s raised shield blocks the knight’s frontal sword blows', ({
    task,
  }) => {
    markExercised(task, 'shield', 'forgotten-board-shield');
    const { sim, creature, step, stand, world } = pen('pen-shield-bearer', 1.1);
    const blows: { blocked: boolean; total: number }[] = [];
    sim.events.on(DamageApplied, (e) => {
      if (e.target === creature)
        blows.push({ blocked: e.tags.includes('blocked'), total: e.total });
    });
    // The knight stands in front of it and swings (the light attack), over and over.
    for (let tick = 0; tick < 10 * HZ; tick++) {
      step(tick % 6 === 0 ? ['Mouse0'] : [], [stand(1.1)]);
      if (world.get(creature, GuardComponent) === undefined) throw new Error('no guard');
    }
    const blocked = blows.filter((b) => b.blocked);
    expect(blocked.length).toBeGreaterThan(0);
    // 80% of a slash blow is soaked: of the knight's biggest light blow (30) at most 6 gets through.
    for (const blow of blocked) expect(blow.total).toBeLessThanOrEqual(6.01);
    expect(blows.some((b) => !b.blocked)).toBe(true); // and the guard is down between its bashes
  });

  it('AC-3: the brute winds up a heavy swing with a long telegraph and a long recovery', ({
    task,
  }) => {
    markExercised(task, 'creature', 'forgotten-brute');
    markExercised(task, 'attack', 'forgotten-brute-overhead');
    markExercised(task, 'attack', 'forgotten-brute-sweep');
    const { sim, creature, step } = pen('pen-brute', 5);
    const telegraphs: { move: string; tick: number }[] = [];
    const ends: number[] = [];
    sim.events.on(TelegraphStarted, (e) => {
      if (e.attacker === creature) telegraphs.push({ move: e.move, tick: e.tick });
    });
    sim.events.on(AttackEnded, (e) => {
      if (e.attacker === creature) ends.push(e.tick);
    });
    for (let tick = 0; tick < 12 * HZ; tick++) step();
    expect(brainOf(sim, creature)?.state).toBe('combat');
    const [first] = telegraphs;
    expect(first?.move).toMatch(/^forgotten-brute-(overhead|sweep)$/);
    const firstEnd = ends.find((tick) => tick > (first?.tick ?? 0)) ?? 0;
    // The whole swing, windup to recovery, is over 100 ticks (1.7 s): the miner's chop is 54.
    expect(firstEnd - (first?.tick ?? 0)).toBeGreaterThanOrEqual(100);
  });
});
