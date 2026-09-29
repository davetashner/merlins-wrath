// Virtualised list and grid (mw-e00.23). Only the rows in view (plus an overscan margin, plus the
// active row) exist in the DOM, so a 500-item inventory costs the same as a 10-item one. Rows are
// sized in `em`, so they grow with the text scale; the pixel height the window maths needs comes from
// the list's computed font size.
//
// Focus uses a roving tabindex: only the active row is focusable, so spatial navigation from outside
// lands on it and the list is one stop in Tab order. While a row is focused the list takes the
// movement intents itself (up/down, and left/right in a grid) and hands them back at its edges so
// focus can leave. Confirm or a click selects.

import { onIntent } from '../screens';
import { h, uid } from './dom';

export interface VirtualListOptions<T> {
  /** Accessible name of the list. */
  readonly label: string;
  readonly items: readonly T[];
  /** The row's text. */
  readonly text: (item: T, index: number) => string;
  /** Row height in em (default 2). */
  readonly rowHeightEm?: number;
  /** Rows visible at once; the viewport is this many rows tall (default 6). */
  readonly visibleRows?: number;
  /** Columns: 1 is a list, more is a grid (default 1). */
  readonly columns?: number;
  /** Extra rows rendered above and below the viewport (default 2). */
  readonly overscan?: number;
  readonly onSelect?: (item: T, index: number) => void;
}

const DEFAULT_FONT_PX = 16;

export class VirtualList<T> {
  readonly element: HTMLElement;
  readonly #spacer: HTMLElement;
  readonly #options: VirtualListOptions<T>;
  readonly #rowEm: number;
  readonly #visible: number;
  readonly #columns: number;
  readonly #overscan: number;
  readonly #idPrefix: string;
  #items: readonly T[];
  #active = 0;
  readonly #rows = new Map<number, HTMLElement>();

  constructor(options: VirtualListOptions<T>) {
    this.#options = options;
    this.#items = options.items;
    this.#rowEm = options.rowHeightEm ?? 2;
    this.#visible = options.visibleRows ?? 6;
    this.#columns = Math.max(1, Math.floor(options.columns ?? 1));
    this.#overscan = options.overscan ?? 2;
    this.#idPrefix = uid('vb-list');
    this.#spacer = h('div', { className: 'vb-list-spacer' });
    this.element = h(
      'div',
      {
        className: 'vb-list',
        attrs: { role: 'listbox', 'aria-label': options.label },
        data: { uiComponent: this.#columns > 1 ? 'grid' : 'list' },
      },
      this.#spacer,
    );
    this.element.style.height = `${String(this.#visible * this.#rowEm)}em`;
    this.element.addEventListener('scroll', () => {
      this.render();
    });
    onIntent(this.element, (intent) => this.#onIntent(intent));
    this.render();
  }

  get items(): readonly T[] {
    return this.#items;
  }

  /** Index of the active (focusable, selected) item. */
  get activeIndex(): number {
    return this.#active;
  }

  /** Row elements currently in the DOM. */
  get renderedCount(): number {
    return this.#rows.size;
  }

  /** Replaces the items; the active index is clamped into range. */
  setItems(items: readonly T[]): void {
    this.#items = items;
    for (const row of this.#rows.values()) row.remove();
    this.#rows.clear();
    this.#active = Math.min(this.#active, Math.max(0, items.length - 1));
    this.render();
  }

  /** Makes `index` active, scrolls it into view and focuses it. */
  focusIndex(index: number): void {
    if (index < 0 || index >= this.#items.length) return;
    this.#active = index;
    this.#scrollIntoView(index);
    this.render();
    // render() always keeps the active row in the DOM.
    for (const [i, row] of this.#rows) if (i === index) row.focus();
  }

  #rowPx(): number {
    const size = parseFloat(getComputedStyle(this.element).fontSize);
    return (Number.isFinite(size) && size > 0 ? size : DEFAULT_FONT_PX) * this.#rowEm;
  }

  #scrollIntoView(index: number): void {
    const rowPx = this.#rowPx();
    const row = Math.floor(index / this.#columns);
    const top = row * rowPx;
    const bottom = top + rowPx;
    const viewport = this.#visible * rowPx;
    if (top < this.element.scrollTop) this.element.scrollTop = top;
    else if (bottom > this.element.scrollTop + viewport) this.element.scrollTop = bottom - viewport;
  }

  /** Brings the DOM rows in line with the scroll position (called on scroll and after changes). */
  render(): void {
    const count = this.#items.length;
    const totalRows = Math.ceil(count / this.#columns);
    this.#spacer.style.height = `${String(totalRows * this.#rowEm)}em`;
    // The top row in view, the rows below it (one more for a partly scrolled row) and the overscan.
    const top = Math.floor(this.element.scrollTop / this.#rowPx());
    const first = Math.max(0, top - this.#overscan);
    const last = Math.min(totalRows - 1, top + this.#visible + this.#overscan);
    const wanted = new Set<number>();
    for (let row = first; row <= last; row++) {
      for (let col = 0; col < this.#columns; col++) {
        const index = row * this.#columns + col;
        if (index < count) wanted.add(index);
      }
    }
    if (count > 0) wanted.add(this.#active);
    for (const [index, row] of this.#rows) {
      if (!wanted.has(index)) {
        row.remove();
        this.#rows.delete(index);
      }
    }
    for (const index of wanted) {
      const row = this.#rows.get(index) ?? this.#createRow(index);
      this.#decorate(row, index === this.#active);
    }
  }

  #createRow(index: number): HTMLElement {
    const item = this.#items[index] as T;
    const row = h('div', {
      className: 'vb-list-item',
      text: this.#options.text(item, index),
      attrs: {
        role: 'option',
        id: `${this.#idPrefix}-${String(index)}`,
        'aria-setsize': String(this.#items.length),
        'aria-posinset': String(index + 1),
      },
      data: { index: String(index) },
    });
    const col = index % this.#columns;
    const width = 100 / this.#columns;
    row.style.top = `${String(Math.floor(index / this.#columns) * this.#rowEm)}em`;
    row.style.height = `${String(this.#rowEm)}em`;
    row.style.left = `${String(col * width)}%`;
    row.style.width = `${String(width)}%`;
    row.addEventListener('click', () => {
      this.focusIndex(index);
      this.#options.onSelect?.(item, index);
    });
    this.#rows.set(index, row);
    this.#spacer.append(row);
    return row;
  }

  #decorate(row: HTMLElement, active: boolean): void {
    row.tabIndex = active ? 0 : -1;
    row.setAttribute('aria-selected', String(active));
  }

  #onIntent(intent: string): boolean {
    const cols = this.#columns;
    const i = this.#active;
    const n = this.#items.length;
    const col = i % cols;
    let next: number | undefined;
    if (intent === 'up') next = i - cols;
    else if (intent === 'down') next = i + cols;
    else if (intent === 'left' && col > 0) next = i - 1;
    else if (intent === 'right' && col < cols - 1) next = i + 1;
    else if (intent === 'confirm') {
      if (n === 0) return false;
      this.#options.onSelect?.(this.#items[i] as T, i);
      return true;
    }
    if (next === undefined || next < 0 || next >= n) return false;
    this.focusIndex(next);
    return true;
  }
}
