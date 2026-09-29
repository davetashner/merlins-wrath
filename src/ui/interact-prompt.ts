// The contextual Interact prompt (mw-e02.5): `[E] Pull lever` under the crosshair while the player
// has something in focus. A HUD widget like the vitals: it shows a view model the game derives from
// the sim's interaction prompt (src/sim/interaction `interactionPrompt`) plus the Interact binding's
// glyph for the device last used, and writes the DOM only when a shown value changes. An affordance
// the player can't use yet stays visible, greyed, with its reason ("Locked — needs Iron Key"), to hint
// at another route. A hold affordance shows a bar filling while Interact is held.

import { h } from './components/dom';
import { glyphPrompt, type GlyphPrompt } from './components/overlays';
import { WriteCache, type HudWidget } from './hud';

/** What the prompt shows; null hides it (nothing in focus). */
export interface InteractPromptModel {
  /** The Interact binding on the device last used ("E", "X"). */
  readonly glyph: string;
  /** The affordance's prompt text ("Pull lever"). */
  readonly label: string;
  readonly available: boolean;
  /** Why it can't be used; empty when available. */
  readonly reason: string;
  /** Whether Interact must be held. */
  readonly hold: boolean;
  /** Hold progress, 0…1. */
  readonly progress: number;
}

/** The Interact prompt widget; put its element in `ui.hud`. */
export class InteractPrompt implements HudWidget<InteractPromptModel | null> {
  readonly element: HTMLElement;
  readonly #prompt: GlyphPrompt;
  readonly #reason: HTMLElement;
  readonly #bar: HTMLElement;
  readonly #fill: HTMLElement;
  readonly #cache = new WriteCache();

  constructor() {
    this.#prompt = glyphPrompt('', '');
    this.#reason = h('span', { className: 'vb-interact-reason', data: { part: 'reason' } });
    this.#fill = h('span', { className: 'vb-interact-fill' });
    this.#bar = h('span', { className: 'vb-interact-bar', data: { part: 'progress' } }, this.#fill);
    this.element = h(
      'div',
      { className: 'vb-interact', data: { testid: 'interact-prompt', uiComponent: 'interact' } },
      this.#prompt.element,
      this.#reason,
      this.#bar,
    );
    this.element.hidden = true;
  }

  update(model: InteractPromptModel | null): void {
    const c = this.#cache;
    c.set('shown', String(model !== null), (v) => {
      this.element.hidden = v === 'false';
    });
    if (model === null) return;
    this.#prompt.setGlyph(model.glyph);
    this.#prompt.setAction(model.hold ? `${model.label} (hold)` : model.label);
    c.set('available', String(model.available), (v) => {
      this.element.dataset['available'] = v;
    });
    c.set('reason', model.available ? '' : model.reason, (v) => {
      this.#reason.textContent = v;
      this.#reason.hidden = v === '';
    });
    c.set('hold', String(model.hold && model.available), (v) => {
      this.#bar.hidden = v === 'false';
    });
    const progress = Math.min(1, Math.max(0, model.progress));
    c.set('progress', `scaleX(${progress.toFixed(3)})`, (v) => {
      this.#fill.style.transform = v;
    });
  }
}
