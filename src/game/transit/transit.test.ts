// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { Arrival } from './controller';
import { peekTransit, takeTransit, transitSearch, TRANSIT_KEY, writeTransit } from './payload';
import type { Transit } from './payload';

const transit: Transit = {
  from: 'a',
  to: 'b',
  spawn: 'arrive-from-a',
  follow: false,
  areaName: 'Area B',
  startedAt: 1_000,
  carry: { sections: {}, player: { components: {} } },
};

const store = () => {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (k: string) => items.get(k) ?? null,
    setItem: (k: string, v: string) => void items.set(k, v),
    removeItem: (k: string) => void items.delete(k),
  };
};

describe('transit hand-off (mw-e01.11)', () => {
  it('round-trips through storage and is consumed on take', () => {
    const s = store();
    writeTransit(s, transit);
    expect(peekTransit(s)).toEqual(transit);
    expect(takeTransit(s)).toEqual(transit);
    expect(takeTransit(s)).toBeUndefined();
  });

  it('drops malformed hand-offs', () => {
    const s = store();
    s.setItem(TRANSIT_KEY, '{nope');
    expect(takeTransit(s)).toBeUndefined();
    s.setItem(TRANSIT_KEY, JSON.stringify({ ...transit, to: '' }));
    expect(takeTransit(s)).toBeUndefined();
    expect(s.items.size).toBe(0);
  });

  it('boots the target scene and drops the parameters that would fight the carried state', () => {
    expect(transitSearch('?scene=a&class=knight&newgame&menu=title&spawn=x&debug=1', 'b')).toBe(
      'scene=b&debug=1',
    );
  });

  it('times the arrival and shows the overlay only if it outlasted the delay', () => {
    vi.useFakeTimers();
    const parent = document.createElement('div');
    let now = 1_300;
    const quick = new Arrival(transit, { overlayParent: parent, now: () => now });
    expect(quick.playable()).toMatchObject({ kind: 'arrived', ms: 300, overlay: false });
    const slow = new Arrival(transit, { overlayParent: parent, now: () => now });
    vi.advanceTimersByTime(600);
    now = 2_600;
    expect(parent.querySelector('[data-testid="area-loading"]')).not.toBeNull();
    expect(slow.playable()).toMatchObject({ ms: 1_600, overlay: true });
    expect(parent.children).toHaveLength(0);
    new Arrival(transit, { overlayParent: parent, now: () => now }).dismiss();
    vi.useRealTimers();
  });
});
