// Tooltip, toast, modal confirm and key-glyph prompt (mw-e00.23).

import type { UiDevice, UiIntent } from '../input';
import type { UiRoot } from '../screens';
import { button } from './controls';
import { h, uid } from './dom';

/**
 * Attaches a tooltip to `target`: shown while it has focus or the pointer is over it, linked with
 * aria-describedby so screen readers read it too. The tooltip is inserted after the target, so give
 * the target's parent `position: relative` for placement. Returns the tooltip element.
 */
export function attachTooltip(target: HTMLElement, text: string): HTMLElement {
  const tip = h('div', {
    className: 'vb-tooltip',
    text,
    attrs: { role: 'tooltip', id: uid('vb-tip') },
  });
  tip.hidden = true;
  target.setAttribute('aria-describedby', tip.id);
  const show = (): void => {
    tip.style.left = `${String(target.offsetLeft)}px`;
    tip.style.top = `${String(target.offsetTop + target.offsetHeight + 4)}px`;
    tip.hidden = false;
  };
  const hide = (): void => {
    tip.hidden = true;
  };
  target.addEventListener('focus', show);
  target.addEventListener('mouseenter', show);
  target.addEventListener('blur', hide);
  target.addEventListener('mouseleave', () => {
    if (target.ownerDocument.activeElement !== target) hide();
  });
  target.after(tip);
  return tip;
}

/** Timer functions (the browser passes setTimeout / clearTimeout). */
export interface Timers {
  set(callback: () => void, ms: number): unknown;
}

const browserTimers: Timers = {
  set: (callback, ms) => setTimeout(callback, ms),
};

export interface ToastOptions {
  readonly tone?: 'info' | 'warning';
  /** How long it stays (default 4 s). */
  readonly durationMs?: number;
}

/** Non-blocking notifications in a polite live region (put it in the HUD layer). */
export class ToastHost {
  readonly element: HTMLElement;
  readonly #timers: Timers;

  constructor(timers: Timers = browserTimers) {
    this.#timers = timers;
    this.element = h('div', {
      className: 'vb-toasts',
      attrs: { role: 'status', 'aria-live': 'polite' },
      data: { testid: 'toasts' },
    });
  }

  /** Shows a toast; it removes itself after its duration. Returns its element. */
  show(text: string, options: ToastOptions = {}): HTMLElement {
    const toast = h('div', {
      className: 'vb-toast',
      text,
      data: { tone: options.tone ?? 'info' },
    });
    this.element.append(toast);
    this.#timers.set(() => {
      toast.remove();
    }, options.durationMs ?? 4000);
    return toast;
  }
}

export interface ConfirmOptions {
  readonly title: string;
  readonly body: string;
  readonly confirmLabel?: string;
  readonly cancelLabel?: string;
  /** Style the confirm button as destructive. */
  readonly destructive?: boolean;
  /** Pause the sim while asking (default false: the screen underneath decides). */
  readonly pausesSim?: boolean;
}

/**
 * Asks a yes/no question in a modal screen. Resolves true on confirm, false on cancel or back; focus
 * starts on cancel (the safe answer) and returns to where it was when the dialog closes.
 */
export function confirmDialog(ui: UiRoot, options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    let answer = false;
    const cancel = button({
      label: options.cancelLabel ?? 'Cancel',
      autofocus: true,
      onPress: () => {
        screen.close();
      },
    });
    const ok = button({
      label: options.confirmLabel ?? 'Confirm',
      variant: options.destructive === true ? 'warning' : 'default',
      onPress: () => {
        answer = true;
        screen.close();
      },
    });
    const content = h(
      'div',
      { className: 'vb-panel vb-stack', data: { testid: 'confirm' } },
      h('h2', { text: options.title }),
      h('p', { text: options.body }),
      h('div', { className: 'vb-row' }, cancel, ok),
    );
    const screen = ui.push({
      id: 'confirm',
      label: options.title,
      content,
      modal: true,
      pausesSim: options.pausesSim ?? false,
      onClose: () => {
        resolve(answer);
      },
    });
  });
}

/** Glyphs for the UI's own navigation intents, per device (menu hints: "Esc Back", "B Back"). */
export const UI_INTENT_GLYPHS: Readonly<Record<UiDevice, Readonly<Record<UiIntent, string>>>> =
  Object.freeze({
    keyboard: {
      up: '↑',
      down: '↓',
      left: '←',
      right: '→',
      confirm: 'Enter',
      back: 'Esc',
      tabPrev: 'Q',
      tabNext: 'E',
      next: 'Tab',
      prev: 'Shift+Tab',
    },
    gamepad: {
      up: 'D-pad Up',
      down: 'D-pad Down',
      left: 'D-pad Left',
      right: 'D-pad Right',
      confirm: 'A',
      back: 'B',
      tabPrev: 'LB',
      tabNext: 'RB',
      next: 'D-pad Down',
      prev: 'D-pad Up',
    },
  });

export interface GlyphPrompt {
  readonly element: HTMLElement;
  /** Changes the glyph (the device changed, or the binding was remapped). */
  setGlyph(glyph: string): void;
  /** Changes the action text (a contextual prompt whose target changed). */
  setAction(action: string): void;
}

/**
 * A key-glyph prompt: `[E] Open`. The glyph is plain text supplied by the caller: gameplay prompts
 * resolve it from the e02 input bindings (src/game/input `inputGlyph`), menu hints from
 * UI_INTENT_GLYPHS. mw-e37 swaps the text for glyph art by the same keys.
 */
export function glyphPrompt(glyph: string, action: string): GlyphPrompt {
  const kbd = h('kbd', { text: glyph });
  const label = h('span', { text: action });
  const element = h(
    'span',
    { className: 'vb-glyph-prompt', data: { uiComponent: 'glyph' } },
    kbd,
    label,
  );
  return {
    element,
    setGlyph(next: string) {
      if (kbd.textContent !== next) kbd.textContent = next;
    },
    setAction(next: string) {
      if (label.textContent !== next) label.textContent = next;
    },
  };
}
