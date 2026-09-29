// Per-tick action sampling (mw-e02.1). The DOM adapter (dom.ts) pushes raw input events into an
// ActionSampler as they arrive; once per fixed sim tick the frame loop calls `sample()`, which
// replays the events queued since the previous tick through the current bindings and returns one
// frozen ActionFrame. Replaying the queue in order is what keeps taps: a key that goes down and up
// between two samples reports pressed and released on the same frame (held false). No DOM here, so
// every rule is unit-tested with plain calls.

import {
  actionButton,
  actionFrame,
  actionVector,
  IDLE_ACTION_FRAME,
  type ActionButton,
  type ActionFrame,
  type ButtonAction,
} from '@sim/index';
import type { CommandSampler } from '../loop';
import {
  actionsByCode,
  BINDABLE_ACTIONS,
  DEFAULT_BINDINGS,
  type BindableAction,
  type Bindings,
  type InputCode,
  type MoveDirection,
} from './bindings';

type RawEvent =
  | { readonly type: 'down'; readonly code: InputCode }
  | { readonly type: 'up'; readonly code: InputCode }
  | { readonly type: 'releaseAll' };

interface Edges {
  pressed: boolean;
  released: boolean;
}

export class ActionSampler {
  #bindings: Bindings;
  #byCode: ReadonlyMap<InputCode, readonly BindableAction[]>;
  /** Codes down as of the last sample. */
  readonly #held = new Set<InputCode>();
  /** Actions held as of the last sample. */
  readonly #actionHeld = new Set<BindableAction>();
  #queue: RawEvent[] = [];
  #lookX = 0;
  #lookY = 0;
  #last: ActionFrame = IDLE_ACTION_FRAME;

  constructor(bindings: Bindings = DEFAULT_BINDINGS) {
    this.#bindings = bindings;
    this.#byCode = actionsByCode(bindings);
  }

  get bindings(): Bindings {
    return this.#bindings;
  }

  /**
   * Swaps the bindings; the next sample maps every code through them. Actions whose codes are still
   * down stay held; ones that lose their key report a release.
   */
  setBindings(bindings: Bindings): void {
    this.#bindings = bindings;
    this.#byCode = actionsByCode(bindings);
  }

  /** Whether `code` is bound to any action (the adapter suppresses the browser default for these). */
  isBound(code: InputCode): boolean {
    return this.#byCode.has(code);
  }

  /** A key or mouse button went down. Auto-repeat is harmless: a held code going down is ignored. */
  down(code: InputCode): void {
    this.#queue.push({ type: 'down', code });
  }

  /** A key or mouse button went up. */
  up(code: InputCode): void {
    this.#queue.push({ type: 'up', code });
  }

  /** Mouse movement in counts (MouseEvent.movementX/Y: x right, y down). Non-finite values are dropped. */
  look(movementX: number, movementY: number): void {
    if (!Number.isFinite(movementX) || !Number.isFinite(movementY)) return;
    this.#lookX += movementX;
    this.#lookY -= movementY;
  }

  /**
   * Input focus is gone (pointer lock lost, window blur): every code goes up and pending look is
   * discarded, so nothing stays stuck. Held actions report a release on the next frame.
   */
  releaseAll(): void {
    this.#queue.push({ type: 'releaseAll' });
    this.#lookX = 0;
    this.#lookY = 0;
  }

  /** The most recent frame (idle before the first sample). */
  get lastFrame(): ActionFrame {
    return this.#last;
  }

  /** Consumes everything since the previous sample into this tick's ActionFrame. */
  sample(): ActionFrame {
    const edges = new Map<BindableAction, Edges>();
    const edgesOf = (action: BindableAction): Edges => {
      let entry = edges.get(action);
      if (!entry) {
        entry = { pressed: false, released: false };
        edges.set(action, entry);
      }
      return entry;
    };
    const held = new Set<BindableAction>(this.#actionHeld);
    // Codes down per action while replaying, counted through the current bindings.
    const count = new Map<BindableAction, number>();
    const bump = (action: BindableAction, delta: number): number => {
      const n = (count.get(action) ?? 0) + delta;
      count.set(action, n);
      return n;
    };
    const press = (action: BindableAction): void => {
      held.add(action);
      edgesOf(action).pressed = true;
    };
    const release = (action: BindableAction): void => {
      held.delete(action);
      edgesOf(action).released = true;
    };
    for (const code of this.#held) {
      for (const action of this.#byCode.get(code) ?? []) bump(action, 1);
    }
    // After a bindings change an action can be held with no key down any more, or the reverse.
    for (const action of BINDABLE_ACTIONS) {
      const down = (count.get(action) ?? 0) > 0;
      if (held.has(action) !== down) {
        if (down) press(action);
        else release(action);
      }
    }

    const goDown = (code: InputCode): void => {
      if (this.#held.has(code)) return;
      this.#held.add(code);
      for (const action of this.#byCode.get(code) ?? []) {
        if (bump(action, 1) === 1) press(action);
      }
    };
    const goUp = (code: InputCode): void => {
      if (!this.#held.delete(code)) return;
      for (const action of this.#byCode.get(code) ?? []) {
        if (bump(action, -1) === 0) release(action);
      }
    };
    for (const event of this.#queue) {
      if (event.type === 'down') goDown(event.code);
      else if (event.type === 'up') goUp(event.code);
      else for (const code of [...this.#held]) goUp(code);
    }
    this.#queue = [];

    this.#actionHeld.clear();
    for (const action of held) this.#actionHeld.add(action);

    const axis = (plus: MoveDirection, minus: MoveDirection): number =>
      (held.has(plus) ? 1 : 0) - (held.has(minus) ? 1 : 0);
    let x = axis('moveRight', 'moveLeft');
    let y = axis('moveForward', 'moveBack');
    if (x !== 0 && y !== 0) {
      x *= Math.SQRT1_2;
      y *= Math.SQRT1_2;
    }
    const look = actionVector(this.#lookX, this.#lookY);
    this.#lookX = 0;
    this.#lookY = 0;

    const button = (action: ButtonAction): ActionButton => {
      const e = edges.get(action);
      return actionButton(e?.pressed ?? false, held.has(action), e?.released ?? false);
    };
    this.#last = actionFrame({ move: actionVector(x, y), look, buttons: button });
    return this.#last;
  }

  /** The frame loop hook: one ActionFrame per tick. */
  readonly sampleCommands: CommandSampler<ActionFrame> = () => [this.sample()];
}
