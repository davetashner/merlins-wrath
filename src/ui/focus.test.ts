// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { FocusManager, focusables, spatialPick, spatialScore, type Rect } from '@ui/focus';
import { find, place, rectFromData } from '@ui/testing/layout';

const box = (left: number, top: number, width = 100, height = 30): Rect => ({
  left,
  top,
  right: left + width,
  bottom: top + height,
});

describe('spatial navigation', () => {
  const from = box(100, 100);

  it('only considers candidates wholly beyond the edge in the pressed direction', () => {
    expect(spatialScore(from, box(100, 140), 'down')).toBeDefined();
    expect(spatialScore(from, box(100, 120), 'down')).toBeUndefined(); // overlaps
    expect(spatialScore(from, box(100, 40), 'up')).toBeDefined();
    expect(spatialScore(from, box(210, 100), 'right')).toBeDefined();
    expect(spatialScore(from, box(150, 100), 'right')).toBeUndefined();
    expect(spatialScore(from, box(-10, 100), 'left')).toBeDefined();
    expect(spatialScore(from, box(100, 100), 'left')).toBeUndefined(); // same place
  });

  it('prefers the aligned neighbour over a nearer one off to the side', () => {
    const aligned = { item: 'aligned', rect: box(100, 200) };
    const offside = { item: 'offside', rect: box(400, 140) };
    expect(spatialPick(from, [offside, aligned], 'down')).toBe('aligned');
  });

  it('prefers the nearest of several aligned candidates, first on a tie, none when nothing is beyond', () => {
    const near = { item: 'near', rect: box(100, 140) };
    const far = { item: 'far', rect: box(100, 300) };
    const twin = { item: 'twin', rect: box(100, 140) };
    expect(spatialPick(from, [far, near, twin], 'down')).toBe('near');
    expect(spatialPick(from, [far, near], 'up')).toBeUndefined();
  });

  it('breaks ties between overlapping candidates by alignment', () => {
    const wide = box(0, 100, 400, 30);
    const left = { item: 'left', rect: box(0, 140) };
    const middle = { item: 'middle', rect: box(150, 140) };
    expect(spatialPick(wide, [left, middle], 'down')).toBe('middle');
  });
});

describe('focusables', () => {
  it('lists enabled, tabbable, visible, non-inert elements in DOM order', () => {
    document.body.innerHTML = `
      <div id="scope">
        <button id="a">a</button>
        <button id="b" disabled>b</button>
        <div id="c" tabindex="0">c</div>
        <div id="d" tabindex="-1">d</div>
        <div hidden><button id="e">e</button></div>
        <div inert><button id="f">f</button></div>
        <a id="g" href="#x">g</a>
        <a id="h">h</a>
      </div>`;
    const scope = find('#scope');
    expect(focusables(scope).map((el) => el.id)).toEqual(['a', 'c', 'g']);
    expect(() => find('#missing')).toThrow('nothing matches #missing');
  });
});

describe('FocusManager', () => {
  let scope: HTMLElement;
  let buttons: HTMLButtonElement[];
  const fm = new FocusManager({ rectOf: rectFromData });

  beforeEach(() => {
    document.body.innerHTML = '';
    scope = document.createElement('div');
    // a b
    // c
    buttons = ['a', 'b', 'c'].map((id) => {
      const b = document.createElement('button');
      b.id = id;
      return b;
    });
    const [a, b, c] = buttons as [HTMLButtonElement, HTMLButtonElement, HTMLButtonElement];
    place(a, 0, 0);
    place(b, 120, 0);
    place(c, 0, 50);
    scope.append(a, b, c);
    document.body.append(scope);
  });

  const active = (): string => (document.activeElement as HTMLElement).id;

  it('focuses the first focusable, or the [data-autofocus] one', () => {
    expect(fm.focusFirst(scope)).toBe(true);
    expect(active()).toBe('a');
    buttons[2]?.setAttribute('data-autofocus', '');
    fm.focusFirst(scope);
    expect(active()).toBe('c');
    expect(fm.focusFirst(document.createElement('div'))).toBe(false);
  });

  it('moves spatially and stays put at the edges', () => {
    expect(fm.current(scope)).toBeUndefined();
    expect(fm.move(scope, 'right')).toBe(true); // nothing focused yet: the first
    expect(active()).toBe('a');
    fm.move(scope, 'right');
    expect(active()).toBe('b');
    fm.move(scope, 'down');
    expect(active()).toBe('c');
    expect(fm.move(scope, 'down')).toBe(false);
    expect(active()).toBe('c');
    fm.move(scope, 'up');
    expect(active()).toBe('a');
    expect(fm.current(scope)?.id).toBe('a');
  });

  it('steps through Tab order with wrap-around (the modal trap)', () => {
    expect(fm.step(scope, -1)).toBe(true);
    expect(active()).toBe('c');
    fm.step(scope, 1);
    expect(active()).toBe('a');
    fm.step(scope, 1);
    fm.step(scope, 1);
    expect(active()).toBe('c');
    fm.step(scope, 1);
    expect(active()).toBe('a');
    fm.step(scope, -1);
    expect(active()).toBe('c');
    document.body.focus();
    expect(fm.step(scope, 1)).toBe(true);
    expect(active()).toBe('a');
    expect(fm.step(document.createElement('div'), 1)).toBe(false);
  });

  it('uses the real bounding boxes by default', () => {
    const real = new FocusManager();
    buttons[0]?.focus();
    // happy-dom lays nothing out: every box is empty, so nothing is "beyond".
    expect(real.move(scope, 'down')).toBe(false);
  });
});
