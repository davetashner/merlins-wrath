import {
  controllerSchema,
  controllerTuningFor,
  loadGameContent,
  PLAYER_CONTROLLER_ID,
  withoutSchemaKey,
  type ControllerDef,
  type ControllerTuning,
  type Frozen,
} from '@content/index';
import { markExercised } from '@content/testing';
import { CommandQueue } from '@game/loop/command-queue';
import {
  CharacterTuning,
  DEBUG_COMMAND,
  FakeCollisionWorld,
  installDebugCommands,
  installPlayer,
  layoutScene,
  registerSceneComponents,
  World,
  type EntityId,
} from '@sim/index';
import { TEST_SCENE, testKit } from '@sim/scene/fixtures';
import { beforeEach, describe, expect, it } from 'vitest';
import { registerBuiltins, type ConsoleHost } from './builtins';
import {
  CONTROLLER_FIELD_ALIASES,
  controllerFields,
  registerControllerCommands,
} from './controller';
import { characterTuningOf, createGameHost } from './host';
import { CommandRegistry } from './registry';

const profile = loadGameContent().get('controller', PLAYER_CONTROLLER_ID);
const shipped = controllerTuningFor(profile);

/** A console over a world whose player (when `withPlayer`) moves with the shipped tuning. */
function session(options: { withPlayer?: boolean; profile?: Frozen<ControllerDef> } = {}) {
  const world = registerSceneComponents(new World<never>({ seed: 7 }));
  installDebugCommands(world, { spawners: new Map() });
  let player: EntityId | undefined;
  if (options.withPlayer !== false) {
    const layout = layoutScene(TEST_SCENE, testKit);
    const collision = new FakeCollisionWorld(layout.parts.flatMap((part) => part.collider ?? []));
    player = installPlayer(world, { spawns: layout.spawns, collision, tuning: shipped });
  }
  const queue = new CommandQueue<unknown>();
  const host = createGameHost({
    world,
    submit: (command) => {
      queue.push(command);
    },
    player: () => player,
    spawnables: [],
    bookmarks: () => new Map(),
    scenes: [],
    loadScene: () => undefined,
    loop: { timeScale: 1 },
  });
  const registry = new CommandRegistry<ConsoleHost>(host);
  registerBuiltins(registry);
  registerControllerCommands(registry, {
    profile: options.profile ?? profile,
    tuning: (entity) => characterTuningOf(world, entity),
  });
  const run = (line: string) => registry.execute(line);
  /** Feeds the queued commands to the next tick. */
  const step = () => {
    world.step(queue.drain() as never[]);
  };
  return { world, player, registry, run, step, queue };
}

describe('controller console commands (mw-e02.3)', () => {
  beforeEach(({ task }) => {
    markExercised(task, 'controller', PLAYER_CONTROLLER_ID);
  });

  it('lists every value by dotted path, in profile order', () => {
    const fields = controllerFields(shipped);
    expect(fields[0]).toEqual(['capsule.radius', 0.35]);
    expect(fields).toContainEqual(['speeds.run', 5]);
    expect(fields).toContainEqual(['ledge.jumpBack.up', 6]);
    expect(fields).toContainEqual(['climb.walkOn', ['ladder', 'rope', 'ivy']]);
    expect(controllerFields(undefined)).toEqual([]);
    const s = session();
    const all = s.run('ctl.get');
    expect(all.ok).toBe(true);
    expect(all.lines).toHaveLength(fields.length);
    expect(all.lines).toContain('speeds.run = 5');
    expect(all.lines).toContain('climb.walkOn = ["ladder","rope","ivy"]');
  });

  it('gets one value by path or by its designer name, suggesting near names', () => {
    const s = session();
    expect(s.run('ctl.get runSpeed').lines).toEqual(['speeds.run = 5']);
    expect(s.run('ctl.get crouchSpeed').lines).toEqual(['speeds.crouch = 2.2']);
    expect(s.run('ctl.get gravity').lines).toEqual(['gravity = 25']);
    expect(s.run('ctl.get speeds.rum')).toEqual({
      ok: false,
      lines: [
        'unknown controller field "speeds.rum"; closest: speeds.run, speeds.crouch, speeds.sprint',
      ],
    });
    expect(s.registry.complete('ctl.get run').line).toBe('ctl.get runSpeed ');
    expect(s.registry.complete('ctl.set speeds.c').line).toBe('ctl.set speeds.crouch ');
    expect(s.registry.complete('ctl.set runSpeed ').options).toEqual([]);
    expect(s.registry.complete('ctl.get runSpeed ').options).toEqual([]);
    expect(Object.keys(CONTROLLER_FIELD_ALIASES)).toEqual([
      'runSpeed',
      'sprintSpeed',
      'crouchSpeed',
    ]);
  });

  it('sets a value as a recorded tune command carrying the whole validated tuning', () => {
    const s = session();
    const result = s.run('ctl.set runSpeed 6');
    expect(result).toEqual({ ok: true, lines: ['speeds.run = 6 (was 5)'] });
    const [command] = s.queue.drain() as [{ kind: string; op: string; tuning: ControllerTuning }];
    expect(command.kind).toBe(DEBUG_COMMAND);
    expect(command.op).toBe('tune');
    expect(command.tuning).toEqual({ ...shipped, speeds: { ...shipped.speeds, run: 6 } });
    expect(Object.isFrozen(command.tuning.speeds)).toBe(true);
    // Only the queued command changes the sim, on the next tick.
    expect(s.player && s.world.get(s.player, CharacterTuning)?.speeds.run).toBe(5);
  });

  it('rejects values the schema rejects, naming the field, and fields that are not numbers', () => {
    const s = session();
    expect(s.run('ctl.set gravity -9.8')).toEqual({
      ok: false,
      lines: ['gravity: Too small: expected number to be >0'],
    });
    expect(s.run('ctl.set crouchSpeed 9')).toEqual({
      ok: false,
      lines: ['speeds.crouch: speeds.crouch must not be higher than speeds.run'],
    });
    expect(s.run('ctl.set coyoteMs 10.5').lines).toEqual([
      'coyoteMs: Invalid input: expected int, received number',
    ]);
    expect(s.run('ctl.set climb.walkOn 1')).toEqual({
      ok: false,
      lines: ['climb.walkOn is ["ladder","rope","ivy"], not a number: edit it in the file'],
    });
    expect(s.run('ctl.set runSpeed fast').ok).toBe(false);
    expect(s.run('ctl.set runSpeed Infinity').ok).toBe(false);
    expect(s.queue.drain()).toEqual([]);
  });

  it('dumps the live profile as a valid controller file', () => {
    const s = session();
    s.run('ctl.set sprintSpeed 8');
    s.step();
    const dump = s.run('ctl.dump');
    expect(dump.ok).toBe(true);
    const file = JSON.parse(dump.lines.join('\n')) as Record<string, unknown>;
    expect(file['$schema']).toBe('../controller.schema.json');
    const parsed = controllerSchema.parse(withoutSchemaKey(file));
    expect(parsed.speeds.sprint).toBe(8);
    expect(parsed.classes).toEqual(profile.classes);
    expect({ ...parsed, speeds: profile.speeds }).toEqual({ ...profile, speeds: profile.speeds });
  });

  it('dumps a profile without class overrides without a classes field', () => {
    const bare = Object.fromEntries(
      Object.entries(profile).filter(([key]) => key !== 'classes'),
    ) as Frozen<ControllerDef>;
    const s = session({ profile: bare });
    const file = JSON.parse(s.run('ctl.dump').lines.join('\n')) as Record<string, unknown>;
    expect(Object.keys(file)).not.toContain('classes');
  });

  it('refuses to dump live values a class override no longer fits', () => {
    const s = session();
    s.run('ctl.set crouchSpeed 2');
    s.step();
    s.run('ctl.set runSpeed 2.4');
    s.step();
    expect(s.run('ctl.dump')).toEqual({
      ok: false,
      lines: [
        'classes.thief.speeds.crouch: with the thief override: speeds.crouch must not be higher than speeds.run',
      ],
    });
  });

  it('says so when there is no player to tune', () => {
    const s = session({ withPlayer: false });
    const none = { ok: false, lines: ['no player with controller tuning in this scene'] };
    expect(s.run('ctl.get')).toEqual(none);
    expect(s.run('ctl.set runSpeed 6')).toEqual(none);
    expect(s.run('ctl.dump')).toEqual(none);
    expect(s.registry.complete('ctl.get s').line).toBe('ctl.get sprintSpeed ');
  });
});
