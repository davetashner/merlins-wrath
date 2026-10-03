import { expect, test, type Page } from '@playwright/test';
import { playerState } from './helpers/player';

// mw-e04.10: the combat HUD in the combat sandbox (?scene=combat-sandbox) against the production build
// (Chromium, 1280×720). The sandbox publishes each fighter's sim health on #app[data-frame-data]
// after every drawn frame whose tick changed; the HUD's health bar carries the value it shows on
// data-value / aria-valuenow. The debug console (open in the sandbox) moves the player in front of
// the attacker dummy, which swings every 120 ticks; the test then watches frame by frame, inside the
// page, until the hit lands, so a slow runner costs frames rather than round trips.

// Driver performance notices from the GPU process are not our errors (see e2e/render-boot.spec.ts).
const DRIVER_PERF_NOTICE = /^\[\.WebGL-[^\]]+\]GL Driver Message \([^)]*\bPerformance\b/;
// A starved software-GL frame drops sim steps and says so; that is the runner, not the HUD.
const FRAME_LOOP_NOTICE = 'frame loop: ';

interface HitWatch {
  /** Frames the watch looked at before (and including) the hit. */
  frames: number;
  /** Frames where the HUD's health differed from the sim's. */
  mismatches: { sim: number | null; hud: string | null }[];
  hit: {
    sim: { current: number; max: number };
    hud: { value: string | null; now: string | null; max: string | null };
    bars: { left: number; top: number; right: number; bottom: number }[];
  } | null;
}

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

test('AC-5: when the player takes a dummy hit in the combat sandbox, the HUD health matches the sim health within one rendered frame', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const problems = collectProblems(page);
  await page.goto('/?scene=combat-sandbox');
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-scene', 'combat-sandbox', { timeout: 10_000 });
  await expect(app).toHaveAttribute('data-frame-data', /"role":"player"/);
  const health = page.getByTestId('combat-hud').getByRole('meter', { name: 'Health' });
  await expect(health).toHaveAttribute('aria-valuenow', '100');

  // Watch every frame from before the teleport, so the hit frame itself is seen however slow the
  // round trips that follow are.
  await page.evaluate(() => {
    const target = window as unknown as { combatHudWatch?: Promise<HitWatch> };
    target.combatHudWatch = new Promise<HitWatch>((resolve) => {
      interface Fighter {
        role: string;
        health: { current: number; max: number } | null;
      }
      const app = document.querySelector<HTMLElement>('#app');
      const meter = () =>
        document.querySelector<HTMLElement>(
          '[data-testid="combat-hud"] [role="meter"][aria-label="Health"]',
        );
      const read = () => {
        const data = JSON.parse(app?.dataset['frameData'] ?? 'null') as {
          tick: number;
          fighters: Fighter[];
        } | null;
        return { tick: data?.tick ?? 0, player: data?.fighters.find((f) => f.role === 'player') };
      };
      const start = read().tick;
      const mismatches: HitWatch['mismatches'] = [];
      let frames = 0;
      const look = () => {
        frames += 1;
        const { tick, player } = read();
        const el = meter();
        const shown = el?.dataset['value'] ?? null;
        const sim = player?.health ?? null;
        if (sim === null || shown !== String(sim.current)) {
          mismatches.push({ sim: sim?.current ?? null, hud: shown });
        }
        if (sim !== null && sim.current < sim.max) {
          const bars = [
            ...document.querySelectorAll<HTMLElement>('[data-testid="combat-hud"] [role="meter"]'),
          ].map((bar) => {
            const r = bar.getBoundingClientRect();
            return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
          });
          resolve({
            frames,
            mismatches,
            hit: {
              sim,
              hud: {
                value: shown,
                now: el?.getAttribute('aria-valuenow') ?? null,
                max: el?.getAttribute('aria-valuemax') ?? null,
              },
              bars,
            },
          });
          return;
        }
        // Five attacker periods without a hit: give up and report it.
        if (tick - start > 600) {
          resolve({ frames, mismatches, hit: null });
          return;
        }
        requestAnimationFrame(look);
      };
      requestAnimationFrame(look);
    });
  });

  // Stand 1 m in front of the attacker dummy (at x 2, z 1); it turns to the player as it swings.
  const { y } = (await playerState(page)).position;
  await expect(app).toHaveAttribute('data-debug-console', 'closed', { timeout: 10_000 });
  await page.keyboard.press('Backquote');
  await expect(page.getByTestId('debug-console-input')).toBeFocused();
  // One input event for the whole line: per-key typing costs a round trip a character.
  await page.keyboard.insertText(`tp 2 ${String(y)} 0`);
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  const watch = await page.evaluate(
    () => (window as unknown as { combatHudWatch: Promise<HitWatch> }).combatHudWatch,
  );

  expect(watch.hit, 'the attacker dummy hit the player').not.toBeNull();
  const hit = watch.hit;
  if (hit === null) return;
  expect(hit.sim.current).toBe(85); // the dummy swing deals 15 of the player's 100
  expect(hit.hud).toEqual({ value: '85', now: '85', max: '100' });
  expect(watch.mismatches).toEqual([]);
  const viewport = page.viewportSize();
  for (const bar of hit.bars) {
    expect(bar.left).toBeGreaterThanOrEqual(0);
    expect(bar.top).toBeGreaterThanOrEqual(0);
    expect(bar.right).toBeLessThanOrEqual(viewport?.width ?? 0);
    expect(bar.bottom).toBeLessThanOrEqual(viewport?.height ?? 0);
  }
  expect(problems).toEqual([]);
});
