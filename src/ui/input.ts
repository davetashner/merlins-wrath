// The UI input adapter (mw-e00.23): turns keyboard events and Gamepad API polls into UI intents
// (ui.up/down/left/right/confirm/back/tabPrev/tabNext). It is deliberately separate from the gameplay
// action map (src/game/input, e02-input-actions): menu navigation keys are fixed, so a player who
// remaps gameplay can never lock themselves out of the menus, and src/ui does not depend on the
// gameplay layer. Prompt glyphs for gameplay actions are resolved by the caller from those bindings.
//
// Keyboard: arrows move, Enter/Space confirm, Esc back, Q/E and PageUp/PageDown switch tabs, Tab and
// Shift+Tab step through the focus order. Gamepad (W3C standard mapping): D-pad or left stick move,
// A (Cross) confirm, B (Circle) back, LB/RB switch tabs. A held direction repeats after a delay.
// Every browser dependency is injected, so the rules are unit-tested with plain objects.

/** A UI intent. `next`/`prev` are Tab / Shift+Tab (keyboard only). */
export type UiIntent =
  'up' | 'down' | 'left' | 'right' | 'confirm' | 'back' | 'tabPrev' | 'tabNext' | 'next' | 'prev';

export type Direction = 'up' | 'down' | 'left' | 'right';

export const DIRECTIONS: readonly Direction[] = ['up', 'down', 'left', 'right'];

export function isDirection(intent: UiIntent): intent is Direction {
  return (DIRECTIONS as readonly string[]).includes(intent);
}

/** The device an intent came from. */
export type UiDevice = 'keyboard' | 'gamepad';

/** KeyboardEvent.code → intent. */
export const UI_KEYS: Readonly<Record<string, UiIntent>> = Object.freeze({
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  Enter: 'confirm',
  NumpadEnter: 'confirm',
  Space: 'confirm',
  Escape: 'back',
  KeyQ: 'tabPrev',
  KeyE: 'tabNext',
  PageUp: 'tabPrev',
  PageDown: 'tabNext',
});

/** Standard-mapping button index → intent. */
export const UI_PAD_BUTTONS: Readonly<Record<number, UiIntent>> = Object.freeze({
  0: 'confirm',
  1: 'back',
  4: 'tabPrev',
  5: 'tabNext',
  12: 'up',
  13: 'down',
  14: 'left',
  15: 'right',
});

/** The KeyboardEvent fields the adapter reads. */
export interface KeyLike {
  readonly code: string;
  readonly repeat: boolean;
  readonly shiftKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
}

/**
 * The intent a key press means, or undefined. Browser shortcuts (Ctrl/Alt/Meta held) are never
 * intents; auto-repeat only repeats movement.
 */
export function keyIntent(event: KeyLike): UiIntent | undefined {
  if (event.ctrlKey || event.altKey || event.metaKey) return undefined;
  if (event.code === 'Tab') return event.shiftKey ? 'prev' : 'next';
  const intent = UI_KEYS[event.code];
  if (intent === undefined) return undefined;
  if (event.repeat && !isDirection(intent) && intent !== 'next' && intent !== 'prev') {
    return undefined;
  }
  return intent;
}

/** The parts of the browser's Gamepad the adapter reads. */
export interface UiPadLike {
  readonly connected: boolean;
  readonly mapping: string;
  readonly buttons: readonly { readonly pressed: boolean }[];
  readonly axes: readonly number[];
}

/** Left-stick deflection past this counts as a direction press. */
export const STICK_THRESHOLD = 0.5;

/** Intents held on a pad right now (buttons and left stick). */
export function padIntents(pad: UiPadLike): Set<UiIntent> {
  const held = new Set<UiIntent>();
  pad.buttons.forEach((button, index) => {
    const intent = UI_PAD_BUTTONS[index];
    if (button.pressed && intent !== undefined) held.add(intent);
  });
  const [x = 0, y = 0] = pad.axes;
  if (x <= -STICK_THRESHOLD) held.add('left');
  if (x >= STICK_THRESHOLD) held.add('right');
  if (y <= -STICK_THRESHOLD) held.add('up'); // Gamepad API: y is down-positive
  if (y >= STICK_THRESHOLD) held.add('down');
  return held;
}

export interface RepeatTiming {
  /** A held direction first repeats after this long. */
  readonly delayMs: number;
  /** Then repeats at this interval. */
  readonly intervalMs: number;
}

export const DEFAULT_REPEAT: RepeatTiming = Object.freeze({ delayMs: 400, intervalMs: 120 });

/** Receives intents; returns whether the UI used it (a used key's browser default is suppressed). */
export type IntentSink = (intent: UiIntent, device: UiDevice) => boolean;

export interface UiInputHost {
  /** Where keydown/keyup listeners attach (the browser passes `window`). */
  readonly window: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;
  /** Pad source (the browser passes `navigator`); absent: keyboard only. */
  readonly navigator?: { getGamepads(): readonly (UiPadLike | null)[] };
  /** Monotonic milliseconds for pad repeat (the browser passes `() => performance.now()`). */
  readonly now: () => number;
}

interface Hold {
  next: number;
}

/**
 * Feeds UI intents to a sink. Keyboard intents arrive on keydown; the pad is read by `poll()`, which
 * the owner calls once per animation frame. A pad that disconnects (or a Gamepad API that throws)
 * simply reads as no pad: nothing is emitted, nothing throws (mw-e00.23 AC-6).
 */
export class UiInputAdapter {
  readonly #sink: IntentSink;
  readonly #repeat: RepeatTiming;
  #host: UiInputHost | undefined;
  readonly #held = new Map<UiIntent, Hold>();
  #padConnected = false;

  constructor(sink: IntentSink, repeat: RepeatTiming = DEFAULT_REPEAT) {
    this.#sink = sink;
    this.#repeat = repeat;
  }

  /** Whether the last poll found a usable pad. */
  get padConnected(): boolean {
    return this.#padConnected;
  }

  /** Handles one keydown: emits its intent; returns whether the UI used it. */
  keydown(event: KeyLike): boolean {
    const intent = keyIntent(event);
    return intent !== undefined && this.#sink(intent, 'keyboard');
  }

  readonly #onKeyDown = (event: Event): void => {
    if (this.keydown(event as KeyboardEvent)) event.preventDefault();
  };

  /** Starts listening to the host's keyboard; returns a detach function. */
  attach(host: UiInputHost): () => void {
    this.#host = host;
    host.window.addEventListener('keydown', this.#onKeyDown);
    return () => {
      host.window.removeEventListener('keydown', this.#onKeyDown);
      this.#host = undefined;
      this.#held.clear();
    };
  }

  /** Reads the pad once: emits press edges and held-direction repeats. */
  poll(): void {
    const host = this.#host;
    if (host === undefined) return;
    const pad = this.#readPad(host);
    this.#padConnected = pad !== undefined;
    const held = pad === undefined ? new Set<UiIntent>() : padIntents(pad);
    const now = host.now();
    for (const intent of [...this.#held.keys()]) {
      if (!held.has(intent)) this.#held.delete(intent);
    }
    for (const intent of held) {
      const hold = this.#held.get(intent);
      if (hold === undefined) {
        this.#held.set(intent, { next: now + this.#repeat.delayMs });
        this.#sink(intent, 'gamepad');
      } else if (isDirection(intent) && now >= hold.next) {
        hold.next = now + this.#repeat.intervalMs;
        this.#sink(intent, 'gamepad');
      }
    }
  }

  #readPad(host: UiInputHost): UiPadLike | undefined {
    let pads: readonly (UiPadLike | null)[] = [];
    try {
      pads = host.navigator?.getGamepads() ?? [];
    } catch {
      // A permissions policy can forbid the Gamepad API: no pad, then.
    }
    return pads.find(
      (pad): pad is UiPadLike => pad !== null && pad.connected && pad.mapping === 'standard',
    );
  }
}
