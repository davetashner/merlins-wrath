import { CommandQueue } from '@game/loop/command-queue';
import { registerSceneComponents, sandboxCommand, World, type SandboxCommand } from '@sim/index';
import { describe, expect, it } from 'vitest';
import { registerBuiltins, type ConsoleHost } from './builtins';
import { createGameHost } from './host';
import { CommandRegistry } from './registry';
import { registerSandboxCommands, SANDBOX_HELP } from './sandbox';

function session() {
  const queue = new CommandQueue<unknown>();
  const host = createGameHost({
    world: registerSceneComponents(new World<never>({ seed: 1 })),
    submit: (command) => {
      queue.push(command);
    },
    player: () => undefined,
    spawnables: ['dummy'],
    bookmarks: () => new Map(),
    scenes: [],
    loadScene: () => undefined,
    loop: { timeScale: 1 },
  });
  const registry = new CommandRegistry<ConsoleHost>(host);
  registerBuiltins(registry);
  const checked: SandboxCommand[] = [];
  registerSandboxCommands(registry, (command) => {
    checked.push(command);
    return command.params['every'] === 'soon' ? '--every must be a number' : undefined;
  });
  return { queue, registry, checked };
}

describe('sandbox console commands (mw-e04.9)', () => {
  it('attacker retunes every attacker dummy through a sandbox command', () => {
    const s = session();
    expect(s.registry.execute('attacker --every 1.5 --unblockable on')).toEqual({
      ok: true,
      lines: ['attackers --every 1.5 --unblockable on'],
    });
    expect(s.registry.execute('attacker off').lines).toEqual(['attackers --enabled off']);
    expect(s.registry.execute('attacker on --move sword-light-1').lines).toEqual([
      'attackers --move sword-light-1 --enabled on',
    ]);
    expect(s.queue.drain()).toEqual([
      sandboxCommand('attackers', { every: '1.5', unblockable: 'on' }),
      sandboxCommand('attackers', { enabled: 'off' }),
      sandboxCommand('attackers', { move: 'sword-light-1', enabled: 'on' }),
    ]);
  });

  it('attacker reports bad options and words without queuing anything', () => {
    const s = session();
    expect(s.registry.execute('attacker --every soon')).toEqual({
      ok: false,
      lines: ['--every must be a number'],
    });
    expect(s.registry.execute('attacker maybe').lines[0]).toMatch(/^usage: attacker \[on\|off\]/);
    expect(s.registry.execute('attacker on off').ok).toBe(false);
    expect(s.registry.execute('attacker --every').lines).toEqual(['option --every needs a value']);
    expect(s.queue.size).toBe(0);
  });

  it('dummies switches infinite health, and without options explains how to spawn and tune', () => {
    const s = session();
    expect(s.registry.execute('dummies --infinite off').lines).toEqual(['dummies --infinite off']);
    expect(s.queue.drain()).toEqual([sandboxCommand('dummies', { infinite: 'off' })]);
    const help = s.registry.execute('dummies');
    expect(help).toEqual({ ok: true, lines: SANDBOX_HELP });
    expect(SANDBOX_HELP[0]).toBe(
      'spawn dummy [count] [--health <points>] [--poise <points>] [--resist <type=multiplier,…>] [--regions <head,torso,limb,weakpoint>] [--infinite <on|off>]',
    );
    expect(s.registry.execute('dummies all').ok).toBe(false);
    expect(s.queue.size).toBe(0);
  });

  it('completes states and options', () => {
    const s = session();
    expect(s.registry.complete('attacker --un').line).toBe('attacker --unblockable ');
    expect(s.registry.complete('dummies --i').line).toBe('dummies --infinite ');
    expect(s.registry.complete('attacker o').options).toEqual(['on', 'off']);
  });
});
