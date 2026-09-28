import { describe, expect, it } from 'vitest';
import { ALL_SLOTS, AUTOSAVE_SLOTS, isSlotId, MANUAL_SLOTS, QUICKSAVE_SLOT, slotKind } from './ids';

describe('slot ids', () => {
  it('has 10 manual slots, a 3-slot autosave ring and one quicksave, in display order', () => {
    expect(MANUAL_SLOTS).toHaveLength(10);
    expect(MANUAL_SLOTS[0]).toBe('manual-1');
    expect(MANUAL_SLOTS[9]).toBe('manual-10');
    expect(AUTOSAVE_SLOTS).toEqual(['auto-1', 'auto-2', 'auto-3']);
    expect(ALL_SLOTS).toEqual([...MANUAL_SLOTS, ...AUTOSAVE_SLOTS, 'quick']);
  });

  it('recognises only known slots', () => {
    expect(ALL_SLOTS.every(isSlotId)).toBe(true);
    expect(['manual-0', 'manual-11', 'auto-4', 'quick-1', ''].some(isSlotId)).toBe(false);
  });

  it('classifies slots by kind', () => {
    expect([slotKind('manual-3'), slotKind('auto-2'), slotKind(QUICKSAVE_SLOT)]).toEqual([
      'manual',
      'autosave',
      'quicksave',
    ]);
  });
});
