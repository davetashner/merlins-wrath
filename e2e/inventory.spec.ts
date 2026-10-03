import { expect, test, type Page } from '@playwright/test';
import { stubPointerLock, takeControl, turnTo } from './helpers/player';
import {
  installVirtualPad,
  navigate,
  openScreen,
  openUiPage,
  seriousAxeViolations,
} from './helpers/ui';

// mw-e17.10: the inventory screen, against the production build (Chromium, 1280×720). The layout and
// accessibility checks run on the UI testbed's demo pack (testbed/ui.html, screen `inventory`); the
// quick-slot flow runs in the game (?scene=testbed), where the page publishes the pack on
// #app[data-items], the quick slots on #app[data-quick-slots] and whether the inventory is open on
// #app[data-inventory]. Menu navigation is real key presses (handled synchronously by the UI layer,
// so a slow runner costs round trips, not frames); state is read in single evaluations.

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

interface LayoutReport {
  tab: string;
  clipped: { text: string; clippedBy: string }[];
  overlaps: string[];
  escapes: string[];
}

/**
 * For every tab: text clipped by an overflow-hiding ancestor, pairs of item cards whose boxes
 * overlap, and item names whose text runs outside their card. One evaluation for the whole screen.
 */
async function layoutReport(page: Page): Promise<LayoutReport[]> {
  return page.evaluate(() => {
    interface Hooks {
      __ui: { clippedText(): { text: string; clippedBy: string }[] };
    }
    const hooks = window as unknown as Hooks;
    const overlap = (a: DOMRect, b: DOMRect) =>
      a.left < b.right - 0.5 &&
      b.left < a.right - 0.5 &&
      a.top < b.bottom - 0.5 &&
      b.top < a.bottom - 0.5;
    const tabs = [
      ...document.querySelectorAll<HTMLElement>('[data-screen="inventory"] [role="tab"]'),
    ];
    return tabs.map((tab) => {
      tab.click();
      const cards = [
        ...document.querySelectorAll<HTMLElement>('[data-screen="inventory"] [data-item]'),
      ];
      const boxes = cards.map((card) => card.getBoundingClientRect());
      const overlaps: string[] = [];
      boxes.forEach((a, i) => {
        boxes.slice(i + 1).forEach((b, j) => {
          if (overlap(a, b)) overlaps.push(`${String(i)}/${String(i + 1 + j)}`);
        });
      });
      const escapes = cards.flatMap((card, i) => {
        const name = card.querySelector('.vb-item-name');
        const box = boxes[i];
        if (name === null || box === undefined) return [];
        const range = document.createRange();
        range.selectNodeContents(name);
        const text = range.getBoundingClientRect();
        const inside =
          text.left >= box.left - 0.5 &&
          text.right <= box.right + 0.5 &&
          text.top >= box.top - 0.5 &&
          text.bottom <= box.bottom + 0.5;
        return inside ? [] : [name.textContent];
      });
      return { tab: tab.textContent, clipped: hooks.__ui.clippedText(), overlaps, escapes };
    });
  });
}

test.describe('inventory screen (UI testbed)', () => {
  test('mw-e17.10 AC-4: at 150% text, item names wrap without overlapping and no text is clipped', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await openUiPage(page, '/testbed/ui.html?scale=1.5');
    await openScreen(page, 'inventory');
    const report = await layoutReport(page);
    expect(report.map((r) => r.tab)).toEqual([
      'All',
      'Weapons & Armor',
      'Tools',
      'Consumables',
      'Books',
      'Keys',
      'Quest & Artifacts',
    ]);
    for (const { tab, clipped, overlaps, escapes } of report) {
      expect({ tab, clipped, overlaps, escapes }).toEqual({
        tab,
        clipped: [],
        overlaps: [],
        escapes: [],
      });
    }
    expect(problems).toEqual([]);
  });

  test('mw-e17.10: the inventory, its context menu and slot picker have no serious axe violations', async ({
    page,
  }) => {
    await openUiPage(page);
    await openScreen(page, 'inventory');
    expect(await seriousAxeViolations(page)).toEqual([]);
    await navigate(page, ['confirm']);
    expect(await seriousAxeViolations(page)).toEqual([]);
    await navigate(page, ['down', 'confirm']);
    expect(await seriousAxeViolations(page)).toEqual([]);
  });

  test('mw-e17.10 AC-3: on the real layout, a gamepad opens a consumable’s Use/Assign/Drop menu and assigns it', async ({
    page,
  }) => {
    await installVirtualPad(page);
    await openUiPage(page);
    await openScreen(page, 'inventory');
    const status = page.getByTestId('inventory-status');
    await navigate(page, ['confirm'], 'gamepad');
    const menu = page.getByTestId('inventory-menu');
    await expect(menu.getByRole('button')).toHaveText([
      'Use',
      'Assign to quick slot',
      'Remove from quick slot',
      'Drop',
      'Throw',
      'Cancel',
    ]);
    await navigate(page, ['confirm'], 'gamepad');
    await expect(status).toHaveText('use 9');
    await navigate(page, ['confirm', 'down', 'confirm', 'down', 'down', 'confirm'], 'gamepad');
    await expect(status).toHaveText('assign 9');
    await navigate(page, ['confirm', 'down', 'down', 'down', 'confirm'], 'gamepad');
    await expect(status).toHaveText('drop 9');
  });
});

interface Stack {
  item: string;
  count: number;
}

interface GameState {
  inventory: string | undefined;
  pack: Stack[];
  slots: ({ label: string; count: number } | null)[];
}

async function gameState(page: Page): Promise<GameState> {
  return page.evaluate(() => {
    const app = document.querySelector<HTMLElement>('#app');
    const items = JSON.parse(app?.dataset['items'] ?? '{"pack":[]}') as { pack: Stack[] };
    return {
      inventory: app?.dataset['inventory'],
      pack: items.pack.map(({ item, count }) => ({ item, count })),
      slots: JSON.parse(app?.dataset['quickSlots'] ?? '[]') as GameState['slots'],
    };
  });
}

test('mw-e17.10 AC-5: open the inventory, assign the potion to quick slot 2, close it; quick slot 2 drinks it', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const problems = collectProblems(page);
  await stubPointerLock(page);
  // ?debug=1: the console's `quickslot 2` is the quick-slot-2 action until the controls bind the
  // slots (mw-e17.17).
  await page.goto('/?scene=testbed&debug=1');
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-scene', 'testbed', { timeout: 10_000 });
  await expect(app).toHaveAttribute('data-player', /"grounded":true/);
  await expect(app).toHaveAttribute('data-inventory', 'closed');
  await takeControl(page);

  // Take the healing draught lying to the player's left (as e2e/items.spec.ts does).
  await turnTo(page, -Math.PI / 2);
  await expect(page.getByTestId('interact-prompt')).toContainText('Take Healing draught');
  await page.keyboard.press('KeyE');
  await expect
    .poll(async () => (await gameState(page)).pack)
    .toEqual([{ item: 'healing-draught', count: 1 }]);

  // I opens the inventory, focused on the newest item: the draught.
  await page.keyboard.press('KeyI');
  await expect(app).toHaveAttribute('data-inventory', 'open');
  await expect(page.locator('[data-screen="inventory"] [data-item]:focus')).toHaveAttribute(
    'aria-label',
    'Healing draught',
  );
  // Its actions, Assign, quick slot 2.
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-screen="inventory-assign"] button:focus')).toHaveText(
    'Slot 1: empty',
  );
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  // The assignment runs in the sim while the screen stays open (one paused tick).
  await expect
    .poll(async () => (await gameState(page)).slots)
    .toEqual([null, { label: 'Healing draught', count: 1 }, null, null]);
  await expect(page.locator('[data-item]:focus')).toHaveAttribute(
    'aria-label',
    'Healing draught, quick slot 2',
  );
  await expect(
    page.getByTestId('quick-slots').getByRole('img', { name: 'Quick slot 2: Healing draught, 1' }),
  ).toBeAttached();

  // I again closes it; then press the quick-slot-2 action.
  await page.keyboard.press('KeyI');
  await expect(app).toHaveAttribute('data-inventory', 'closed');
  await expect(app).toHaveAttribute('data-debug-console', 'closed', { timeout: 10_000 });
  await page.keyboard.press('Backquote');
  await expect(page.getByTestId('debug-console-input')).toBeFocused();
  await page.keyboard.insertText('quickslot 2');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');

  // The potion is drunk: gone from the pack, and the slot keeps it, depleted.
  await expect
    .poll(async () => gameState(page))
    .toEqual({
      inventory: 'closed',
      pack: [],
      slots: [null, { label: 'Healing draught', count: 0 }, null, null],
    });
  expect(problems).toEqual([]);
});
