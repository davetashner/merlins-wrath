// The combat sandbox's console commands (mw-e04.9): `attacker` retunes every attacker dummy's
// metronome (its move, how often, parryable, unblockable, on or off) and `dummies` switches the
// training dummies' infinite health; both go to the sim as SandboxCommands (applied next tick,
// recorded in replays). New dummies come from the built-in `spawn` with options
// (`spawn dummy --poise 60 --resist slash=0.5`); `dummies` with no options lists them.

import {
  ATTACKER_OPTIONS,
  ATTACKER_SPAWNABLE,
  DUMMIES_COMMAND_OPTIONS,
  DUMMY_OPTIONS,
  DUMMY_SPAWNABLE,
  sandboxCommand,
  type SandboxCommand,
} from '@sim/index';
import { z } from 'zod';
import { parsedOptions, type ConsoleHost } from './builtins';
import { ConsoleError, type CommandRegistry } from './registry';

/** Checks a sandbox command's options (the sim's checkSandboxCommand): the problem, or undefined. */
export type SandboxCommandCheck = (command: SandboxCommand) => string | undefined;

const syntax = (options: Readonly<Record<string, string>>): string =>
  Object.entries(options)
    .map(([name, value]) => `[--${name} ${value}]`)
    .join(' ');

/** How to spawn and retune the sandbox's dummies (the `dummies` command with no options). */
export const SANDBOX_HELP: readonly string[] = [
  `spawn ${DUMMY_SPAWNABLE} [count] ${syntax(DUMMY_OPTIONS)}`,
  `spawn ${ATTACKER_SPAWNABLE} [count] ${syntax(DUMMY_OPTIONS)} ${syntax(ATTACKER_OPTIONS)}`,
  `attacker [on|off] ${syntax(ATTACKER_OPTIONS)}`,
  `dummies ${syntax(DUMMIES_COMMAND_OPTIONS)}`,
  'e.g. spawn dummy --poise 60 --resist slash=0.5 · attacker --every 1.5 --unblockable on',
];

function submit(host: ConsoleHost, check: SandboxCommandCheck, command: SandboxCommand): string {
  const problem = check(command);
  if (problem !== undefined) throw new ConsoleError([problem]);
  host.submit(command);
  const said = Object.entries(command.params).map(([name, value]) => `--${name} ${value}`);
  return [command.op, ...said].join(' ');
}

/** Registers `attacker` and `dummies` on `registry`. */
export function registerSandboxCommands(
  registry: CommandRegistry<ConsoleHost>,
  check: SandboxCommandCheck,
): void {
  const flags = (options: Readonly<Record<string, string>>) =>
    Object.keys(options).map((name) => `--${name}`);

  registry.registerCommand({
    name: 'attacker',
    summary: 'retune every attacker dummy: its move, how often it swings, parry/block toggles',
    usage: `[on|off] ${syntax(ATTACKER_OPTIONS)}`,
    args: z.array(z.string()),
    complete: () => ['on', 'off', ...flags(ATTACKER_OPTIONS)],
    run: (tokens, host) => {
      const { words, options } = parsedOptions(tokens);
      const [state, ...extra] = words;
      if (extra.length > 0 || (state !== undefined && state !== 'on' && state !== 'off')) {
        throw new ConsoleError([`usage: attacker [on|off] ${syntax(ATTACKER_OPTIONS)}`]);
      }
      const params = state === undefined ? options : { ...options, enabled: state };
      return submit(host, check, sandboxCommand('attackers', params));
    },
  });

  registry.registerCommand({
    name: 'dummies',
    summary: 'switch the dummies’ infinite health; with no options, how to spawn and tune dummies',
    usage: syntax(DUMMIES_COMMAND_OPTIONS),
    args: z.array(z.string()),
    complete: () => flags(DUMMIES_COMMAND_OPTIONS),
    run: (tokens, host) => {
      const { words, options } = parsedOptions(tokens);
      if (words.length > 0)
        throw new ConsoleError([`usage: dummies ${syntax(DUMMIES_COMMAND_OPTIONS)}`]);
      if (Object.keys(options).length === 0) return SANDBOX_HELP;
      return submit(host, check, sandboxCommand('dummies', options));
    },
  });
}
