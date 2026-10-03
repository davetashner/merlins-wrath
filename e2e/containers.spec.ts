import { expect, test, type Page } from '@playwright/test';
import { stubPointerLock, takeControl, turnTo } from './helpers/player';

// mw-e18.3 AC-5: the testbed's supply chest, looted, saved and reloaded against the production build
// (Chromium). The player walks up to the chest and Interacts: its loot table is rolled on this first
// open and everything in it goes into the pack (there is no container window yet, mw-e18.4). The game
// saves with the debug console and the tab closes; a new tab opens the testbed, where the chest is as
// built (never opened), the player dies (`kill`) and loads the save from the death screen. The chest
// comes back opened and empty: its Search is greyed "Empty", and Interact rolls nothing more.
// #app[data-containers] is what each container holds; #app[data-items] is the player's pack (read
// before the save: the load itself publishes no pack change).

// Driver performance notices from the GPU process are not our errors (see e2e/render-boot.spec.ts).
const DRIVER_PERF_NOTICE = /^\[\.WebGL-[^\]]+\]GL Driver Message \([^)]*\bPerformance\b/;

interface Stack {
  item: string;
  count: number;
}

interface Containers {
  'supply-chest'?: { opened: boolean; items: Stack[]; gold: number };
}

interface ItemsData {
  pack: Stack[];
}

function collectProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error' && msg.type() !== 'warning') return;
    if (DRIVER_PERF_NOTICE.test(msg.text())) return;
    problems.push(`${msg.type()}: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  return problems;
}

async function data<T>(page: Page, key: string): Promise<T | null> {
  const json = await page.locator('#app').getAttribute(`data-${key}`);
  return JSON.parse(json ?? 'null') as T | null;
}

const chest = async (page: Page) => (await data<Containers>(page, 'containers'))?.['supply-chest'];
const pack = async (page: Page) => (await data<ItemsData>(page, 'items'))?.pack ?? [];

/** Opens the testbed with the debug console and waits for the player to stand in a running sim. */
async function openTestbed(page: Page): Promise<void> {
  await page.goto('/?scene=testbed&debug=1');
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-scene', 'testbed', { timeout: 10_000 });
  await expect(app).toHaveAttribute('data-player', /"grounded":true/, { timeout: 10_000 });
}

/** Types `line` into the debug console, leaving it open. */
async function type(page: Page, line: string): Promise<void> {
  await page.keyboard.press('Backquote');
  const input = page.getByTestId('debug-console-input');
  await expect(input).toBeFocused();
  await page.keyboard.insertText(line);
  await page.keyboard.press('Enter');
}

/** Types `line` into the debug console and closes it again. */
async function run(page: Page, line: string): Promise<void> {
  await type(page, line);
  await page.keyboard.press('Escape');
  await expect(page.locator('#app')).toHaveAttribute('data-debug-console', 'closed');
}

const CHEST = { x: -2, z: 1 };

/** Stands the player 1.2 m north of the chest, facing it. */
async function walkUpToTheChest(page: Page): Promise<void> {
  await run(page, `tp ${String(CHEST.x)} 0 ${String(CHEST.z - 1.2)}`);
  await takeControl(page);
  await turnTo(page, CHEST);
}

test('AC-5: loot the testbed chest, save, close the tab, load the save: the chest is empty', async ({
  context,
}) => {
  test.setTimeout(120_000);
  const first = await context.newPage();
  const problems = collectProblems(first);
  await stubPointerLock(first);
  await openTestbed(first);
  expect(await chest(first)).toEqual({ opened: false, items: [], gold: 0 });
  await takeControl(first);
  await walkUpToTheChest(first);

  // One Interact opens the chest (rolling its table) and takes everything.
  const prompt = first.getByTestId('interact-prompt');
  await expect(prompt).toContainText('Search');
  await first.keyboard.press('KeyE');
  await expect.poll(() => chest(first)).toEqual({ opened: true, items: [], gold: 0 });
  // The supply crate always holds a healing draught.
  await expect
    .poll(async () => (await pack(first)).some((stack) => stack.item === 'healing-draught'))
    .toBe(true);
  await expect(prompt).toContainText('Empty');

  await run(first, 'save manual-1');
  await expect(first.locator('#app')).toHaveAttribute('data-saved-game', /"slot":"manual-1"/);
  expect(problems).toEqual([]);
  await first.close();

  // A new tab: the chest as built, then the save.
  const second = await context.newPage();
  const later = collectProblems(second);
  await stubPointerLock(second);
  await openTestbed(second);
  expect(await chest(second)).toEqual({ opened: false, items: [], gold: 0 });
  await type(second, 'kill');
  const screen = second.locator('[data-screen="death"]');
  await expect(screen).toBeVisible();
  await screen.getByRole('button', { name: 'Load last save' }).click();
  await openTestbed(second);
  await expect(second.locator('#app')).toHaveAttribute('data-loaded-save', /"slot":"manual-1"/);
  await expect.poll(() => chest(second)).toEqual({ opened: true, items: [], gold: 0 });

  // Open it again: empty, and nothing more comes out.
  await takeControl(second);
  await walkUpToTheChest(second);
  const again = second.getByTestId('interact-prompt');
  await expect(again).toContainText('Search');
  await expect(again).toContainText('Empty');
  await second.keyboard.press('KeyE');
  await expect(again).toContainText('Empty');
  expect(await chest(second)).toEqual({ opened: true, items: [], gold: 0 });
  expect(later).toEqual([]);
});
