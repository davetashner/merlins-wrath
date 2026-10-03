// mw-e04.14: the knight's shield bash in the game world — the testbed with the player as src/main.ts
// and the replay world wire it (the sim's Rapier physics, stimuli, physics objects, the player with
// sword and shield from content, startTestbedCombat), headless, driven through the ActionSampler.
// Block (right mouse) + attack (left mouse) bashes; its shove moves what is light enough by physics.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it } from 'vitest';
import { markExercised } from '@content/testing';
import { ActionSampler } from '@game/input/index';
import {
  ActionStarted,
  addPhysicsObject,
  addProperties,
  CharacterController,
  hashWorld,
  ImpactResisted,
  PhysicsObjectComponent,
  PlayerLook,
  staminaOf,
  type ActionStartInfo,
  type EntityId,
  type ImpactResistance,
  type Vec3,
} from '@sim/index';
import { createGameWorld } from '@tools/replay/testbed-player-scenario';

/** The knight faces −x (look yaw π/2), away from the testbed's dummies, with room to shove. */
const FACING_YAW = Math.PI / 2;

function testbed() {
  const game = createGameWorld<unknown>(RAPIER, { seed: 1, hz: 60 });
  const { world, player } = game;
  const look = world.get(player, PlayerLook) ?? expect.fail('no look');
  world.set(player, PlayerLook, { ...look, yaw: FACING_YAW });
  const sampler = new ActionSampler();
  const started: ActionStartInfo[] = [];
  const resisted: ImpactResistance[] = [];
  world.events.on(ActionStarted, (e) => {
    if (e.entity === player) started.push(e);
  });
  world.events.on(ImpactResisted, (e) => resisted.push(e));
  const step = (codes: readonly string[] = []) => {
    for (const code of codes) sampler.down(code);
    world.step(sampler.sampleCommands(world.tick));
    for (const code of codes) sampler.up(code);
  };
  const run = (ticks: number) => {
    for (let i = 0; i < ticks; i++) step();
  };
  run(20); // settle on the floor, turned
  const feet = world.get(player, CharacterController)?.position ?? expect.fail('no player');
  return { ...game, sampler, started, resisted, step, run, feet };
}

type Game = ReturnType<typeof testbed>;

/** A box of `weight` kg standing on the floor 0.9 m in front of the knight. */
function propInFront(game: Game, weight: number, init: Record<string, unknown>): EntityId {
  const { world, feet } = game;
  const half = { x: 0.3, y: 0.45, z: 0.3 };
  const entity = world.spawn();
  addProperties(world, entity, { weight, friction: 0.5, material: 'wood', ...init });
  addPhysicsObject(world, entity, {
    shape: { kind: 'box', halfExtents: half },
    position: { x: feet.x - 0.9, y: feet.y + half.y, z: feet.z },
  });
  game.run(10); // let it settle
  return entity;
}

const positionOf = (game: Game, entity: EntityId): Vec3 =>
  game.world.get(entity, PhysicsObjectComponent)?.position ?? expect.fail('no body');

/** Holds block, then presses attack with it: the bash. Runs on for `after` ticks. */
function bash(game: Game, after = 120): void {
  game.sampler.down('Mouse2');
  game.run(10);
  game.step(['Mouse0']);
  game.sampler.up('Mouse2');
  game.run(after);
}

const horizontal = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.z - b.z);

describe('the shield bash in the testbed (mw-e04.14)', () => {
  it('AC-3: a 30 kg barrel in front of the knight is shoved ≥ 1.0 m by physics', ({ task }) => {
    markExercised(task, 'move', 'shield-bash');
    const run = () => {
      const game = testbed();
      const barrel = propInFront(game, 30, { bashable: true });
      const before = positionOf(game, barrel);
      bash(game);
      return { game, barrel, before };
    };
    const { game, barrel, before } = run();
    expect(game.started.map((e) => e.move)).toEqual(['shield-bash']);
    const after = positionOf(game, barrel);
    expect(horizontal(after, before)).toBeGreaterThanOrEqual(1.0);
    expect(after.x).toBeLessThan(before.x); // along the knight's facing (−x)
    expect(game.resisted).toEqual([]);
    expect(hashWorld(run().game.world)).toBe(hashWorld(game.world)); // deterministic
  });

  it('AC-3: a 100 kg crate does not move, and ImpactResisted fires', () => {
    const game = testbed();
    const crate = propInFront(game, 100, { pushable: true });
    const before = positionOf(game, crate);
    bash(game);
    expect(game.started.map((e) => e.move)).toEqual(['shield-bash']);
    expect(horizontal(positionOf(game, crate), before)).toBeLessThan(0.01);
    expect(game.resisted).toHaveLength(1);
    expect(game.resisted[0]).toMatchObject({
      entity: crate,
      weight: 100,
      maxWeight: 60,
      source: game.player,
    });
  });

  it('the bash from content costs 18 stamina (AC-5’s last-action rule: src/sim/combat/melee/bash.test.ts)', () => {
    const game = testbed();
    const full = staminaOf(game.world, game.player)?.current ?? 0;
    game.sampler.down('Mouse2');
    game.run(10);
    game.step(['Mouse0']);
    expect(full - (staminaOf(game.world, game.player)?.current ?? 0)).toBe(18);
    game.sampler.up('Mouse2');
    game.run(90);
    expect(game.started.map((e) => e.move)).toEqual(['shield-bash']);
  });
});
