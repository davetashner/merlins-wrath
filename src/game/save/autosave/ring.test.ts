// Autosave ring slot choice (mw-e30.5): empty first, then unreadable, then the oldest save.
import { describe, expect, it } from 'vitest';
import { SaveCorruptError } from '../format/index';
import type { SlotId, SlotSummary } from '../slots/index';
import { pickAutosaveSlot } from './ring';

const empty = (slot: SlotId): SlotSummary => ({ state: 'empty', slot, kind: 'autosave' });
const saved = (slot: SlotId, savedAt: number): SlotSummary => ({
  state: 'ready',
  slot,
  kind: 'autosave',
  savedAt,
  gameVersion: '0.2.0',
  details: undefined,
});
const broken = (slot: SlotId): SlotSummary => ({
  state: 'unreadable',
  slot,
  kind: 'autosave',
  error: new SaveCorruptError('bad'),
});

describe('pickAutosaveSlot', () => {
  it('fills empty slots first, in ring order', () => {
    expect(pickAutosaveSlot([saved('auto-1', 5), empty('auto-2'), empty('auto-3')])).toBe('auto-2');
    expect(pickAutosaveSlot([broken('auto-1'), saved('auto-2', 1), empty('auto-3')])).toBe(
      'auto-3',
    );
  });

  it('replaces an unreadable save before any readable one', () => {
    expect(pickAutosaveSlot([saved('auto-1', 1), broken('auto-2'), saved('auto-3', 2)])).toBe(
      'auto-2',
    );
  });

  it('AC-1: replaces the oldest save when all are readable, ties going to ring order', () => {
    expect(pickAutosaveSlot([saved('auto-1', 30), saved('auto-2', 10), saved('auto-3', 20)])).toBe(
      'auto-2',
    );
    expect(pickAutosaveSlot([saved('auto-1', 7), saved('auto-2', 7), saved('auto-3', 9)])).toBe(
      'auto-1',
    );
  });

  it('throws on an empty ring', () => {
    expect(() => pickAutosaveSlot([])).toThrow(TypeError);
  });
});
