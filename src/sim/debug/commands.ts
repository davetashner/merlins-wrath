// Debug commands (mw-e33.1): how the in-game debug console (src/tools/console) spawns, teleports and
// cheats. A command is plain JSON fed to `World.step` among that tick's inputs, exactly like an
// ActionFrame or a fact command, so the replay recorder captures it and a replay reproduces the
// cheat on the same tick. The console never touches sim state itself; `debugCommandSystem` applies
// these inside the tick. Builders validate at the call site so a bad value fails where it is typed,
// not deep inside a tick.

import type { EntityId } from '../core/component';
import type { Vec3 } from '../stimulus/shapes';

/** The `kind` tag of a debug command. */
export const DEBUG_COMMAND = 'sim.debug' as const;

/** The toggleable cheats. */
export const DEBUG_CHEATS = ['god', 'noclip'] as const;

export type DebugCheat = (typeof DEBUG_CHEATS)[number];

/** Most entities one spawn command may create. */
export const MAX_SPAWN_COUNT = 100;

/** Spawns `count` of a spawnable content id, the first at `at`, the rest in a row along +x. */
export interface SpawnCommand {
  readonly kind: typeof DEBUG_COMMAND;
  readonly op: 'spawn';
  /** A spawnable id such as `testprop-crate` (see `testPropSpawners`). */
  readonly content: string;
  readonly count: number;
  readonly at: Vec3;
}

/** Turns a cheat on or off for one entity. */
export interface CheatCommand {
  readonly kind: typeof DEBUG_COMMAND;
  readonly op: 'cheat';
  readonly target: EntityId;
  readonly cheat: DebugCheat;
  readonly on: boolean;
}

/** Moves an entity (a character's feet, or a placed object) to `to`, at rest. */
export interface TeleportCommand {
  readonly kind: typeof DEBUG_COMMAND;
  readonly op: 'teleport';
  readonly target: EntityId;
  readonly to: Vec3;
}

/** Kills a combatant (health to 0, Died emitted), or removes an entity that has no health. */
export interface KillCommand {
  readonly kind: typeof DEBUG_COMMAND;
  readonly op: 'kill';
  readonly target: EntityId;
}

export type DebugCommand = SpawnCommand | CheatCommand | TeleportCommand | KillCommand;

/** A finite position with -0 folded to 0 (replays reject -0). */
function position(what: string, v: Vec3): Vec3 {
  for (const axis of [v.x, v.y, v.z]) {
    if (!Number.isFinite(axis)) throw new RangeError(`${what} must be finite, got ${String(axis)}`);
  }
  return { x: v.x + 0, y: v.y + 0, z: v.z + 0 };
}

function entity(target: EntityId): EntityId {
  if (!Number.isSafeInteger(target) || target < 1) {
    throw new RangeError(`target must be an entity id, got ${String(target)}`);
  }
  return target;
}

/**
 * A spawn command.
 * @throws RangeError for an empty id, a count outside 1–MAX_SPAWN_COUNT or a non-finite position.
 */
export function spawnCommand(content: string, count: number, at: Vec3): SpawnCommand {
  if (content === '') throw new RangeError('spawn needs a content id');
  if (!Number.isInteger(count) || count < 1 || count > MAX_SPAWN_COUNT) {
    throw new RangeError(`spawn count must be 1–${String(MAX_SPAWN_COUNT)}, got ${String(count)}`);
  }
  return { kind: DEBUG_COMMAND, op: 'spawn', content, count, at: position('spawn position', at) };
}

/** A cheat toggle. @throws RangeError for an invalid target or cheat. */
export function cheatCommand(target: EntityId, cheat: DebugCheat, on: boolean): CheatCommand {
  if (!DEBUG_CHEATS.includes(cheat)) throw new RangeError(`unknown cheat "${cheat}"`);
  return { kind: DEBUG_COMMAND, op: 'cheat', target: entity(target), cheat, on };
}

/** A teleport. @throws RangeError for an invalid target or a non-finite destination. */
export function teleportCommand(target: EntityId, to: Vec3): TeleportCommand {
  return {
    kind: DEBUG_COMMAND,
    op: 'teleport',
    target: entity(target),
    to: position('teleport destination', to),
  };
}

/** A kill. @throws RangeError for an invalid target. */
export function killCommand(target: EntityId): KillCommand {
  return { kind: DEBUG_COMMAND, op: 'kill', target: entity(target) };
}

/** True for a DebugCommand among arbitrary step inputs. */
export function isDebugCommand(input: unknown): input is DebugCommand {
  return (
    typeof input === 'object' &&
    input !== null &&
    (input as { kind?: unknown }).kind === DEBUG_COMMAND
  );
}
