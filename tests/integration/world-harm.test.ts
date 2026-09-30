// mw-e04.34: the environmental damage rules and the character impulse API in the game world — the
// testbed with the player as src/main.ts and the replay world wire it (the sim's Rapier physics,
// scene loader, stimuli, the player with sword and shield, startTestbedCombat), headless. Blasts
// come in as the debug console's `blast` command, a sim command like any other.
import * as RAPIER from '@dimforge/rapier3d-deterministic';
import { describe, expect, it } from 'vitest';
import { DEFAULT_ENVIRONMENT_DAMAGE_ID } from '@content/index';
import { markExercised } from '@content/testing';
import { DamageMeter, sandboxFrameData } from '@game/combat/index';
import {
  blastCommand,
  CharacterController,
  CharacterImpacted,
  DamageApplied,
  fallDamageFraction,
  hashWorld,
  healthOf,
  placementOf,
  readProperty,
  teleportCommand,
  type CharacterImpactInfo,
  type DamageResult,
} from '@sim/index';
import { createGameWorld } from '@tools/replay/testbed-player-scenario';

function testbed() {
  const game = createGameWorld<unknown>(RAPIER, { seed: 1, hz: 60 });
  const { world, player } = game;
  const hits: DamageResult[] = [];
  world.events.on(DamageApplied, (hit) => {
    if (hit.target === player) hits.push(hit);
  });
  const impacts: CharacterImpactInfo[] = [];
  world.events.on(CharacterImpacted, (impact) => impacts.push(impact));
  for (let i = 0; i < 10; i++) world.step([]); // settle on the floor
  return { ...game, hits, impacts };
}

const feetOf = (game: ReturnType<typeof testbed>) => {
  const feet = game.world.get(game.player, CharacterController)?.position;
  if (feet === undefined) throw new Error('no player');
  return feet;
};

describe('the world as a weapon in the testbed (mw-e04.34)', () => {
  it('the player is placed at its feet, pushable and as heavy as its launch.mass', () => {
    const game = testbed();
    const feet = feetOf(game);
    expect(placementOf(game.world, game.player)).toEqual({ ...feet, radius: 0.35 });
    expect(readProperty(game.world, game.player, 'pushable')).toBe(true);
    expect(readProperty(game.world, game.player, 'weight')).toBe(
      game.combat.character.launch?.mass,
    );
  });

  it('AC-1: a sphere force stimulus going off next to the player launches them', () => {
    const run = () => {
      const game = testbed();
      const { x, y, z } = feetOf(game);
      expect(game.world.get(game.player, CharacterController)?.grounded).toBe(true);
      game.world.step([blastCommand({ x: x + 1.5, y, z }, 4, 1500)]);
      return game;
    };
    const game = run();
    expect(hashWorld(run().world)).toBe(hashWorld(game.world)); // deterministic
    const state = game.world.get(game.player, CharacterController);
    expect(state?.grounded).toBe(false);
    expect(state?.launch).toEqual({ source: null, stagger: true });
    expect(state?.velocity.x).toBeLessThan(-5); // away from the blast
    expect(state?.velocity.y).toBeGreaterThan(2); // and up off the ground
    const floor = feetOf(testbed()).y; // where an untouched player stands
    for (let i = 0; i < 90; i++) game.world.step([]);
    expect(game.world.get(game.player, CharacterController)?.grounded).toBe(true);
    expect(feetOf(game).y).toBeCloseTo(floor, 2); // back on the floor it left
    expect(game.impacts.some((i) => i.entity === game.player && i.launch !== null)).toBe(true);
  });

  it('AC-2: dropping from 10 m above the floor costs the player fall damage the frame data shows', ({
    task,
  }) => {
    markExercised(task, 'environment-damage', DEFAULT_ENVIRONMENT_DAMAGE_ID);
    const game = testbed();
    const { world, player, combat } = game;
    const meter = new DamageMeter(world);
    const max = healthOf(world, player)?.max ?? 0;
    const { x, y, z } = feetOf(game);
    world.step([teleportCommand(player, { x, y: y + 10, z })]);
    for (let i = 0; i < 90; i++) world.step([]);
    const landing = game.impacts.find((i) => i.entity === player);
    expect(landing?.height).toBeCloseTo(10, 0);
    expect(game.hits).toHaveLength(1);
    const [hit] = game.hits;
    expect(hit?.tags).toEqual(['environment', 'fall']);
    expect(hit?.total).toBeCloseTo(
      max * fallDamageFraction(landing?.height ?? 0, combat.environment.fall),
      1,
    );
    const knight = sandboxFrameData(world, { moves: combat.moves, player, meter }).fighters[0];
    expect(knight?.health?.current).toBe(max - (hit?.total ?? 0));
    expect(knight?.environment?.kind).toBe('fall');
    // A 3 m drop is within the safe height: no damage.
    const before = healthOf(world, player)?.current;
    world.step([teleportCommand(player, { x, y: y + 3, z })]);
    for (let i = 0; i < 60; i++) world.step([]);
    expect(healthOf(world, player)?.current).toBe(before);
  });
});
