// Focus management (mw-e00.23): spatial navigation, Tab order and the focus trap. The screen stack
// (screens.ts) calls this with the top screen's element as the scope, so focus can never leave an
// open modal: candidates are only ever looked for inside the scope, and screens below it are `inert`.
//
// Spatial navigation picks, among the focusable elements that lie wholly beyond the current one's
// edge in the pressed direction, the one with the smallest score: the gap along the direction plus twice the
// sideways gap (zero when the two overlap sideways), plus a small share of the centre offset so the
// best-aligned of several overlapping candidates wins. Nothing beyond → focus stays put. Geometry is
// injected (`rectOf`), so the rules are unit-tested without a layout engine.

import type { Direction } from './input';

export interface Rect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** What counts as focusable before filtering (disabled, tabindex -1, hidden and inert are dropped). */
export const FOCUSABLE_SELECTOR =
  'button, a[href], input, select, textarea, [tabindex], [contenteditable="true"]';

/** Elements in `scope` a player can move focus to, in DOM (Tab) order. */
export function focusables(scope: Element): HTMLElement[] {
  return [...scope.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter(
    (el) =>
      el.tabIndex >= 0 &&
      !(el as HTMLElement & { disabled?: boolean }).disabled &&
      el.closest('[hidden], [inert]') === null,
  );
}

const centre = (r: Rect): { x: number; y: number } => ({
  x: (r.left + r.right) / 2,
  y: (r.top + r.bottom) / 2,
});

/** Distance between two 1-D spans (0 when they overlap). */
const gap = (a0: number, a1: number, b0: number, b1: number): number =>
  Math.max(0, b0 - a1, a0 - b1);

const EDGE_SLACK = 1;

/** Score of moving from `from` to `to` in `dir`, or undefined when `to` is not in that direction. */
export function spatialScore(from: Rect, to: Rect, dir: Direction): number | undefined {
  const a = centre(from);
  const b = centre(to);
  const vertical = dir === 'up' || dir === 'down';
  const sign = dir === 'down' || dir === 'right' ? 1 : -1;
  const along = vertical ? (b.y - a.y) * sign : (b.x - a.x) * sign;
  // Beyond: the candidate starts past the current element's far edge (1 px of slack for rounding).
  const beyond =
    dir === 'down'
      ? to.top >= from.bottom - EDGE_SLACK
      : dir === 'up'
        ? to.bottom <= from.top + EDGE_SLACK
        : dir === 'right'
          ? to.left >= from.right - EDGE_SLACK
          : to.right <= from.left + EDGE_SLACK;
  if (!beyond || along <= 0) return undefined;
  const primary = vertical
    ? gap(from.top, from.bottom, to.top, to.bottom)
    : gap(from.left, from.right, to.left, to.right);
  const sideways = vertical
    ? gap(from.left, from.right, to.left, to.right)
    : gap(from.top, from.bottom, to.top, to.bottom);
  const offset = vertical ? Math.abs(b.x - a.x) : Math.abs(b.y - a.y);
  return primary + 2 * sideways + 0.1 * offset + 0.01 * along;
}

/** The best candidate in `dir` from `from` (first in order on a tie), or undefined. */
export function spatialPick<T>(
  from: Rect,
  candidates: readonly { readonly item: T; readonly rect: Rect }[],
  dir: Direction,
): T | undefined {
  let best: T | undefined;
  let bestScore = Infinity;
  for (const { item, rect } of candidates) {
    const score = spatialScore(from, rect, dir);
    if (score !== undefined && score < bestScore) {
      best = item;
      bestScore = score;
    }
  }
  return best;
}

export interface FocusManagerOptions {
  /** Element geometry; defaults to getBoundingClientRect. */
  readonly rectOf?: (el: HTMLElement) => Rect;
}

const boundingRect = (el: HTMLElement): Rect => el.getBoundingClientRect();

export class FocusManager {
  readonly #rectOf: (el: HTMLElement) => Rect;

  constructor(options: FocusManagerOptions = {}) {
    this.#rectOf = options.rectOf ?? boundingRect;
  }

  /** The focused element if it is inside `scope`. */
  current(scope: Element): HTMLElement | undefined {
    const active = scope.ownerDocument.activeElement;
    return active instanceof HTMLElement && active !== scope && scope.contains(active)
      ? active
      : undefined;
  }

  /** Focuses `scope`'s `[data-autofocus]` element, else its first focusable. */
  focusFirst(scope: Element): boolean {
    const all = focusables(scope);
    const target = all.find((el) => el.hasAttribute('data-autofocus')) ?? all[0];
    if (target === undefined) return false;
    target.focus();
    return true;
  }

  /**
   * Moves focus to the nearest focusable in `dir` inside `scope`. With nothing focused in the scope
   * yet, focuses the first one. Returns whether focus moved.
   */
  move(scope: Element, dir: Direction): boolean {
    const from = this.current(scope);
    if (from === undefined) return this.focusFirst(scope);
    const candidates = focusables(scope)
      .filter((el) => el !== from)
      .map((el) => ({ item: el, rect: this.#rectOf(el) }));
    const target = spatialPick(this.#rectOf(from), candidates, dir);
    if (target === undefined) return false;
    target.focus();
    return true;
  }

  /** Tab order inside `scope`, wrapping at the ends (the modal focus trap). */
  step(scope: Element, delta: 1 | -1): boolean {
    const all = focusables(scope);
    if (all.length === 0) return false;
    const from = this.current(scope);
    const index = from === undefined ? -1 : all.indexOf(from);
    const next =
      index === -1 ? (delta === 1 ? 0 : all.length - 1) : (index + delta + all.length) % all.length;
    all[next]?.focus();
    return true;
  }
}
