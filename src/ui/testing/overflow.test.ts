// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import type { Rect } from '@ui/focus';
import { find } from '@ui/testing/layout';
import { browserGeometry, findClippedText, type OverflowGeometry } from '@ui/testing/overflow';

const box = (left: number, top: number, width: number, height: number): Rect => ({
  left,
  top,
  right: left + width,
  bottom: top + height,
});

/** Geometry from data attributes: data-box on elements, data-text-box on the text's parent. */
const fake: OverflowGeometry = {
  textRect(node) {
    const spec = node.parentElement?.dataset['textBox'];
    if (spec === undefined) return undefined;
    const [l = 0, t = 0, w = 0, h = 0] = spec.split(',').map(Number);
    return box(l, t, w, h);
  },
  clipRect(el) {
    const [l = 0, t = 0, w = 0, h = 0] = ((el as HTMLElement).dataset['box'] ?? '')
      .split(',')
      .map(Number);
    return box(l, t, w, h);
  },
  overflow(el) {
    const [x = 'visible', y = x] = ((el as HTMLElement).dataset['overflow'] ?? 'visible').split(
      ' ',
    );
    return { x, y };
  },
};

describe('findClippedText', () => {
  it('AC-4 helper: reports text that spills out of an overflow-hiding ancestor', () => {
    document.body.innerHTML = `
      <div id="root">
        <div class="bar" data-overflow="hidden" data-box="0,0,100,20">
          <span data-text-box="0,0,150,20">Too long for the bar</span>
          <span data-text-box="0,0,80,20">Fits</span>
        </div>
        <div data-overflow="visible clip" data-box="0,100,100,20">
          <span data-text-box="0,110,300,20">Wide is fine, tall is not</span>
          <span data-text-box="0,100,300,20">Wide only</span>
        </div>
        <div data-overflow="auto" data-box="0,200,100,20">
          <p data-overflow="hidden" data-box="0,200,100,20" data-text-box="0,195,50,20">Scrollable</p>
          <span data-text-box="0,300,500,20">In a scroller</span>
        </div>
        <span>   </span>
        <span>Not rendered</span>
      </div>`;
    const root = find('#root');
    expect(findClippedText(root, fake)).toEqual([
      { text: 'Too long for the bar', clippedBy: 'div.bar' },
      { text: 'Wide is fine, tall is not', clippedBy: 'div' },
      { text: 'Scrollable', clippedBy: 'p' },
    ]);
  });

  it('reads real geometry through Range and getComputedStyle', () => {
    document.body.innerHTML =
      '<div id="root" style="overflow-x: hidden; overflow-y: hidden; text-overflow: ellipsis"><span>Text</span></div>';
    const root = find('#root');
    const geometry = browserGeometry(window);
    expect(geometry.overflow(root)).toEqual({ x: 'hidden', y: 'hidden' });
    expect(geometry.clipRect(root)).toMatchObject({ left: 0, top: 0 });
    const text = root.querySelector('span')?.firstChild as Text;
    // happy-dom has no layout: text has no box, so nothing can be clipped.
    expect(geometry.textRect(text)).toBeUndefined();
    expect(findClippedText(root, geometry)).toEqual([]);
    const measured = vi.spyOn(Range.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      right: 40,
      bottom: 10,
      width: 40,
      height: 10,
    } as DOMRect);
    expect(geometry.textRect(text)).toMatchObject({ width: 40 });
    measured.mockRestore();
    const plain = document.createElement('div');
    plain.style.overflowX = 'auto';
    document.body.append(plain);
    expect(geometry.overflow(plain).x).toBe('auto');
  });
});
