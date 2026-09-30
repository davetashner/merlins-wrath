import { expect, test, type Page } from '@playwright/test';

// mw-e12.4: data-defined creatures in the grey-box scenes, against the production build (Chromium),
// which is a debug build (the console built in), so it carries the frozen fixture creatures and the
// creature pen. The page publishes #app[data-creatures] after every frame: how many creatures the
// sim has, how many have a render proxy, and how many of those are inside the camera's view.

// Driver performance notices from the GPU process are not our errors (see e2e/render-boot.spec.ts).
const DRIVER_PERF_NOTICE = /^\[\.WebGL-[^\]]+\]GL Driver Message \([^)]*\bPerformance\b/;

interface CreatureReadout {
  count: number;
  drawn: number;
  inView: number;
  kinds: Record<string, number>;
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

async function creatures(page: Page): Promise<CreatureReadout> {
  const json = await page.locator('#app').getAttribute('data-creatures');
  return JSON.parse(json ?? 'null') as CreatureReadout;
}

test('AC-5: the creature pen loads its 4 creature spawns, all drawn and in view, with no console errors', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const problems = collectProblems(page);
  await page.goto('/?scene=creature-pen');
  await expect(page.locator('#app')).toHaveAttribute('data-scene', 'creature-pen', {
    timeout: 10_000,
  });
  await expect
    .poll(() => creatures(page), { timeout: 10_000 })
    .toEqual({
      count: 4,
      drawn: 4,
      inView: 4,
      kinds: { 'fixture-guard': 1, 'fixture-hound': 2, 'fixture-sentinel': 1 },
    });
  expect(problems).toEqual([]);
});

test('AC-3: `spawn fixture-hound 3` in the testbed console makes 3 drawn hounds; `despawn all` removes them', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const problems = collectProblems(page);
  await page.goto('/?scene=testbed&debug=1');
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-debug-console', 'closed', { timeout: 10_000 });
  await expect.poll(() => creatures(page)).toMatchObject({ count: 0, drawn: 0 });
  await page.keyboard.press('Backquote');
  const input = page.getByTestId('debug-console-input');
  await expect(input).toBeFocused();
  await page.keyboard.type('spawn fixture-hound 3');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('debug-console-log')).toContainText('spawning 3 × fixture-hound');
  await expect
    .poll(() => creatures(page))
    .toMatchObject({ count: 3, drawn: 3, kinds: { 'fixture-hound': 3 } });
  await page.keyboard.type('despawn all');
  await page.keyboard.press('Enter');
  await expect.poll(() => creatures(page)).toMatchObject({ count: 0, drawn: 0 });
  expect(problems).toEqual([]);
});
