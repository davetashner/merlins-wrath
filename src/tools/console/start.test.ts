// @vitest-environment happy-dom
import { CommandQueue } from '@game/loop/command-queue';
import { registerSceneComponents, spawnCommand, World } from '@sim/index';
import { UiRoot } from '@ui/index';
import { describe, expect, it, vi } from 'vitest';
import { HISTORY_KEY } from './history';
import { startDebugConsole } from './start';

function start(withToggle: boolean) {
  document.body.innerHTML = '';
  const ui = new UiRoot(document.body, { unstyled: true });
  const queue = new CommandQueue<unknown>();
  const stored = new Map<string, string>();
  const onToggle = vi.fn();
  const console = startDebugConsole({
    world: registerSceneComponents(new World<never>({ seed: 1 })),
    submit: (command) => {
      queue.push(command);
    },
    player: () => undefined,
    spawnables: ['testprop-crate'],
    bookmarks: () => new Map(),
    scenes: ['testbed'],
    loadScene: () => undefined,
    loop: { timeScale: 1 },
    dom: { document, keys: window, screens: ui },
    storage: {
      getItem: (key) => stored.get(key) ?? null,
      setItem: (key, value) => {
        stored.set(key, value);
      },
    },
    ...(withToggle && { onToggle }),
  });
  return { queue, stored, onToggle, console };
}

describe('startDebugConsole', () => {
  it('mounts the console with the built-ins, queuing sim commands and persisting history', () => {
    const s = start(true);
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Backquote', cancelable: true }));
    expect(s.onToggle).toHaveBeenCalledWith(true);
    const input = document.activeElement as HTMLInputElement;
    expect(input.dataset['testid']).toBe('debug-console-input');
    input.value = 'spawn testprop-crate 2';
    input.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter', bubbles: true }));
    expect(s.queue.drain()).toEqual([spawnCommand('testprop-crate', 2, { x: 0, y: 0, z: 0 })]);
    expect(JSON.parse(s.stored.get(HISTORY_KEY) ?? '[]')).toEqual(['spawn testprop-crate 2']);
    expect(s.console.registry.get('help')).toBeDefined();
  });

  it('adds the sandbox commands when given the sandbox check (mw-e04.9)', () => {
    const plain = start(false);
    expect(plain.console.registry.get('attacker')).toBeUndefined();
    document.body.innerHTML = '';
    const ui = new UiRoot(document.body, { unstyled: true });
    const sandbox = startDebugConsole({
      world: registerSceneComponents(new World<never>({ seed: 1 })),
      submit: () => undefined,
      player: () => undefined,
      spawnables: [],
      bookmarks: () => new Map(),
      scenes: [],
      loadScene: () => undefined,
      loop: { timeScale: 1 },
      dom: { document, keys: window, screens: ui },
      sandbox: () => undefined,
    });
    expect(sandbox.registry.get('attacker')).toBeDefined();
    expect(sandbox.registry.get('dummies')).toBeDefined();
  });

  it('works without a toggle callback', () => {
    const s = start(false);
    s.console.view.open();
    expect(s.console.view.isOpen).toBe(true);
  });
});
