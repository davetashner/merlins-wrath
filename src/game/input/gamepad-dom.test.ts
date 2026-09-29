import { describe, expect, it, vi } from 'vitest';
import { attachGamepadInput, type GamepadHost } from './gamepad-dom';
import { fakePad } from './fake-gamepad';
import type { GamepadLike } from './gamepad';
import { ActionSampler } from './sampler';

/** A fake navigator whose pads the test swaps between samples, and a focus flag. */
function fakeHost() {
  let pads: (GamepadLike | null)[] = [];
  let focused = true;
  const host = {
    navigator: { getGamepads: vi.fn(() => pads) },
    hasFocus: () => focused,
    onConnect: vi.fn(),
    onDisconnect: vi.fn(),
  } satisfies GamepadHost;
  return {
    host,
    plug: (...next: (GamepadLike | null)[]) => {
      pads = next;
    },
    focus: (value: boolean) => {
      focused = value;
    },
  };
}

describe('attachGamepadInput (mw-e02.9)', () => {
  it('polls the pad once per sample, with no pointer lock needed', () => {
    const { host, plug } = fakeHost();
    const sampler = new ActionSampler();
    const input = attachGamepadInput(sampler, host);
    expect(sampler.sample().jump.held).toBe(false);
    expect(host.navigator.getGamepads).toHaveBeenCalledTimes(1);
    const pad = fakePad({ pressed: ['PadA'], left: [0, 1] });
    plug(null, pad);
    const frame = sampler.sample();
    expect(frame.jump.pressed).toBe(true);
    expect(frame.move).toEqual({ x: 0, y: 1 });
    expect(host.navigator.getGamepads).toHaveBeenCalledTimes(2);
    expect(input.index).toBe(0);
    expect(host.onConnect).toHaveBeenCalledWith(pad);
    sampler.sample();
    expect(host.onConnect).toHaveBeenCalledTimes(1);
  });

  it('AC-4: the pad unplugging mid-sprint releases its actions, taps pause and tells the UI', () => {
    const { host, plug } = fakeHost();
    const sampler = new ActionSampler();
    attachGamepadInput(sampler, host);
    plug(fakePad({ pressed: ['PadLS'], left: [0, 1] }));
    expect(sampler.sample().sprint.held).toBe(true);
    plug(fakePad({ left: [0, 1] }));
    expect(sampler.sample().sprint.held).toBe(true);
    plug(fakePad({ left: [0, 1], connected: false }));
    const gone = sampler.sample();
    expect(gone.sprint).toEqual({ pressed: false, held: false, released: true });
    expect(gone.move).toEqual({ x: 0, y: 0 });
    expect(gone.pause).toEqual({ pressed: true, held: false, released: true });
    expect(host.onDisconnect).toHaveBeenCalledTimes(1);
    plug();
    expect(sampler.sample().pause.pressed).toBe(false);
    expect(host.onDisconnect).toHaveBeenCalledTimes(1);
  });

  it('another pad taking over counts as a disconnect of the first', () => {
    const { host, plug } = fakeHost();
    const sampler = new ActionSampler();
    const input = attachGamepadInput(sampler, host);
    plug(fakePad({ index: 0 }), fakePad({ index: 1 }));
    sampler.sample();
    plug(null, fakePad({ index: 1, pressed: ['PadX'] }));
    const frame = sampler.sample();
    expect(host.onDisconnect).toHaveBeenCalledTimes(1);
    expect(input.index).toBe(1);
    expect(frame.pause.pressed).toBe(true);
    expect(frame.interact.pressed).toBe(true);
  });

  it('without page focus, or while disabled, the pad reads idle but stays connected', () => {
    const { host, plug, focus } = fakeHost();
    const sampler = new ActionSampler();
    const input = attachGamepadInput(sampler, host);
    plug(fakePad({ pressed: ['PadA'] }));
    expect(sampler.sample().jump.held).toBe(true);
    focus(false);
    const blurred = sampler.sample();
    expect(blurred.jump.released).toBe(true);
    expect(blurred.pause.pressed).toBe(false);
    focus(true);
    expect(sampler.sample().jump.pressed).toBe(true);
    input.enabled = false;
    expect(input.enabled).toBe(false);
    expect(sampler.sample().jump.released).toBe(true);
    input.enabled = true;
    expect(sampler.sample().jump.pressed).toBe(true);
    expect(host.onDisconnect).not.toHaveBeenCalled();
  });

  it('a Gamepad API that throws (permissions policy) means no pad', () => {
    const sampler = new ActionSampler();
    attachGamepadInput(sampler, {
      navigator: {
        getGamepads: () => {
          throw new Error('blocked');
        },
      },
      hasFocus: () => true,
    });
    expect(sampler.sample().jump.held).toBe(false);
  });

  it('detach stops polling and lets go of the pad', () => {
    const { host, plug } = fakeHost();
    const sampler = new ActionSampler();
    const input = attachGamepadInput(sampler, host);
    plug(fakePad({ pressed: ['PadA'] }));
    sampler.sample();
    input.detach();
    const frame = sampler.sample();
    expect(frame.jump.released).toBe(true);
    expect(frame.pause.pressed).toBe(false);
    expect(input.index).toBeUndefined();
    expect(host.navigator.getGamepads).toHaveBeenCalledTimes(1);
    input.detach(); // twice is harmless
  });
});
