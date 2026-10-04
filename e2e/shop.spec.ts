import { expect, test, type Page } from '@playwright/test';
import { stubPointerLock, takeControl, turnTo } from './helpers/player';

// mw-e20.10 AC-4: the grey-box shop room (dev scene `shop-room`, debug builds) against the production
// build (Chromium). The player walks up to the general-goods counter and talks to it; the shop opens
// (#app[data-shop], JSON: open, merchant, crowns) with the player topped up to 400 crowns. A purchase
// moves crowns and pack; selling the item and buying it back through the Buyback tab leaves crowns
// and pack exactly as they were before the sale. (A merchant never pays above its selling price, so
// "buy then sell back" can only restore the state from the sale on; the unit tests cover the prices.)

// Driver performance notices from the GPU process are not our errors (see e2e/render-boot.spec.ts).
const DRIVER_PERF_NOTICE = /^\[\.WebGL-[^\]]+\]GL Driver Message \([^)]*\bPerformance\b/;
// A starved software-GL frame drops sim steps and says so; that is the runner, not the game.
const FRAME_LOOP_NOTICE = 'frame loop: ';

interface Stack {
  item: string;
  count: number;
}
interface Shop {
  open: boolean;
  merchant: string | null;
  crowns: number;
  pack: Stack[];
}

const COUNTER = { x: -2, z: 1 };

async function shop(page: Page): Promise<Shop> {
  return page.evaluate(
    () => JSON.parse(document.querySelector<HTMLElement>('#app')?.dataset['shop'] ?? '{}') as Shop,
  );
}

/** The pack as the shop reads it (the item readout only moves once the sim steps again). */
async function pack(page: Page): Promise<Stack[]> {
  return (await shop(page)).pack;
}

test('mw-e20.10 AC-4: buy at the counter, sell the item, buy it back: crowns and pack match', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error' && msg.type() !== 'warning') return;
    if (DRIVER_PERF_NOTICE.test(msg.text()) || msg.text().startsWith(FRAME_LOOP_NOTICE)) return;
    problems.push(`${msg.type()}: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  await stubPointerLock(page);
  await page.goto('/?scene=shop-room&debug=1');
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-scene', 'shop-room', { timeout: 10_000 });
  await expect(app).toHaveAttribute('data-player', /"grounded":true/, { timeout: 10_000 });
  expect(await shop(page)).toMatchObject({ open: false, merchant: null });

  // Stand 1.2 m before the counter, facing it, and talk.
  await page.keyboard.press('Backquote');
  await expect(page.getByTestId('debug-console-input')).toBeFocused();
  await page.keyboard.insertText(`tp ${String(COUNTER.x)} 0 ${String(COUNTER.z - 1.2)}`);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await expect(app).toHaveAttribute('data-debug-console', 'closed');
  await takeControl(page);
  await turnTo(page, COUNTER);
  await expect(page.getByTestId('interact-prompt')).toContainText('Trade with the shopkeeper');
  await page.keyboard.press('KeyE');
  await expect(app).toHaveAttribute('data-shop', /"open":true/);
  expect(await shop(page)).toEqual({
    open: true,
    merchant: 'fixture-general-goods',
    crowns: 400,
    pack: [],
  });
  await expect(page.locator('[data-screen="shop"] .vb-shop-name')).toHaveText('Fixture shopkeeper');
  await expect(page.getByTestId('shop-crowns')).toHaveText('Your crowns: 400 crowns');

  // Buy lockpicks: a cheap deal is one input.
  const empty = await pack(page);
  await page.locator('[data-screen="shop"] [aria-label^="Buy Lockpicks"]').first().click();
  await expect(page.getByTestId('shop-status')).toHaveText(/^Bought Lockpicks for \d+ crowns\.$/);
  const bought = await shop(page);
  expect(bought.crowns).toBeLessThan(400);
  const afterBuy = await pack(page);
  expect(afterBuy).not.toEqual(empty);
  expect(afterBuy).toContainEqual({ item: 'lockpicks', count: 1 });

  // Sell them, then buy them back from the Buyback tab.
  await page.locator('[data-screen="shop"] [data-tab="sell"]').click();
  await page.locator('[data-screen="shop"] [aria-label^="Sell Lockpicks"]').first().click();
  await expect(page.getByTestId('shop-status')).toHaveText(/^Sold Lockpicks for \d+ crowns\.$/);
  expect((await shop(page)).crowns).toBeGreaterThan(bought.crowns);
  await page.locator('[data-screen="shop"] [data-tab="buyback"]').click();
  await page.locator('[data-screen="shop"] [aria-label^="Buy back Lockpicks"]').first().click();
  await expect(page.getByTestId('shop-status')).toHaveText(/^Bought Lockpicks for \d+ crowns\.$/);
  expect((await shop(page)).crowns).toBe(bought.crowns);
  expect(await pack(page)).toEqual(afterBuy);

  // Escape closes the shop and returns the game.
  await page.keyboard.press('Escape');
  await expect(app).toHaveAttribute('data-shop', /"open":false/);
  expect(problems).toEqual([]);
});
