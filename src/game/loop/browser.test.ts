import { describe, expect, it, vi } from 'vitest';
import { browserFrameSources } from './browser';

function fakeHost() {
  const listeners = new Set<() => void>();
  const document = {
    hidden: false,
    addEventListener: vi.fn((type: string, listener: () => void) => {
      if (type === 'visibilitychange') listeners.add(listener);
    }),
    removeEventListener: vi.fn((type: string, listener: () => void) => {
      if (type === 'visibilitychange') listeners.delete(listener);
    }),
  };
  let queued: FrameRequestCallback | undefined;
  const host = {
    document,
    performance: { now: () => 42 },
    requestAnimationFrame: vi.fn((callback: FrameRequestCallback) => {
      queued = callback;
      return 7;
    }),
    cancelAnimationFrame: vi.fn(),
  };
  return { host, listeners, runFrame: () => queued?.(0) };
}

describe('browserFrameSources', () => {
  it('reads time from performance.now', () => {
    const { host } = fakeHost();
    expect(browserFrameSources(host as never).now()).toBe(42);
  });

  it('schedules and cancels through requestAnimationFrame', () => {
    const { host, runFrame } = fakeHost();
    const { scheduler } = browserFrameSources(host as never);
    const callback = vi.fn();
    expect(scheduler.request(callback)).toBe(7);
    runFrame();
    expect(callback).toHaveBeenCalledOnce();
    scheduler.cancel(7);
    expect(host.cancelAnimationFrame).toHaveBeenCalledWith(7);
  });

  it('AC-3: reports document.hidden and subscribes to visibilitychange', () => {
    const { host, listeners } = fakeHost();
    const { visibility } = browserFrameSources(host as never);
    expect(visibility.hidden).toBe(false);
    host.document.hidden = true;
    expect(visibility.hidden).toBe(true);
    const listener = vi.fn();
    const off = visibility.subscribe(listener);
    for (const l of listeners) l();
    expect(listener).toHaveBeenCalledOnce();
    off();
    expect(listeners.size).toBe(0);
  });
});
