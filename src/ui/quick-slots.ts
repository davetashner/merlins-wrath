// The quick-slot HUD strip (mw-e17.10): the player's four quick slots as brass-rimmed circles at the
// bottom centre of the game screen (style bible §9), each with its item's placeholder icon, its slot
// number and how many are left. A slot whose item ran out stays, dimmed, at 0 (it refills when more
// arrive); an empty slot is a faint ring. Sizes are whole CSS pixels from `quickSlotLayout(scale)`,
// where scale is the HUD scale setting (75–200 %), like the combat HUD's bars.
//
// Like every HUD widget it reads no sim state: the game derives the model (src/game/items/
// inventory-screen.ts) and the widget rewrites the DOM only when a shown value changes.

import { clampHudScale } from './combat-hud';
import { h } from './components/dom';
import { WriteCache, type HudWidget } from './hud';
import { itemIcon, type ItemIconKind } from './item-icons';

/** What one quick slot shows. */
export interface QuickSlotModel {
  /** The item's name; empty for an empty slot. */
  readonly label: string;
  readonly icon: ItemIconKind | null;
  /** Units of the item carried (0 once depleted). */
  readonly count: number;
}

/** Slot sizes at 100 % HUD scale, CSS pixels. */
export const QUICK_SLOT_BASE = Object.freeze({
  /** Gap from the viewport's bottom edge. */
  margin: 24,
  /** Slot diameter. */
  size: 52,
  /** Gap between slots. */
  gap: 10,
  /** Font size of the slot number and the count. */
  font: 13,
});

export interface QuickSlotLayout {
  readonly scale: number;
  readonly margin: number;
  readonly size: number;
  readonly gap: number;
  readonly font: number;
}

const px = (n: number): number => Math.round(n * 100) / 100;

/** The strip's dimensions at `scale` (clamped to 0.75–2). */
export function quickSlotLayout(scale: number): QuickSlotLayout {
  const s = clampHudScale(scale);
  return {
    scale: s,
    margin: px(QUICK_SLOT_BASE.margin * s),
    size: px(QUICK_SLOT_BASE.size * s),
    gap: px(QUICK_SLOT_BASE.gap * s),
    font: px(QUICK_SLOT_BASE.font * s),
  };
}

/** A slot's state: empty, holding units, or depleted (its item ran out). */
export function slotState(model: QuickSlotModel): 'empty' | 'ready' | 'depleted' {
  if (model.label === '') return 'empty';
  return model.count > 0 ? 'ready' : 'depleted';
}

/** A slot's accessible name: "Quick slot 2: Healing draught, 3" / "…: empty" / "…: none left". */
export function quickSlotLabel(index: number, model: QuickSlotModel): string {
  const name = `Quick slot ${String(index + 1)}`;
  const state = slotState(model);
  if (state === 'empty') return `${name}: empty`;
  if (state === 'depleted') return `${name}: ${model.label}, none left`;
  return `${name}: ${model.label}, ${String(model.count)}`;
}

const EMPTY: QuickSlotModel = Object.freeze({ label: '', icon: null, count: 0 });

interface SlotParts {
  readonly element: HTMLElement;
  readonly icon: HTMLElement;
  readonly key: HTMLElement;
  readonly count: HTMLElement;
  readonly cache: WriteCache;
}

export interface QuickSlotHudOptions {
  /** Slots shown (default 4). */
  readonly slots?: number;
  /** HUD scale, 0.75–2 (default 1). */
  readonly scale?: number;
}

/** The quick-slot strip; put its element in `ui.hud`. */
export class QuickSlotHud implements HudWidget<readonly QuickSlotModel[]> {
  readonly element: HTMLElement;
  readonly #slots: SlotParts[];
  readonly #cache = new WriteCache();
  #layout: QuickSlotLayout;

  constructor(options: QuickSlotHudOptions = {}) {
    this.#slots = Array.from({ length: options.slots ?? 4 }, (_, i) => {
      const icon = h('span', { className: 'vb-quick-slot-icon', attrs: { 'aria-hidden': 'true' } });
      const key = h('span', {
        className: 'vb-quick-slot-key',
        text: String(i + 1),
        attrs: { 'aria-hidden': 'true' },
      });
      const count = h('span', {
        className: 'vb-quick-slot-count',
        attrs: { 'aria-hidden': 'true' },
      });
      const element = h(
        'span',
        { className: 'vb-quick-slot', attrs: { role: 'img' }, data: { slot: String(i) } },
        icon,
        key,
        count,
      );
      return { element, icon, key, count, cache: new WriteCache() };
    });
    this.element = h(
      'div',
      {
        className: 'vb-quick-slots',
        attrs: { role: 'group', 'aria-label': 'Quick slots' },
        data: { testid: 'quick-slots', uiComponent: 'quick-slots' },
      },
      ...this.#slots.map((slot) => slot.element),
    );
    this.#layout = quickSlotLayout(options.scale ?? 1);
    this.#applyLayout();
  }

  /** The current dimensions. */
  get layout(): QuickSlotLayout {
    return this.#layout;
  }

  /** Applies a new HUD scale (clamped to 0.75–2) at once. */
  setScale(scale: number): void {
    this.#layout = quickSlotLayout(scale);
    this.#applyLayout();
  }

  update(model: readonly QuickSlotModel[]): void {
    this.#slots.forEach((slot, i) => {
      const shown = model[i] ?? EMPTY;
      const state = slotState(shown);
      const c = slot.cache;
      c.set('label', quickSlotLabel(i, shown), (v) => {
        slot.element.setAttribute('aria-label', v);
      });
      c.set('state', state, (v) => (slot.element.dataset['state'] = v));
      c.set('icon', shown.icon ?? '', (v) => {
        slot.icon.replaceChildren(...(v === '' ? [] : [itemIcon(v as ItemIconKind)]));
      });
      c.set('count', state === 'empty' ? '' : String(shown.count), (v) => {
        slot.count.textContent = v;
      });
    });
  }

  #applyLayout(): void {
    const { margin, size, gap, font } = this.#layout;
    this.#cache.set('layout', `${String(margin)} ${String(size)} ${String(gap)}`, () => {
      this.element.style.bottom = `${String(margin)}px`;
      this.element.style.gap = `${String(gap)}px`;
      this.element.style.fontSize = `${String(font)}px`;
      for (const slot of this.#slots) {
        slot.element.style.width = `${String(size)}px`;
        slot.element.style.height = `${String(size)}px`;
      }
    });
    this.element.dataset['scale'] = String(this.#layout.scale);
  }
}
