// The lock-on marker (mw-e02.16): a ring over the locked target's main lock point. Like every HUD
// widget it never reads sim state: the game projects the lock point to the screen each frame and
// hands the result in as a view model (see src/game/player/lock-on.ts). Only changed values touch
// the DOM, so a marker resting on a still target costs no writes.

import { h } from './components/dom';
import { WriteCache, type HudWidget } from './hud';

/** Where the marker is drawn this frame. */
export interface LockMarkerModel {
  /** The locked entity, or null when nothing is locked (or it is off screen): hidden. */
  readonly target: number | null;
  /** Position within the HUD layer, CSS pixels from its top-left corner. */
  readonly x: number;
  readonly y: number;
}

/** No lock: the marker is hidden. */
export const NO_LOCK_MARKER: LockMarkerModel = Object.freeze({ target: null, x: 0, y: 0 });

/** The lock-on ring. Position is rounded to whole pixels so sub-pixel jitter causes no writes. */
export class LockMarker implements HudWidget<LockMarkerModel> {
  readonly element: HTMLElement;
  readonly #cache = new WriteCache();

  constructor() {
    this.element = h('div', {
      className: 'vb-lock-marker',
      attrs: { 'aria-hidden': 'true', hidden: '' },
      data: { testid: 'lock-marker', uiComponent: 'lock-marker' },
    });
  }

  update(model: LockMarkerModel): void {
    const c = this.#cache;
    const shown = model.target !== null;
    c.set('shown', String(shown), () => {
      this.element.hidden = !shown;
    });
    c.set('target', shown ? String(model.target) : '', (v) => {
      if (v === '') delete this.element.dataset['target'];
      else this.element.dataset['target'] = v;
    });
    if (!shown) return;
    const at = `translate(${String(Math.round(model.x))}px, ${String(Math.round(model.y))}px)`;
    c.set('at', at, (v) => (this.element.style.transform = v));
  }
}
