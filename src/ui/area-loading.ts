// The loading overlay of an area transition (mw-e01.11): the name of the area being entered over a
// dark veil, shown only when the load takes longer than LOADING_OVERLAY_DELAY_MS. A quick transition
// never flashes it. It is plain DOM over the canvas; both the page that leaves and the page that
// arrives start one (src/game/transit), so a slow hand-off shows it on whichever page is on screen.

/** A load that finishes inside this many milliseconds shows no overlay. */
export const LOADING_OVERLAY_DELAY_MS = 500;

/** A pending or shown loading overlay. */
export interface AreaLoading {
  /** Whether the overlay has appeared (the load outlasted the delay). */
  readonly shown: boolean;
  /** Cancels a pending overlay or removes a shown one; safe to call twice. */
  hide(): void;
}

export interface AreaLoadingOptions {
  /** Milliseconds to wait before showing; defaults to LOADING_OVERLAY_DELAY_MS. */
  readonly delayMs?: number;
  /** Timer functions, replaceable in tests. */
  readonly setTimer?: (callback: () => void, ms: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
  /** Called when the overlay appears. */
  readonly onShown?: () => void;
}

/**
 * Shows `areaName` over `parent` once the delay has passed, unless `hide()` comes first.
 * The overlay is `[data-testid="area-loading"]` with `role="status"`.
 */
export function showAreaLoadingAfter(
  parent: HTMLElement,
  areaName: string,
  options: AreaLoadingOptions = {},
): AreaLoading {
  const setTimer = options.setTimer ?? ((callback, ms) => globalThis.setTimeout(callback, ms));
  const clearTimer =
    options.clearTimer ??
    ((handle) => {
      globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>);
    });
  let element: HTMLElement | undefined;
  let done = false;
  const handle = setTimer(() => {
    if (done) return;
    const veil = parent.ownerDocument.createElement('div');
    veil.dataset['testid'] = 'area-loading';
    veil.setAttribute('role', 'status');
    veil.setAttribute('aria-live', 'polite');
    veil.style.cssText =
      'position:absolute;inset:0;z-index:50;display:flex;align-items:center;justify-content:center;' +
      'background:rgba(8,6,14,0.92);color:#e8e0d0;font:600 1.5rem/1.2 serif;letter-spacing:0.04em;';
    veil.textContent = areaName;
    parent.append(veil);
    element = veil;
    options.onShown?.();
  }, options.delayMs ?? LOADING_OVERLAY_DELAY_MS);
  return {
    get shown() {
      return element !== undefined;
    },
    hide() {
      if (done) return;
      done = true;
      clearTimer(handle);
      element?.remove();
    },
  };
}
