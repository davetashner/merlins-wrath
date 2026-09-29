// Player input capture (mw-e02.23): the DOM input adapter (mw-e02.1) plus click-to-play. A click on
// the game canvas asks for pointer lock; while locked, keys and mouse feed the ActionSampler. The
// debug fly camera (F2) shares WASD, so disabling player input releases the lock (and every held
// action) and stops clicks from taking it again until re-enabled.

import {
  attachDomInput,
  type ActionSampler,
  type DomInput,
  type DomInputHost,
  type InputEventTarget,
  type PointerLockDocument,
  type PointerLockElement,
} from '../input';

export interface PlayerInputHost extends DomInputHost {
  readonly document: PointerLockDocument & { exitPointerLock?(): unknown };
  readonly element: PointerLockElement & InputEventTarget;
}

export interface PlayerInput {
  /** True while the pointer is locked and input reaches the sampler. */
  readonly locked: boolean;
  /** Whether a click captures input. Setting it false releases the lock and held actions. */
  enabled: boolean;
  detach(): void;
}

/** Feeds `sampler` from the page and locks the pointer on a click on `host.element`. */
export function attachPlayerInput(sampler: ActionSampler, host: PlayerInputHost): PlayerInput {
  const dom: DomInput = attachDomInput(sampler, host);
  let enabled = true;
  const onClick = (): void => {
    if (enabled) dom.requestPointerLock();
  };
  host.element.addEventListener('click', onClick);
  return {
    get locked() {
      return dom.locked;
    },
    get enabled() {
      return enabled;
    },
    set enabled(value: boolean) {
      enabled = value;
      if (value) return;
      if (dom.locked) host.document.exitPointerLock?.();
      sampler.releaseAll();
    },
    detach() {
      host.element.removeEventListener('click', onClick);
      dom.detach();
    },
  };
}
