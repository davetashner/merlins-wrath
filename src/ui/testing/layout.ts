// Fake layout for unit tests of the UI kit (mw-e00.23): happy-dom has no layout engine, so tests
// give elements boxes through `data-rect="left,top,width,height"` and pass `rectFromData` to the
// FocusManager (`new UiRoot(container, { focus: { rectOf: rectFromData } })`).
import type { Rect } from '../focus';

/** Sets an element's fake box. */
export function place<T extends HTMLElement>(
  el: T,
  left: number,
  top: number,
  width = 100,
  height = 30,
): T {
  el.dataset['rect'] = [left, top, width, height].join(',');
  return el;
}

/** Reads the fake box set by `place` (elements without one sit at the origin, zero-sized). */
export function rectFromData(el: HTMLElement): Rect {
  const [left = 0, top = 0, width = 0, height = 0] = (el.dataset['rect'] ?? '')
    .split(',')
    .map(Number);
  return { left, top, right: left + width, bottom: top + height };
}

/** The first element under `root` matching `selector`; throws when there is none. */
export function find(selector: string, root: ParentNode = document): HTMLElement {
  const el = root.querySelector<HTMLElement>(selector);
  if (el === null) throw new Error(`nothing matches ${selector}`);
  return el;
}
