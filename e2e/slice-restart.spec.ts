import { expect, test, type Page } from '@playwright/test';
import { collectProblems, data, ready, run, SLICE_URL } from './helpers/slice';

// mw-e01.16: "Restart area" after a death with no save, in the vertical slice, against the production
// build (Chromium). A clean profile has no saves; the debug console's `kill` stands in for a death
// before CP-1. Restart area reloads the slice through the New Game hand-off with the class chosen this
// session (?class=), so the knight is back at player-start with its kit and fresh world facts.
// #app[data-boot-state] is the sim state hash of the world as booted, before its first step.
//
// "Within 3 s warm" is measured inside the page, as e2e/death-reload.spec.ts does: from the click on
// Restart area (stamped in session storage) to the first sim step of the new world, seen by a
// MutationObserver as it happens. CI draws a few frames a second, so that budget can flake there.

const SPAWN = { x: 0, z: -2 };

interface BootState {
  tick: number;
  hash: string;
}

/** The HUD kit panel: its class name and item lines, null when absent. */
const kitOf = (page: Page): Promise<{ name: string; items: (string | null)[] } | null> =>
  page.evaluate(() => {
    const kit = document.querySelector('[data-testid="class-kit"]');
    return kit === null
      ? null
      : {
          name: kit.querySelector('[data-part="class"]')?.textContent ?? '',
          items: [...kit.querySelectorAll('li')].map((li) => li.textContent),
        };
  });

test('mw-e01.16 AC-1, AC-2, AC-3: after a death before CP-1 with no save, Restart area replays a knight New Game within 3 s, with no console errors', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const problems = collectProblems(page);
  // On every page: when the sim first steps in a world booted after the click on Restart area.
  await page.addInitScript(() => {
    const w = window as unknown as { playableAt?: number };
    const observer = new MutationObserver(() => {
      const app = document.querySelector<HTMLElement>('#app');
      const player = app?.dataset['player'];
      let stamp: string | null = null;
      try {
        stamp = sessionStorage.getItem('restartClickedAt');
      } catch {
        // No session storage: nothing to time.
      }
      if (stamp === null || player === undefined || w.playableAt !== undefined) return;
      if ((JSON.parse(player) as { tick: number }).tick <= 0) return;
      w.playableAt = Date.now();
      observer.disconnect();
    });
    observer.observe(document, { attributes: true, subtree: true });
  });

  // A new game as the knight: the baseline the restart must equal.
  await page.goto(SLICE_URL);
  const app = page.locator('#app');
  await ready(page);
  await expect(app).toHaveAttribute('data-player-class', 'knight');
  await expect(app).toHaveAttribute('data-boot-state', /"hash"/);
  const newGame = await data<BootState>(page, 'boot-state');
  expect(newGame.tick).toBe(0);
  // A new game's facts: only player.class is set, no slice fact (docs/design/vertical-slice.md §5).
  const newGameFacts = await data<Record<string, unknown>>(page, 'facts');
  expect(newGameFacts).toEqual({ 'player.class': 'knight' });
  const kit = await kitOf(page);
  expect(kit?.name).toBe('Knight');
  expect(kit?.items.some((item) => item?.includes('(equipped)'))).toBe(true);
  // Warm the cache the reload will use, as a second visit would be.
  await page.waitForLoadState('networkidle');

  // Dies in the spawn room, before CP-1; no save exists on this clean profile.
  await run(page, 'kill');
  const screen = page.locator('[data-screen="death"]');
  // The death beat (mw-e01.8, 90 sim ticks) runs first: seconds of wall time on a slow runner.
  await expect(screen).toBeVisible({ timeout: 60_000 });
  await expect(app).toHaveAttribute('data-death', /"saves":0/);
  const restart = screen.getByRole('button', { name: 'Restart area' });
  await expect(restart).toBeFocused();

  const reloaded = page.waitForEvent('load');
  await page.evaluate(() => {
    sessionStorage.setItem('restartClickedAt', String(Date.now()));
  });
  await restart.click();
  await reloaded;
  await ready(page);

  // AC-1: at player-start, the knight with its kit, every fact at its default.
  await expect(app).toHaveAttribute('data-player-class', 'knight');
  expect(await data<Record<string, unknown>>(page, 'facts')).toEqual(newGameFacts);
  await expect(page.locator('[data-screen="death"]')).toHaveCount(0);
  await expect(app).not.toHaveAttribute('data-loaded-save', /./);
  expect(await kitOf(page)).toEqual(kit);
  // AC-2: the world as booted hashes as the New Game as the knight did, at tick 0.
  expect(await data<BootState>(page, 'boot-state')).toEqual(newGame);
  // AC-3: playable (stepping, no screen over it) within 3 s of the click.
  await expect(page.locator('[data-screen]')).toHaveCount(0);
  const player = await data<{ position: { x: number; z: number } }>(page, 'player');
  expect(Math.abs(player.position.x - SPAWN.x)).toBeLessThan(0.5);
  expect(Math.abs(player.position.z - SPAWN.z)).toBeLessThan(0.5);
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { playableAt?: number }).playableAt ?? null),
    )
    .not.toBeNull();
  const { playableAt, clickedAt } = await page.evaluate(() => ({
    playableAt: (window as unknown as { playableAt: number }).playableAt,
    clickedAt: Number(sessionStorage.getItem('restartClickedAt')),
  }));
  const elapsed = playableAt - clickedAt;
  test.info().annotations.push({ type: 'restart-ms', description: String(elapsed) });
  expect(elapsed).toBeGreaterThan(0);
  expect(elapsed).toBeLessThanOrEqual(3_000);
  expect(problems).toEqual([]);
});
