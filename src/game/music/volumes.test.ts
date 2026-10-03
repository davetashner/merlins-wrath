import { describe, expect, it, vi } from 'vitest';
import { bindVolumes, VOLUME_RAMP_S, type VolumeKey } from './volumes.ts';

function setup(state = 'suspended') {
  const values: Record<VolumeKey, number> = {
    'audio.master': 0.8,
    'audio.music': 0.5,
    'audio.sfx': 0.25,
  };
  const listeners = new Map<VolumeKey, (value: number) => void>();
  const setBusGain = vi.fn();
  let current = state;
  const binding = bindVolumes(
    {
      get context() {
        return current === 'none' ? undefined : { state: current };
      },
      setBusGain,
    },
    {
      get: (key) => values[key],
      on: (key, listener) => {
        listeners.set(key, listener);
        return () => listeners.delete(key);
      },
    },
  );
  return { binding, setBusGain, listeners, run: () => (current = 'running') };
}

describe('bindVolumes (mw-0j5)', () => {
  it('AC-1: nothing touches the buses until the context is running', () => {
    const t = setup();
    t.binding.update();
    t.listeners.get('audio.music')?.(0.1);
    expect(t.setBusGain).not.toHaveBeenCalled();
  });

  it('AC-1: with no context nothing is applied', () => {
    const t = setup('none');
    t.binding.update();
    expect(t.setBusGain).not.toHaveBeenCalled();
  });

  it('AC-2: once running, master, music (with ambience) and effects are applied once', () => {
    const t = setup();
    t.run();
    t.binding.update();
    t.binding.update();
    expect(t.setBusGain.mock.calls).toEqual([
      ['master', 0.8, 0],
      ['music', 0.5, 0],
      ['ambience', 0.5, 0],
      ['sfx', 0.25, 0],
    ]);
  });

  it('AC-3: a slider change after that ramps the matching buses', () => {
    const t = setup();
    t.run();
    t.binding.update();
    t.setBusGain.mockClear();
    t.listeners.get('audio.music')?.(0.2);
    expect(t.setBusGain.mock.calls).toEqual([
      ['music', 0.2, VOLUME_RAMP_S],
      ['ambience', 0.2, VOLUME_RAMP_S],
    ]);
  });

  it('AC-4: dispose unsubscribes the listeners', () => {
    const t = setup();
    t.binding.dispose();
    expect(t.listeners.size).toBe(0);
  });
});
