// The kit panel (mw-e19.5): a grey-box HUD readout of the player's class and what they carry, top
// right, until the inventory screen (mw-e17.10) and the paper-doll (mw-e17.11) land. A HUD widget like
// the vitals: it shows a view model the game derives from the sim (src/game/classes.ts `kitModel`)
// and rewrites its list only when a shown line changes. Hidden while there is no class.

import { h } from './components/dom';
import { WriteCache, type HudWidget } from './hud';

/** One carried stack, as the panel shows it. */
export interface KitLineModel {
  readonly label: string;
  readonly count: number;
  readonly equipped: boolean;
}

/** What the kit panel shows; null hides it (no class yet). */
export interface KitModel {
  /** The class's display name, e.g. "Sorcerer". */
  readonly className: string;
  readonly gold: number;
  readonly items: readonly KitLineModel[];
}

/** One line's text: "Ash staff (equipped)", "Mana draught ×2". */
export function kitLineText(line: KitLineModel): string {
  const count = line.count > 1 ? ` ×${String(line.count)}` : '';
  return `${line.label}${count}${line.equipped ? ' (equipped)' : ''}`;
}

/** The kit panel widget; put its element in `ui.hud`. */
export class KitPanel implements HudWidget<KitModel | null> {
  readonly element: HTMLElement;
  readonly #title: HTMLElement;
  readonly #gold: HTMLElement;
  readonly #list: HTMLElement;
  readonly #cache = new WriteCache();

  constructor() {
    this.#title = h('p', { className: 'vb-kit-title', data: { part: 'class' } });
    this.#gold = h('p', { data: { part: 'gold' } });
    this.#list = h('ul', { className: 'vb-kit-list', data: { part: 'items' } });
    this.element = h(
      'section',
      {
        className: 'vb-kit',
        attrs: { 'aria-label': 'Kit' },
        data: { testid: 'class-kit', uiComponent: 'kit' },
      },
      this.#title,
      this.#gold,
      this.#list,
    );
    this.element.hidden = true;
  }

  update(model: KitModel | null): void {
    const c = this.#cache;
    c.set('shown', String(model !== null), (v) => {
      this.element.hidden = v === 'false';
    });
    if (model === null) return;
    c.set('class', model.className, (v) => (this.#title.textContent = v));
    c.set('gold', `${String(model.gold)} gold`, (v) => (this.#gold.textContent = v));
    const lines = model.items.map(kitLineText);
    c.set('items', JSON.stringify(lines), () => {
      this.#list.replaceChildren(...lines.map((text) => h('li', { text })));
    });
  }
}
