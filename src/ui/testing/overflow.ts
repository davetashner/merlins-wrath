// Clipped-text finder (mw-e00.23 AC-4), used by e2e tests at large text scales. A text node is
// clipped when part of its box lies outside an ancestor that hides overflow (`overflow: hidden` or
// `clip` on that axis, or `text-overflow: ellipsis` truncating it). Text inside a scroll container is
// not clipped (the player can scroll to it), so the walk stops at scrollable ancestors: they clip
// visually but show the text on demand. Geometry is injected so the rules are unit-tested; the
// browser default uses Range and getComputedStyle.

import type { Rect } from '../focus';

export interface OverflowGeometry {
  /** The rendered box of a text node (Range.getBoundingClientRect), or undefined if not rendered. */
  textRect(node: Text): Rect | undefined;
  /** The element's padding box (its clip rectangle). */
  clipRect(el: Element): Rect;
  /** Computed overflow per axis. */
  overflow(el: Element): { readonly x: string; readonly y: string };
}

export interface ClippedText {
  /** The clipped text (trimmed, first 80 characters). */
  readonly text: string;
  /** A short path to the clipping ancestor, e.g. `div.vb-meter`. */
  readonly clippedBy: string;
}

/** Allowed rounding error in CSS px. */
const TOLERANCE = 1;

const SCROLLS = new Set(['auto', 'scroll']);
const CLIPS = new Set(['hidden', 'clip']);

function describe(el: Element): string {
  const cls = el.classList.length > 0 ? `.${[...el.classList].join('.')}` : '';
  return `${el.tagName.toLowerCase()}${cls}`;
}

export const browserGeometry = (win: Window): OverflowGeometry => ({
  textRect(node) {
    const range = node.ownerDocument.createRange();
    range.selectNodeContents(node);
    const rect = range.getBoundingClientRect();
    return rect.width === 0 && rect.height === 0 ? undefined : rect;
  },
  clipRect(el) {
    const rect = el.getBoundingClientRect();
    const style = win.getComputedStyle(el);
    const px = (value: string): number => parseFloat(value) || 0;
    const left = rect.left + px(style.borderLeftWidth);
    const top = rect.top + px(style.borderTopWidth);
    return { left, top, right: left + el.clientWidth, bottom: top + el.clientHeight };
  },
  overflow(el) {
    const style = win.getComputedStyle(el);
    const ellipsis = style.textOverflow === 'ellipsis' ? 'hidden' : undefined;
    return { x: ellipsis ?? style.overflowX, y: style.overflowY };
  },
});

/** Every clipped text node under `root`. */
export function findClippedText(root: Element, geometry: OverflowGeometry): ClippedText[] {
  const found: ClippedText[] = [];
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = node as Text;
    const content = text.data.trim();
    if (content === '') continue;
    const rect = geometry.textRect(text);
    if (rect === undefined) continue;
    for (let el = text.parentElement; el !== null; el = el.parentElement) {
      const { x, y } = geometry.overflow(el);
      if (SCROLLS.has(x) || SCROLLS.has(y)) break;
      const clipX = CLIPS.has(x);
      const clipY = CLIPS.has(y);
      if (!clipX && !clipY) continue;
      const clip = geometry.clipRect(el);
      const outX =
        clipX && (rect.left < clip.left - TOLERANCE || rect.right > clip.right + TOLERANCE);
      const outY =
        clipY && (rect.top < clip.top - TOLERANCE || rect.bottom > clip.bottom + TOLERANCE);
      if (outX || outY) {
        found.push({ text: content.slice(0, 80), clippedBy: describe(el) });
        break;
      }
    }
  }
  return found;
}
