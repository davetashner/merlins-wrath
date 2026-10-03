import { describe, expect, it } from 'vitest';
import {
  isDirection,
  keyIntent,
  padIntents,
  UiInputAdapter,
  type KeyLike,
  type UiDevice,
  type UiIntent,
  type UiPadLike,
} from '@ui/input';

const key = (code: string, extra: Partial<KeyLike> = {}): KeyLike => ({
  code,
  repeat: false,
  shiftKey: false,
  ctrlKey: false,
  altKey: false,
  metaKey: false,
  ...extra,
});

/** A standard-mapping pad with these buttons down and these axes. */
function pad(pressed: number[] = [], axes: number[] = [0, 0, 0, 0]): UiPadLike {
  return {
    connected: true,
    mapping: 'standard',
    buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i) })),
    axes,
  };
}

class FakeWindow {
  readonly listeners = new Map<string, Set<(event: Event) => void>>();
  addEventListener(type: string, listener: (event: Event) => void): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener);
  }
  removeEventListener(type: string, listener: (event: Event) => void): void {
    this.listeners.get(type)?.delete(listener);
  }
  /** Dispatches a keydown; returns whether the default was prevented. */
  keydown(k: KeyLike): boolean {
    let prevented = false;
    const event = { ...k, preventDefault: () => (prevented = true) } as unknown as Event;
    for (const listener of this.listeners.get('keydown') ?? []) listener(event);
    return prevented;
  }
}

function harness(handled = true) {
  const got: [UiIntent, UiDevice][] = [];
  const win = new FakeWindow();
  let pads: (UiPadLike | null)[] = [];
  let time = 0;
  const adapter = new UiInputAdapter((intent, device) => {
    got.push([intent, device]);
    return handled;
  });
  const detach = adapter.attach({
    window: win,
    navigator: { getGamepads: () => pads },
    now: () => time,
  });
  return {
    got,
    win,
    adapter,
    detach,
    setPads(next: (UiPadLike | null)[]) {
      pads = next;
    },
    at(ms: number) {
      time = ms;
      adapter.poll();
    },
  };
}

describe('keyIntent', () => {
  it('maps arrows, Enter/Space, Esc, Q/E, PageUp/PageDown and Tab', () => {
    expect(keyIntent(key('ArrowUp'))).toBe('up');
    expect(keyIntent(key('ArrowDown'))).toBe('down');
    expect(keyIntent(key('ArrowLeft'))).toBe('left');
    expect(keyIntent(key('ArrowRight'))).toBe('right');
    expect(keyIntent(key('Enter'))).toBe('confirm');
    expect(keyIntent(key('Space'))).toBe('confirm');
    expect(keyIntent(key('Escape'))).toBe('back');
    expect(keyIntent(key('KeyQ'))).toBe('tabPrev');
    expect(keyIntent(key('KeyR'))).toBe('secondary');
    expect(keyIntent({ ...key('KeyR'), repeat: true })).toBeUndefined();
    expect(keyIntent(key('PageDown'))).toBe('tabNext');
    expect(keyIntent(key('Tab'))).toBe('next');
    expect(keyIntent(key('Tab', { shiftKey: true }))).toBe('prev');
    expect(keyIntent(key('KeyZ'))).toBeUndefined();
  });

  it('leaves browser shortcuts alone and repeats only movement', () => {
    expect(keyIntent(key('KeyE', { ctrlKey: true }))).toBeUndefined();
    expect(keyIntent(key('ArrowUp', { altKey: true }))).toBeUndefined();
    expect(keyIntent(key('Enter', { metaKey: true }))).toBeUndefined();
    expect(keyIntent(key('ArrowDown', { repeat: true }))).toBe('down');
    expect(keyIntent(key('Tab', { repeat: true }))).toBe('next');
    expect(keyIntent(key('Enter', { repeat: true }))).toBeUndefined();
    expect(keyIntent(key('Escape', { repeat: true }))).toBeUndefined();
  });

  it('knows which intents are directions', () => {
    expect(isDirection('left')).toBe(true);
    expect(isDirection('confirm')).toBe(false);
  });
});

describe('padIntents', () => {
  it('maps the D-pad, A/B/X and LB/RB (standard mapping)', () => {
    expect([...padIntents(pad([0, 1, 2, 4, 5, 12, 13, 14, 15]))].sort()).toEqual(
      ['back', 'confirm', 'down', 'left', 'right', 'secondary', 'tabNext', 'tabPrev', 'up'].sort(),
    );
    expect(padIntents(pad([3, 9]))).toEqual(new Set());
  });

  it('reads the left stick past the threshold as directions', () => {
    expect([...padIntents(pad([], [-0.9, -0.9]))].sort()).toEqual(['left', 'up']);
    expect([...padIntents(pad([], [0.9, 0.9]))].sort()).toEqual(['down', 'right']);
    expect(padIntents(pad([], [0.3, -0.3]))).toEqual(new Set());
    expect(padIntents({ ...pad(), axes: [] })).toEqual(new Set());
  });
});

describe('UiInputAdapter', () => {
  it('emits keyboard intents and suppresses the browser default only when the UI used them', () => {
    const h = harness();
    expect(h.win.keydown(key('ArrowDown'))).toBe(true);
    expect(h.win.keydown(key('KeyZ'))).toBe(false);
    expect(h.got).toEqual([['down', 'keyboard']]);
    const idle = harness(false);
    expect(idle.win.keydown(key('ArrowDown'))).toBe(false);
    expect(idle.got).toEqual([['down', 'keyboard']]);
  });

  it('emits a pad press once, then repeats held directions after the delay', () => {
    const h = harness();
    h.setPads([pad([13, 0])]);
    h.at(0);
    expect(h.got).toEqual([
      ['confirm', 'gamepad'],
      ['down', 'gamepad'],
    ]);
    h.at(399);
    expect(h.got).toHaveLength(2);
    h.at(400); // first repeat; confirm never repeats
    h.at(519);
    h.at(520);
    expect(h.got.slice(2)).toEqual([
      ['down', 'gamepad'],
      ['down', 'gamepad'],
    ]);
    h.setPads([pad()]);
    h.at(600);
    h.setPads([pad([13])]);
    h.at(610); // a new press after release
    expect(h.got.at(-1)).toEqual(['down', 'gamepad']);
    expect(h.got).toHaveLength(5);
  });

  it('ignores pads that are not connected or not standard-mapped', () => {
    const h = harness();
    h.setPads([null, { ...pad([0]), connected: false }, { ...pad([0]), mapping: '' }]);
    h.at(0);
    expect(h.got).toEqual([]);
    expect(h.adapter.padConnected).toBe(false);
  });

  it('AC-6: a disconnect mid-hold emits nothing and throws nothing; the keyboard carries on', () => {
    const h = harness();
    h.setPads([pad([15])]);
    h.at(0);
    expect(h.adapter.padConnected).toBe(true);
    h.setPads([null]);
    expect(() => {
      h.at(1000);
    }).not.toThrow();
    expect(h.adapter.padConnected).toBe(false);
    h.win.keydown(key('ArrowLeft'));
    expect(h.got).toEqual([
      ['right', 'gamepad'],
      ['left', 'keyboard'],
    ]);
  });

  it('treats a throwing Gamepad API or a missing navigator as no pad', () => {
    const got: UiIntent[] = [];
    const a = new UiInputAdapter((intent) => {
      got.push(intent);
      return true;
    });
    a.attach({
      window: new FakeWindow(),
      navigator: {
        getGamepads: () => {
          throw new Error('blocked by permissions policy');
        },
      },
      now: () => 0,
    });
    expect(() => {
      a.poll();
    }).not.toThrow();
    const b = new UiInputAdapter(() => true);
    b.attach({ window: new FakeWindow(), now: () => 0 });
    b.poll();
    expect(got).toEqual([]);
    expect(b.padConnected).toBe(false);
  });

  it('detach removes the listener and stops polling', () => {
    const h = harness();
    h.detach();
    h.win.keydown(key('ArrowUp'));
    h.setPads([pad([0])]);
    h.at(0);
    expect(h.got).toEqual([]);
    expect(h.win.listeners.get('keydown')?.size).toBe(0);
  });

  it('handles keydown objects directly', () => {
    const got: UiIntent[] = [];
    const a = new UiInputAdapter((intent) => {
      got.push(intent);
      return false;
    });
    expect(a.keydown(key('Escape'))).toBe(false);
    expect(got).toEqual(['back']);
  });
});
