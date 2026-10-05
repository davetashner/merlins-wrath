// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { LOADING_OVERLAY_DELAY_MS, showAreaLoadingAfter } from './area-loading';

describe('area loading overlay (mw-e01.11)', () => {
  it('shows the area name only once the delay has passed', () => {
    vi.useFakeTimers();
    const parent = document.createElement('div');
    const loading = showAreaLoadingAfter(parent, 'Briar Glen Lane');
    vi.advanceTimersByTime(LOADING_OVERLAY_DELAY_MS - 1);
    expect(parent.querySelector('[data-testid="area-loading"]')).toBeNull();
    expect(loading.shown).toBe(false);
    vi.advanceTimersByTime(1);
    expect(parent.querySelector('[data-testid="area-loading"]')?.textContent).toBe(
      'Briar Glen Lane',
    );
    expect(loading.shown).toBe(true);
    loading.hide();
    loading.hide();
    expect(parent.querySelector('[data-testid="area-loading"]')).toBeNull();
    vi.useRealTimers();
  });

  it('never appears when the load finishes first', () => {
    vi.useFakeTimers();
    const parent = document.createElement('div');
    const loading = showAreaLoadingAfter(parent, 'Valley');
    loading.hide();
    vi.advanceTimersByTime(5_000);
    expect(parent.children).toHaveLength(0);
    expect(loading.shown).toBe(false);
    vi.useRealTimers();
  });

  it('takes the timer functions and the delay from its options', () => {
    const parent = document.createElement('div');
    const pending: { run: () => void; ms: number }[] = [];
    const cleared: unknown[] = [];
    const shown = vi.fn();
    const loading = showAreaLoadingAfter(parent, 'Hall', {
      delayMs: 50,
      setTimer: (run, ms) => pending.push({ run, ms }),
      clearTimer: (handle) => cleared.push(handle),
      onShown: shown,
    });
    expect(pending.map((p) => p.ms)).toEqual([50]);
    pending[0]?.run();
    expect(shown).toHaveBeenCalledOnce();
    loading.hide();
    expect(cleared).toHaveLength(1);
    // A timer that fires after hide() adds nothing.
    pending[0]?.run();
    expect(parent.children).toHaveLength(0);
  });
});
