import { expect, test, type Page } from '@playwright/test';

// mw-e01.8: the player's death beat and respawn in the vertical slice (?scene=slice), against the
// production build (Chromium). The debug console (?debug=1) teleports the knight into the arena,
// makes a manual save (publishing the tick and sim state hash it saved on #app[data-saved-game]) and
// kills the player. The page publishes the death on #app[data-player-death] (the tick it died, the
// tick the beat hands off, the respawn rule), the fade on the death-fade veil, the loaded save on
// #app[data-loaded-save] and the respawn on #app[data-respawned]; the test only reads them.
//
// The death beat is counted in sim ticks, so its length is checked in ticks (1.5 s at 60 Hz = 90),
// never in wall time: CI draws a few frames a second at most five ticks a frame, so the beat itself
// can take several seconds of wall time there. "Playable within 3 s" is measured inside the page,
// from the click on Load last save (stamped in the reload hand-off) to the first sim step from the
// loaded save, seen by a MutationObserver as it happens, so Playwright round trips never add to it.
//
// "The skeleton's state matches the save" is checked generically: the whole world's state hash after
// the load equals the one saved (it covers every entity, the arena's Forgotten miner, mw-e01.5,
// included), and the creature readout is the same as at the save. mw-e01.9 checks the skeleton
// itself.

// Driver performance notices from the GPU process are not our errors (see e2e/render-boot.spec.ts).
const DRIVER_PERF_NOTICE = /^\[\.WebGL-[^\]]+\]GL Driver Message \([^)]*\bPerformance\b/;

/** The death beat in sim ticks: respawn-rules.json deathBeatSeconds (1.5) at 60 Hz. */
const BEAT_TICKS = 90;

interface Saved {
  slot: string;
  tick: number;
  hash: string;
  status?: string;
  requestedAt?: number | null;
}

interface PlayerDeath {
  tick: number;
  handoffTick: number;
  endedAt: number | null;
  rule: string | null;
  mode: string;
  killer: number | null;
  position: { x: number; y: number; z: number } | null;
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

/** Waits until the slice's player stands in a running sim. */
async function ready(page: Page): Promise<void> {
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-scene', 'slice', { timeout: 15_000 });
  await expect(app).toHaveAttribute('data-player', /"grounded":true/, { timeout: 15_000 });
}

/** Types `line` into the debug console, leaving it open. */
async function type(page: Page, line: string): Promise<void> {
  await page.keyboard.press('Backquote');
  const input = page.getByTestId('debug-console-input');
  await expect(input).toBeFocused();
  await page.keyboard.type(line);
  await page.keyboard.press('Enter');
}

/** Types `line` into the debug console and closes it again. */
async function run(page: Page, line: string): Promise<void> {
  await type(page, line);
  await page.keyboard.press('Escape');
  await expect(page.locator('#app')).toHaveAttribute('data-debug-console', 'closed');
}

test('AC-2: dying in the slice arena plays a 90-tick death beat, and Load last save is playable within 3 s at the save’s state', async ({
  page,
}) => {
  test.setTimeout(150_000);
  const problems = collectProblems(page);
  // On every page: the wall-clock time the player first moves on from a loaded save (the first sim
  // step after it), and whether the death screen was ever open while the beat still ran.
  await page.addInitScript(() => {
    const w = window as unknown as { playableAt?: number; screenDuringBeat?: boolean };
    const observer = new MutationObserver(() => {
      const app = document.querySelector<HTMLElement>('#app');
      const death = app?.dataset['playerDeath'];
      if (death !== undefined && document.querySelector('[data-screen="death"]') !== null) {
        if ((JSON.parse(death) as { endedAt: number | null }).endedAt === null) {
          w.screenDuringBeat = true;
        }
      }
      const loaded = app?.dataset['loadedSave'];
      const player = app?.dataset['player'];
      if (loaded === undefined || player === undefined || w.playableAt !== undefined) return;
      const { tick } = JSON.parse(loaded) as { tick: number };
      if ((JSON.parse(player) as { tick: number }).tick <= tick) return;
      w.playableAt = Date.now();
    });
    observer.observe(document, { attributes: true, childList: true, subtree: true });
  });
  await page.goto('/?scene=slice&debug=1');
  await ready(page);
  // Warm the cache the reload will use, as a second visit would be.
  await page.waitForLoadState('networkidle');

  // Into the arena (x −6…6, z 25…37), between the doorway and the pillars; then a manual save.
  await run(page, 'tp 0 0 27');
  await expect
    .poll(async () => (await data<{ position: { z: number } }>(page, 'player')).position.z, {
      timeout: 15_000,
    })
    .toBeGreaterThan(25);
  await run(page, 'save manual-1');
  await expect(page.locator('#app')).toHaveAttribute('data-saved-game', /"slot":"manual-1"/);
  const saved = await data<Saved>(page, 'saved-game');
  const creaturesAtSave = await data<unknown>(page, 'creatures');

  // Death: one death with its position and rule, then a beat of exactly 90 sim ticks.
  await type(page, 'kill');
  await expect(page.locator('#app')).toHaveAttribute('data-player-death', /"tick"/);
  const death = await data<PlayerDeath>(page, 'player-death');
  expect(death).toMatchObject({ rule: 'slice-reload', mode: 'reload', killer: null });
  expect(death.position?.z).toBeGreaterThan(25);
  expect(death.handoffTick - death.tick).toBe(BEAT_TICKS);
  const screen = page.locator('[data-screen="death"]');
  // At ~15 ticks a second on a slow runner the beat alone takes ~6 s of wall time.
  await expect(screen).toBeVisible({ timeout: 45_000 });
  const ended = await data<PlayerDeath>(page, 'player-death');
  expect(ended.endedAt).toBe(death.tick + BEAT_TICKS);
  await expect(page.getByTestId('death-fade')).toHaveAttribute('data-opacity', '0.85');
  expect(
    await page.evaluate(
      () => (window as unknown as { screenDuringBeat?: boolean }).screenDuringBeat,
    ),
  ).toBeUndefined();
  await expect(page.locator('#app')).toHaveAttribute('data-death', /"last":"manual-1"/);

  const load = screen.getByRole('button', { name: 'Load last save' });
  await expect(load).toBeFocused();
  await load.click();
  await ready(page);
  await expect(page.locator('#app')).toHaveAttribute('data-loaded-save', /"hash"/);
  const loaded = await data<Saved>(page, 'loaded-save');
  // The world is exactly the save's: every entity (creatures included) hashes the same.
  expect(loaded).toMatchObject({ slot: 'manual-1', status: 'loaded', tick: saved.tick });
  expect(loaded.hash).toBe(saved.hash);
  expect(await data<unknown>(page, 'creatures')).toEqual(creaturesAtSave);
  // Back in play: no screen holds the sim, it steps on from the save, and the respawn is announced.
  await expect(page.locator('[data-screen]')).toHaveCount(0);
  await expect(page.locator('#app')).toHaveAttribute('data-respawned', /"mode":"reload"/, {
    timeout: 15_000,
  });
  expect(await data<unknown>(page, 'respawned')).toMatchObject({
    mode: 'reload',
    rule: 'slice-reload',
    slot: 'manual-1',
  });
  await expect(page.getByTestId('death-fade')).toBeHidden();
  const playableAt = await page.evaluate(
    () => (window as unknown as { playableAt?: number }).playableAt,
  );
  const elapsed = (playableAt ?? Infinity) - (loaded.requestedAt ?? 0);
  test.info().annotations.push({ type: 'reload-ms', description: String(elapsed) });
  expect(elapsed).toBeGreaterThan(0);
  expect(elapsed).toBeLessThanOrEqual(3_000);
  expect(problems).toEqual([]);
});
