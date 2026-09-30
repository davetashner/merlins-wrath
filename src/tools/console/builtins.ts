// The debug console's built-in commands (mw-e33.1): help, spawn, give, god, noclip, kill, tp,
// timescale, scene, set and seed. Everything that changes the sim goes out as a sim command through
// `host.submit` (applied next tick, recorded in replays); the host's other members only read the
// sim or drive the page (time scale, scene reload), never sim state.

import {
  cheatCommand,
  DIFFICULTY_KEYS,
  DIFFICULTY_RANGES,
  difficultyCommand,
  killCommand,
  MAX_SPAWN_COUNT,
  spawnCommand,
  teleportCommand,
  type DebugCheat,
  type DifficultyKey,
  type EntityId,
  type Vec3,
} from '@sim/index';
import { MAX_TIME_SCALE } from '@game/loop/fixed-step';
import { z } from 'zod';
import { ConsoleError, type CommandRegistry, type CommandSpec } from './registry';
import { closest, splitOptions } from './text';

/** What the built-ins need from the running game. */
export interface ConsoleHost {
  /** Queues a sim command for the next tick. */
  submit(command: unknown): void;
  /** The world seed. */
  readonly seed: number;
  isAlive(entity: EntityId): boolean;
  /** The player entity, if the scene has one. */
  player(): EntityId | undefined;
  /** Whether `entity` has `cheat` on right now. */
  cheat(entity: EntityId, cheat: DebugCheat): boolean;
  /** Where `spawn` puts things: a little in front of the player, or the scene origin. */
  spawnPoint(): Vec3;
  /** Spawnable content ids (`testprop-crate`…), sorted. */
  readonly spawnables: readonly string[];
  /**
   * What is wrong with `options` for spawning `content` (`spawn dummy --poise 60`), or undefined
   * when they are fine. Without it, no spawnable takes options.
   */
  checkSpawn?(content: string, options: Readonly<Record<string, string>>): string | undefined;
  /** Named places `tp` accepts (the loaded scene's spawns). */
  bookmarks(): ReadonlyMap<string, Vec3>;
  /** Scene ids `scene` accepts, sorted. */
  readonly scenes: readonly string[];
  /** Switches to scene `id` (reloads the page). */
  loadScene(id: string): void;
  /** Sim speed: 1 is real time. */
  timeScale: number;
}

const count = (max: number) => z.coerce.number<string>().int().min(1).max(max);
const coordinate = z.coerce.number<string>().refine(Number.isFinite, 'expected a finite number');

function player(host: ConsoleHost): EntityId {
  const id = host.player();
  if (id === undefined) throw new ConsoleError(['no player in this scene']);
  return id;
}

function unknown(what: string, value: string, known: readonly string[]): ConsoleError {
  const near = closest(value, known);
  return new ConsoleError([
    near.length === 0
      ? `unknown ${what} "${value}"`
      : `unknown ${what} "${value}"; closest: ${near.join(', ')}`,
  ]);
}

const onOff = z.enum(['on', 'off']).optional();

/** `splitOptions` with its errors as console errors. */
export function parsedOptions(tokens: readonly string[]): ReturnType<typeof splitOptions> {
  try {
    return splitOptions(tokens);
  } catch (error) {
    throw new ConsoleError([(error as Error).message]);
  }
}

function cheatToggle(
  name: DebugCheat,
  label: string,
): CommandSpec<[('on' | 'off' | undefined)?], ConsoleHost> {
  return {
    name,
    summary: `toggle ${label} for the player`,
    usage: '[on|off]',
    args: z.tuple([onOff]),
    complete: () => ['on', 'off'],
    run: ([state], host) => {
      const target = player(host);
      const on = state === undefined ? !host.cheat(target, name) : state === 'on';
      host.submit(cheatCommand(target, name, on));
      return `${label} ${on ? 'on' : 'off'}`;
    },
  };
}

/** Registers every built-in command on `registry`. */
export function registerBuiltins(registry: CommandRegistry<ConsoleHost>): void {
  registry.registerCommand({
    name: 'help',
    summary: 'list commands, or show how to use one',
    usage: '[command]',
    args: z.tuple([z.string().optional()]),
    complete: () => registry.list().map((spec) => spec.name),
    run: ([name]) => {
      if (name === undefined) {
        return registry.list().map((spec) => `${registry.usageOf(spec)} — ${spec.summary}`);
      }
      const spec = registry.get(name);
      if (spec === undefined) {
        throw unknown(
          'command',
          name,
          registry.list().map((s) => s.name),
        );
      }
      return [`usage: ${registry.usageOf(spec)}`, spec.summary];
    },
  });

  const spawnUsage = `<contentId> [count 1–${String(MAX_SPAWN_COUNT)}] [--option value…]`;
  registry.registerCommand({
    name: 'spawn',
    summary: 'spawn content in front of the player (sandbox dummies take options: type dummies)',
    usage: spawnUsage,
    args: z.tuple([z.string()]).rest(z.string()),
    complete: (index, host) => (index === 0 ? host.spawnables : []),
    run: ([content, ...rest], host) => {
      const { words, options } = parsedOptions(rest);
      const counted = z.tuple([count(MAX_SPAWN_COUNT).optional()]).safeParse(words);
      if (!counted.success) {
        const issue = counted.error.issues.map((i) => i.message).join('; ');
        throw new ConsoleError([
          `spawn: invalid arguments: arg 2: ${issue}`,
          `usage: spawn ${spawnUsage}`,
        ]);
      }
      const [n = 1] = counted.data;
      if (!host.spawnables.includes(content)) {
        throw unknown('content id', content, host.spawnables);
      }
      const noOptions = Object.keys(options).length === 0;
      const problem =
        host.checkSpawn === undefined
          ? noOptions
            ? undefined
            : `${content} takes no options`
          : host.checkSpawn(content, options);
      if (problem !== undefined) throw new ConsoleError([`spawn ${content}: ${problem}`]);
      host.submit(spawnCommand(content, n, host.spawnPoint(), options));
      const described = Object.entries(options).map(([name, value]) => `--${name} ${value}`);
      return `spawning ${String(n)} × ${[content, ...described].join(' ')}`;
    },
  });

  registry.registerCommand({
    name: 'give',
    summary: 'give the player items',
    usage: '<itemId> [n]',
    args: z.tuple([z.string(), count(999).optional()]),
    run: () => {
      throw new ConsoleError(['no items to give yet: the inventory arrives with e17 (mw-e17.12)']);
    },
  });

  registry.registerCommand(cheatToggle('god', 'god mode'));
  registry.registerCommand(cheatToggle('noclip', 'noclip'));

  registry.registerCommand({
    name: 'kill',
    summary: 'kill an entity (the player by default)',
    usage: '[entityId]',
    args: z.tuple([z.coerce.number<string>().int().positive().optional()]),
    run: ([entity], host) => {
      const target = entity ?? player(host);
      if (!host.isAlive(target)) throw new ConsoleError([`no entity ${String(target)}`]);
      host.submit(killCommand(target));
      return `killing entity ${String(target)}`;
    },
  });

  registry.registerCommand({
    name: 'tp',
    summary: 'teleport the player to a position or a named place',
    usage: '<x y z | place>',
    args: z.union([z.tuple([coordinate, coordinate, coordinate]), z.tuple([z.string()])]),
    complete: (index, host) => (index === 0 ? [...host.bookmarks().keys()].sort() : []),
    run: (args, host) => {
      const target = player(host);
      let to: Vec3;
      if (args.length === 3) {
        const [x, y, z] = args;
        to = { x, y, z };
      } else {
        const places = host.bookmarks();
        const place = places.get(args[0]);
        if (place === undefined) throw unknown('place', args[0], [...places.keys()].sort());
        to = place;
      }
      host.submit(teleportCommand(target, to));
      return `teleporting to ${String(to.x)} ${String(to.y)} ${String(to.z)}`;
    },
  });

  registry.registerCommand({
    name: 'timescale',
    summary: 'show or set the sim speed (1 = real time, 0 = frozen)',
    usage: `[0–${String(MAX_TIME_SCALE)}]`,
    args: z.tuple([z.coerce.number<string>().min(0).max(MAX_TIME_SCALE).optional()]),
    run: ([scale], host) => {
      if (scale !== undefined) host.timeScale = scale;
      return `timescale ${String(host.timeScale)}`;
    },
  });

  registry.registerCommand({
    name: 'scene',
    summary: 'load a scene (reloads the page)',
    usage: '<sceneId>',
    args: z.tuple([z.string()]),
    complete: (index, host) => (index === 0 ? host.scenes : []),
    run: ([id], host) => {
      if (!host.scenes.includes(id)) throw unknown('scene', id, host.scenes);
      host.loadScene(id);
      return `loading scene ${id}`;
    },
  });

  registry.registerCommand({
    name: 'set',
    summary: 'set a difficulty multiplier',
    usage: '<setting> <value>',
    args: z.tuple([z.enum(DIFFICULTY_KEYS as [DifficultyKey, ...DifficultyKey[]]), coordinate]),
    complete: (index) => (index === 0 ? DIFFICULTY_KEYS : []),
    run: ([key, value], host) => {
      const { min, max } = DIFFICULTY_RANGES[key];
      if (value < min || value > max) {
        throw new ConsoleError([`${key} must be ${String(min)}–${String(max)}`]);
      }
      host.submit(difficultyCommand({ [key]: value }));
      return `${key} = ${String(value)}`;
    },
  });

  registry.registerCommand({
    name: 'seed',
    summary: 'print the world seed',
    usage: '',
    args: z.tuple([]),
    run: (_args, host) => `seed ${String(host.seed)}`,
  });
}
