// Live controller tuning from the debug console (mw-e02.3): `ctl.get` prints the player's current
// controller values, `ctl.set <field> <value>` changes one and `ctl.dump` prints the whole profile
// as a controller data file to paste over src/content/data/controller/<id>.json.
//
// Fields are dotted paths into the profile (`speeds.run`, `ledge.jumpBack.up`); the speeds also go by
// their designer names (`runSpeed`, `sprintSpeed`, `crouchSpeed`). `ctl.set` validates the whole
// changed tuning against the controller schema (bounds and cross-field rules) and sends it as a
// recorded debug command, so the next tick moves with it and a replay reproduces the edit.

import {
  controllerSchema,
  controllerTuningSchema,
  dottedPath,
  tuningOf,
  type ControllerDef,
  type ControllerTuning,
  type Frozen,
} from '@content/index';
import { tuneCommand, type EntityId } from '@sim/index';
import { z } from 'zod';
import type { ConsoleHost } from './builtins';
import { ConsoleError, type CommandRegistry } from './registry';
import { closest } from './text';

/** Designer names for fields, as in the bead and the feel review (`ctl.set runSpeed 6`). */
export const CONTROLLER_FIELD_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  runSpeed: 'speeds.run',
  sprintSpeed: 'speeds.sprint',
  crouchSpeed: 'speeds.crouch',
});

/** What the controller commands need beyond the console host. */
export interface ControllerConsoleOptions {
  /** The profile the player's tuning came from (content `controller`, `player`): its id, name… */
  readonly profile: Frozen<ControllerDef>;
  /** `entity`'s current controller tuning (its CharacterTuning), or undefined without one. */
  readonly tuning: (entity: EntityId) => Frozen<ControllerTuning> | undefined;
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Every value of `tuning` that is not an object, by dotted path, in profile order. */
export function controllerFields(tuning: unknown, prefix = ''): [string, unknown][] {
  if (!isRecord(tuning)) return [];
  return Object.entries(tuning).flatMap(([key, value]): [string, unknown][] =>
    isRecord(value) ? controllerFields(value, `${prefix}${key}.`) : [[`${prefix}${key}`, value]],
  );
}

/** `value` with the field at `path` replaced (copies along the path). */
function withField(value: unknown, path: readonly string[], field: number): unknown {
  const [key, ...rest] = path;
  if (key === undefined || !isRecord(value)) return field;
  return { ...value, [key]: withField(value[key], rest, field) };
}

const show = (value: unknown): string => JSON.stringify(value);

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

/** Registers `ctl.get`, `ctl.set` and `ctl.dump` on `registry`. */
export function registerControllerCommands(
  registry: CommandRegistry<ConsoleHost>,
  options: ControllerConsoleOptions,
): void {
  const current = (host: ConsoleHost): { entity: EntityId; tuning: Frozen<ControllerTuning> } => {
    const entity = host.player();
    const tuning = entity === undefined ? undefined : options.tuning(entity);
    if (entity === undefined || tuning === undefined) {
      throw new ConsoleError(['no player with controller tuning in this scene']);
    }
    return { entity, tuning };
  };

  /** The dotted path `name` stands for, checked against `tuning`'s fields. */
  const resolve = (name: string, tuning: Frozen<ControllerTuning>): string => {
    const path = CONTROLLER_FIELD_ALIASES[name] ?? name;
    const fields = controllerFields(tuning).map(([field]) => field);
    if (fields.includes(path)) return path;
    const known = [...Object.keys(CONTROLLER_FIELD_ALIASES), ...fields];
    throw new ConsoleError([
      `unknown controller field "${name}"; closest: ${closest(name, known).join(', ')}`,
    ]);
  };

  const fieldNames = (host: ConsoleHost): readonly string[] => {
    const entity = host.player();
    const tuning = entity === undefined ? undefined : options.tuning(entity);
    return [
      ...Object.keys(CONTROLLER_FIELD_ALIASES),
      ...controllerFields(tuning).map(([field]) => field),
    ];
  };

  registry.registerCommand({
    name: 'ctl.get',
    summary: 'print the player’s controller values, or one of them (e.g. ctl.get runSpeed)',
    usage: '[field]',
    args: z.tuple([z.string().optional()]),
    complete: (index, host) => (index === 0 ? fieldNames(host) : []),
    run: ([name], host) => {
      const { tuning } = current(host);
      const fields = controllerFields(tuning);
      if (name === undefined) return fields.map(([path, value]) => `${path} = ${show(value)}`);
      const path = resolve(name, tuning);
      const value = fields.find(([field]) => field === path)?.[1];
      return `${path} = ${show(value)}`;
    },
  });

  registry.registerCommand({
    name: 'ctl.set',
    summary:
      'change one of the player’s controller values from the next tick (e.g. ctl.set runSpeed 6)',
    usage: '<field> <value>',
    args: z.tuple([
      z.string(),
      z.coerce.number<string>().refine(Number.isFinite, 'expected a finite number'),
    ]),
    complete: (index, host) => (index === 0 ? fieldNames(host) : []),
    run: ([name, value], host) => {
      const { entity, tuning } = current(host);
      const path = resolve(name, tuning);
      const before = controllerFields(tuning).find(([field]) => field === path)?.[1];
      if (typeof before !== 'number') {
        throw new ConsoleError([`${path} is ${show(before)}, not a number: edit it in the file`]);
      }
      const changed = controllerTuningSchema.safeParse(withField(tuning, path.split('.'), value));
      if (!changed.success) {
        throw new ConsoleError(
          changed.error.issues.map((issue) => `${dottedPath(issue.path)}: ${issue.message}`),
        );
      }
      host.submit(tuneCommand(entity, deepFreeze(changed.data)));
      return `${path} = ${show(value)} (was ${show(before)})`;
    },
  });

  registry.registerCommand({
    name: 'ctl.dump',
    summary: `print the player’s controller profile with its live values, as src/content/data/controller/${options.profile.id}.json`,
    usage: '',
    args: z.tuple([]),
    run: (_args, host) => {
      const { tuning } = current(host);
      const { profile } = options;
      const entry = {
        id: profile.id,
        name: profile.name,
        notes: profile.notes,
        ...tuningOf(tuning),
        ...(profile.classes !== undefined && { classes: profile.classes }),
      };
      // The live values may no longer suit a class override (a run below the thief's crouch).
      const checked = controllerSchema.safeParse(entry);
      if (!checked.success) {
        throw new ConsoleError(
          checked.error.issues.map((issue) => `${dottedPath(issue.path)}: ${issue.message}`),
        );
      }
      const file = { $schema: '../controller.schema.json', ...entry };
      return JSON.stringify(file, null, 2).split('\n');
    },
  });
}
