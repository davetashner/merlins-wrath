import { CommandQueue } from '@game/loop/command-queue';
import {
  CharacterController,
  cheatCommand,
  DEBUG_SPAWN_TAG,
  DebugCheatsComponent,
  difficultyCommand,
  hashWorld,
  installDebugCommands,
  blastCommand,
  killCommand,
  PlayerLook,
  registerSceneComponents,
  ReplayRecorder,
  SceneSpawnComponent,
  spawnCharacter,
  spawnCommand,
  teleportCommand,
  testPropSpawners,
  World,
  type EntityId,
} from '@sim/index';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_BLAST, registerBuiltins, type ConsoleHost } from './builtins';
import { createGameHost } from './host';
import { CommandRegistry } from './registry';

const PROPS = ['crate', 'plank', 'barrel', 'brazier', 'crystal'];

/** The host options every test host shares. */
const HOST_BASE = (world: World) => ({
  world,
  submit: () => undefined,
  player: () => undefined,
  spawnables: [],
  bookmarks: () => new Map(),
  scenes: [],
  loadScene: () => undefined,
  loop: { timeScale: 1 },
});

/** A real sim world behind a console, with a replay recorder in front of it like a session. */
function session(options: { withPlayer?: boolean; props?: readonly string[] } = {}) {
  const world = registerSceneComponents(new World<unknown>({ seed: 42 }));
  const spawners = testPropSpawners(options.props ?? PROPS);
  installDebugCommands(world, { spawners });
  world.register(CharacterController, PlayerLook);
  let player: EntityId | undefined;
  if (options.withPlayer === true) {
    player = spawnCharacter(world, { x: 1, y: 0, z: 1 });
    world.add(player, PlayerLook, { yaw: 0, pitch: 0 });
  }
  const queue = new CommandQueue<unknown>();
  const loop = { timeScale: 1 };
  const loadScene = vi.fn();
  const host = createGameHost({
    world: world,
    submit: (command) => {
      queue.push(command);
    },
    player: () => player,
    spawnables: [...spawners.keys()].sort(),
    bookmarks: () => new Map([['player-start', { x: 0, y: 0.5, z: 3 }]]),
    scenes: ['kit-gallery', 'testbed'],
    loadScene,
    loop,
  });
  const registry = new CommandRegistry<ConsoleHost>(host);
  registerBuiltins(registry);
  const recorder = new ReplayRecorder(world, {
    scenario: 'console',
    buildSha: 'test',
    contentHash: null,
  });
  const tick = () => {
    recorder.step(queue.drain());
  };
  const crates = () => {
    let n = 0;
    world.query(SceneSpawnComponent).forEach((_id, spawn) => {
      if (spawn.prop === 'crate' && spawn.tags.includes(DEBUG_SPAWN_TAG)) n++;
    });
    return n;
  };
  return {
    world,
    registry,
    queue,
    recorder,
    tick,
    crates,
    hero: player ?? 0,
    loop,
    loadScene,
    host,
  };
}

describe('built-in console commands', () => {
  it('AC-1: spawn testprop-crate 3 puts 3 crates in the sim next tick, recorded in the replay input log', () => {
    const s = session({ withPlayer: true });
    const result = s.registry.execute('spawn testprop-crate 3');
    expect(result).toEqual({ ok: true, lines: ['spawning 3 × testprop-crate'] });
    expect(s.crates()).toBe(0); // nothing changes until the sim steps
    s.tick();
    expect(s.crates()).toBe(3);
    const replay = s.recorder.finish();
    // In front of the player: feet (1, y, 1) facing −z, 2 m ahead.
    const y = s.world.get(s.hero, CharacterController)?.position.y ?? NaN;
    expect(replay.inputs).toEqual([[1, [spawnCommand('testprop-crate', 3, { x: 1, y, z: -1 })]]]);
  });

  it('AC-2: spawn does-not-exist prints "unknown content id" with the 3 closest matches; the sim is unchanged', () => {
    const s = session();
    const before = hashWorld(s.world);
    const result = s.registry.execute('spawn testprop-crat');
    expect(result.ok).toBe(false);
    expect(result.lines).toEqual([
      'unknown content id "testprop-crat"; closest: testprop-crate, testprop-crystal, testprop-plank',
    ]);
    const missing = s.registry.execute('spawn does-not-exist');
    expect(missing.lines[0]).toMatch(
      /^unknown content id "does-not-exist"; closest: (\S+, ){2}\S+$/,
    );
    expect(s.queue.size).toBe(0);
    s.tick();
    expect(s.recorder.finish().inputs).toEqual([[1, []]]);
    expect(hashWorld(s.world)).not.toBe(before); // the clock advanced…
    const fresh = session();
    fresh.tick();
    expect(hashWorld(s.world)).toBe(hashWorld(fresh.world)); // …and nothing else did
  });

  it('an unknown id with nothing to compare to says only that it is unknown', () => {
    expect(session({ props: [] }).registry.execute('spawn testprop-crate').lines).toEqual([
      'unknown content id "testprop-crate"',
    ]);
  });

  it('AC-3: give with a non-numeric count fails argument validation with usage help', () => {
    const s = session();
    const result = s.registry.execute('give potion lots');
    expect(result.ok).toBe(false);
    expect(result.lines[0]).toMatch(/^give: invalid arguments: arg 2: /);
    expect(result.lines[1]).toBe('usage: give <itemId> [n]');
    expect(s.queue.size).toBe(0);
  });

  it('give with valid arguments explains items do not exist yet', () => {
    expect(session().registry.execute('give potion 2')).toEqual({
      ok: false,
      lines: ['no items to give yet: the inventory arrives with e17 (mw-e17.12)'],
    });
  });

  it('spawn defaults to one at the origin without a player, and caps the count', () => {
    const s = session();
    s.registry.execute('spawn testprop-crate');
    expect(s.queue.drain()).toEqual([spawnCommand('testprop-crate', 1, { x: 0, y: 0, z: 0 })]);
    expect(s.registry.execute('spawn testprop-crate 101').ok).toBe(false);
    expect(s.registry.execute('spawn testprop-crate 0').ok).toBe(false);
  });

  it('spawn passes --options to spawnables that take them, checked up front (mw-e04.9)', () => {
    const s = session();
    const checked: [string, Readonly<Record<string, string>>][] = [];
    const host: ConsoleHost = Object.assign(Object.create(s.host) as ConsoleHost, {
      checkSpawn: (content: string, options: Readonly<Record<string, string>>) => {
        checked.push([content, options]);
        return options['poise'] === '-1' ? '--poise must be a number 0–…' : undefined;
      },
    });
    const registry = new CommandRegistry<ConsoleHost>(host);
    registerBuiltins(registry);
    expect(registry.execute('spawn testprop-crate 2 --poise 60 --resist slash=0.5')).toEqual({
      ok: true,
      lines: ['spawning 2 × testprop-crate --poise 60 --resist slash=0.5'],
    });
    expect(s.queue.drain()).toEqual([
      spawnCommand('testprop-crate', 2, { x: 0, y: 0, z: 0 }, { poise: '60', resist: 'slash=0.5' }),
    ]);
    expect(registry.execute('spawn testprop-crate --poise -1')).toEqual({
      ok: false,
      lines: ['spawn testprop-crate: --poise must be a number 0–…'],
    });
    expect(checked).toHaveLength(2);
    expect(registry.execute('spawn testprop-crate --poise').lines).toEqual([
      'option --poise needs a value',
    ]);
    expect(registry.execute('spawn testprop-crate 1 2').lines).toEqual([
      'spawn: invalid arguments: arg 2: Too big: expected array to have <=1 items',
      'usage: spawn <contentId> [count 1–100] [--option value…]',
    ]);
    // Without a check, no spawnable takes options.
    expect(s.registry.execute('spawn testprop-crate --size big').lines).toEqual([
      'spawn testprop-crate: testprop-crate takes no options',
    ]);
    expect(s.queue.size).toBe(0);
    expect(
      createGameHost({ ...HOST_BASE(s.world), checkSpawn: () => 'nope' }).checkSpawn?.('x', {}),
    ).toBe('nope');
  });

  it('god and noclip toggle the player through cheat commands, or set a state explicitly', () => {
    const s = session({ withPlayer: true });
    const player = s.hero;
    expect(s.registry.execute('god')).toEqual({ ok: true, lines: ['god mode on'] });
    s.tick();
    expect(s.world.get(player, DebugCheatsComponent)).toEqual({ god: true, noclip: false });
    expect(s.registry.execute('god').lines).toEqual(['god mode off']);
    expect(s.registry.execute('noclip on').lines).toEqual(['noclip on']);
    expect(s.registry.execute('noclip off').lines).toEqual(['noclip off']);
    expect(s.queue.drain()).toEqual([
      cheatCommand(player, 'god', false),
      cheatCommand(player, 'noclip', true),
      cheatCommand(player, 'noclip', false),
    ]);
    expect(s.registry.execute('noclip maybe').ok).toBe(false);
  });

  it('player commands say so when the scene has no player', () => {
    const s = session();
    for (const line of ['god', 'kill', 'tp 1 2 3']) {
      expect(s.registry.execute(line)).toEqual({ ok: false, lines: ['no player in this scene'] });
    }
  });

  it('kill targets the player by default, or a given live entity', () => {
    const s = session({ withPlayer: true });
    expect(s.registry.execute('kill').lines).toEqual([`killing entity ${String(s.hero)}`]);
    expect(s.registry.execute('kill 999')).toEqual({ ok: false, lines: ['no entity 999'] });
    expect(s.queue.drain()).toEqual([killCommand(s.hero)]);
  });

  it('tp takes x y z or a named place; unknown places list the closest', () => {
    const s = session({ withPlayer: true });
    const player = s.hero;
    expect(s.registry.execute('tp 1 2.5 -3').lines).toEqual(['teleporting to 1 2.5 -3']);
    expect(s.registry.execute('tp player-start').lines).toEqual(['teleporting to 0 0.5 3']);
    expect(s.queue.drain()).toEqual([
      teleportCommand(player, { x: 1, y: 2.5, z: -3 }),
      teleportCommand(player, { x: 0, y: 0.5, z: 3 }),
    ]);
    expect(s.registry.execute('tp nowhere').lines).toEqual([
      'unknown place "nowhere"; closest: player-start',
    ]);
    expect(s.registry.execute('tp 1 two 3').ok).toBe(false);
    expect(s.registry.execute('tp 1 Infinity 3').ok).toBe(false);
  });

  it('mw-e04.34: blast sets off a force blast where spawn puts things, with defaults and bounds', () => {
    const s = session({ withPlayer: true });
    // The player's feet are at (1, 0, 1), looking along −z: two metres ahead is (1, 0, −1).
    expect(s.registry.execute('blast').lines).toEqual([
      `blast of ${String(DEFAULT_BLAST.intensity)} N·s, radius ${String(DEFAULT_BLAST.radius)} m at 1 0 -1`,
    ]);
    expect(s.registry.execute('blast 900 2.5').ok).toBe(true);
    expect(s.queue.drain()).toEqual([
      blastCommand({ x: 1, y: 0, z: -1 }, DEFAULT_BLAST.radius, DEFAULT_BLAST.intensity),
      blastCommand({ x: 1, y: 0, z: -1 }, 2.5, 900),
    ]);
    expect(s.registry.execute('blast 0').ok).toBe(false);
    expect(s.registry.execute('blast 100 99').ok).toBe(false);
  });

  it('timescale shows and sets the loop speed within range', () => {
    const s = session();
    expect(s.registry.execute('timescale').lines).toEqual(['timescale 1']);
    expect(s.registry.execute('timescale 0.25').lines).toEqual(['timescale 0.25']);
    expect(s.loop.timeScale).toBe(0.25);
    expect(s.host.timeScale).toBe(0.25);
    expect(s.registry.execute('timescale 9').ok).toBe(false);
  });

  it('scene loads a known scene and suggests close ones for a typo', () => {
    const s = session();
    expect(s.registry.execute('scene testbed').lines).toEqual(['loading scene testbed']);
    expect(s.loadScene).toHaveBeenCalledWith('testbed');
    expect(s.registry.execute('scene testbd').lines).toEqual([
      'unknown scene "testbd"; closest: testbed, kit-gallery',
    ]);
  });

  it('set changes a difficulty multiplier through a difficulty command, within its range', () => {
    const s = session();
    expect(s.registry.execute('set damageTaken 0.5').lines).toEqual(['damageTaken = 0.5']);
    expect(s.queue.drain()).toEqual([difficultyCommand({ damageTaken: 0.5 })]);
    expect(s.registry.execute('set damageTaken 99').lines).toEqual(['damageTaken must be 0.25–4']);
    expect(s.registry.execute('set speed 2').ok).toBe(false);
    s.registry.execute('set fallDamage 0');
    s.tick();
    expect(s.world.difficulty.fallDamage).toBe(0);
  });

  it('seed prints the world seed; help lists every command or explains one', () => {
    const s = session();
    expect(s.registry.execute('seed').lines).toEqual(['seed 42']);
    expect(s.registry.execute('seed 1').ok).toBe(false);
    const help = s.registry.execute('help').lines;
    expect(help.map((line) => line.split(' ')[0])).toEqual([
      'blast',
      'give',
      'god',
      'help',
      'kill',
      'noclip',
      'scene',
      'seed',
      'set',
      'spawn',
      'timescale',
      'tp',
    ]);
    expect(s.registry.execute('help spawn').lines).toEqual([
      'usage: spawn <contentId> [count 1–100] [--option value…]',
      'spawn content in front of the player (sandbox dummies take options: type dummies)',
    ]);
    expect(s.registry.execute('help spwn').lines).toEqual([
      'unknown command "spwn"; closest: spawn, scene, seed',
    ]);
  });

  it('completes arguments: content ids, places, scenes, settings, cheat states and command names', () => {
    const s = session();
    expect(s.registry.complete('spawn testprop-cr')).toEqual({
      line: 'spawn testprop-cr',
      options: ['testprop-crate', 'testprop-crystal'],
    });
    expect(s.registry.complete('spawn testprop-p').line).toBe('spawn testprop-plank ');
    expect(s.registry.complete('spawn testprop-crate ').options).toEqual([]);
    expect(s.registry.complete('tp pl').line).toBe('tp player-start ');
    expect(s.registry.complete('tp 1 ').options).toEqual([]);
    expect(s.registry.complete('scene k').line).toBe('scene kit-gallery ');
    expect(s.registry.complete('scene kit-gallery ').options).toEqual([]);
    expect(s.registry.complete('set damage').options).toEqual(['damageDealt', 'damageTaken']);
    expect(s.registry.complete('set damageTaken ').options).toEqual([]);
    expect(s.registry.complete('god o').options).toEqual(['on', 'off']);
    expect(s.registry.complete('help ti').line).toBe('help timescale ');
  });
});
