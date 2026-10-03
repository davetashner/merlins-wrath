import type { ControllerTuning, Frozen } from '@content/index';
import { describe, expect, it, vi } from 'vitest';
import { FakeCollisionWorld } from '../character/fake-collision-world';
import { CharacterController } from '../character/system';
import { Died, type Death } from '../combat/damage/events';
import type { EntityId } from '../core/component';
import { World } from '../core/world';
import {
  actionButton,
  actionFrame,
  actionFrameOf,
  actionVector,
  IDLE_ACTION_FRAME,
  stickVector,
  type ActionFrame,
} from '../input/action-frame';
import { installPlayer, PlayerLook } from '../player/player';
import { TEST_SCENE, testKit } from '../scene/fixtures';
import { layoutScene } from '../scene/layout';
import {
  announceRespawn,
  deathBeatProgress,
  deathBeatTicks,
  DEFAULT_DEATH_BEAT_SECONDS,
  installPlayerDeath,
  isPlayerDead,
  PlayerDeath,
  playerDeathBeatEnded,
  playerDied,
  playerRespawned,
  type PlayerDeathBeatEnded,
  type PlayerDied,
  type PlayerRespawned,
} from './death';
import { RespawnRules, type RespawnRule } from './rules';

const TUNING: Frozen<ControllerTuning> = {
  capsule: { radius: 0.35, height: 1.8, crouchHeight: 1.0 },
  speeds: { run: 5, sprint: 7.5, crouch: 2.2 },
  accelTime: 0.15,
  decelTime: 0.1,
  airControl: 0.3,
  gravity: 25,
  maxFallSpeed: 40,
  jumpApex: 1.2,
  coyoteMs: 120,
  jumpBufferMs: 150,
  stepHeight: 0.35,
  slopeLimit: 45,
};

const LAYOUT = layoutScene(TEST_SCENE, testKit);

const SLICE_RULE: RespawnRule = {
  id: 'slice-reload',
  region: 'slice',
  priority: 0,
  destination: { scene: 'slice', spawn: 'player-start' },
  mode: 'reload',
  factsToSet: [{ fact: 'player.deaths-seen', value: true }],
};

/** Walks forward and turns: every part of it would move or turn a living player. */
const PUSH: ActionFrame = actionFrame({
  move: actionVector(0, 1),
  look: actionVector(40, 10),
  lookStick: stickVector(0, 0),
  buttons: (action) => actionButton(action === 'jump', action === 'jump', false),
});

interface Setup {
  readonly world: World;
  readonly player: EntityId;
  readonly died: PlayerDied[];
  readonly ended: PlayerDeathBeatEnded[];
  /** Emits the player's Died (as the damage model does) in the next step, with this killer. */
  readonly kill: (killer: EntityId | null) => void;
}

function setup(options: { region?: string; beatSeconds?: number; warn?: () => void } = {}): Setup {
  const world = new World<unknown>({ seed: 7 });
  const player = installPlayer(world, {
    spawns: LAYOUT.spawns,
    collision: new FakeCollisionWorld(LAYOUT.parts.flatMap((part) => part.collider ?? [])),
    tuning: TUNING,
  });
  let pending: Death | undefined;
  // Stands in for the damage model: a system before the death wiring that emits Died.
  world.addSystem({
    name: 'test-damage',
    run: ({ world: w, tick }) => {
      if (pending === undefined) return;
      w.events.emit(Died, { ...pending, tick });
      pending = undefined;
    },
  });
  installPlayerDeath(world, {
    player,
    region: options.region ?? 'slice',
    rules: new RespawnRules([SLICE_RULE]),
    ...(options.beatSeconds !== undefined && { beatSeconds: options.beatSeconds }),
    ...(options.warn !== undefined && { warn: options.warn }),
  });
  const died: PlayerDied[] = [];
  const ended: PlayerDeathBeatEnded[] = [];
  world.events.on(playerDied, (event) => died.push(event));
  world.events.on(playerDeathBeatEnded, (event) => ended.push(event));
  return {
    world,
    player,
    died,
    ended,
    kill: (killer) => {
      pending = { tick: -1, target: player, killer, source: killer, tags: ['slash'] };
    },
  };
}

describe('player death (mw-e01.8)', () => {
  it('AC-1: after the player’s Died, the next tick ignores its input and one player.died is emitted with position and killer', () => {
    const { world, player, died, kill } = setup();
    for (let i = 0; i < 5; i++) world.step([IDLE_ACTION_FRAME]);
    const killer = world.spawn();
    kill(killer);
    const deathTick = world.tick;
    world.step([IDLE_ACTION_FRAME]); // Died
    const fallen = world.get(player, CharacterController)?.position;
    const look = world.get(player, PlayerLook);
    expect(died).toEqual([
      {
        tick: deathTick,
        player,
        killer,
        source: killer,
        tags: ['slash'],
        position: fallen,
        region: 'slice',
        rule: 'slice-reload',
        mode: 'reload',
        handoffTick: deathTick + 90,
      },
    ]);
    // The next tick, and every one after: the player's walk, turn and jump are ignored.
    for (let i = 0; i < 30; i++) world.step([PUSH]);
    expect(world.get(player, CharacterController)?.position).toEqual(fallen);
    expect(world.get(player, PlayerLook)).toEqual(look);
    expect(died).toHaveLength(1);
    expect(isPlayerDead(world, player)).toBe(true);
  });

  it('AC-1: only ActionFrames are dropped; other inputs still reach the systems', () => {
    const { world, kill } = setup();
    const seen: { frame: boolean; other: boolean }[] = [];
    world.addSystem({
      name: 'probe',
      run: ({ inputs }) => {
        seen.push({
          frame: actionFrameOf(inputs) !== undefined,
          other: inputs.includes('debug'),
        });
      },
    });
    kill(null);
    world.step([PUSH, 'debug']); // dies this tick: its own input still counted
    world.step([PUSH, 'debug']);
    expect(seen).toEqual([
      { frame: true, other: true },
      { frame: false, other: true },
    ]);
  });

  it('runs a 1.5 s death beat in sim ticks, then hands off exactly once', () => {
    const { world, player, ended, kill } = setup();
    expect(DEFAULT_DEATH_BEAT_SECONDS).toBe(1.5);
    expect(deathBeatTicks(1.5, world.clock.hz)).toBe(90);
    kill(null);
    const deathTick = world.tick;
    world.step();
    expect(deathBeatProgress(world, player)).toBe(1 / 90);
    while (world.tick < deathTick + 90) world.step();
    expect(ended).toEqual([]);
    expect(deathBeatProgress(world, player, deathTick + 45)).toBe(0.5);
    world.step(); // tick deathTick + 90
    expect(ended).toEqual([
      {
        tick: deathTick + 90,
        player,
        rule: 'slice-reload',
        mode: 'reload',
        destination: { scene: 'slice', spawn: 'player-start' },
      },
    ]);
    expect(world.get(player, PlayerDeath)?.handedOff).toBe(true);
    for (let i = 0; i < 10; i++) world.step();
    expect(ended).toHaveLength(1);
    expect(deathBeatProgress(world, player, deathTick + 500)).toBe(1);
    expect(deathBeatProgress(world, player, deathTick - 5)).toBe(0);
  });

  it('writes the winning rule’s facts and ignores Died of anyone else or a second Died', () => {
    const { world, player, died, kill } = setup();
    const other = world.spawn();
    world.events.emit(Died, { tick: 0, target: other, killer: null, source: null, tags: [] });
    world.step();
    expect(died).toEqual([]);
    expect(world.facts.get('player.deaths-seen')).toBeUndefined();
    kill(null);
    world.step();
    expect(world.facts.get('player.deaths-seen')).toBe(true);
    kill(other);
    world.step();
    expect(died).toHaveLength(1);
    expect(world.get(player, PlayerDeath)?.killer).toBeNull();
  });

  it('AC-4: a death in a region with no rule reloads the last save and warns', () => {
    const warn = vi.fn();
    const { world, died, kill } = setup({ region: 'testbed', warn });
    kill(null);
    world.step();
    expect(died[0]).toMatchObject({ region: 'testbed', rule: null, mode: 'reload' });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('a zero beat hands off on the tick after the death; a negative beat is refused', () => {
    const { world, player, ended, kill } = setup({ beatSeconds: 0 });
    kill(null);
    world.step();
    expect(ended).toEqual([]);
    expect(deathBeatProgress(world, player)).toBe(1);
    world.step();
    expect(ended).toHaveLength(1);
    expect(() => deathBeatTicks(-1, 60)).toThrow(RangeError);
    expect(() => deathBeatTicks(Number.NaN, 60)).toThrow(RangeError);
  });

  it('knows the player is alive before it dies, also in worlds without the death wiring', () => {
    const { world, player } = setup();
    expect(isPlayerDead(world, player)).toBe(false);
    expect(deathBeatProgress(world, player)).toBeUndefined();
    const bare = new World({ seed: 1 });
    const id = bare.spawn();
    expect(isPlayerDead(bare, id)).toBe(false);
    expect(deathBeatProgress(bare, id)).toBeUndefined();
  });

  it('records a null position for a player without a character controller', () => {
    const world = new World<unknown>({ seed: 1 });
    const player = world.spawn();
    const withController = new World<unknown>({ seed: 1 }).register(CharacterController);
    const other = withController.spawn();
    installPlayerDeath(withController, {
      player: other,
      region: 'slice',
      rules: new RespawnRules([]),
    });
    withController.events.on(playerDied, (event) => {
      expect(event.position).toBeNull();
    });
    withController.events.emit(Died, {
      tick: 0,
      target: other,
      killer: null,
      source: null,
      tags: [],
    });
    withController.step();
    expect(isPlayerDead(withController, other)).toBe(true);
    installPlayerDeath(world, { player, region: 'slice', rules: new RespawnRules([]) });
    const died: PlayerDied[] = [];
    world.events.on(playerDied, (event) => died.push(event));
    world.events.emit(Died, { tick: 0, target: player, killer: null, source: null, tags: [] });
    world.step();
    expect(died[0]?.position).toBeNull();
    world.step();
    expect(deathBeatProgress(world, player)).toBe(2 / 90);
  });

  it('announces the respawn at the next phase boundary', () => {
    const { world, player } = setup();
    const respawned: PlayerRespawned[] = [];
    world.events.on(playerRespawned, (event) => respawned.push(event));
    announceRespawn(world, { player, mode: 'reload', rule: 'slice-reload', slot: 'manual-1' });
    expect(respawned).toEqual([]);
    world.step();
    expect(respawned).toEqual([
      { tick: 0, player, mode: 'reload', rule: 'slice-reload', slot: 'manual-1' },
    ]);
  });
});
