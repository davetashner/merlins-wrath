import { loadGameContent, RESPAWN_RULES_ID } from '@content/index';
import {
  Died,
  PlayerDeath,
  playerDeathBeatEnded,
  playerDied,
  installPlayerDeath,
  RespawnRules,
  World,
  type EntityId,
  type PlayerDeathBeatEnded,
} from '@sim/index';
import { describe, expect, it, vi } from 'vitest';
import { DeathBeat, respawnRulesFrom, type DeathBeatReadout } from './death-beat';

function setup(mode: 'reload' | 'wake-in-place' = 'reload') {
  const world = new World<never>({ seed: 1 });
  const player = world.spawn();
  const other = world.spawn();
  installPlayerDeath(world, {
    player,
    region: 'slice',
    rules: new RespawnRules([
      {
        id: 'slice-reload',
        region: 'slice',
        priority: 0,
        destination: { scene: 'slice', spawn: 'player-start' },
        mode,
        factsToSet: [],
      },
    ]),
  });
  const pullBack = vi.fn<(fraction: number) => void>();
  const fade = vi.fn<(progress: number | null) => void>();
  const onReload = vi.fn<(end: PlayerDeathBeatEnded) => void>();
  const published: DeathBeatReadout[] = [];
  const warn = vi.fn<(message: string) => void>();
  const beat = new DeathBeat({
    world,
    player,
    view: { pullBack, fade },
    onReload,
    publish: (readout) => published.push(readout),
    warn,
  });
  const die = (target: EntityId = player) => {
    world.events.emit(Died, { tick: world.tick, target, killer: other, source: null, tags: [] });
  };
  return { world, player, other, beat, pullBack, fade, onReload, published, warn, die };
}

describe('death beat presentation (mw-e01.8)', () => {
  it('pulls the camera back and fades over the beat’s sim ticks, then opens the death screen', () => {
    const { world, beat, pullBack, fade, onReload, published, die, other } = setup();
    beat.frame();
    expect(fade).not.toHaveBeenCalled(); // alive: nothing to do
    die();
    world.step(); // tick 0: Died
    expect(published).toEqual([
      {
        tick: 0,
        killer: other,
        position: null,
        rule: 'slice-reload',
        mode: 'reload',
        handoffTick: 90,
        endedAt: null,
      },
    ]);
    for (let i = 0; i < 45; i++) world.step();
    beat.frame(1); // drawn at tick 45
    expect(pullBack).toHaveBeenLastCalledWith(0.5);
    expect(fade).toHaveBeenLastCalledWith(0.5);
    beat.frame(0.5);
    expect(fade).toHaveBeenLastCalledWith(44.5 / 90);
    while (world.tick <= 90) world.step();
    expect(onReload).toHaveBeenCalledTimes(1);
    expect(onReload.mock.calls[0]?.[0]).toMatchObject({ tick: 90, rule: 'slice-reload' });
    expect(published.at(-1)?.endedAt).toBe(90);
    beat.frame(0);
    expect(fade).toHaveBeenLastCalledWith(1); // ended: stays at the end whatever the alpha
  });

  it('a wake-in-place rule warns (not supported yet) and reloads instead', () => {
    const { world, onReload, warn, die } = setup('wake-in-place');
    die();
    while (world.tick <= 91) world.step();
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/wake-in-place is not supported yet/));
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it('ignores other entities, clears the view once alive again, and stops on dispose', () => {
    const { world, player, beat, fade, pullBack, onReload, published, die, other } = setup();
    die(other);
    world.step();
    expect(published).toEqual([]);
    die();
    world.step();
    beat.frame();
    expect(fade).toHaveBeenCalledTimes(1);
    // A load replaces the world's state: the player is alive again.
    world.remove(player, PlayerDeath);
    beat.frame();
    expect(fade).toHaveBeenLastCalledWith(null);
    expect(pullBack).toHaveBeenLastCalledWith(0);
    beat.frame();
    expect(fade).toHaveBeenCalledTimes(2);
    beat.dispose();
    while (world.tick <= 100) world.step();
    expect(onReload).not.toHaveBeenCalled();
  });

  it('works without a publisher or logger, and only for its own player’s hand-off', () => {
    const world = new World<never>({ seed: 1 });
    const player = world.spawn();
    const onReload = vi.fn();
    new DeathBeat({ world, player, view: { pullBack: vi.fn(), fade: vi.fn() }, onReload });
    const end = { tick: 0, rule: null, mode: 'wake-in-place', destination: null } as const;
    world.events.emit(playerDied, {
      tick: 0,
      player: player + 1,
      killer: null,
      source: null,
      tags: [],
      position: null,
      region: 'slice',
      rule: null,
      mode: 'reload',
      handoffTick: 90,
    });
    world.events.emit(playerDeathBeatEnded, { ...end, player: player + 1 });
    world.events.emit(playerDeathBeatEnded, { ...end, player });
    world.step();
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it('builds the sim’s rule table from content', () => {
    const entry = loadGameContent().get('respawn-rules', RESPAWN_RULES_ID);
    const rules = respawnRulesFrom(entry);
    expect(rules.find(({ id }) => id === 'slice-reload')).toEqual({
      id: 'slice-reload',
      region: 'slice',
      priority: 0,
      conditions: undefined,
      destination: { scene: 'slice', spawn: 'player-start' },
      mode: 'reload',
      factsToSet: [],
    });
    expect(new RespawnRules(rules).order).toContain('testbed-reload');
  });
});
