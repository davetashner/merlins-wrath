import { expect, test, type Page } from '@playwright/test';
import { stubPointerLock, takeControl, turnTo } from './helpers/player';
import {
  installVirtualPad,
  navigate,
  openScreen,
  openUiPage,
  seriousAxeViolations,
} from './helpers/ui';

// mw-e18.4: the container window and pickup toasts, against the production build (Chromium,
// 1280×720). Layout, accessibility and input checks run on the UI testbed's demo chest
// (testbed/ui.html, screens `container` and `container-empty`; Take All is echoed on
// #app[data-container-took]). The looting flow runs in the game (?scene=testbed): Interact on the
// supply chest opens its window (#app[data-container-window]), R takes everything, and the toasts
// show on #app[data-pickups]. Menu input is real key presses or a virtual pad (handled synchronously
// by the UI layer); state is read in single evaluations.

// Driver performance notices from the GPU process are not our errors (see e2e/render-boot.spec.ts).
const DRIVER_PERF_NOTICE = /^\[\.WebGL-[^\]]+\]GL Driver Message \([^)]*\bPerformance\b/;
// A starved software-GL frame drops sim steps and says so; that is the runner, not the game.
const FRAME_LOOP_NOTICE = 'frame loop: ';

function collectProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error' && msg.type() !== 'warning') return;
    if (DRIVER_PERF_NOTICE.test(msg.text()) || msg.text().startsWith(FRAME_LOOP_NOTICE)) return;
    problems.push(`${msg.type()}: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  return problems;
}

interface WindowState {
  top: string | null;
  took: string | undefined;
  rows: string[];
  focused: string | null;
  empty: boolean;
  takeAllDisabled: boolean;
}

/** The container window as the page shows it, in one evaluation. */
async function windowState(page: Page): Promise<WindowState> {
  return page.evaluate(() => {
    const screen = document.querySelector('[data-screen="container"]');
    const takeAll = screen?.querySelector<HTMLButtonElement>('[data-action="take-all"]');
    const active = document.activeElement as HTMLElement | null;
    return {
      top: (window as unknown as { __ui: { topScreen(): string | null } }).__ui.topScreen(),
      took: document.querySelector<HTMLElement>('#app')?.dataset['containerTook'],
      rows: [...(screen?.querySelectorAll('[data-container-item]') ?? [])].map(
        (row) => row.getAttribute('aria-label') ?? '',
      ),
      focused: active?.getAttribute('aria-label') ?? active?.textContent ?? null,
      empty:
        screen?.querySelector<HTMLElement>('[data-testid="container-empty"]')?.hidden === false,
      takeAllDisabled: takeAll?.disabled ?? false,
    };
  });
}

test.describe('container window (UI testbed)', () => {
  test('mw-e18.4: the window and the pickup toasts have no serious axe violations, and nothing clips at 150% text', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await openUiPage(page, '/testbed/ui.html?scale=1.5');
    await openScreen(page, 'container');
    await page.evaluate(() => {
      (window as unknown as { __ui: { pickups(): void } }).__ui.pickups();
    });
    await expect(
      page.getByTestId('pickup-toasts').locator('[data-kind="discovery"]'),
    ).toContainText('It points north, mostly.');
    const clipped = await page.evaluate(() =>
      (window as unknown as { __ui: { clippedText(): { text: string }[] } }).__ui.clippedText(),
    );
    expect(clipped).toEqual([]);
    expect(await seriousAxeViolations(page)).toEqual([]);
    await openScreen(page, 'container-empty');
    expect(await seriousAxeViolations(page)).toEqual([]);
    expect(problems).toEqual([]);
  });

  test('mw-e18.4 AC-4: an empty container shows "Empty" and Take All is disabled', async ({
    page,
  }) => {
    await openUiPage(page);
    await openScreen(page, 'container-empty');
    await navigate(page, ['secondary']);
    expect(await windowState(page)).toEqual({
      top: 'container',
      took: undefined,
      rows: [],
      focused: 'Close',
      empty: true,
      takeAllDisabled: true,
    });
    await expect(page.getByTestId('container-empty')).toHaveText('Empty');
  });

  test('mw-e18.4 AC-1: a gamepad takes one stack with A and everything with X, which closes the window', async ({
    page,
  }) => {
    await installVirtualPad(page);
    await openUiPage(page);
    await openScreen(page, 'container');
    expect(await windowState(page)).toMatchObject({
      top: 'container',
      rows: [
        'Take 37 gold',
        'Take Healing draught',
        'Take Standard arrow, 12',
        'Take Exceedingly ornate ceremonial lantern of the harbour guild',
      ],
      focused: 'Take All',
    });
    await navigate(page, ['up', 'confirm'], 'gamepad');
    await expect(page.getByTestId('container-status')).toHaveText(/^take \d$/);
    await navigate(page, ['secondary'], 'gamepad');
    expect(await windowState(page)).toMatchObject({ top: null, took: 'all' });
  });

  test('mw-e18.4 AC-1: the mouse takes a stack and Take All', async ({ page }) => {
    await openUiPage(page);
    await openScreen(page, 'container');
    const box = async (selector: string) => {
      const rect = await page.locator(selector).boundingBox();
      if (rect === null) throw new Error(`${selector} is not visible`);
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    };
    const gold = await box('[data-screen="container"] [data-container-item="gold"]');
    await page.mouse.click(gold.x, gold.y);
    await expect(page.getByTestId('container-status')).toHaveText('take gold');
    const takeAll = await box('[data-screen="container"] [data-action="take-all"]');
    await page.mouse.click(takeAll.x, takeAll.y);
    expect(await windowState(page)).toMatchObject({ top: null, took: 'all' });
  });
});

interface Stack {
  item: string;
  count: number;
}

interface GameState {
  window: string | undefined;
  chest: { opened: boolean; items: Stack[]; gold: number } | undefined;
  pack: Stack[];
  pickups: { text: string; count: number; discovery: boolean }[];
}

async function gameState(page: Page): Promise<GameState> {
  return page.evaluate(() => {
    const app = document.querySelector<HTMLElement>('#app');
    const items = JSON.parse(app?.dataset['items'] ?? '{"pack":[]}') as { pack: Stack[] };
    const containers = JSON.parse(app?.dataset['containers'] ?? '{}') as Record<
      string,
      GameState['chest']
    >;
    return {
      window: app?.dataset['containerWindow'],
      chest: containers['supply-chest'],
      pack: items.pack.map(({ item, count }) => ({ item, count })),
      pickups: JSON.parse(app?.dataset['pickups'] ?? '[]') as GameState['pickups'],
    };
  });
}

const CHEST = { x: -2, z: 1 };

test('mw-e18.4 AC-1 AC-2: Interact opens the testbed chest, R takes everything and closes it, and the pickups toast', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const problems = collectProblems(page);
  await stubPointerLock(page);
  await page.goto('/?scene=testbed&debug=1');
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-scene', 'testbed', { timeout: 10_000 });
  await expect(app).toHaveAttribute('data-player', /"grounded":true/, { timeout: 10_000 });
  await expect(app).toHaveAttribute('data-container-window', 'closed');

  // Stand 1.2 m north of the chest, facing it (as e2e/containers.spec.ts does).
  await page.keyboard.press('Backquote');
  await expect(page.getByTestId('debug-console-input')).toBeFocused();
  await page.keyboard.insertText(`tp ${String(CHEST.x)} 0 ${String(CHEST.z - 1.2)}`);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await expect(app).toHaveAttribute('data-debug-console', 'closed');
  await takeControl(page);
  await turnTo(page, CHEST);
  await expect(page.getByTestId('interact-prompt')).toContainText('Search');

  // Interact opens the window over the rolled contents, Take All focused.
  await page.keyboard.press('KeyE');
  await expect(app).toHaveAttribute('data-container-window', 'open');
  const opened = await gameState(page);
  expect(opened.chest?.opened).toBe(true);
  // The supply crate always holds a healing draught, then one or two picks.
  expect(opened.chest?.items[0]).toEqual({ item: 'healing-draught', count: 1 });
  const inside = opened.chest?.items ?? [];
  await expect(page.locator('[data-screen="container"] [data-container-item]')).toHaveCount(
    inside.length,
  );
  await expect(page.locator('[data-screen="container"] button:focus')).toHaveText('Take All');

  // R: the window closes and everything lands in the pack, each pickup toasted. Read in the frame
  // the chest empties (toasts last 3 s, a few round trips on a slow runner).
  await page.keyboard.press('KeyR');
  const handle = await page.waitForFunction(() => {
    const app = document.querySelector<HTMLElement>('#app');
    const containers = JSON.parse(app?.dataset['containers'] ?? '{}') as Record<
      string,
      { items: unknown[] } | undefined
    >;
    if (containers['supply-chest']?.items.length !== 0) return null;
    const items = JSON.parse(app?.dataset['items'] ?? '{"pack":[]}') as {
      pack: { item: string; count: number }[];
    };
    return {
      window: app?.dataset['containerWindow'],
      pack: items.pack.map(({ item, count }) => ({ item, count })),
      pickups: JSON.parse(app?.dataset['pickups'] ?? '[]') as GameState['pickups'],
      toastText: document.querySelector('[data-testid="pickup-toasts"]')?.textContent ?? '',
    };
  });
  const after = await handle.jsonValue();
  if (after === null) throw new Error('the chest never emptied');
  expect(after.window).toBe('closed');
  for (const stack of inside) expect(after.pack).toContainEqual(stack);
  expect(after.pickups.length).toBeGreaterThan(0);
  expect(after.pickups.length).toBeLessThanOrEqual(4);
  expect(after.pickups[0]).toEqual({ text: 'Healing draught', count: 1, discovery: false });
  expect(after.toastText).toContain('Healing draught');
  expect(problems).toEqual([]);
});
