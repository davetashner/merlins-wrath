// The debug console's entry point (mw-e33.1), loaded by src/main.ts with a dynamic import only when
// the console is enabled (see src/game/debug-console-gate.ts), so none of it is in the main bundle.

import { ConsoleHistory, type HistoryStorage } from './history';
import { registerBuiltins, type ConsoleHost } from './builtins';
import { createGameHost, type GameHostOptions } from './host';
import { CommandRegistry } from './registry';
import { registerSandboxCommands, type SandboxCommandCheck } from './sandbox';
import { mountConsoleView, type ConsoleDom, type ConsoleView } from './view';

export interface DebugConsoleOptions extends GameHostOptions {
  readonly dom: ConsoleDom;
  /** Persists the command history (localStorage); omitted or failing = this session only. */
  readonly storage?: HistoryStorage;
  /** Called after the console opens or closes (the game hands keyboard and mouse over). */
  readonly onToggle?: (open: boolean) => void;
  /** The combat sandbox's command check: adds `attacker` and `dummies` (mw-e04.9). */
  readonly sandbox?: SandboxCommandCheck;
}

export interface DebugConsole {
  readonly view: ConsoleView;
  /** Register domain commands here (items, quests, AI…). */
  readonly registry: CommandRegistry<ConsoleHost>;
}

/** Mounts the console (closed) with the built-in commands. */
export function startDebugConsole(options: DebugConsoleOptions): DebugConsole {
  const registry = new CommandRegistry<ConsoleHost>(createGameHost(options));
  registerBuiltins(registry);
  if (options.sandbox !== undefined) registerSandboxCommands(registry, options.sandbox);
  const view = mountConsoleView({
    dom: options.dom,
    commands: registry,
    history: new ConsoleHistory(options.storage),
    ...(options.onToggle && { onToggle: options.onToggle }),
  });
  return { view, registry };
}

export { unboundDebugSpawns } from './host';
