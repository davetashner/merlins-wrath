// Playwright helpers for UI tests (mw-e00.23), driving pages that mount a UiRoot and expose
// window.__ui (testbed/ui.html, src/testbed/ui.ts). Screens are opened directly, navigation goes
// through real key presses or a virtual standard-mapping gamepad, and the checks (clipped text, axe,
// focus ring contrast) run against the real layout.
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';

export type UiStep =
  'up' | 'down' | 'left' | 'right' | 'confirm' | 'back' | 'tabPrev' | 'tabNext' | 'next' | 'prev';

export type UiDevice = 'keyboard' | 'gamepad';

const KEYS: Record<UiStep, string> = {
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
  confirm: 'Enter',
  back: 'Escape',
  tabPrev: 'q',
  tabNext: 'e',
  next: 'Tab',
  prev: 'Shift+Tab',
};

/** Standard-mapping button per step (Tab steps have no pad button). */
const PAD_BUTTONS: Partial<Record<UiStep, number>> = {
  confirm: 0,
  back: 1,
  tabPrev: 4,
  tabNext: 5,
  up: 12,
  down: 13,
  left: 14,
  right: 15,
};

interface UiHooks {
  openScreen(id: string): void;
  poll(): void;
  focus(): string | null;
  components(): string[];
  focusInTop(): boolean;
  topScreen(): string | null;
  clippedText(): { text: string; clippedBy: string }[];
  values(): Record<string, unknown>;
}

interface VirtualPad {
  buttons: number[];
  axes: number[];
  connected: boolean;
}

type UiWindow = Window & { __ui: UiHooks; __pad: VirtualPad };

/**
 * Plugs in a virtual standard-mapping gamepad (call before page.goto). Tests press its buttons with
 * `navigate(page, steps, 'gamepad')`, or unplug it with `setPadConnected`.
 */
export async function installVirtualPad(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const pad = { buttons: Array(17).fill(0) as number[], axes: [0, 0, 0, 0], connected: true };
    (window as unknown as { __pad: typeof pad }).__pad = pad;
    Object.defineProperty(Navigator.prototype, 'getGamepads', {
      configurable: true,
      value: () =>
        pad.connected
          ? [
              {
                id: 'Virtual Xbox Controller (STANDARD GAMEPAD)',
                index: 0,
                connected: true,
                mapping: 'standard',
                timestamp: performance.now(),
                axes: [...pad.axes],
                buttons: pad.buttons.map((value) => ({
                  pressed: value > 0.5,
                  touched: value > 0,
                  value,
                })),
              },
            ]
          : [null, null, null, null],
    });
  });
}

export async function setPadConnected(page: Page, connected: boolean): Promise<void> {
  await page.evaluate((on) => {
    (window as unknown as UiWindow).__pad.connected = on;
    (window as unknown as UiWindow).__ui.poll();
  }, connected);
}

/** Loads a UI testbed page and waits for its hooks. */
export async function openUiPage(page: Page, url = '/testbed/ui.html'): Promise<void> {
  await page.goto(url);
  await page.locator('#app[data-ready="true"]').waitFor();
}

/** Closes every screen and opens `id` fresh (focus on its first element). */
export async function openScreen(page: Page, id: string): Promise<void> {
  await page.evaluate((screen) => {
    (window as unknown as UiWindow).__ui.openScreen(screen);
  }, id);
}

/** Presses one step on `device`. */
export async function press(page: Page, step: UiStep, device: UiDevice): Promise<void> {
  if (device === 'keyboard') {
    await page.keyboard.press(KEYS[step]);
    return;
  }
  const index = PAD_BUTTONS[step];
  if (index === undefined) throw new Error(`no gamepad button for ${step}`);
  // Press, poll (the edge fires), release, poll: one tap, no repeat.
  await page.evaluate((button) => {
    const w = window as unknown as UiWindow;
    w.__pad.buttons[button] = 1;
    w.__ui.poll();
    w.__pad.buttons[button] = 0;
    w.__ui.poll();
  }, index);
}

/** Presses each step in turn. */
export async function navigate(
  page: Page,
  path: readonly UiStep[],
  device: UiDevice = 'keyboard',
): Promise<void> {
  for (const step of path) await press(page, step, device);
}

/** Keys (`screen/component#n`) of every focusable component in the top screen. */
export async function interactiveComponents(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as UiWindow).__ui.components());
}

/** The focused element's component key (`screen/component#n`), or null. */
export async function focused(page: Page): Promise<string | null> {
  return page.evaluate(() => (window as unknown as UiWindow).__ui.focus());
}

export async function focusInTopScreen(page: Page): Promise<boolean> {
  return page.evaluate(() => (window as unknown as UiWindow).__ui.focusInTop());
}

export async function topScreen(page: Page): Promise<string | null> {
  return page.evaluate(() => (window as unknown as UiWindow).__ui.topScreen());
}

/** Text nodes clipped by an overflow-hiding ancestor (src/ui/testing/overflow.ts). */
export async function clippedText(page: Page): Promise<{ text: string; clippedBy: string }[]> {
  return page.evaluate(() => (window as unknown as UiWindow).__ui.clippedText());
}

/** axe-core violations of serious or critical impact on the page. */
export async function seriousAxeViolations(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).analyze();
  return results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map(
      (v) => `${v.id} (${String(v.impact)}): ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`,
    );
}

/** The focused element's outline and its contrast against the background around it. */
export async function focusRing(
  page: Page,
): Promise<{ style: string; width: number; contrast: number } | null> {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!(el instanceof HTMLElement) || el === document.body) return null;
    const parse = (color: string): [number, number, number, number] => {
      const m = /rgba?\(([^)]+)\)/.exec(color);
      if (!m?.[1]) return [0, 0, 0, 0];
      const parts = m[1]
        .split(/[\s,/]+/)
        .filter(Boolean)
        .map(Number);
      return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, parts[3] ?? 1];
    };
    const lum = ([r, g, b]: [number, number, number, number]): number => {
      const c = [r, g, b].map((v) => {
        const s = v / 255;
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      }) as [number, number, number];
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    };
    const style = getComputedStyle(el);
    // The ring sits outside the element (outline-offset), over its parent's background.
    let bg: [number, number, number, number] = [255, 255, 255, 1];
    for (let p = el.parentElement; p; p = p.parentElement) {
      const c = parse(getComputedStyle(p).backgroundColor);
      if (c[3] > 0) {
        bg = c;
        break;
      }
    }
    const ring = parse(style.outlineColor);
    const [hi, lo] = [lum(ring), lum(bg)].sort((a, b) => b - a) as [number, number];
    return {
      style: style.outlineStyle,
      width: parseFloat(style.outlineWidth),
      contrast: (hi + 0.05) / (lo + 0.05),
    };
  });
}

/** Values the gallery's controls last reported. */
export async function galleryValues(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(() => (window as unknown as UiWindow).__ui.values());
}
