// The pending-load hand-off across the reload (mw-e30.7): written by the death screen, consumed once
// on boot, and dropped when malformed.
import { describe, expect, it } from 'vitest';
import {
  clearPendingLoad,
  PENDING_LOAD_KEY,
  takePendingLoad,
  writePendingLoad,
  type PendingLoadStorage,
} from './pending';

function storage(): PendingLoadStorage & { items: Map<string, string> } {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, value);
    },
    removeItem: (key) => {
      items.delete(key);
    },
  };
}

describe('pending load', () => {
  it('round-trips a load once, then is gone (a later refresh does not load again)', () => {
    const s = storage();
    writePendingLoad(s, { slot: 'manual-1', areaId: 'testbed', requestedAt: 1234 });
    expect(takePendingLoad(s)).toEqual({ slot: 'manual-1', areaId: 'testbed', requestedAt: 1234 });
    expect(takePendingLoad(s)).toBeUndefined();
    writePendingLoad(s, { slot: 'quick', areaId: undefined });
    expect(s.items.get(PENDING_LOAD_KEY)).toBe('{"slot":"quick"}');
    expect(takePendingLoad(s)).toEqual({ slot: 'quick', areaId: undefined });
  });

  it('clears a pending load (Restart area)', () => {
    const s = storage();
    writePendingLoad(s, { slot: 'auto-2', areaId: 'testbed' });
    clearPendingLoad(s);
    expect(takePendingLoad(s)).toBeUndefined();
  });

  it.each([
    ['not json', '{'],
    ['not an object', '3'],
    ['null', 'null'],
    ['no slot', '{"areaId":"testbed"}'],
    ['an unknown slot', '{"slot":"manual-99"}'],
  ])('drops a malformed hand-off (%s)', (_name, text) => {
    const s = storage();
    s.setItem(PENDING_LOAD_KEY, text);
    expect(takePendingLoad(s)).toBeUndefined();
    expect(s.items.has(PENDING_LOAD_KEY)).toBe(false);
  });

  it('carries a respawn rule across the reload (mw-e01.8), dropping a malformed one', () => {
    const s = storage();
    writePendingLoad(s, { slot: 'manual-1', areaId: 'slice', respawn: { rule: 'slice-reload' } });
    expect(takePendingLoad(s)).toEqual({
      slot: 'manual-1',
      areaId: 'slice',
      requestedAt: undefined,
      respawn: { rule: 'slice-reload' },
    });
    writePendingLoad(s, { slot: 'manual-1', areaId: 'slice', respawn: { rule: null } });
    expect(takePendingLoad(s)?.respawn).toEqual({ rule: null });
    for (const respawn of ['"x"', 'null', '{"rule":3}']) {
      s.setItem(PENDING_LOAD_KEY, `{"slot":"manual-1","respawn":${respawn}}`);
      expect(takePendingLoad(s)).toEqual({ slot: 'manual-1', areaId: undefined });
    }
  });

  it('ignores a non-string area', () => {
    const s = storage();
    s.setItem(PENDING_LOAD_KEY, '{"slot":"manual-2","areaId":4}');
    expect(takePendingLoad(s)).toEqual({ slot: 'manual-2', areaId: undefined });
  });
});
