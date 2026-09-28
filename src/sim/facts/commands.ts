// Fact commands (mw-e27.1): the way code outside the sim — the debug console (mw-e27.6), tools,
// scripted tests — changes world facts mid-game. A command is plain JSON fed to `World.step` among
// that tick's inputs, so the replay recorder captures it and replays reproduce the change on the
// same tick; a `world.facts.set` called between ticks would sit outside the recorded input stream.
// Systems inside a tick write `world.facts` directly.

import type { FactStore, FactValue } from './store';
import { FactKeyError, isFactKey } from './store';

/** The `kind` tag of a fact command. */
export const FACT_COMMAND = 'sim.fact' as const;

/** Sets facts at the start of a tick, before any system runs; all or nothing. */
export interface FactCommand {
  readonly kind: typeof FACT_COMMAND;
  /** Fact key → new value. */
  readonly set: Readonly<Record<string, FactValue>>;
}

const isPrimitive = (value: unknown): value is FactValue =>
  typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string';

/**
 * Builds a fact command, checking keys and value kinds now so a typo fails at the call site. Value
 * types are checked against the store when the command runs.
 * @throws FactKeyError for a malformed key; TypeError for a non-primitive value.
 */
export function factCommand(set: Readonly<Record<string, FactValue>>): FactCommand {
  for (const [key, value] of Object.entries(set)) {
    if (!isFactKey(key)) throw new FactKeyError(key);
    if (!isPrimitive(value)) throw new TypeError(`fact "${key}" value must be a primitive`);
  }
  return { kind: FACT_COMMAND, set: { ...set } };
}

/** True for a FactCommand among arbitrary step inputs. */
export function isFactCommand(input: unknown): input is FactCommand {
  return (
    typeof input === 'object' &&
    input !== null &&
    (input as { kind?: unknown }).kind === FACT_COMMAND
  );
}

/** Code-unit key order (keys are unique), without locale rules. */
const byKey = ([a]: readonly [string, unknown], [b]: readonly [string, unknown]): number =>
  Number(a > b) - Number(a < b);

/**
 * Applies this tick's fact commands in input order (each command's keys in code-unit order) as one
 * transaction: if any write is invalid, none of them happen and the error propagates.
 * @throws FactKeyError / FactTypeError for an invalid write.
 */
export function applyFactCommands(store: FactStore, inputs: readonly unknown[]): void {
  const commands = inputs.filter(isFactCommand);
  if (commands.length === 0) return;
  store.transaction(() => {
    for (const command of commands) {
      const writes = Object.entries(command.set).sort(byKey);
      for (const [key, value] of writes) store.set(key, value);
    }
  });
}
