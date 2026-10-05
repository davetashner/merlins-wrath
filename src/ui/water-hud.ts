// The water HUD (mw-e02.14): a breath meter that shows only while the character is short of breath
// (under water, or catching it back) and a short notice, e.g. the warning that the armor is dragging
// the player under. Like every HUD widget it reads no sim state: the game derives the model
// (src/game/player/water-hud.ts) and times run on the `nowMs` the caller passes.

import { h } from './components/dom';
import { Meter, WriteCache, type HudWidget } from './hud';

export const WATER_HUD_TEXT = Object.freeze({
  breath: 'Breath',
  region: 'Water',
  /** The first second of sinking under heavy armor (owner direction, 2026-10-04). */
  sinking: 'Your armour drags you under.',
});

/** How long a notice shows. */
export const WATER_NOTICE_MS = 4000;
/** The breath meter is marked low (and pulses) below this share of a full breath. */
export const BREATH_LOW = 0.25;

/** What the water HUD shows. */
export interface WaterHudModel {
  /** Share of a full breath left, 0 (drowning) to 1 (full: the meter hides). */
  readonly breath: number;
}

export interface WaterHudOptions {
  /** Whether motion is reduced right now (see comfort.ts reducedMotion). */
  readonly reducedMotion?: () => boolean;
}

/** The breath meter and notice; put its element in `ui.hud`. */
export class WaterHud implements HudWidget<WaterHudModel> {
  readonly element: HTMLElement;
  readonly #meter: Meter;
  readonly #notice: HTMLElement;
  readonly #cache = new WriteCache();
  #until = -Infinity;
  #text = '';

  constructor(options: WaterHudOptions = {}) {
    this.#meter = new Meter({
      label: WATER_HUD_TEXT.breath,
      kind: 'breath',
      lowBelow: BREATH_LOW,
      ...(options.reducedMotion !== undefined && { reducedMotion: options.reducedMotion }),
    });
    this.#notice = h('p', {
      className: 'vb-water-notice',
      attrs: { role: 'status', 'aria-live': 'polite' },
      data: { testid: 'water-notice' },
    });
    this.element = h(
      'div',
      {
        className: 'vb-water-hud',
        attrs: { hidden: '', role: 'group', 'aria-label': WATER_HUD_TEXT.region },
        data: { testid: 'water-hud', uiComponent: 'water-hud' },
      },
      this.#meter.element,
      this.#notice,
    );
  }

  /** Whether the meter is showing as of the last update. */
  get visible(): boolean {
    return !this.element.hidden;
  }

  /** The notice showing as of the last update ('' when none). */
  get notice(): string {
    return this.#notice.textContent;
  }

  /** Shows `text` as the notice from `nowMs` for WATER_NOTICE_MS. */
  announce(text: string, nowMs: number): void {
    this.#text = text;
    this.#until = nowMs + WATER_NOTICE_MS;
  }

  update(model: WaterHudModel, nowMs: number): void {
    const breath = Math.min(1, Math.max(0, model.breath));
    const notice = nowMs < this.#until ? this.#text : '';
    const meterShown = breath < 1;
    this.#meter.update({ value: Math.round(breath * 100), max: 100 }, nowMs);
    this.#cache.set('meter', String(meterShown), (v) => {
      this.#meter.element.hidden = v === 'false';
    });
    this.#cache.set('notice', notice, (v) => {
      this.#notice.textContent = v;
    });
    this.#cache.set('shown', String(meterShown || notice !== ''), (v) => {
      this.element.hidden = v === 'false';
    });
  }
}
