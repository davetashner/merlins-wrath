// A fake Gamepad for tests (mw-e02.9): what navigator.getGamepads() returns for a standard-mapping
// pad, built from the buttons held, the trigger pulls and the sticks. Sticks are given as the player
// sees them (y up) and stored as the Gamepad API reports them (y down).

import { PAD_BUTTONS, type GamepadLike, type PadCode } from './gamepad';

export interface FakePadOptions {
  readonly index?: number;
  readonly connected?: boolean;
  readonly mapping?: string;
  /** Buttons held (a held trigger reads fully pulled). */
  readonly pressed?: readonly PadCode[];
  /** Trigger pulls, 0–1. */
  readonly lt?: number;
  readonly rt?: number;
  /** Stick deflections, x right and y up. */
  readonly left?: readonly [number, number];
  readonly right?: readonly [number, number];
}

/** A fake standard-mapping pad. */
export function fakePad(options: FakePadOptions = {}): GamepadLike {
  const { pressed = [], left = [0, 0], right = [0, 0] } = options;
  const pulls: Partial<Record<PadCode, number | undefined>> = {
    PadLT: options.lt,
    PadRT: options.rt,
  };
  return {
    index: options.index ?? 0,
    connected: options.connected ?? true,
    mapping: options.mapping ?? 'standard',
    buttons: PAD_BUTTONS.map((code) => {
      const value = pulls[code] ?? (pressed.includes(code) ? 1 : 0);
      return { pressed: value > 0.1, value };
    }),
    axes: [left[0], -left[1], right[0], -right[1]],
  };
}
