// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VirtualList } from '@ui/components/list';
import { UiRoot, uiIntentEvent } from '@ui/screens';
import { rectFromData } from '@ui/testing/layout';

const items = (n: number): string[] => Array.from({ length: n }, (_, i) => `Item ${String(i)}`);
let ui: UiRoot;

beforeEach(() => {
  document.body.innerHTML = '';
  ui = new UiRoot(document.body, { focus: { rectOf: rectFromData } });
});

function open<T>(list: VirtualList<T>): void {
  ui.push({ id: 'list', label: 'List', content: list.element });
}

const rows = (list: VirtualList<string>): string[] =>
  [...list.element.querySelectorAll<HTMLElement>('[role="option"]')]
    .map((row) => Number(row.dataset['index']))
    .sort((a, b) => a - b)
    .map(String);

describe('VirtualList', () => {
  it('renders only the rows in view plus overscan, however long the list', () => {
    const list = new VirtualList({
      label: 'Items',
      items: items(500),
      text: (s) => s,
      visibleRows: 6,
      overscan: 2,
    });
    // Rows 0–8: 6 in view, one partly scrolled in, 2 overscan below (none above row 0).
    expect(list.renderedCount).toBe(9);
    expect(list.element.style.height).toBe('12em');
    // Scrolled to row 100 (16 px font × 2 em rows): rows 98–108 plus the active row 0.
    list.element.scrollTop = 100 * 32;
    list.element.dispatchEvent(new Event('scroll'));
    expect(rows(list)).toEqual(['0', ...Array.from({ length: 11 }, (_, i) => String(98 + i))]);
  });

  it('keeps one tab stop (roving tabindex) and moves it with up/down while focused', () => {
    const onSelect = vi.fn();
    const list = new VirtualList({ label: 'Items', items: items(20), text: (s) => s, onSelect });
    open(list);
    const focused = (): string | undefined =>
      (document.activeElement as HTMLElement).dataset['index'];
    expect(focused()).toBe('0');
    const tabbable = list.element.querySelectorAll('[tabindex="0"]');
    expect(tabbable).toHaveLength(1);
    ui.intent('down', 'gamepad');
    ui.intent('down', 'gamepad');
    expect(focused()).toBe('2');
    expect(list.activeIndex).toBe(2);
    expect(list.element.querySelector('[aria-selected="true"]')?.textContent).toBe('Item 2');
    ui.intent('confirm', 'keyboard');
    expect(onSelect).toHaveBeenCalledWith('Item 2', 2);
    ui.intent('up', 'keyboard');
    ui.intent('up', 'keyboard');
    expect(focused()).toBe('0');
    ui.intent('up', 'keyboard'); // edge: handed back to spatial nav (nothing above → stays)
    expect(focused()).toBe('0');
    ui.intent('left', 'keyboard'); // a list has no columns
    expect(focused()).toBe('0');
  });

  it('scrolls the active row into view in both directions', () => {
    const list = new VirtualList({
      label: 'Items',
      items: items(50),
      text: (s) => s,
      visibleRows: 4,
    });
    open(list);
    list.focusIndex(10);
    expect(list.element.scrollTop).toBe((11 - 4) * 32);
    list.focusIndex(2);
    expect(list.element.scrollTop).toBe(2 * 32);
    list.focusIndex(99); // out of range: ignored
    expect(list.activeIndex).toBe(2);
  });

  it('moves in two dimensions as a grid and leaves at the side edges', () => {
    const list = new VirtualList({ label: 'Spells', items: items(10), text: (s) => s, columns: 4 });
    expect(list.element.dataset['uiComponent']).toBe('grid');
    open(list);
    ui.intent('right', 'gamepad');
    ui.intent('down', 'gamepad');
    expect(list.activeIndex).toBe(5);
    ui.intent('left', 'gamepad');
    expect(list.activeIndex).toBe(4);
    ui.intent('left', 'gamepad'); // column 0: not consumed
    expect(list.activeIndex).toBe(4);
    list.focusIndex(7);
    ui.intent('right', 'gamepad'); // last column: not consumed
    ui.intent('down', 'gamepad'); // index 11 does not exist
    expect(list.activeIndex).toBe(7);
    const row = list.element.querySelector<HTMLElement>('[data-index="5"]');
    expect(row?.style.left).toBe('25%');
    expect(row?.style.width).toBe('25%');
  });

  it('selects on click and survives item changes, including an empty list', () => {
    const onSelect = vi.fn();
    const list = new VirtualList({ label: 'Items', items: items(5), text: (s) => s, onSelect });
    open(list);
    list.element.querySelector<HTMLElement>('[data-index="3"]')?.click();
    expect(onSelect).toHaveBeenCalledWith('Item 3', 3);
    expect(list.activeIndex).toBe(3);
    list.setItems(items(2));
    expect(list.activeIndex).toBe(1);
    expect(list.items).toHaveLength(2);
    list.setItems([]);
    expect(list.renderedCount).toBe(0);
    const confirm = uiIntentEvent('confirm', 'keyboard');
    list.element.dispatchEvent(confirm);
    expect(confirm.defaultPrevented).toBe(false);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('sizes rows from the computed font size', () => {
    const list = new VirtualList({ label: 'Items', items: items(100), text: (s) => s });
    document.body.append(list.element);
    list.element.style.fontSize = '32px';
    list.element.scrollTop = 20 * 64;
    list.render();
    expect(rows(list)).toContain('18');
    expect(rows(list)).not.toContain('17');
  });
});
