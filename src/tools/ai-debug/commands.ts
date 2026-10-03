// The AI debug overlay's console commands (mw-e11.17):
//   ai.debug [on|off]        show or switch the overlay
//   ai.debug select [id]     select an agent by entity id (its label shows everything); with no id,
//                            the agent under the crosshair; turns the overlay on
//   ai.debug select none     clear the selection
//   ai.freeze [on|off]       hold the sim (toggles without an argument)
//   ai.step                  freeze and advance exactly one tick
// None of them changes sim state: the overlay reads introspection snapshots and freezing only stops
// the frame loop stepping the sim.

import type { EntityId } from '@sim/index';
import { z } from 'zod';
import type { ConsoleHost } from '../console/builtins';
import { ConsoleError, type CommandRegistry } from '../console/registry';
import type { AiDebug } from './controller';
import type { Ray } from './model';

export interface AiDebugCommandOptions {
  readonly debug: AiDebug;
  /** The ray through the crosshair, for `ai.debug select` with no id. */
  readonly crosshair: () => Ray | undefined;
  /** Whether `entity` is alive. */
  readonly isAlive: (entity: EntityId) => boolean;
}

const DEBUG_USAGE = '[on|off] | select [<entityId>|none]';

/** Registers `ai.debug`, `ai.freeze` and `ai.step` on `registry`. */
export function registerAiDebugCommands(
  registry: CommandRegistry<ConsoleHost>,
  { debug, crosshair, isAlive }: AiDebugCommandOptions,
): void {
  const describe = (): string => {
    const selected = debug.selected === undefined ? 'none' : `#${String(debug.selected)}`;
    return `ai.debug ${debug.enabled ? 'on' : 'off'} · selected ${selected} · ${debug.frozen ? 'frozen' : 'running'}`;
  };

  registry.registerCommand({
    name: 'ai.debug',
    summary: 'AI debug overlay: senses, states, awareness, LKP and paths; select an agent',
    usage: DEBUG_USAGE,
    args: z.array(z.string()).max(2),
    complete: (index) => (index === 0 ? ['on', 'off', 'select'] : ['none']),
    run: ([word, id]) => {
      if (word === undefined) return describe();
      if ((word === 'on' || word === 'off') && id === undefined) {
        debug.enabled = word === 'on';
        return describe();
      }
      if (word !== 'select') throw new ConsoleError([`usage: ai.debug ${DEBUG_USAGE}`]);
      if (id === 'none') {
        debug.selected = undefined;
        return describe();
      }
      debug.enabled = true;
      if (id === undefined) {
        const ray = crosshair();
        const picked = ray === undefined ? undefined : debug.pick(ray);
        if (picked === undefined) throw new ConsoleError(['no agent under the crosshair']);
        return describe();
      }
      const entity = Number(id);
      if (!Number.isInteger(entity) || entity < 0 || !isAlive(entity)) {
        throw new ConsoleError([`no entity ${id}`]);
      }
      debug.selected = entity;
      return describe();
    },
  });

  registry.registerCommand({
    name: 'ai.freeze',
    summary: 'hold the sim for the AI overlay (toggles; ai.step advances one tick)',
    usage: '[on|off]',
    args: z.tuple([z.enum(['on', 'off']).optional()]),
    complete: () => ['on', 'off'],
    run: ([state]) => {
      debug.frozen = state === undefined ? !debug.frozen : state === 'on';
      return describe();
    },
  });

  registry.registerCommand({
    name: 'ai.step',
    summary: 'freeze the sim and advance exactly one tick',
    usage: '',
    args: z.tuple([]),
    run: () => {
      debug.step();
      return 'stepping 1 tick (frozen)';
    },
  });
}
