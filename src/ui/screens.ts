// The UI layer and screen stack (mw-e00.23). `UiRoot` renders DOM UI over the canvas: a HUD layer
// (never focusable, pointer events pass through to the game) and a menu layer holding a stack of
// screens. Each screen declares whether it pauses the sim and whether it captures input; the game
// glue (src/game/ui) reads `pausesSim` / `capturesInput` to pause the loop and to withhold gameplay
// action frames. The UI never touches sim state: it only reports what is open.
//
// Pushing a screen remembers what had focus, makes every screen below it `inert` (so neither focus
// nor clicks can reach them: the focus trap) and focuses the new screen's `[data-autofocus]` element
// or its first focusable. Popping restores focus to the remembered element. Intents from the UI input
// adapter (input.ts) go to the top screen: first to the focused component as a cancelable `ui-intent`
// DOM event (a slider takes left/right, a list takes up/down), then to the screen's own handler, then
// to the defaults: directions move focus spatially, Tab steps, confirm clicks, back closes the screen.

import { FOCUSABLE_SELECTOR, FocusManager, type FocusManagerOptions } from './focus';
import {
  isDirection,
  UiInputAdapter,
  type UiDevice,
  type UiInputHost,
  type UiIntent,
} from './input';
import { installUiStyles } from './tokens';

/** The DOM event components receive for each intent while they (or a descendant) have focus. */
export const UI_INTENT_EVENT = 'ui-intent';

export interface UiIntentDetail {
  readonly intent: UiIntent;
  readonly device: UiDevice;
}

/** Makes a `ui-intent` event (bubbling, cancelable: call preventDefault to consume the intent). */
export function uiIntentEvent(intent: UiIntent, device: UiDevice): CustomEvent<UiIntentDetail> {
  return new CustomEvent(UI_INTENT_EVENT, {
    bubbles: true,
    cancelable: true,
    detail: { intent, device },
  });
}

/** Listens for intents on `el`; the handler returns true to consume one. Returns an unsubscribe. */
export function onIntent(
  el: HTMLElement,
  handler: (intent: UiIntent, event: CustomEvent<UiIntentDetail>) => boolean,
): () => void {
  const listener = (event: Event): void => {
    const custom = event as CustomEvent<UiIntentDetail>;
    if (handler(custom.detail.intent, custom)) event.preventDefault();
  };
  el.addEventListener(UI_INTENT_EVENT, listener);
  return () => {
    el.removeEventListener(UI_INTENT_EVENT, listener);
  };
}

export interface ScreenOptions {
  /** Stable id, also written to `data-screen` (tests find screens by it). */
  readonly id: string;
  /** Accessible name of the screen (its dialog label). */
  readonly label: string;
  /** The screen's content; the stack wraps it. */
  readonly content: HTMLElement;
  /** While open, the game loop stops stepping the sim (pause menu, inventory). Default false. */
  readonly pausesSim?: boolean;
  /** While open, gameplay action frames are withheld and UI intents go here. Default true. */
  readonly capturesInput?: boolean;
  /** Dims the screens below it with a backdrop (confirm dialogs). Default false. */
  readonly modal?: boolean;
  /** Back was pressed: return true to keep the screen open (handled), else it closes. */
  readonly onBack?: () => boolean;
  /** Any intent the focused component left unhandled; return true to consume it. */
  readonly onIntent?: (intent: UiIntent, device: UiDevice) => boolean;
  /** The screen was closed (popped or removed). */
  readonly onClose?: () => void;
}

export interface Screen {
  readonly id: string;
  /** The wrapper element (`.vb-screen`, role dialog). */
  readonly element: HTMLElement;
  readonly pausesSim: boolean;
  readonly capturesInput: boolean;
  /** Closes this screen (and only this one), restoring focus if it was on top. */
  close(): void;
}

interface Entry extends Screen {
  readonly options: ScreenOptions;
  /** What had focus when the screen opened. */
  readonly restore: Element | null;
}

/** What the game glue needs to know about the stack. */
export interface UiState {
  readonly capturesInput: boolean;
  readonly pausesSim: boolean;
}

export interface UiRootOptions {
  readonly focus?: FocusManagerOptions;
  /** Skip adding the stylesheet (tests of structure only). Default false. */
  readonly unstyled?: boolean;
}

export class UiRoot implements UiState {
  /** `.vb-ui`: the layer over the canvas, carrier of the tokens and comfort settings. */
  readonly element: HTMLElement;
  /** `.vb-hud`: HUD widgets go here. Not focusable; pointer events pass through. */
  readonly hud: HTMLElement;
  /** `.vb-menus`: holds the screen stack. */
  readonly menus: HTMLElement;
  readonly focus: FocusManager;
  readonly #stack: Entry[] = [];
  readonly #listeners = new Set<(state: UiState) => void>();

  constructor(container: HTMLElement, options: UiRootOptions = {}) {
    const doc = container.ownerDocument;
    if (options.unstyled !== true) installUiStyles(doc);
    this.focus = new FocusManager(options.focus);
    this.element = doc.createElement('div');
    this.element.className = 'vb-ui';
    this.element.dataset['testid'] = 'ui-root';
    this.hud = doc.createElement('div');
    this.hud.className = 'vb-hud';
    this.hud.dataset['testid'] = 'hud';
    this.menus = doc.createElement('div');
    this.menus.className = 'vb-menus';
    this.element.append(this.hud, this.menus);
    container.append(this.element);
    // Pointer use hides the keyboard/gamepad focus ring until the next intent.
    this.element.addEventListener('pointerdown', () => {
      this.element.dataset['modality'] = 'pointer';
    });
    // A press on a screen's background (a panel, the modal backdrop) must not blur the focused
    // element: focus would fall to <body>, outside the screen, and the next intent would have nothing
    // to move from.
    this.element.addEventListener('mousedown', (event) => {
      const target = event.target as Element;
      if (target.closest('.vb-screen') !== null && target.closest(FOCUSABLE_SELECTOR) === null) {
        event.preventDefault();
      }
    });
  }

  /** Open screens, bottom first. */
  get screens(): readonly Screen[] {
    return this.#stack;
  }

  get top(): Screen | undefined {
    return this.#stack.at(-1);
  }

  /** True while any open screen captures input. */
  get capturesInput(): boolean {
    return this.#stack.some((entry) => entry.capturesInput);
  }

  /** True while any open screen pauses the sim. */
  get pausesSim(): boolean {
    return this.#stack.some((entry) => entry.pausesSim);
  }

  /** Called synchronously after every push, pop or close. Returns an unsubscribe. */
  subscribe(listener: (state: UiState) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /** Opens a screen on top of the stack and focuses it. */
  push(options: ScreenOptions): Screen {
    const doc = this.element.ownerDocument;
    const element = doc.createElement('section');
    element.className = 'vb-screen';
    element.dataset['screen'] = options.id;
    element.setAttribute('role', 'dialog');
    element.setAttribute('aria-label', options.label);
    if (options.modal === true) {
      element.setAttribute('aria-modal', 'true');
      element.dataset['modal'] = '';
    }
    element.append(options.content);
    const entry: Entry = {
      id: options.id,
      element,
      options,
      pausesSim: options.pausesSim ?? false,
      capturesInput: options.capturesInput ?? true,
      restore: doc.activeElement,
      close: () => {
        this.#close(entry);
      },
    };
    for (const below of this.#stack) below.element.inert = true;
    this.#stack.push(entry);
    this.menus.append(element);
    if (entry.capturesInput) this.focus.focusFirst(element);
    this.#notify();
    return entry;
  }

  /** Closes the top screen; returns it (undefined when the stack is empty). */
  pop(): Screen | undefined {
    const top = this.#stack.at(-1);
    if (top !== undefined) this.#close(top);
    return top;
  }

  /** Closes every screen, top first. */
  clear(): void {
    while (this.#stack.length > 0) this.pop();
  }

  #close(entry: Entry): void {
    const index = this.#stack.indexOf(entry);
    if (index === -1) return;
    const wasTop = index === this.#stack.length - 1;
    this.#stack.splice(index, 1);
    entry.element.remove();
    const top = this.#stack.at(-1);
    if (top !== undefined) top.element.inert = false;
    if (wasTop) this.#restoreFocus(entry, top);
    entry.options.onClose?.();
    this.#notify();
  }

  #restoreFocus(closed: Entry, top: Entry | undefined): void {
    const { restore } = closed;
    const usable =
      restore instanceof HTMLElement &&
      restore.isConnected &&
      restore.closest('[inert]') === null &&
      (top === undefined || top.element.contains(restore));
    if (usable) restore.focus();
    else if (top !== undefined) this.focus.focusFirst(top.element);
  }

  #notify(): void {
    const state: UiState = { capturesInput: this.capturesInput, pausesSim: this.pausesSim };
    for (const listener of [...this.#listeners]) listener(state);
  }

  /**
   * Handles one UI intent (the UiInputAdapter's sink). Returns false when no open screen captures
   * input, so the key or button stays with the game.
   */
  intent(intent: UiIntent, device: UiDevice): boolean {
    const top = this.#stack.at(-1);
    if (!top?.capturesInput) return false;
    this.element.dataset['modality'] = 'nav';
    const scope = top.element;
    const target = this.focus.current(scope);
    const event = uiIntentEvent(intent, device);
    (target ?? scope).dispatchEvent(event);
    if (event.defaultPrevented) return true;
    if (top.options.onIntent?.(intent, device) === true) return true;
    if (isDirection(intent)) {
      this.focus.move(scope, intent);
    } else if (intent === 'next' || intent === 'prev') {
      this.focus.step(scope, intent === 'next' ? 1 : -1);
    } else if (intent === 'confirm') {
      target?.click();
    } else if (intent === 'back') {
      if (top.options.onBack?.() !== true) this.#close(top);
    } else {
      // tabPrev / tabNext from outside a tab strip: the screen's first tab strip takes it.
      scope.querySelector('[data-ui-tabs]')?.dispatchEvent(uiIntentEvent(intent, device));
    }
    return true;
  }

  /**
   * Connects keyboard and gamepad to this root. Call `poll()` once per animation frame to read the
   * pad; `detach()` removes the listeners.
   */
  attachInput(host: UiInputHost): {
    readonly adapter: UiInputAdapter;
    poll(): void;
    detach(): void;
  } {
    const adapter = new UiInputAdapter((intent, device) => this.intent(intent, device));
    const detach = adapter.attach(host);
    return {
      adapter,
      poll: () => {
        adapter.poll();
      },
      detach,
    };
  }
}
