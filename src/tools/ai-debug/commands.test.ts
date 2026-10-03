import { registerSceneComponents, World } from '@sim/index';
import { describe, expect, it, vi } from 'vitest';
import type { ConsoleHost } from '../console/builtins';
import { createGameHost } from '../console/host';
import { CommandRegistry } from '../console/registry';
import { registerAiDebugCommands } from './commands';
import { AiDebug } from './controller';
import type { Ray } from './model';

function session(crosshair?: Ray) {
  const world = registerSceneComponents(new World<never>({ seed: 1 }));
  const registry = new CommandRegistry<ConsoleHost>(
    createGameHost({
      world,
      submit: () => undefined,
      player: () => undefined,
      spawnables: [],
      bookmarks: () => new Map(),
      scenes: [],
      loadScene: () => undefined,
      loop: { timeScale: 1 },
    }),
  );
  const loop = { stepOnce: vi.fn() };
  const debug = new AiDebug({ world, loop });
  const pick = vi.spyOn(debug, 'pick');
  registerAiDebugCommands(registry, {
    debug,
    crosshair: () => crosshair,
    isAlive: (entity) => entity === 5,
  });
  return { registry, debug, loop, pick };
}

describe('AI debug console commands (mw-e11.17)', () => {
  it('ai.debug on|off switches the overlay; with no argument it reports', () => {
    const { registry, debug } = session();
    expect(registry.execute('ai.debug').lines).toEqual(['ai.debug off · selected none · running']);
    expect(registry.execute('ai.debug on')).toEqual({
      ok: true,
      lines: ['ai.debug on · selected none · running'],
    });
    expect(debug.enabled).toBe(true);
    registry.execute('ai.debug off');
    expect(debug.enabled).toBe(false);
    expect(registry.execute('ai.debug sideways').ok).toBe(false);
    expect(registry.execute('ai.debug on 3').ok).toBe(false);
  });

  it('ai.debug select <id> selects a live entity and turns the overlay on; none clears', () => {
    const { registry, debug } = session();
    expect(registry.execute('ai.debug select 5').lines).toEqual([
      'ai.debug on · selected #5 · running',
    ]);
    expect(debug.selected).toBe(5);
    expect(registry.execute('ai.debug select 6')).toEqual({ ok: false, lines: ['no entity 6'] });
    expect(registry.execute('ai.debug select x').ok).toBe(false);
    expect(registry.execute('ai.debug select -1').ok).toBe(false);
    registry.execute('ai.debug select none');
    expect(debug.selected).toBeUndefined();
  });

  it('ai.debug select with no id picks the agent under the crosshair', () => {
    const ray: Ray = { origin: { x: 0, y: 1, z: 0 }, direction: { x: 0, y: 0, z: -1 } };
    const s = session(ray);
    s.pick.mockReturnValueOnce(5);
    expect(s.registry.execute('ai.debug select').ok).toBe(true);
    expect(s.pick).toHaveBeenCalledWith(ray);
    s.pick.mockReturnValueOnce(undefined);
    expect(s.registry.execute('ai.debug select')).toEqual({
      ok: false,
      lines: ['no agent under the crosshair'],
    });
    const blind = session(undefined);
    expect(blind.registry.execute('ai.debug select').ok).toBe(false);
    expect(blind.pick).not.toHaveBeenCalled();
  });

  it('ai.freeze toggles or sets the freeze; ai.step freezes and steps one tick', () => {
    const { registry, debug, loop } = session();
    registry.execute('ai.freeze');
    expect(debug.frozen).toBe(true);
    registry.execute('ai.freeze');
    expect(debug.frozen).toBe(false);
    registry.execute('ai.freeze on');
    expect(debug.frozen).toBe(true);
    expect(registry.execute('ai.freeze off').lines).toEqual([
      'ai.debug off · selected none · running',
    ]);
    expect(registry.execute('ai.step').lines).toEqual(['stepping 1 tick (frozen)']);
    expect(debug.frozen).toBe(true);
    expect(loop.stepOnce).toHaveBeenCalledTimes(1);
  });

  it('completes its arguments', () => {
    const { registry } = session();
    expect(registry.complete('ai.debug s').line).toBe('ai.debug select ');
    expect(registry.complete('ai.debug select n').line).toBe('ai.debug select none ');
    expect(registry.complete('ai.freeze o').options).toEqual(['on', 'off']);
  });
});
