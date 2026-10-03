// Pickup toasts (mw-e18.4): a short note in the bottom-right corner for everything the player picks
// up, so discoveries feel noticed without stopping play. HUD widget: it takes pickups as view models
// and never reads game state. The pickup toast frame and artifact discovery banner are asset beads
// (mw-e37.121); until then they are parchment cards on the kit's tokens.
//
// - At most MAX_PICKUP_TOASTS show at once. A pickup of something already showing merges into that
//   toast: its count goes up and its time starts again. When the corner is full the ordinary toast
//   due to go first makes way; discoveries never do, and a pickup with no room waits for one.
// - A unique artifact gets a discovery toast instead: a gold-edged card headed "Discovery" with the
//   item's flavour line, shown for DISCOVERY_TOAST_MS (at least 4 s).
// - Time is the `nowMs` the game passes to `push` and `frame` (the draw clock), so tests step it
//   without wall time. The corner is a polite live region; sizes are in em and follow the text size
//   setting, times the HUD scale (`setScale`).

import { h } from './components/dom';
import { itemIcon, type ItemIconKind } from './item-icons';

/** Toasts visible at once. */
export const MAX_PICKUP_TOASTS = 4;
/** How long an ordinary pickup toast shows, from its last merge. */
export const PICKUP_TOAST_MS = 3000;
/** How long a discovery toast shows. */
export const DISCOVERY_TOAST_MS = 6000;

export const PICKUP_TEXT = Object.freeze({
  region: 'Pickups',
  discovery: 'Discovery',
});

/** One pickup. */
export interface Pickup {
  /** What merges toasts: the item definition (or `gold`). */
  readonly key: string;
  readonly name: string;
  readonly icon: ItemIconKind;
  readonly count: number;
  /** A unique artifact's flavour line: shows a discovery toast. */
  readonly discovery?: string;
  /** Gold: the count is the amount ("+12 gold"), never "×12". */
  readonly gold?: boolean;
}

/** A toast, as `visible` reports it. */
export interface ToastView {
  readonly key: string;
  readonly text: string;
  readonly count: number;
  readonly discovery: boolean;
  /** When it goes, ms on the clock passed in. */
  readonly until: number;
}

interface Toast {
  readonly key: string;
  readonly pickup: Pickup;
  count: number;
  until: number;
  readonly element: HTMLElement;
  readonly line: HTMLElement;
}

/** A toast's main line: "Healing draught ×2", "+12 gold". */
export function pickupText(pickup: Pickup, count: number): string {
  if (pickup.gold === true) return `+${String(count)} gold`;
  return count > 1 ? `${pickup.name} ×${String(count)}` : pickup.name;
}

/** The pickup toast corner (put it in `ui.hud`). */
export class PickupToasts {
  readonly element: HTMLElement;
  #shown: Toast[] = [];
  #waiting: { pickup: Pickup; count: number }[] = [];

  constructor(options: { readonly scale?: number } = {}) {
    this.element = h('div', {
      className: 'vb-pickups',
      attrs: { role: 'status', 'aria-live': 'polite', 'aria-label': PICKUP_TEXT.region },
      data: { testid: 'pickup-toasts' },
    });
    this.setScale(options.scale ?? 1);
  }

  /** The toasts showing, oldest first. */
  get visible(): readonly ToastView[] {
    return this.#shown.map(({ key, pickup, count, until }) => ({
      key,
      text: pickupText(pickup, count),
      count,
      discovery: pickup.discovery !== undefined,
      until,
    }));
  }

  /** Pickups waiting for room. */
  get waiting(): number {
    return this.#waiting.length;
  }

  /** Sizes the corner by the HUD scale setting (1 = 100 %). */
  setScale(scale: number): void {
    this.element.style.fontSize = `${String(scale)}em`;
  }

  /** Shows `pickup` (merging, making way or waiting as the header says). */
  push(pickup: Pickup, nowMs: number): void {
    this.frame(nowMs);
    if (pickup.discovery === undefined) {
      const same = this.#shown.find(
        (t) => t.key === pickup.key && t.pickup.discovery === undefined,
      );
      if (same !== undefined) {
        same.count += pickup.count;
        same.until = nowMs + PICKUP_TOAST_MS;
        same.line.textContent = pickupText(same.pickup, same.count);
        return;
      }
      const queued = this.#waiting.find(
        (w) => w.pickup.key === pickup.key && w.pickup.discovery === undefined,
      );
      if (queued !== undefined) {
        queued.count += pickup.count;
        return;
      }
    }
    if (this.#shown.length >= MAX_PICKUP_TOASTS) {
      // The ordinary toast due to go first (the least recently merged) makes way.
      const oldest = this.#shown
        .filter((t) => t.pickup.discovery === undefined)
        .reduce<Toast | undefined>(
          (due, t) => (due === undefined || t.until < due.until ? t : due),
          undefined,
        );
      if (oldest === undefined) {
        this.#waiting.push({ pickup, count: pickup.count });
        return;
      }
      this.#remove(oldest);
    }
    this.#show(pickup, pickup.count, nowMs);
  }

  /** Removes the toasts whose time is up and shows waiting ones in their place. */
  frame(nowMs: number): void {
    for (const toast of this.#shown.filter((t) => t.until <= nowMs)) this.#remove(toast);
    while (this.#shown.length < MAX_PICKUP_TOASTS && this.#waiting.length > 0) {
      const next = this.#waiting.shift() as { pickup: Pickup; count: number };
      this.#show(next.pickup, next.count, nowMs);
    }
  }

  /** Removes every toast. */
  clear(): void {
    for (const toast of [...this.#shown]) this.#remove(toast);
    this.#waiting = [];
  }

  #show(pickup: Pickup, count: number, nowMs: number): void {
    const discovery = pickup.discovery !== undefined;
    const line = h('span', { className: 'vb-pickup-name', text: pickupText(pickup, count) });
    const element = h(
      'div',
      {
        className: 'vb-pickup',
        data: { pickup: pickup.key, kind: discovery ? 'discovery' : 'pickup' },
      },
      itemIcon(pickup.icon, 'vb-icon vb-pickup-icon'),
      h(
        'span',
        { className: 'vb-pickup-text' },
        ...(discovery
          ? [h('span', { className: 'vb-pickup-heading', text: PICKUP_TEXT.discovery })]
          : []),
        line,
        ...(discovery && pickup.discovery !== ''
          ? [
              h('span', {
                className: 'vb-pickup-flavour',
                text: pickup.discovery,
                data: { part: 'flavour' },
              }),
            ]
          : []),
      ),
    );
    this.element.append(element);
    this.#shown.push({
      key: pickup.key,
      pickup,
      count,
      until: nowMs + (discovery ? DISCOVERY_TOAST_MS : PICKUP_TOAST_MS),
      element,
      line,
    });
  }

  #remove(toast: Toast): void {
    toast.element.remove();
    this.#shown.splice(this.#shown.indexOf(toast), 1);
  }
}
