// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { button } from '@ui/components/controls';
import { tabs } from '@ui/components/tabs';
import { UiRoot } from '@ui/screens';
import { find, place, rectFromData } from '@ui/testing/layout';

let ui: UiRoot;
beforeEach(() => {
  document.body.innerHTML = '';
  ui = new UiRoot(document.body, { focus: { rectOf: rectFromData } });
});

const panel = (text: string): HTMLElement => {
  const p = document.createElement('p');
  p.textContent = text;
  return p;
};

function journal(onChange = vi.fn()) {
  return tabs({
    label: 'Journal',
    tabs: [
      { id: 'quests', label: 'Quests', panel: panel('q') },
      { id: 'rumours', label: 'Rumours', panel: panel('r') },
      { id: 'notes', label: 'Notes', panel: panel('n') },
    ],
    onChange,
  });
}

const visible = (el: HTMLElement): string[] =>
  [...el.querySelectorAll<HTMLElement>('[role="tabpanel"]')]
    .filter((p) => !p.hidden)
    .map((p) => p.textContent);

describe('tabs', () => {
  it('links tabs and panels and shows only the selected panel', () => {
    const t = journal();
    const tab = find('[role="tab"]', t.element);
    const panelEl = t.element.querySelector(`#${tab.getAttribute('aria-controls') ?? ''}`);
    expect(t.element.contains(panelEl)).toBe(true);
    expect(panelEl?.getAttribute('aria-labelledby')).toBe(tab.id);
    expect(t.selected).toBe('quests');
    expect(visible(t.element)).toEqual(['q']);
    expect(t.element.querySelectorAll('[role="tab"][tabindex="0"]')).toHaveLength(1);
  });

  it('switches with tabPrev/tabNext from anywhere on the screen, wrapping', () => {
    const onChange = vi.fn();
    const t = journal(onChange);
    const elsewhere = place(button({ label: 'Elsewhere', autofocus: true }), 0, 200);
    const content = document.createElement('div');
    content.append(t.element, elsewhere);
    ui.push({ id: 'journal', label: 'Journal', content });
    expect(document.activeElement).toBe(elsewhere);
    ui.intent('tabNext', 'gamepad');
    expect(t.selected).toBe('rumours');
    ui.intent('tabPrev', 'gamepad');
    ui.intent('tabPrev', 'gamepad');
    expect(t.selected).toBe('notes');
    expect(document.activeElement).toBe(elsewhere); // focus stays off the strip
    expect(onChange.mock.calls.flat()).toEqual(['rumours', 'quests', 'notes']);
  });

  it('switches with left/right and click while the strip has focus', () => {
    const t = journal();
    ui.push({ id: 'journal', label: 'Journal', content: t.element });
    expect((document.activeElement as HTMLElement).dataset['tab']).toBe('quests');
    ui.intent('right', 'keyboard');
    expect(t.selected).toBe('rumours');
    expect((document.activeElement as HTMLElement).dataset['tab']).toBe('rumours');
    ui.intent('left', 'keyboard');
    ui.intent('left', 'keyboard');
    expect(t.selected).toBe('notes');
    ui.intent('tabNext', 'keyboard');
    expect((document.activeElement as HTMLElement).dataset['tab']).toBe('quests');
    find('[data-tab="rumours"]', t.element).click();
    expect(t.selected).toBe('rumours');
    ui.intent('down', 'keyboard'); // not a tab intent
    t.select('notes');
    expect(visible(t.element)).toEqual(['n']);
    t.select('notes'); // no change
    expect(() => {
      t.select('maps');
    }).toThrow(RangeError);
  });

  it('starts on the requested tab and needs at least one', () => {
    const t = tabs({
      label: 'x',
      selected: 'b',
      tabs: [
        { id: 'a', label: 'A', panel: panel('a') },
        { id: 'b', label: 'B', panel: panel('b') },
      ],
    });
    expect(t.selected).toBe('b');
    expect(() => tabs({ label: 'x', tabs: [] })).toThrow(RangeError);
  });
});
