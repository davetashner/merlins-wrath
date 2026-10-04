// The target readout and damage numbers (mw-e04.21). Like every HUD widget they read no sim state:
// the game hands in view models and spawns numbers, and only changed values touch the DOM.
//
// - TargetBar: the fighter you are locked onto (or last hit) — its name and a health bar with the
//   combat HUD's delayed chip — docked top-centre. Hidden when there is no target.
// - DamageNumbers: a small pool of figures that rise and fade where a hit landed: what you dealt
//   (on the target) and what you took (by your own bars). "No effect" shows for an immune hit.
//   Every timer runs on the `nowMs` the caller passes.

import { h } from './components/dom';
import { Meter, WriteCache, type HudWidget, type MeterModel } from './hud';

/** How long a number takes to rise and fade. */
export const DAMAGE_NUMBER_MS = 900;
/** How far a number rises, CSS pixels. */
export const DAMAGE_NUMBER_RISE = 36;
/** At most this many numbers show at once; a new one replaces the oldest. */
export const MAX_DAMAGE_NUMBERS = 12;

/** The target bar's model: null hides it. */
export interface TargetModel {
  readonly name: string;
  readonly health: MeterModel;
}

/** The locked target's name and health. */
export class TargetBar implements HudWidget<TargetModel | null> {
  readonly element: HTMLElement;
  readonly health: Meter;
  readonly #name: HTMLElement;
  readonly #cache = new WriteCache();

  constructor(options: { readonly reducedMotion?: () => boolean } = {}) {
    this.health = new Meter({
      label: 'Target health',
      kind: 'health',
      trailHoldMs: 500,
      trailDrainMs: 400,
      ...(options.reducedMotion ? { reducedMotion: options.reducedMotion } : {}),
    });
    this.#name = h('div', { className: 'vb-target-name' });
    this.element = h(
      'div',
      {
        className: 'vb-target-bar',
        attrs: { hidden: '' },
        data: { testid: 'target-bar', uiComponent: 'target-bar' },
      },
      this.#name,
      this.health.element,
    );
  }

  update(model: TargetModel | null, nowMs: number): void {
    const shown = model !== null;
    this.#cache.set('shown', String(shown), (v) => {
      this.element.hidden = v === 'false';
    });
    if (model === null) return;
    this.#cache.set('name', model.name, (v) => (this.#name.textContent = v));
    this.health.update(model.health, nowMs);
  }
}

/** Whose damage a number shows. */
export type DamageNumberKind = 'dealt' | 'taken';

/** One live number (tests read them). */
export interface DamageNumber {
  readonly text: string;
  readonly kind: DamageNumberKind;
  /** 1 when it appeared, 0 when it is gone. */
  readonly opacity: number;
}

interface Slot {
  readonly el: HTMLElement;
  readonly cache: WriteCache;
  text: string;
  kind: DamageNumberKind;
  x: number;
  y: number;
  since: number;
}

/** The rising damage figures. */
export class DamageNumbers {
  readonly element: HTMLElement;
  readonly #slots: Slot[] = [];
  readonly #reduced: () => boolean;
  #live: DamageNumber[] = [];

  constructor(options: { readonly reducedMotion?: () => boolean } = {}) {
    this.#reduced = options.reducedMotion ?? (() => false);
    this.element = h('div', {
      className: 'vb-damage-numbers',
      attrs: { 'aria-hidden': 'true' },
      data: { testid: 'damage-numbers', uiComponent: 'damage-numbers' },
    });
    for (let i = 0; i < MAX_DAMAGE_NUMBERS; i++) {
      const el = h('span', { className: 'vb-damage-number', attrs: { hidden: '' } });
      this.element.append(el);
      this.#slots.push({
        el,
        cache: new WriteCache(),
        text: '',
        kind: 'dealt',
        x: 0,
        y: 0,
        since: -Infinity,
      });
    }
  }

  /** The numbers showing as of the last update, oldest first. */
  get numbers(): readonly DamageNumber[] {
    return this.#live;
  }

  /** Shows `text` at (`x`, `y`) CSS pixels in the HUD layer from `nowMs`. */
  spawn(text: string, kind: DamageNumberKind, x: number, y: number, nowMs: number): void {
    const slot =
      this.#slots.find((s) => nowMs - s.since >= DAMAGE_NUMBER_MS) ??
      this.#slots.reduce((oldest, s) => (s.since < oldest.since ? s : oldest));
    Object.assign(slot, { text, kind, x: Math.round(x), y: Math.round(y), since: nowMs });
  }

  update(nowMs: number): void {
    const live: { n: DamageNumber; since: number }[] = [];
    for (const s of this.#slots) {
      const age = nowMs - s.since;
      const shown = age >= 0 && age < DAMAGE_NUMBER_MS;
      s.cache.set('shown', String(shown), (v) => {
        s.el.hidden = v === 'false';
      });
      if (!shown) continue;
      const t = age / DAMAGE_NUMBER_MS;
      live.push({ n: { text: s.text, kind: s.kind, opacity: 1 - t }, since: s.since });
      s.cache.set('text', s.text, (v) => (s.el.textContent = v));
      s.cache.set('kind', s.kind, (v) => (s.el.dataset['kind'] = v));
      const rise = this.#reduced() ? 0 : Math.round(t * DAMAGE_NUMBER_RISE);
      s.cache.set('at', `translate(${String(s.x)}px, ${String(s.y - rise)}px)`, (v) => {
        s.el.style.transform = v;
      });
      s.cache.set('opacity', (1 - t).toFixed(2), (v) => (s.el.style.opacity = v));
    }
    this.#live = live.sort((a, b) => a.since - b.since).map(({ n }) => n);
  }
}
