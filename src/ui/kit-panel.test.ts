// @vitest-environment happy-dom
// The kit panel (mw-e19.5): hidden without a class, one line per carried stack, and no DOM writes
// while nothing it shows changes.
import { describe, expect, it } from 'vitest';
import { kitLineText, KitPanel, type KitModel } from '@ui/kit-panel';

const SORCERER: KitModel = {
  className: 'Sorcerer',
  gold: 30,
  items: [
    { label: 'Ash staff', count: 1, equipped: true },
    { label: 'Mana draught', count: 2, equipped: false },
  ],
};

const lines = (panel: KitPanel): string[] =>
  [...panel.element.querySelectorAll('li')].map((li) => li.textContent);

describe('kit panel', () => {
  it('formats a line with its count and whether it is equipped', () => {
    expect(kitLineText({ label: 'Ash staff', count: 1, equipped: true })).toBe(
      'Ash staff (equipped)',
    );
    expect(kitLineText({ label: 'Mana draught', count: 2, equipped: false })).toBe(
      'Mana draught ×2',
    );
  });

  it('is hidden until there is a class, then shows the class, gold and kit', () => {
    const panel = new KitPanel();
    expect(panel.element.hidden).toBe(true);
    expect(panel.element.dataset['testid']).toBe('class-kit');
    panel.update(null);
    expect(panel.element.hidden).toBe(true);

    panel.update(SORCERER);
    expect(panel.element.hidden).toBe(false);
    expect(panel.element.querySelector('[data-part="class"]')?.textContent).toBe('Sorcerer');
    expect(panel.element.querySelector('[data-part="gold"]')?.textContent).toBe('30 gold');
    expect(lines(panel)).toEqual(['Ash staff (equipped)', 'Mana draught ×2']);
  });

  it('rewrites the list only when a line changes', () => {
    const panel = new KitPanel();
    panel.update(SORCERER);
    const first = panel.element.querySelector('li');
    panel.update({ ...SORCERER, items: [...SORCERER.items] });
    expect(panel.element.querySelector('li')).toBe(first);
    panel.update({ ...SORCERER, items: SORCERER.items.slice(1) });
    expect(lines(panel)).toEqual(['Mana draught ×2']);
  });
});
