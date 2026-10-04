import { expect, test, type Page } from '@playwright/test';

// mw-e01.7: saving and reloading the vertical slice (?scene=slice), against the production build
// (Chromium). The knight is put in the corridor with the debug console (`tp`) and saved into manual
// slot 1 (`save manual-1`, which publishes the tick and sim state hash it saved on
// #app[data-saved-game]); the pause menu that will offer Save is mw-e01.3. The page is then reloaded
// through the front door (`/`): the title's Continue loads the most recent save, reloading into the
// slice, and #app[data-loaded-save] carries the state hash right after the load. On the way the
// knight passes CP-1, whose checkpoint autosave is published on #app[data-autosave].
//
// The "within 3 s warm" wall-clock budget is the perf suite's (mw-e41.8, e2e/perf/flows.ts), not
// asserted here. CI draws a few frames a second, so the spec waits on published state, never on wall
// time, and reads it in one round trip.

// Driver performance notices from the GPU process are not our errors (see e2e/render-boot.spec.ts).
const DRIVER_PERF_NOTICE = /^\[\.WebGL-[^\]]+\]GL Driver Message \([^)]*\bPerformance\b/;

/** Halfway along the corridor (x −1…1, z 5…25, docs/design/vertical-slice.md §4), clear of CP-1/CP-2. */
const CORRIDOR = { x: 0, z: 15 };

interface Readout {
  slot: string;
  tick: number;
  hash: string;
  status?: string;
  requestedAt?: number | null;
}

interface Resumed {
  loaded: Readout | null;
  player: { tick: number; position: { x: number; z: number } } | null;
  screens: string[];
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

async function data<T>(page: Page, key: string): Promise<T> {
  const json = await page.locator('#app').getAttribute(`data-${key}`);
  return JSON.parse(json ?? 'null') as T;
}

/** Types `line` into the debug console and closes it again. */
async function run(page: Page, line: string): Promise<void> {
  await page.keyboard.press('Backquote');
  const input = page.getByTestId('debug-console-input');
  await expect(input).toBeFocused();
  await page.keyboard.insertText(line);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await expect(page.locator('#app')).toHaveAttribute('data-debug-console', 'closed');
}

/** Everything the resumed page is checked for, in one round trip. */
const resumed = (page: Page): Promise<Resumed> =>
  page.evaluate(() => {
    const app = document.querySelector<HTMLElement>('#app');
    const parse = (key: string): unknown => {
      const json = app?.dataset[key];
      return json === undefined ? null : JSON.parse(json);
    };
    return {
      loaded: parse('loadedSave') as Readout | null,
      player: parse('player') as Resumed['player'],
      screens: [...document.querySelectorAll<HTMLElement>('[data-screen]')].map(
        (el) => el.dataset['screen'] ?? '',
      ),
    };
  });

test('mw-e01.7 AC-3: a manual save in the corridor, reloaded and continued, resumes in the corridor', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const problems = collectProblems(page);
  // A new game as the knight, straight into the slice, with the debug console.
  await page.goto('/?scene=slice&class=knight&debug=1');
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-scene', 'slice', { timeout: 15_000 });
  await expect(app).toHaveAttribute('data-player-class', 'knight', { timeout: 15_000 });
  await expect(app).toHaveAttribute('data-player', /"grounded":true/, { timeout: 15_000 });
  // Warm the cache the reload will use, as a second visit would be.
  await page.waitForLoadState('networkidle');

  // Through CP-1 (just past the spawn-room door): its checkpoint autosave lands in the ring.
  await run(page, 'tp 0 0 6');
  await expect(app).toHaveAttribute(
    'data-autosave',
    /"type":"saved","kind":"checkpoint","source":"slice\/cp-1"/,
    { timeout: 30_000 },
  );

  // On into the corridor, then a manual save there: the most recent save.
  await run(page, `tp ${String(CORRIDOR.x)} 0 ${String(CORRIDOR.z)}`);
  await expect
    .poll(async () => (await data<{ position: { z: number } }>(page, 'player')).position.z, {
      timeout: 30_000,
    })
    .toBeCloseTo(CORRIDOR.z, 0);
  await run(page, 'save manual-1');
  await expect(app).toHaveAttribute('data-saved-game', /"slot":"manual-1"/, { timeout: 15_000 });
  const saved = await data<Readout>(page, 'saved-game');

  // Reload through the front door: the title offers Continue (focused) with the corridor save,
  // made as the knight (mw-e30.14).
  await page.goto('/');
  const title = page.locator('[data-screen="title"]');
  await expect(title).toBeVisible({ timeout: 30_000 });
  await expect(title).toContainText('Last save: Manual save 1 · Knight · slice');
  await expect(title.getByRole('button', { name: 'Continue' })).toBeFocused();
  await page.keyboard.press('Enter');

  // Back in the slice at the save: the same tick and state hash, the knight in the corridor.
  await expect(app).toHaveAttribute('data-loaded-save', /"hash"/, { timeout: 30_000 });
  await expect
    .poll(
      async () => {
        const state = await resumed(page);
        // Playable: the sim has stepped on from the save and no screen holds it.
        return (
          state.loaded !== null &&
          (state.player?.tick ?? 0) > state.loaded.tick &&
          state.screens.length === 0
        );
      },
      { timeout: 30_000 },
    )
    .toBe(true);
  const state = await resumed(page);
  expect(state.loaded).toMatchObject({ slot: 'manual-1', status: 'loaded', tick: saved.tick });
  expect(state.loaded?.hash).toBe(saved.hash);
  const at = state.player?.position ?? { x: NaN, z: NaN };
  expect(Math.abs(at.x)).toBeLessThan(1);
  expect(at.z).toBeGreaterThan(5);
  expect(at.z).toBeLessThan(25);
  // The 3 s warm budget, press on Continue to first step from the save, is the perf suite's (continue-slice).
  expect(problems).toEqual([]);
});
