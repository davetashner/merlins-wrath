import { expect, test, type Page } from '@playwright/test';

// mw-e04.9: the combat sandbox (?scene=combat-sandbox) against the production build (Chromium). The
// page publishes the frame data it derives from the sim after every tick on #app[data-frame-data]
// and draws the same data in the frame-data overlay; F3 toggles the overlay, F4 slow motion, and the
// debug console (enabled in the sandbox without ?debug=1) spawns dummies. The test only reads the
// page and presses keys as a player would.

// Driver performance notices from the GPU process are not our errors (see e2e/render-boot.spec.ts).
const DRIVER_PERF_NOTICE = /^\[\.WebGL-[^\]]+\]GL Driver Message \([^)]*\bPerformance\b/;

interface Fighter {
  entity: number;
  role: 'player' | 'attacker' | 'dummy';
  move: string | null;
  phase: string;
  moveTick: number | null;
  totalTicks: number | null;
  poise: { current: number; max: number } | null;
}

interface FrameData {
  tick: number;
  speed: number;
  fighters: Fighter[];
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

async function frameData(page: Page): Promise<FrameData> {
  const json = await page.locator('#app').getAttribute('data-frame-data');
  return JSON.parse(json ?? 'null') as FrameData;
}

async function open(page: Page): Promise<void> {
  await page.goto('/?scene=combat-sandbox');
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-scene', 'combat-sandbox', { timeout: 5_000 });
  await expect(app).toHaveAttribute('data-frame-overlay', 'on');
  await expect(app).toHaveAttribute('data-frame-data', /"role":"attacker"/);
}

test('AC-3: the frame overlay toggles and shows the move, phase and tick the sim has, with no console errors', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const problems = collectProblems(page);
  await open(page);
  const overlay = page.getByTestId('frame-data');
  await expect(overlay).toBeVisible();
  await page.keyboard.press('F3');
  await expect(page.locator('#app')).toHaveAttribute('data-frame-overlay', 'off');
  await expect(overlay).toBeHidden();
  await page.keyboard.press('F3');
  await expect(page.locator('#app')).toHaveAttribute('data-frame-overlay', 'on');
  await expect(overlay).toBeVisible();

  // The published data and the overlay's attacker row, read in one go (both are written by the same
  // frame), on the first frame the attacker is mid-swing.
  const { tick, attacker, shown } = await page.evaluate(
    () =>
      new Promise<{
        tick: number;
        attacker: Fighter;
        shown: { move: string | null; phase: string | null; frame: string | null };
      }>((resolve) => {
        const look = () => {
          const app = document.querySelector<HTMLElement>('#app');
          const data = JSON.parse(app?.dataset['frameData'] ?? 'null') as FrameData;
          const attacker = data.fighters.find((f) => f.role === 'attacker');
          if (attacker?.move == null) {
            requestAnimationFrame(look);
            return;
          }
          const row = document.querySelector(
            `[data-testid="frame-data"] tr[data-key="${String(attacker.entity)}"]`,
          );
          const cell = (col: string) =>
            row?.querySelector(`[data-col="${col}"]`)?.textContent ?? null;
          resolve({
            tick: data.tick,
            attacker,
            shown: { move: cell('move'), phase: cell('phase'), frame: cell('frame') },
          });
        };
        look();
      }),
  );
  if (attacker.moveTick === null) throw new Error('the attacker is not swinging');
  expect(shown).toEqual({
    move: 'training-dummy-swing',
    phase: attacker.phase,
    frame: `${String(attacker.moveTick)}/${String(attacker.totalTicks)}`,
  });
  // Sim state: the swing started on a multiple of 120 ticks, and its phase is the move's
  // (18 startup, 4 active, 20 recovery ticks).
  expect((tick - 1 - attacker.moveTick) % 120).toBe(0);
  const phase = attacker.moveTick < 18 ? 'startup' : attacker.moveTick < 22 ? 'active' : 'recovery';
  expect(attacker.phase).toBe(phase);
  expect(problems).toEqual([]);
});

test('F4 slows the sim to 0.25×; the console spawns a dummy with options', async ({ page }) => {
  test.setTimeout(60_000);
  const problems = collectProblems(page);
  await open(page);
  const app = page.locator('#app');
  await page.keyboard.press('F4');
  await expect(app).toHaveAttribute('data-time-scale', '0.25');
  await expect(page.getByTestId('frame-data')).toContainText('0.25× slow motion');
  await page.keyboard.press('F4');
  await expect(app).toHaveAttribute('data-time-scale', '1');

  await expect(app).toHaveAttribute('data-debug-console', 'closed', { timeout: 10_000 });
  const before = (await frameData(page)).fighters.filter((f) => f.role === 'dummy').length;
  await page.keyboard.press('Backquote');
  await expect(app).toHaveAttribute('data-debug-console', 'open');
  await page.keyboard.type('spawn dummy --poise 60 --resist slash=0.5');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await expect
    .poll(async () => (await frameData(page)).fighters.filter((f) => f.role === 'dummy').length)
    .toBe(before + 1);
  const dummies = (await frameData(page)).fighters.filter((f) => f.role === 'dummy');
  expect(dummies.at(-1)?.poise).toEqual({ current: 60, max: 60 });
  expect(problems).toEqual([]);
});
