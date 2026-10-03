// The death beat's fade (mw-e01.8): a full-screen veil over the game that darkens from clear to
// black over the beat between the player's death and the death screen (e30-death-reload). A HUD
// widget like the others: the game hands it the beat's progress each frame and it never reads sim
// state. Opacity is quantised to 1/100 so a still frame writes nothing. It ignores the pointer and is
// hidden from assistive technology; the death screen that follows carries the words.

import { h } from './components/dom';
import { WriteCache, type HudWidget } from './hud';

/** How dark the veil is at the end of the beat (the death screen's panel still reads over it). */
export const DEATH_FADE_MAX_OPACITY = 0.85;

/** The death beat's veil; put its element in `ui.hud`. Model: beat progress 0–1, or null (alive). */
export class DeathFade implements HudWidget<number | null> {
  readonly element: HTMLElement;
  readonly #cache = new WriteCache();

  constructor() {
    this.element = h('div', {
      className: 'vb-death-fade',
      attrs: { 'aria-hidden': 'true', hidden: '' },
      data: { testid: 'death-fade', uiComponent: 'death-fade' },
    });
    // Inline, so the veil needs no stylesheet entry: it covers the HUD layer, which covers the game.
    Object.assign(this.element.style, {
      position: 'absolute',
      inset: '0',
      background: '#000',
      opacity: '0',
      pointerEvents: 'none',
    });
  }

  update(progress: number | null): void {
    const c = this.#cache;
    c.set('shown', String(progress !== null), (v) => {
      this.element.hidden = v === 'false';
    });
    if (progress === null) return;
    const clamped = Math.min(1, Math.max(0, progress));
    const opacity = (Math.round(clamped * DEATH_FADE_MAX_OPACITY * 100) / 100).toFixed(2);
    c.set('opacity', opacity, (v) => {
      this.element.style.opacity = v;
      this.element.dataset['opacity'] = v;
    });
  }
}
