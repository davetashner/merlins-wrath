import { expect, test, type Page } from '@playwright/test';

// mw-e04.34: environmental damage and character impulses in the testbed, against the production
// build (Chromium). The frame-data overlay (?frames) is the HUD that shows them: each fighter's
// health and the latest harm the world dealt it, published as JSON on #app[data-frame-data]. The
// debug console (?debug=1) moves the player with `tp` and sets off a `blast`, both sim commands; the
// test only types into the console and reads the page.

// Driver performance notices from the GPU process are not our errors (see e2e/render-boot.spec.ts).
const DRIVER_PERF_NOTICE = /^\[\.WebGL-[^\]]+\]GL Driver Message \([^)]*\bPerformance\b/;

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

interface PlayerData {
  tick: number;
  position: Vec3;
  grounded: boolean;
}

interface Fighter {
  role: 'player' | 'attacker' | 'dummy';
  health: { current: number; max: number } | null;
  environment: { kind: string; amount: number; tick: number } | null;
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

async function player(page: Page): Promise<PlayerData> {
  const json = await page.locator('#app').getAttribute('data-player');
  return JSON.parse(json ?? 'null') as PlayerData;
}

async function knight(page: Page): Promise<Fighter | undefined> {
  const json = await page.locator('#app').getAttribute('data-frame-data');
  const data = JSON.parse(json ?? 'null') as { fighters: Fighter[] } | null;
  return data?.fighters.find((f) => f.role === 'player');
}

/** Loads the testbed with the frame data and the console, and waits for the player to settle. */
async function open(page: Page): Promise<void> {
  await page.goto('/?scene=testbed&frames&debug=1');
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-scene', 'testbed', { timeout: 5_000 });
  await expect(app).toHaveAttribute('data-player', /"grounded":true/);
  await expect(app).toHaveAttribute('data-frame-data', /"role":"player"/);
}

/** Types `line` into the debug console and closes it again. */
async function run(page: Page, line: string): Promise<void> {
  await page.keyboard.press('Backquote');
  const input = page.getByTestId('debug-console-input');
  await expect(input).toBeFocused();
  await page.keyboard.type(line);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await expect(page.locator('#app')).toHaveAttribute('data-debug-console', 'closed');
}

test('AC-2: dropping the player from 10 m shows fall damage on the frame-data HUD', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const problems = collectProblems(page);
  await open(page);
  const before = await knight(page);
  expect(before?.health?.current).toBe(before?.health?.max);
  expect(before?.environment).toBeNull();
  const { x, y, z } = (await player(page)).position;
  await run(page, `tp ${String(x)} ${String(y + 10)} ${String(z)}`);
  await expect.poll(async () => (await knight(page))?.environment?.kind).toBe('fall');
  const after = await knight(page);
  const max = after?.health?.max ?? 0;
  expect(after?.health?.current).toBeLessThan(max);
  expect(after?.health?.current).toBe(max - (after?.environment?.amount ?? 0));
  // The overlay shows the same: the knight's row names the fall and its damage.
  await expect(page.getByTestId('frame-data').locator('td[data-col="world"]').first()).toHaveText(
    /^fall \d/,
  );
  expect(problems).toEqual([]);
});

test('AC-1: a blast next to the player throws them back', async ({ page }) => {
  test.setTimeout(60_000);
  const problems = collectProblems(page);
  await open(page);
  const start = (await player(page)).position;
  await run(page, 'blast');
  await expect
    .poll(async () => {
      const { x, z } = (await player(page)).position;
      return Math.hypot(x - start.x, z - start.z);
    })
    .toBeGreaterThan(1);
  await expect(page.locator('#app')).toHaveAttribute('data-player', /"grounded":true/);
  expect(problems).toEqual([]);
});
