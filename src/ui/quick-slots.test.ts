// @vitest-environment happy-dom
// The quick-slot HUD strip (mw-e17.10) and the placeholder item icons: slot states and labels, DOM
// writes only on change, and sizes from the HUD scale.
import { describe, expect, it } from 'vitest';
import { ITEM_ICON_KINDS, ITEM_ICON_PATHS, itemIcon } from '@ui/item-icons';
import {
  QUICK_SLOT_BASE,
  QuickSlotHud,
  quickSlotLabel,
  quickSlotLayout,
  slotState,
  type QuickSlotModel,
} from '@ui/quick-slots';

const DRAUGHT: QuickSlotModel = { label: 'Healing draught', icon: 'consumable', count: 3 };
const EMPTY: QuickSlotModel = { label: '', icon: null, count: 0 };

describe('QuickSlotHud', () => {
  it('shows four slots: icon, number and count, labelled for screen readers', () => {
    const hud = new QuickSlotHud();
    hud.update([EMPTY, DRAUGHT, { ...DRAUGHT, count: 0 }]);
    const slots = [...hud.element.querySelectorAll<HTMLElement>('.vb-quick-slot')];
    expect(hud.element.getAttribute('aria-label')).toBe('Quick slots');
    expect(slots.map((slot) => slot.getAttribute('aria-label'))).toEqual([
      'Quick slot 1: empty',
      'Quick slot 2: Healing draught, 3',
      'Quick slot 3: Healing draught, none left',
      'Quick slot 4: empty',
    ]);
    expect(slots.map((slot) => slot.dataset['state'])).toEqual([
      'empty',
      'ready',
      'depleted',
      'empty',
    ]);
    expect(slots.map((slot) => slot.querySelector('.vb-quick-slot-count')?.textContent)).toEqual([
      '',
      '3',
      '0',
      '',
    ]);
    expect(slots[1]?.querySelector('svg')?.dataset['icon']).toBe('consumable');
    expect(slots[0]?.querySelector('svg')).toBeNull();
    expect(slots[3]?.querySelector('.vb-quick-slot-key')?.textContent).toBe('4');
  });

  it('touches the DOM only when a shown value changes', () => {
    const hud = new QuickSlotHud({ slots: 1 });
    hud.update([DRAUGHT]);
    const icon = hud.element.querySelector('svg');
    hud.update([{ ...DRAUGHT }]);
    expect(hud.element.querySelector('svg')).toBe(icon);
    hud.update([EMPTY]);
    expect(hud.element.querySelector('svg')).toBeNull();
  });

  it('sizes the slots from the HUD scale, clamped to 75–200 %', () => {
    const hud = new QuickSlotHud({ scale: 1.5 });
    const slot = hud.element.querySelector<HTMLElement>('.vb-quick-slot');
    expect(slot?.style.width).toBe(`${String(QUICK_SLOT_BASE.size * 1.5)}px`);
    expect(hud.element.style.bottom).toBe(`${String(QUICK_SLOT_BASE.margin * 1.5)}px`);
    expect(hud.element.dataset['scale']).toBe('1.5');
    hud.setScale(9);
    expect(hud.layout).toEqual(quickSlotLayout(2));
    expect(slot?.style.height).toBe(`${String(QUICK_SLOT_BASE.size * 2)}px`);
    expect(new QuickSlotHud().layout.scale).toBe(1);
    expect(quickSlotLayout(Number.NaN).scale).toBe(1);
  });

  it('names slot states', () => {
    expect(slotState(EMPTY)).toBe('empty');
    expect(slotState(DRAUGHT)).toBe('ready');
    expect(slotState({ ...DRAUGHT, count: 0 })).toBe('depleted');
    expect(quickSlotLabel(0, DRAUGHT)).toBe('Quick slot 1: Healing draught, 3');
  });
});

describe('placeholder item icons', () => {
  it('draws a decorative glyph for every kind', () => {
    for (const kind of ITEM_ICON_KINDS) {
      const svg = itemIcon(kind);
      expect(svg.getAttribute('aria-hidden')).toBe('true');
      expect(svg.getAttribute('class')).toBe('vb-icon');
      expect(svg.querySelector('path')?.getAttribute('d')).toBe(ITEM_ICON_PATHS[kind]);
    }
    expect(itemIcon('key', 'big').getAttribute('class')).toBe('big');
  });
});
