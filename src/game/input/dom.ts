// The DOM side of input (mw-e02.1): keyboard, mouse button and mouse movement listeners that feed an
// ActionSampler, plus pointer lock. Input only counts while the pointer is locked to the game's
// element; losing the lock (Esc, alt-tab) or window focus releases everything, so no key stays stuck
// and no stale look delta leaks into the next tick. All mapping logic lives in the sampler.

import { mouseCode } from './bindings';
import type { ActionSampler } from './sampler';

/** The window-like target the listeners attach to (keys, mouse, blur). */
export type InputEventTarget = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;

/** The document-like source of pointer lock state. */
export interface PointerLockDocument extends InputEventTarget {
  readonly pointerLockElement: unknown;
}

/** The element the pointer locks to (the game canvas). */
export interface PointerLockElement {
  requestPointerLock(): unknown;
}

export interface DomInputHost {
  readonly window: InputEventTarget;
  readonly document: PointerLockDocument;
  readonly element: PointerLockElement;
}

export interface DomInput {
  /** True while the pointer is locked to the element (input is being captured). */
  readonly locked: boolean;
  /** Asks the browser for pointer lock; call from a user gesture (a click on the canvas). */
  requestPointerLock(): void;
  /** Removes every listener and releases held input. */
  detach(): void;
}

interface KeyLike {
  readonly code: string;
  readonly repeat: boolean;
  preventDefault(): void;
}

interface MouseLike {
  readonly button: number;
  readonly movementX: number;
  readonly movementY: number;
  preventDefault(): void;
}

/** Attaches DOM listeners that feed `sampler`. */
export function attachDomInput(sampler: ActionSampler, host: DomInputHost): DomInput {
  const { window, document, element } = host;
  const isLocked = (): boolean =>
    document.pointerLockElement !== null && document.pointerLockElement === element;
  let locked = isLocked();

  const key = (down: boolean) => (event: Event) => {
    const { code, repeat } = event as unknown as KeyLike;
    if (!locked) return;
    // Bound keys (Tab, Space, arrows…) must not scroll the page or move focus mid-game.
    if (sampler.isBound(code)) (event as unknown as KeyLike).preventDefault();
    if (repeat) return;
    if (down) sampler.down(code);
    else sampler.up(code);
  };
  const button = (down: boolean) => (event: Event) => {
    if (!locked) return;
    const code = mouseCode((event as unknown as MouseLike).button);
    if (down) sampler.down(code);
    else sampler.up(code);
  };
  const onKeyDown = key(true);
  const onKeyUp = key(false);
  const onMouseDown = button(true);
  const onMouseUp = button(false);
  const onMouseMove = (event: Event) => {
    if (!locked) return;
    const { movementX, movementY } = event as unknown as MouseLike;
    sampler.look(movementX, movementY);
  };
  const onContextMenu = (event: Event) => {
    if (locked) event.preventDefault();
  };
  const onBlur = () => {
    sampler.releaseAll();
  };
  const onLockChange = () => {
    locked = isLocked();
    if (!locked) sampler.releaseAll();
  };

  const windowListeners: [string, (event: Event) => void][] = [
    ['keydown', onKeyDown],
    ['keyup', onKeyUp],
    ['mousedown', onMouseDown],
    ['mouseup', onMouseUp],
    ['mousemove', onMouseMove],
    ['contextmenu', onContextMenu],
    ['blur', onBlur],
  ];
  for (const [type, listener] of windowListeners) window.addEventListener(type, listener);
  document.addEventListener('pointerlockchange', onLockChange);

  return {
    get locked() {
      return locked;
    },
    requestPointerLock() {
      if (!locked) void Promise.resolve(element.requestPointerLock()).catch(() => undefined);
    },
    detach() {
      for (const [type, listener] of windowListeners) window.removeEventListener(type, listener);
      document.removeEventListener('pointerlockchange', onLockChange);
      locked = false;
      sampler.releaseAll();
    },
  };
}
