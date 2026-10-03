import { expect, test, type Page } from '@playwright/test';
import {
  holdKey,
  playerState,
  stubPointerLock,
  takeControl,
  turnTo,
  type PlayerState,
} from './helpers/player';

// mw-e01.4: the vertical slice's grey-box level (?scene=slice) against the production build
// (Chromium). The required route is a straight line north along x = 0 (docs/design/vertical-slice.md
// §4): the bot walks up against the spawn-room door and opens it with Interact (E), walks the
// corridor through CP-1 and CP-2, crosses the arena between the pillars and walks into the locked
// iron exit door without the key. The page publishes the doors on #app[data-mechanisms], the
// checkpoints entered on #app[data-checkpoints], the world facts on #app[data-facts] and the player
// on #app[data-player]; the test only reads them.
//
// Walking is paced by sim ticks and checked against the published position, never by wall time:
// CI renders a few frames a second and the frame loop runs at most five ticks a frame, so a slow
// runner only costs frames (see e2e/helpers/player.ts, mw-e00.32).

// Driver performance notices from the GPU process are not our errors (see e2e/render-boot.spec.ts).
const DRIVER_PERF_NOTICE = /^\[\.WebGL-[^\]]+\]GL Driver Message \([^)]*\bPerformance\b/;

const W = { code: 'KeyW', key: 'w' };
const E = { code: 'KeyE', key: 'e' };

/** Sim ticks per metre of walking: 5 m/s at 60 Hz. */
const TICKS_PER_METRE = 12;

interface Mechanisms {
  doors: Record<string, { status: string; openness: number }>;
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

/**
 * Walks north along x = 0 until the player's z reaches `target`, or until a leg makes no headway
 * (something solid in the way). Each leg aims at (0, target), holds W for the ticks the remaining
 * distance needs and lets the player come to rest, then reads where it got to. Returns the state
 * where it stopped.
 */
async function walkNorth(page: Page, target: number, maxLegs = 12): Promise<PlayerState> {
  let state = await playerState(page);
  for (let leg = 0; leg < maxLegs && state.position.z < target; leg++) {
    await turnTo(page, { x: 0, z: target + 2 }, { tolerance: 0.03 });
    const ticks = Math.max(5, Math.ceil((target - state.position.z) * TICKS_PER_METRE));
    const before = state.position.z;
    state = await holdKey(page, W, ticks, 8);
    if (state.position.z - before < 0.05) break;
  }
  return state;
}

/** Presses Interact for one tick (the frame loop may hold it a few more). */
async function interact(page: Page): Promise<void> {
  await holdKey(page, E, 1, 5);
}

test('mw-e01.4 AC-3: walking the route into the exit without the key, it stays locked with a "Locked." prompt and the slice is not complete', async ({
  page,
}) => {
  // About 650 sim ticks of walking, doors and coasting: at most five ticks a frame, ~45 s on a ~3 fps
  // runner, and up to twice that when frames come slower still, plus a round trip (~1 s there) per
  // leg and turn.
  test.setTimeout(240_000);
  const problems = collectProblems(page);
  await stubPointerLock(page);
  await page.goto('/?scene=slice');
  const app = page.locator('#app');
  await expect(app).toHaveAttribute('data-scene', 'slice', { timeout: 10_000 });
  await expect(app).toHaveAttribute('data-player', /"grounded":true/);
  await expect(app).toHaveAttribute('data-mechanisms', /"exit-door":\{"status":"locked"/);
  await expect(app).toHaveAttribute('data-facts', '{}');
  await takeControl(page);

  // Spawn room: up against the wooden door (it stops the player short of z = 5) and open it.
  const atDoor = await walkNorth(page, 4.5);
  expect(atDoor.position.z).toBeGreaterThan(4);
  expect(atDoor.position.z).toBeLessThan(5);
  const prompt = page.getByTestId('interact-prompt');
  await expect(prompt).toContainText('Open', { timeout: 10_000 });
  await interact(page);
  await expect
    .poll(async () => (await data<Mechanisms>(page, 'mechanisms')).doors['spawn-door'], {
      timeout: 30_000,
    })
    .toEqual({ status: 'open', openness: 1 });

  // The corridor: CP-1 just past the door, CP-2 at its end before the arena.
  const corridorEnd = await walkNorth(page, 24.2);
  expect(corridorEnd.position.z).toBeGreaterThan(23.5);
  await expect
    .poll(async () => data<string[]>(page, 'checkpoints'), { timeout: 10_000 })
    .toEqual(['cp-1', 'cp-2']);

  // Across the arena and into the iron door: it holds the player in the arena, locked, with the
  // lock's hint.
  const atExit = await walkNorth(page, 36.5);
  expect(atExit.position.z).toBeGreaterThan(35.5);
  expect(atExit.position.z).toBeLessThan(37);
  await expect(prompt).toContainText('Locked.', { timeout: 10_000 });
  await interact(page);
  // Push on into it for half a second of sim time: still nowhere.
  const pushed = await holdKey(page, W, 30, 8);
  expect(pushed.position.z).toBeLessThan(37);
  expect((await data<Mechanisms>(page, 'mechanisms')).doors['exit-door']).toEqual({
    status: 'locked',
    openness: 0,
  });
  await expect(prompt).toContainText('Locked.');
  // No slice complete: the fact was never written.
  expect(await data<Record<string, unknown>>(page, 'facts')).toEqual({});
  expect(problems).toEqual([]);
});
